import { createHash, randomUUID } from "node:crypto";
import { SpeechifyClient } from "@speechify/api";
import { PRICING_PLANS } from "./billing-service.js";
import type { Database } from "./database.js";
import type { HostedJob } from "./hosted-generation-service.js";
import {
  compactNarrationText,
  ELEVENLABS_MODEL,
  ELEVENLABS_OUTPUT_FORMAT,
  NARRATION_SPEED,
  narrationVoiceDefinition,
} from "./narration.js";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export class ScopedNarrationService {
  constructor(
    private readonly db: Database,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async assertNarrationEntitlement(ownerId: string) {
    const result = await this.db.query<{
      plan: keyof typeof PRICING_PLANS;
      status: string;
      role: string;
    }>(
      `SELECT bp.plan, bp.status, u.role
         FROM billing_profiles bp
         JOIN app_users u ON u.id = bp.user_id
        WHERE bp.user_id = $1`,
      [ownerId],
    );
    const profile = result.rows[0];
    const staff = profile?.role === "staff" || profile?.role === "admin";
    const subscribed = Boolean(
      profile && profile.plan !== "free" && ["active", "trialing"].includes(profile.status),
    );
    const allowed = staff || (subscribed && PRICING_PLANS[profile!.plan]?.entitlements.narration);
    if (!allowed) throw new Error("AI voice is available on paid plans.");
  }

  async speak(job: HostedJob, input: { index?: unknown; text?: unknown }) {
    const voice = narrationVoiceDefinition(job.input.narrationPreferences?.voice);
    const apiKey = voice.provider === "elevenlabs"
      ? process.env.ELEVENLABS_API_KEY?.trim()
      : process.env.SPEECHIFY_API_KEY?.trim();
    if (!apiKey) throw new Error(`${voice.provider === "elevenlabs" ? "ElevenLabs" : "Speechify"} narration is not configured.`);
    // The submit-time check is not enough: the plan can lapse mid-job, and the
    // sandbox holds the callback token, so re-check the owner's entitlement.
    await this.assertNarrationEntitlement(job.ownerId);
    const index = Number(input.index);
    const text = typeof input.text === "string" ? compactNarrationText(input.text) : "";
    if (!Number.isInteger(index) || index < 0 || index >= 12 || !text || text.length > 1800) {
      throw new Error("Narration segment is invalid.");
    }
    const requestHash = createHash("sha256").update(`${voice.key}:${text}`).digest("hex");
    const idempotencyKey = `segment:${index}:${requestHash.slice(0, 16)}`;
    const claimed = await this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`narration:${job.id}`]);
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job_provider_calls WHERE job_id = $1 AND provider = 'narration'",
        [job.id],
      );
      if (Number(count.rows[0]?.count || 0) >= 12) throw new Error("Narration segment limit reached.");
      const result = await client.query(
        `INSERT INTO job_provider_calls (id, job_id, provider, idempotency_key, request_hash)
         VALUES ($1, $2, 'narration', $3, $4)
         ON CONFLICT (job_id, provider, idempotency_key) DO NOTHING RETURNING id`,
        [randomUUID(), job.id, idempotencyKey, requestHash],
      );
      return Boolean(result.rowCount);
    });
    if (!claimed) throw new Error("This narration segment was already requested.");
    try {
      if (voice.provider === "speechify") {
        const client = new SpeechifyClient({ token: apiKey });
        const response = await client.audio.speech({
          input: `<speak><speechify:style emotion="warm">${escapeXml(text)}</speechify:style></speak>`,
          voice_id: voice.voiceId,
          model: "simba-3.2",
          audio_format: "mp3",
          output_format: "mp3_24000_160",
          language: "en-US",
        }, { timeoutInSeconds: 120 });
        if (!response.audio_data) throw new Error("Speechify returned no audio data.");
        return {
          audioData: response.audio_data,
          provider: voice.provider,
          model: "simba-3.2",
          voice: voice.key,
          voiceId: voice.voiceId,
          rate: "natural",
        };
      }

      const response = await this.fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            voice_settings: {
              stability: 0.45,
              similarity_boost: 0.8,
              style: 0.2,
              use_speaker_boost: true,
              speed: NARRATION_SPEED,
            },
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 24 * 1024 * 1024)
        throw new Error("ElevenLabs returned invalid audio data.");
      return {
        audioData: audio.toString("base64"),
        provider: voice.provider,
        model: ELEVENLABS_MODEL,
        voice: voice.key,
        voiceId: voice.voiceId,
        rate: NARRATION_SPEED === 1 ? "natural" : `${NARRATION_SPEED}x`,
      };
    } catch (error) {
      await this.db.query(
        "DELETE FROM job_provider_calls WHERE job_id = $1 AND provider = 'narration' AND idempotency_key = $2",
        [job.id, idempotencyKey],
      );
      throw error;
    }
  }
}
