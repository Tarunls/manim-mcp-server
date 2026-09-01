import assert from "node:assert/strict";
import test from "node:test";
import { compactNarrationText } from "../server/narration.js";
import { ScopedNarrationService } from "../server/scoped-narration.js";
import type { Database, SqlClient } from "../server/database.js";
import type { HostedJob } from "../server/hosted-generation-service.js";

test("narration text removes pause-heavy formatting", () => {
  assert.equal(
    compactNarrationText("First idea...\n\nThen the payoff!!!"),
    "First idea. Then the payoff!",
  );
});

test("selected ElevenLabs voice is enforced with short-form pacing", async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  let requestUrl = "";
  let requestHeaders: HeadersInit | undefined;
  let requestBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = init?.headers;
    requestBody = JSON.parse(String(init?.body));
    return new Response(Buffer.from("test-mp3"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  };
  const client = {
    query: async (text: string) => {
      if (text.includes("count(*)")) return { rows: [{ count: "0" }] };
      if (text.includes("INSERT INTO job_provider_calls")) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  } as unknown as SqlClient;
  const db = {
    query: async (text: string) => {
      if (text.includes("FROM billing_profiles")) {
        return { rows: [{ plan: "creator", status: "active", role: "user" }] };
      }
      return { rows: [], rowCount: 0 };
    },
    transaction: async (callback: (sql: SqlClient) => Promise<unknown>) => callback(client),
  } as unknown as Database;
  const job = {
    id: "00000000-0000-4000-8000-000000000001",
    ownerId: "owner-1",
    projectId: "project-1",
    status: "running",
    prompt: "Explain limits",
    renderer: "manim",
    effort: "quick",
    templateVersion: "release-test",
    reservedCredits: 1,
    input: { narrationPreferences: { enabled: true, voice: "seductive-male" } },
  } satisfies HostedJob;

  try {
    const result = await new ScopedNarrationService(db, fetchImpl).speak(job, {
      index: 0,
      text: "First idea...\nThen the payoff!!!",
    });
    assert.match(requestUrl, /KH1SQLVulwP6uG4O3nmT/);
    assert.equal(new Headers(requestHeaders).get("xi-api-key"), "test-elevenlabs-key");
    assert.equal(requestBody.text, "First idea. Then the payoff!");
    assert.deepEqual(requestBody.voice_settings, {
      stability: 0.45,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
      speed: 1.08,
    });
    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.voice, "seductive-male");
    assert.equal(result.audioData, Buffer.from("test-mp3").toString("base64"));
  } finally {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});
