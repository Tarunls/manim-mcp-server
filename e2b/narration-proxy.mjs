import { createServer } from "node:http";

const maximumRequestBytes = 16 * 1024;
const maximumResponseBytes = 24 * 1024 * 1024;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > maximumRequestBytes) {
        reject(new Error("Narration request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export async function startNarrationProxy({ callbackUrl, callbackToken, fetchImpl = fetch }) {
  if (!callbackUrl || !callbackToken)
    throw new Error("Narration proxy callback configuration is missing.");
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/narration") {
      response.writeHead(404).end();
      return;
    }
    try {
      const input = JSON.parse((await readBody(request)).toString("utf8"));
      const index = Number(input?.index);
      const text = typeof input?.text === "string" ? input.text.trim() : "";
      if (!Number.isInteger(index) || index < 0 || index >= 40 || !text || text.length > 1800) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Narration segment is invalid." }));
        return;
      }
      const upstream = await fetchImpl(`${callbackUrl.replace(/\/$/, "")}/narration`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${callbackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ index, text }),
        signal: AbortSignal.timeout(3 * 60_000),
      });
      const declared = Number(upstream.headers.get("content-length") || 0);
      if (declared > maximumResponseBytes)
        throw new Error("Narration response is too large.");
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > maximumResponseBytes)
        throw new Error("Narration response is too large.");
      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Content-Length": String(body.length),
      });
      response.end(body);
    } catch {
      if (!response.headersSent)
        response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Narration provider request failed." }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Narration proxy did not bind to loopback.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/narration`,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}
