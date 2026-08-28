import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { HostedGenerationService, HostedJob } from "./hosted-generation-service.js";
import type { ScopedCodexProxy } from "./scoped-codex-proxy.js";

const maximumPayloadBytes = 16 * 1024 * 1024;
const maximumMessagesPerSocket = 32;
const forwardedHeaders = [
  "openai-beta",
  "originator",
  "version",
  "x-client-request-id",
  "x-codex-beta-features",
  "x-codex-installation-id",
  "x-codex-routing-hint",
  "x-codex-turn-metadata",
  "x-codex-turn-state",
  "x-codex-window-id",
  "x-oai-attestation",
  "x-openai-subagent",
  "session-id",
  "thread-id",
] as const;

function reject(socket: Socket, status: 401 | 404 | 502) {
  const label = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Gateway";
  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
  socket.destroy();
}

function requestHeader(request: IncomingMessage, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function rawDataBytes(data: RawData) {
  return Array.isArray(data)
    ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
    : data.byteLength;
}

function safeClose(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason.slice(0, 120));
  else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

export function attachScopedCodexWebSocketProxy(
  server: Server,
  dependencies: {
    generations: Pick<HostedGenerationService, "verifyCodexAccess">;
    proxy: Pick<ScopedCodexProxy, "prepareWebSocketMessage" | "completeCall" | "discardCall">;
    upstreamUrl?: string;
    upstreamApiKey?: () => string | undefined;
  },
) {
  const sockets = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: maximumPayloadBytes,
    perMessageDeflate: false,
  });

  server.on("upgrade", async (request, socket, head) => {
    const networkSocket = socket as Socket;
    networkSocket.setTimeout(30_000, () => networkSocket.destroy());
    let match: RegExpMatchArray | null = null;
    try {
      const url = new URL(request.url || "", "http://localhost");
      match = url.pathname.match(/^\/api\/internal\/codex\/([^/]+)\/v1\/responses$/);
    } catch {
      // Rejected below.
    }
    if (!match) return reject(networkSocket, 404);
    const token = String(requestHeader(request, "authorization") || "").replace(/^Bearer\s+/i, "");
    const job = await dependencies.generations
      .verifyCodexAccess(decodeURIComponent(match[1]), token)
      .catch(() => undefined);
    if (!job) return reject(networkSocket, 401);

    const apiKey = dependencies.upstreamApiKey?.() || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return reject(networkSocket, 502);
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    for (const name of forwardedHeaders) {
      const value = requestHeader(request, name);
      if (value) headers[name] = value.slice(0, 4096);
    }
    headers["openai-beta"] ||= "responses_websockets=2026-02-06";

    const upstream = new WebSocket(
      dependencies.upstreamUrl || "wss://api.openai.com/v1/responses",
      { headers, maxPayload: maximumPayloadBytes, perMessageDeflate: false, handshakeTimeout: 30_000 },
    );
    let downstream: WebSocket | undefined;
    let activeCall: Awaited<ReturnType<ScopedCodexProxy["prepareWebSocketMessage"]>>["call"];
    let messages = 0;
    let processing = Promise.resolve();

    const failActiveCall = async () => {
      const call = activeCall;
      activeCall = undefined;
      if (call) await dependencies.proxy.discardCall(call);
    };
    const fail = (message: string) => {
      void failActiveCall();
      if (downstream?.readyState === WebSocket.OPEN) {
        downstream.send(JSON.stringify({ type: "error", code: "proxy_error", message }));
        safeClose(downstream, 1011, "OpenAI proxy failed");
      } else reject(networkSocket, 502);
      safeClose(upstream, 1011, "OpenAI proxy failed");
    };

    upstream.once("open", () => {
      networkSocket.setTimeout(0);
      sockets.handleUpgrade(request, socket, head, (accepted) => {
        downstream = accepted;
        accepted.on("message", (data, isBinary) => {
          processing = processing.then(async () => {
            messages += 1;
            if (isBinary || rawDataBytes(data) > maximumPayloadBytes || messages > maximumMessagesPerSocket)
              throw new Error("OpenAI WebSocket request exceeded its safety limit.");
            const prepared = await dependencies.proxy.prepareWebSocketMessage(
              job as HostedJob,
              JSON.parse(data.toString("utf8")),
            );
            if (prepared.call) {
              if (activeCall) throw new Error("Concurrent OpenAI responses are not allowed.");
              activeCall = prepared.call;
            }
            if (upstream.readyState !== WebSocket.OPEN)
              throw new Error("OpenAI WebSocket closed unexpectedly.");
            upstream.send(prepared.serialized);
          }).catch((error) => fail(error instanceof Error ? error.message : "OpenAI request failed."));
        });
        accepted.on("close", () => {
          void failActiveCall();
          safeClose(upstream, 1000, "Client disconnected");
        });
        accepted.on("error", () => {
          void failActiveCall();
          safeClose(upstream, 1011, "Client connection failed");
        });
      });
    });

    upstream.on("message", (data, isBinary) => {
      if (!downstream || downstream.readyState !== WebSocket.OPEN) return;
      if (isBinary || rawDataBytes(data) > maximumPayloadBytes) return fail("OpenAI returned an invalid WebSocket event.");
      let event: Record<string, unknown> | undefined;
      try {
        event = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      } catch {
        return fail("OpenAI returned an invalid WebSocket event.");
      }
      if (downstream.bufferedAmount > maximumPayloadBytes)
        return fail("OpenAI WebSocket response exceeded its safety limit.");
      downstream.send(data, { binary: false });
      if (["response.completed", "response.failed", "response.incomplete"].includes(String(event.type))) {
        const call = activeCall;
        activeCall = undefined;
        if (call) {
          const status = event.type === "response.completed" ? 200 : 502;
          void dependencies.proxy.completeCall(call, status, event).catch(() => undefined);
        }
      }
    });
    upstream.once("unexpected-response", (_request, response) => {
      response.resume();
      fail(`OpenAI rejected the WebSocket connection with HTTP ${response.statusCode}.`);
    });
    upstream.once("error", () => fail("OpenAI WebSocket connection failed."));
    upstream.once("close", (code) => {
      void failActiveCall();
      if (downstream) safeClose(downstream, code === 1000 ? 1000 : 1011, "OpenAI connection closed");
    });
  });

  return sockets;
}
