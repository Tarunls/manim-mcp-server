import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { startNarrationProxy } from "../e2b/narration-proxy.mjs";

test("sandbox narration proxy keeps the callback credential out of renderer requests", async () => {
  let received;
  const callback = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = {
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ audioData: "c2FmZS1hdWRpbw==" }));
    });
  });
  callback.listen(0, "127.0.0.1");
  await once(callback, "listening");
  const address = callback.address();
  assert.ok(address && typeof address !== "string");
  const proxy = await startNarrationProxy({
    callbackUrl: `http://127.0.0.1:${address.port}/job`,
    callbackToken: "callback-secret",
  });
  try {
    const response = await fetch(proxy.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: 0, text: "Three plus three equals six." }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { audioData: "c2FmZS1hdWRpbw==" });
    assert.deepEqual(received, {
      authorization: "Bearer callback-secret",
      body: { index: 0, text: "Three plus three equals six." },
    });
    assert.equal((await fetch(proxy.url)).status, 404);
    assert.equal(
      (
        await fetch(proxy.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index: 99, text: "invalid" }),
        })
      ).status,
      400,
    );
  } finally {
    await proxy.close();
    callback.close();
  }
});
