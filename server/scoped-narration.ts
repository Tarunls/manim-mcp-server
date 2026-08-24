import { createHash, randomUUID } from "node:crypto";
import { SpeechifyClient } from "@speechify/api";
import type { Database } from "./database.js";
import type { HostedJob } from "./hosted-generation-service.js";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export class ScopedNarrationService {
  constructor(private readonly db: Database) {}

  async speak(job: HostedJob, input: { index?: unknown; text?: unknown }) {
    const apiKey = process.env.SPEECHIFY_API_KEY?.trim();
    if (!apiKey) throw new Error("Speechify narration is not configured.");
    const index = Number(input.index);
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!Number.isInteger(index) || index < 0 || index >= 12 || !text || text.length > 1800) {
      throw new Error("Narration segment is invalid.");
    }
    const requestHash = createHash("sha256").update(text).digest("hex");
    const idempotencyKey = `segment:${index}:${requestHash.slice(0, 16)}`;
    const claimed = await this.db.transaction(async (client) => {
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job_provider_calls WHERE job_id = $1 AND provider = 'speechify'",
        [job.id],
      );
      if (Number(count.rows[0]?.count || 0) >= 12) throw new Error("Narration segment limit reached.");
      const result = await client.query(
        `INSERT INTO job_provider_calls (id, job_id, provider, idempotency_key, request_hash)
         VALUES ($1, $2, 'speechify', $3, $4)
         ON CONFLICT (job_id, provider, idempotency_key) DO NOTHING RETURNING id`,
        [randomUUID(), job.id, idempotencyKey, requestHash],
      );
      return Boolean(result.rowCount);
    });
    if (!claimed) throw new Error("This narration segment was already requested.");
    try {
      const client = new SpeechifyClient({ token: apiKey });
      const response = await client.audio.speech({
        input: `<speak><speechify:style emotion="warm"><prosody rate="-5%">${escapeXml(text)}</prosody></speechify:style></speak>`,
        voice_id: process.env.SPEECHIFY_VOICE_ID?.trim() || "geffen_32",
        model: "simba-3.2",
        audio_format: "mp3",
        output_format: "mp3_24000_160",
        language: "en-US",
      });
      if (!response.audio_data) throw new Error("Speechify returned no audio data.");
      return { audioData: response.audio_data };
    } catch (error) {
      await this.db.query(
        "DELETE FROM job_provider_calls WHERE job_id = $1 AND provider = 'speechify' AND idempotency_key = $2",
        [job.id, idempotencyKey],
      );
      throw error;
    }
  }
}
