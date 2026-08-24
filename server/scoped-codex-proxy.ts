import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import type { HostedJob } from "./hosted-generation-service.js";

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export class ScopedCodexProxy {
  constructor(private readonly db: Database) {}

  get configured() {
    return Boolean(this.db.configured && process.env.OPENAI_API_KEY?.trim());
  }

  async responses(job: HostedJob, body: unknown, options: { headers?: Record<string, string | undefined>; compact?: boolean } = {}) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OpenAI is not configured.");
    const serialized = JSON.stringify(body ?? {});
    if (!serialized || serialized.length > 16 * 1024 * 1024) throw new Error("OpenAI request is invalid.");
    const callId = randomUUID();
    const requestHash = createHash("sha256").update(serialized).digest("hex");
    await this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`openai:${job.id}`]);
      const active = await client.query<{ status: string }>(
        "SELECT status FROM generation_jobs WHERE id = $1 FOR UPDATE",
        [job.id],
      );
      if (!["dispatching", "running", "uploading"].includes(active.rows[0]?.status || "")) throw new Error("Generation is no longer active.");
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job_provider_calls WHERE job_id = $1 AND provider = 'openai'",
        [job.id],
      );
      const limit = boundedInteger(process.env.CODEX_MAX_API_CALLS_PER_JOB, 64, 1, 200);
      if (Number(count.rows[0]?.count || 0) >= limit) throw new Error("OpenAI request limit reached for this generation.");
      await client.query(
        `INSERT INTO job_provider_calls (id, job_id, provider, idempotency_key, request_hash)
         VALUES ($1, $2, 'openai', $3, $4)`,
        [callId, job.id, `request:${callId}`, requestHash],
      );
    });
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: options.headers?.accept || "text/event-stream, application/json",
      };
      for (const name of ["openai-beta", "x-client-request-id", "x-codex-installation-id", "x-codex-routing-hint", "x-codex-turn-state", "x-oai-attestation", "x-openai-subagent"]) {
        const value = options.headers?.[name];
        if (value) headers[name] = value.slice(0, 4096);
      }
      return await fetch(`https://api.openai.com/v1/responses${options.compact ? "/compact" : ""}`, {
        method: "POST",
        headers,
        body: serialized,
        signal: AbortSignal.timeout(boundedInteger(process.env.CODEX_UPSTREAM_TIMEOUT_MS, 45 * 60_000, 1_000, 3_600_000)),
      });
    } catch (error) {
      await this.db.query("DELETE FROM job_provider_calls WHERE id = $1", [callId]).catch(() => undefined);
      throw error;
    }
  }
}
