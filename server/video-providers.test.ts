import assert from "node:assert/strict";
import test from "node:test";
import { GoogleVideoProvider, OpenAIVideoProvider, RunwayVideoProvider, type GeneratedVideoRequest } from "./generation/video-providers.js";

const request: GeneratedVideoRequest = { prompt: "A paper sculpture unfolding", width: 1920, height: 1080, seconds: 9 };

function queuedFetch(responses: Array<Response | ((url: string, init?: RequestInit) => Response)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const value = responses.shift();
    if (!value) throw new Error("Unexpected fetch call.");
    return typeof value === "function" ? value(url, init) : value;
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

test("OpenAI adapter creates, polls, and archives asynchronous video jobs", async () => {
  const mock = queuedFetch([
    new Response(JSON.stringify({ id: "video_1", status: "queued", progress: 0, model: "sora-2-pro" }), { status: 200 }),
    new Response(JSON.stringify({ id: "video_1", status: "completed", progress: 100, model: "sora-2-pro" }), { status: 200 }),
    new Response(Buffer.from("mp4"), { status: 200 }),
  ]);
  const provider = new OpenAIVideoProvider("secret", mock.fetcher);
  const created = await provider.submit(request);
  const body = JSON.parse(String(mock.calls[0].init?.body));
  assert.deepEqual({ model: body.model, seconds: body.seconds, size: body.size }, { model: "sora-2-pro", seconds: "8", size: "1920x1080" });
  const complete = await provider.inspect(created);
  assert.equal(complete.status, "complete");
  assert.match(mock.calls[1].url, /\/v1\/videos\/video_1$/);
});

test("Runway adapter pins its API version and preserves ephemeral output for download", async () => {
  const mock = queuedFetch([
    new Response(JSON.stringify({ id: "task_1" }), { status: 200 }),
    new Response(JSON.stringify({ status: "SUCCEEDED", progressRatio: 1, output: ["https://cdn.example/video.mp4"] }), { status: 200 }),
  ]);
  const provider = new RunwayVideoProvider("secret", mock.fetcher);
  const created = await provider.submit(request);
  assert.equal((mock.calls[0].init?.headers as Record<string, string>)["X-Runway-Version"], "2024-11-06");
  const complete = await provider.inspect(created);
  assert.equal(complete.outputUrl, "https://cdn.example/video.mp4");
  assert.equal(complete.status, "complete");
});

test("Google adapter maps long-running operations into the common job shape", async () => {
  const mock = queuedFetch([
    new Response(JSON.stringify({ name: "operations/op_1" }), { status: 200 }),
    new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://google.example/video" } }] } } }), { status: 200 }),
  ]);
  const provider = new GoogleVideoProvider("secret", mock.fetcher);
  const created = await provider.submit(request);
  assert.equal(created.id, "operations/op_1");
  const complete = await provider.inspect(created);
  assert.equal(complete.status, "complete");
  assert.equal(complete.outputUrl, "https://google.example/video");
  assert.equal((mock.calls[0].init?.headers as Record<string, string>)["x-goog-api-key"], "secret");
});
