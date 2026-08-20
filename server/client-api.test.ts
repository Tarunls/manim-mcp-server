import assert from "node:assert/strict";
import test from "node:test";
import { apiRequest } from "../client/src/api.js";

test("client API reports an unreachable local server clearly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    await assert.rejects(apiRequest("/api/state"), /Cannot reach the local server/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client API identifies a stale server route", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Cannot POST /api/new-route", { status: 404, headers: { "Content-Type": "text/html" } });
  try {
    await assert.rejects(apiRequest("/api/new-route", { method: "POST" }), /different versions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client API preserves actionable server errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "The project is already rendering." }, { status: 409 });
  try {
    await assert.rejects(apiRequest("/api/render", { method: "POST" }), /already rendering/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
