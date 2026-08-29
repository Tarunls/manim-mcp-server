import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { attachScopedCodexWebSocketProxy } from "../server/scoped-codex-websocket.js";
import type { HostedJob } from "../server/hosted-generation-service.js";

const hostedJob: HostedJob = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "owner",
  projectId: "project",
  status: "running",
  prompt: "Explain limits",
  renderer: "manim",
  effort: "balanced",
  templateVersion: "release",
  reservedCredits: 2,
  input: {},
};

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  return address.port;
}

test("Codex WebSocket transport authenticates, constrains, relays, and records a response", async () => {
  const received: Array<Record<string, unknown>> = [];
  const completed: Array<{ status: number; body: unknown }> = [];
  const upstreamServer = createServer();
  const upstreamSockets = new WebSocketServer({ noServer: true });
  upstreamServer.on("upgrade", (request, socket, head) => {
    assert.equal(request.headers.authorization, "Bearer upstream-secret");
    assert.equal(request.headers["openai-beta"], "responses_websockets=2026-02-06");
    upstreamSockets.handleUpgrade(request, socket, head, (websocket) => {
      websocket.on("message", (data) => {
        received.push(JSON.parse(data.toString()) as Record<string, unknown>);
        websocket.send(JSON.stringify({
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 4 },
              output_tokens: 5,
            },
          },
        }));
      });
    });
  });
  const upstreamPort = await listen(upstreamServer);

  const appServer = createServer((_request, response) => response.writeHead(404).end());
  const websocketServer = attachScopedCodexWebSocketProxy(appServer, {
    generations: {
      verifyCodexAccess: async (jobId, token) =>
        jobId === hostedJob.id && token === "job-token" ? hostedJob : undefined,
    },
    proxy: {
      prepareWebSocketMessage: async (_job, body) => {
        const event = body as Record<string, unknown>;
        return {
          serialized: JSON.stringify({ ...event, model: "gpt-5.6-terra", max_output_tokens: 12_000 }),
          call: { callId: "call-1", model: "gpt-5.6-terra" },
        };
      },
      completeCall: async (_call, status, body) => {
        completed.push({ status, body });
      },
      discardCall: async () => undefined,
    },
    upstreamUrl: `ws://127.0.0.1:${upstreamPort}/v1/responses`,
    upstreamApiKey: () => "upstream-secret",
  });
  const appPort = await listen(appServer);
  const client = new WebSocket(
    `ws://127.0.0.1:${appPort}/api/internal/codex/${hostedJob.id}/v1/responses`,
    { headers: { Authorization: "Bearer job-token", "openai-beta": "responses_websockets=2026-02-06" } },
  );
  try {
    await once(client, "open");
    client.send(JSON.stringify({ type: "response.create", model: "untrusted", input: "hello" }));
    const [message] = await once(client, "message") as [Buffer];
    assert.equal(JSON.parse(message.toString()).type, "response.completed");
    assert.deepEqual(received, [{
      type: "response.create",
      model: "gpt-5.6-terra",
      input: "hello",
      max_output_tokens: 12_000,
    }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed[0]?.status, 200);
  } finally {
    client.close();
    websocketServer.close();
    upstreamSockets.close();
    appServer.close();
    upstreamServer.close();
  }
});

test("Codex WebSocket transport rejects an invalid job credential before upgrade", async () => {
  const appServer = createServer((_request, response) => response.writeHead(404).end());
  const websocketServer = attachScopedCodexWebSocketProxy(appServer, {
    generations: { verifyCodexAccess: async () => undefined },
    proxy: {
      prepareWebSocketMessage: async () => { throw new Error("unreachable"); },
      completeCall: async () => undefined,
      discardCall: async () => undefined,
    },
    upstreamApiKey: () => "upstream-secret",
  });
  const port = await listen(appServer);
  const client = new WebSocket(
    `ws://127.0.0.1:${port}/api/internal/codex/${hostedJob.id}/v1/responses`,
    { headers: { Authorization: "Bearer wrong-token" } },
  );
  try {
    const [error] = await once(client, "error") as [Error];
    assert.match(error.message, /401/);
  } finally {
    client.terminate();
    websocketServer.close();
    appServer.close();
  }
});
