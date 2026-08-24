import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import type { HostedJob } from "./hosted-generation-service.js";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export function codexPolicy(effort: HostedJob["effort"]) {
  return {
    model: effort === "thorough" ? "gpt-5.6-sol" : "gpt-5.6-terra",
    maxOutputTokens: boundedInteger(
      process.env.CODEX_MAX_OUTPUT_TOKENS_PER_CALL,
      12_000,
      1_000,
      32_000,
    ),
  } as const;
}

export function constrainCodexRequest(
  job: HostedJob,
  body: unknown,
  compact = false,
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("OpenAI request is invalid.");
  const policy = codexPolicy(job.effort);
  const request: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    model: policy.model,
  };
  if (!compact) {
    const requested = Number(request.max_output_tokens);
    request.max_output_tokens =
      Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, policy.maxOutputTokens)
        : policy.maxOutputTokens;
  }
  return request;
}

function usageFrom(value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const usage =
    record.usage && typeof record.usage === "object"
      ? (record.usage as Record<string, unknown>)
      : undefined;
  if (usage) {
    const details =
      usage.input_tokens_details &&
      typeof usage.input_tokens_details === "object"
        ? (usage.input_tokens_details as Record<string, unknown>)
        : undefined;
    return {
      inputTokens: Math.max(0, Number(usage.input_tokens) || 0),
      cachedInputTokens: Math.max(0, Number(details?.cached_tokens) || 0),
      outputTokens: Math.max(0, Number(usage.output_tokens) || 0),
    };
  }
  return usageFrom(record.response);
}

function usageFromResponseBody(body: string): Usage | undefined {
  const candidates =
    body.includes("\ndata:") || body.startsWith("data:")
      ? body
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line && line !== "[DONE]")
          .reverse()
      : [body];
  for (const candidate of candidates) {
    try {
      const usage = usageFrom(JSON.parse(candidate));
      if (usage) return usage;
    } catch {
      // Streaming responses include comments and partial events that are not JSON.
    }
  }
  return undefined;
}

function estimatedCostMicrousd(model: string, usage: Usage) {
  const prices =
    model === "gpt-5.6-sol"
      ? { input: 5, cached: 0.5, output: 30 }
      : { input: 2.5, cached: 0.25, output: 15 };
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return Math.round(
    uncached * prices.input +
      usage.cachedInputTokens * prices.cached +
      usage.outputTokens * prices.output,
  );
}

export class ScopedCodexProxy {
  constructor(private readonly db: Database) {}

  get configured() {
    return Boolean(this.db.configured && process.env.OPENAI_API_KEY?.trim());
  }

  async responses(
    job: HostedJob,
    body: unknown,
    options: {
      headers?: Record<string, string | undefined>;
      compact?: boolean;
    } = {},
  ) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OpenAI is not configured.");
    const constrained = constrainCodexRequest(job, body, options.compact);
    const serialized = JSON.stringify(constrained);
    if (!serialized || serialized.length > 16 * 1024 * 1024)
      throw new Error("OpenAI request is invalid.");
    const callId = randomUUID();
    const requestHash = createHash("sha256").update(serialized).digest("hex");
    await this.db.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`openai:${job.id}`],
      );
      const active = await client.query<{ status: string }>(
        "SELECT status FROM generation_jobs WHERE id = $1 FOR UPDATE",
        [job.id],
      );
      if (
        !["dispatching", "running", "uploading"].includes(
          active.rows[0]?.status || "",
        )
      )
        throw new Error("Generation is no longer active.");
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job_provider_calls WHERE job_id = $1 AND provider = 'openai'",
        [job.id],
      );
      const limit = boundedInteger(
        process.env.CODEX_MAX_API_CALLS_PER_JOB,
        12,
        1,
        64,
      );
      if (Number(count.rows[0]?.count || 0) >= limit)
        throw new Error("OpenAI request limit reached for this generation.");
      await client.query(
        `INSERT INTO job_provider_calls (id, job_id, provider, idempotency_key, request_hash, model)
         VALUES ($1, $2, 'openai', $3, $4, $5)`,
        [
          callId,
          job.id,
          `request:${callId}`,
          requestHash,
          String(constrained.model),
        ],
      );
    });
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept:
          options.headers?.accept || "text/event-stream, application/json",
      };
      for (const name of [
        "openai-beta",
        "x-client-request-id",
        "x-codex-installation-id",
        "x-codex-routing-hint",
        "x-codex-turn-state",
        "x-oai-attestation",
        "x-openai-subagent",
      ]) {
        const value = options.headers?.[name];
        if (value) headers[name] = value.slice(0, 4096);
      }
      const upstream = await fetch(
        `https://api.openai.com/v1/responses${options.compact ? "/compact" : ""}`,
        {
          method: "POST",
          headers,
          body: serialized,
          signal: AbortSignal.timeout(
            boundedInteger(
              process.env.CODEX_UPSTREAM_TIMEOUT_MS,
              45 * 60_000,
              1_000,
              3_600_000,
            ),
          ),
        },
      );
      const copy = upstream.clone();
      void copy
        .text()
        .then(async (responseBody) => {
          const usage = usageFromResponseBody(responseBody);
          await this.db.query(
            `UPDATE job_provider_calls SET response_status = $2, completed_at = now(),
             input_tokens = $3, cached_input_tokens = $4, output_tokens = $5,
             estimated_cost_microusd = $6
           WHERE id = $1`,
            [
              callId,
              upstream.status,
              usage?.inputTokens || 0,
              usage?.cachedInputTokens || 0,
              usage?.outputTokens || 0,
              usage
                ? estimatedCostMicrousd(String(constrained.model), usage)
                : 0,
            ],
          );
        })
        .catch(() => undefined);
      return upstream;
    } catch (error) {
      await this.db
        .query("DELETE FROM job_provider_calls WHERE id = $1", [callId])
        .catch(() => undefined);
      throw error;
    }
  }
}
