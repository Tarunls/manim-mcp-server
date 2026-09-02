import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { PRICING_PLANS } from "./billing-service.js";
import { effortRank, generationCost, titleFromPrompt } from "./plan.js";
import type { Database } from "./database.js";
import type { GenerationEffort, StudioProject } from "./types.js";
import type { VerifiedArtifact } from "./artifact-service.js";

type JobStatus = "queued" | "dispatching" | "running" | "uploading" | "complete" | "failed" | "cancelled";

/** What the owner reads when a draft lands. Written from the probed file
 * rather than from the agent's own sign-off, which is a build report meant
 * for whoever ran the tool - sandbox paths, source filenames, vendor model
 * names - and reads like a stack trace to the person who asked for a lesson. */
export function completionMessage(number: number, render: StudioProject["versions"][number]["render"]) {
  const opening = number === 1 ? "First draft ready" : `Revision ${number} ready`;
  const seconds = Math.round(Number(render?.duration) || 0);
  if (!seconds) return `${opening}.`;
  const narrated = render?.narration?.hasAudio ? ", with narration" : "";
  return `${opening} - ${seconds} seconds${narrated}.`;
}

export type HostedJob = {
  id: string;
  ownerId: string;
  projectId: string;
  status: JobStatus;
  prompt: string;
  renderer: StudioProject["renderer"];
  effort: GenerationEffort;
  templateVersion: string;
  sandboxId?: string;
  dispatchLeaseId?: string;
  reservedCredits: number;
  input: {
    attachments?: Array<{ fileId: string; label: string }>;
    narrationPreferences?: StudioProject["narrationPreferences"];
  };
};

type JobRow = {
  id: string;
  owner_id: string;
  project_id: string;
  status: JobStatus;
  prompt: string;
  renderer: StudioProject["renderer"];
  effort: GenerationEffort;
  template_version: string;
  e2b_sandbox_id: string | null;
  dispatch_lease_id: string | null;
  reserved_credits: number;
  callback_token_hash: string;
  input: HostedJob["input"];
};

type BillingRow = {
  plan: "free" | "creator" | "pro" | "studio";
  status: "free" | "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  period_start: Date;
  period_end: Date;
  role: "user" | "staff" | "admin";
  balance: string;
};

function activeJobLimit(plan: BillingRow["plan"], staff: boolean) {
  if (staff) return Number(process.env.STAFF_ACTIVE_JOB_LIMIT || 20);
  return plan === "studio" ? 10 : plan === "pro" ? 5 : plan === "creator" ? 2 : 1;
}

function diagnosticMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 4000) : "Generation failed.";
}

export class HostedGenerationService {
  constructor(private readonly db: Database) {}

  // Balances sum the ledger per billing period, so a refund must land in the
  // reservation's period; stamping it now() after a rollover would mint
  // credits in the new period.
  private async refundReservation(client: PoolClient, job: JobRow) {
    if (job.reserved_credits <= 0) return;
    await client.query(
      `INSERT INTO credit_ledger (id, user_id, job_id, amount, reason, idempotency_key, created_at)
       SELECT $1, $2, $3, $4, 'generation_refund', $5,
              COALESCE((SELECT created_at FROM credit_ledger
                         WHERE user_id = $2 AND idempotency_key = $6), now())
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [randomUUID(), job.owner_id, job.id, job.reserved_credits, `job:${job.id}:refund`, `job:${job.id}:reserve`],
    );
  }

  private async queueSandboxCleanup(client: PoolClient, jobId: string, sandboxId: string | null) {
    if (!sandboxId) return;
    await client.query(
      `INSERT INTO outbox_events (id, topic, aggregate_id, payload)
       SELECT $1, 'sandbox.cleanup', $2, $3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM outbox_events
           WHERE topic = 'sandbox.cleanup' AND aggregate_id = $2
        )`,
      [randomUUID(), sandboxId, JSON.stringify({ jobId, sandboxId })],
    );
  }

  get configured() {
    return this.db.configured && process.env.EXECUTION_MODE === "e2b";
  }

  private callbackSecret() {
    const secret = process.env.JOB_CALLBACK_SECRET?.trim();
    if (!secret || secret.length < 32) throw new Error("JOB_CALLBACK_SECRET must contain at least 32 characters.");
    return secret;
  }

  callbackToken(jobId: string) {
    return createHmac("sha256", this.callbackSecret()).update(`lesson-studio-callback:${jobId}`).digest("base64url");
  }

  codexToken(jobId: string) {
    return createHmac("sha256", this.callbackSecret()).update(`lesson-studio-codex:${jobId}`).digest("base64url");
  }

  private callbackHash(jobId: string) {
    return createHash("sha256").update(this.callbackToken(jobId)).digest("hex");
  }

  private async lockBilling(client: PoolClient, ownerId: string) {
    await client.query(
      `INSERT INTO billing_profiles (user_id, period_start, period_end)
       VALUES ($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')
       ON CONFLICT (user_id) DO NOTHING`,
      [ownerId],
    );
    await client.query(
      `UPDATE billing_profiles
          SET plan = 'free', status = 'free',
              period_start = date_trunc('month', now()),
              period_end = date_trunc('month', now()) + interval '1 month',
              updated_at = now()
        WHERE user_id = $1 AND period_end <= now()
          AND (plan = 'free' OR status NOT IN ('active', 'trialing'))`,
      [ownerId],
    );
    const result = await client.query<Omit<BillingRow, "balance">>(
      `SELECT bp.plan, bp.status, bp.period_start, bp.period_end, u.role
         FROM billing_profiles bp
         JOIN app_users u ON u.id = bp.user_id
        WHERE bp.user_id = $1
        FOR UPDATE OF bp`,
      [ownerId],
    );
    if (!result.rows[0]) throw new Error("Billing profile not found.");
    const balance = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS balance
         FROM credit_ledger
        WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
      [ownerId, result.rows[0].period_start, result.rows[0].period_end],
    );
    return { ...result.rows[0], balance: balance.rows[0]?.balance || "0" };
  }

  async submit(input: {
    ownerId: string;
    project: StudioProject;
    prompt: string;
    effort: GenerationEffort;
    idempotencyKey: string;
    attachments?: Array<{ fileId: string; label: string }>;
  }) {
    if (!this.configured) throw new Error("Hosted generation is not configured.");
    if (!/^[A-Za-z0-9._:-]{16,200}$/.test(input.idempotencyKey)) throw new Error("A valid Idempotency-Key header is required.");
    // Serializable transactions abort with SQLSTATE 40001/40P01 under
    // contention; retry instead of surfacing that to the user.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.submitOnce(input);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (attempt >= 3 || (code !== "40001" && code !== "40P01")) throw error;
      }
    }
  }

  private async submitOnce(input: {
    ownerId: string;
    project: StudioProject;
    prompt: string;
    effort: GenerationEffort;
    idempotencyKey: string;
    attachments?: Array<{ fileId: string; label: string }>;
  }) {
    const templateVersion = process.env.E2B_TEMPLATE_VERSION?.trim();
    if (!templateVersion || templateVersion === "dev")
      throw new Error("Hosted generation requires an immutable E2B template version.");
    const jobId = randomUUID();
    const outboxId = randomUUID();
    const timestamp = new Date().toISOString();
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.ownerId}:${input.idempotencyKey}`]);
      const existing = await client.query<JobRow>(
        `SELECT * FROM generation_jobs WHERE owner_id = $1 AND idempotency_key = $2`,
        [input.ownerId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const stored = await client.query<{ document: StudioProject }>(
          `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [existing.rows[0].project_id, input.ownerId],
        );
        if (!stored.rows[0]) throw new Error("Project not found.");
        return { jobId: existing.rows[0].id, project: stored.rows[0].document, duplicate: true };
      }

      const projectResult = await client.query<{ document: StudioProject }>(
        `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [input.project.id, input.ownerId],
      );
      if (!projectResult.rows[0]) throw new Error("Project not found.");
      const project = projectResult.rows[0].document;
      if (project.status === "running") throw new Error("The agent is already working on this project.");

      const billing = await this.lockBilling(client, input.ownerId);
      const staff = billing.role === "staff" || billing.role === "admin";
      const subscribed = billing.plan !== "free" && ["active", "trialing"].includes(billing.status);
      const plan = subscribed ? billing.plan : "free";
      const definition = PRICING_PLANS[plan];
      if (!staff && effortRank(input.effort) > effortRank(definition.entitlements.maxEffort)) {
        throw new Error(`${input.effort === "thorough" ? "Try harder" : "Balanced"} thinking is available on a higher plan.`);
      }
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM generation_jobs
          WHERE owner_id = $1 AND status IN ('queued', 'dispatching', 'running', 'uploading')`,
        [input.ownerId],
      );
      if (Number(active.rows[0]?.count || 0) >= activeJobLimit(plan, staff)) {
        throw new Error("Wait for an active generation to finish before starting another one.");
      }
      const credits = staff ? 0 : generationCost(input.effort);
      const remaining = definition.entitlements.creditsPerMonth + Number(billing.balance);
      if (!staff && remaining < credits) {
        throw new Error(`This request needs ${credits} generation credit${credits === 1 ? "" : "s"}. Upgrade or wait for your monthly credits to renew.`);
      }

      const mode = project.versions.length ? "revision" : "first-draft";
      project.messages.push({ id: randomUUID(), role: "user", text: input.prompt, createdAt: timestamp });
      project.prompt ||= input.prompt;
      if (project.title === "Untitled video") project.title = titleFromPrompt(input.prompt);
      project.status = "running";
      project.stage = "brief";
      project.error = undefined;
      project.updatedAt = timestamp;
      project.actions.push({ id: jobId, label: mode === "revision" ? `Queued revision ${project.versions.length + 1}` : "Queued first draft", status: "running", createdAt: timestamp });

      await client.query(
        `UPDATE projects SET document = $3::jsonb, revision = revision + 1, updated_at = now()
          WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [project.id, input.ownerId, JSON.stringify(project)],
      );
      await client.query(
        `INSERT INTO generation_jobs
          (id, owner_id, project_id, status, prompt, renderer, effort, idempotency_key,
           template_version, callback_token_hash, reserved_credits, input)
         VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [jobId, input.ownerId, project.id, input.prompt, project.renderer, input.effort, input.idempotencyKey,
          templateVersion, this.callbackHash(jobId), credits,
          JSON.stringify({
            attachments: input.attachments || [],
            narrationPreferences: project.narrationPreferences,
          })],
      );
      if (credits > 0) {
        await client.query(
          `INSERT INTO credit_ledger (id, user_id, job_id, amount, reason, idempotency_key)
           VALUES ($1, $2, $3, $4, 'generation_reservation', $5)`,
          [randomUUID(), input.ownerId, jobId, -credits, `job:${jobId}:reserve`],
        );
      }
      await client.query(
        `INSERT INTO job_events (job_id, owner_id, event_type, payload)
         VALUES ($1, $2, 'queued', $3::jsonb)`,
        [jobId, input.ownerId, JSON.stringify({ projectId: project.id })],
      );
      await client.query(
        `INSERT INTO outbox_events (id, topic, aggregate_id, payload)
         VALUES ($1, 'generation.dispatch', $2, $3::jsonb)`,
        [outboxId, jobId, JSON.stringify({ jobId })],
      );
      return { jobId, project, duplicate: false };
    }, { isolation: "serializable" });
  }

  private fromRow(row: JobRow): HostedJob {
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      status: row.status,
      prompt: row.prompt,
      renderer: row.renderer,
      effort: row.effort,
      templateVersion: row.template_version,
      sandboxId: row.e2b_sandbox_id || undefined,
      dispatchLeaseId: row.dispatch_lease_id || undefined,
      reservedCredits: row.reserved_credits,
      input: row.input || {},
    };
  }

  async getForDispatch(jobId: string) {
    const result = await this.db.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1", [jobId]);
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  async claimDispatch(jobId: string) {
    const leaseId = randomUUID();
    const leaseMs = Math.max(60_000, Number(process.env.E2B_DISPATCH_LEASE_MS || 5 * 60_000));
    const maxAttempts = Math.max(1, Number(process.env.E2B_MAX_DISPATCH_ATTEMPTS || 5));
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(7812394102892)");
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM generation_jobs
          WHERE status IN ('dispatching', 'running', 'uploading') AND id <> $1`,
        [jobId],
      );
      if (Number(active.rows[0]?.count || 0) >= Number(process.env.E2B_MAX_CONCURRENT_SANDBOXES || 20)) {
        throw new Error("Generation capacity is currently full.");
      }
      const result = await client.query<JobRow>(
        `UPDATE generation_jobs
            SET status = 'dispatching', dispatch_lease_id = $2,
                lease_expires_at = now() + ($3::int * interval '1 millisecond'),
                attempt = attempt + 1, updated_at = now()
          WHERE id = $1
            AND attempt < $4
            AND (status = 'queued' OR (status = 'dispatching' AND lease_expires_at < now()))
          RETURNING *`,
        [jobId, leaseId, leaseMs, maxAttempts],
      );
      return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
    });
  }

  async getOwned(jobId: string, ownerId: string) {
    const result = await this.db.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1 AND owner_id = $2", [jobId, ownerId]);
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  async getProjectForJob(job: HostedJob) {
    const result = await this.db.query<{ document: StudioProject }>(
      `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [job.projectId, job.ownerId],
    );
    return result.rows[0]?.document;
  }

  async getRevisionSource(job: HostedJob) {
    const result = await this.db.query<{ bucket: string; object_name: string; generation: string }>(
      `SELECT bucket, object_name, generation::text
         FROM artifacts
        WHERE project_id = $1 AND owner_id = $2 AND kind = 'source_archive'
        ORDER BY created_at DESC LIMIT 1`,
      [job.projectId, job.ownerId],
    );
    return result.rows[0];
  }

  async getAttachmentFiles(job: HostedJob) {
    const ids = (job.input.attachments || []).map((item) => item.fileId);
    if (!ids.length) return [];
    const result = await this.db.query<{ id: string; bucket: string; object_name: string; generation: string }>(
      `SELECT id, bucket, object_name, generation::text FROM project_files
        WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND project_id = $3`,
      [ids, job.ownerId, job.projectId],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return (job.input.attachments || []).flatMap((item) => {
      const row = byId.get(item.fileId);
      return row ? [{ ...row, label: item.label }] : [];
    });
  }

  async getProjectFilesByIds(job: HostedJob, ids: string[]) {
    if (!ids.length) return [];
    const result = await this.db.query<{ id: string; bucket: string; object_name: string; generation: string }>(
      `SELECT id, bucket, object_name, generation::text FROM project_files
        WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND project_id = $3`,
      [ids, job.ownerId, job.projectId],
    );
    return result.rows;
  }

  async markSandboxStarted(jobId: string, leaseId: string, sandboxId: string) {
    const runtimeMs = Math.max(60_000, Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 45 * 60_000));
    const result = await this.db.query<JobRow>(
      `UPDATE generation_jobs
          SET status = 'running', e2b_sandbox_id = $2, started_at = COALESCE(started_at, now()),
              lease_expires_at = now() + ($4::int * interval '1 millisecond'), updated_at = now()
        WHERE id = $1 AND status = 'dispatching' AND dispatch_lease_id = $3
        RETURNING *`,
      [jobId, sandboxId, leaseId, runtimeMs + 5 * 60_000],
    );
    if (result.rows[0]) {
      await this.db.query(
        `INSERT INTO job_events (job_id, owner_id, event_type, payload)
         VALUES ($1, $2, 'sandbox_started', $3::jsonb)`,
        [jobId, result.rows[0].owner_id, JSON.stringify({ sandboxId })],
      );
      await this.updateProjectProgress(
        { id: jobId, projectId: result.rows[0].project_id, ownerId: result.rows[0].owner_id },
        "authoring",
        "Workspace ready - the agent is planning the lesson",
      );
    }
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  async retryDispatch(jobId: string, leaseId: string, error: unknown) {
    const result = await this.db.query<JobRow>(
      `UPDATE generation_jobs
          SET status = 'queued', dispatch_lease_id = NULL, lease_expires_at = NULL,
              error_code = 'dispatch_retry', error_detail = $3, updated_at = now()
        WHERE id = $1 AND status = 'dispatching' AND dispatch_lease_id = $2
        RETURNING *`,
      [jobId, leaseId, diagnosticMessage(error)],
    );
    return Boolean(result.rows[0]);
  }

  async verifyCallback(jobId: string, token: string) {
    const result = await this.db.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1", [jobId]);
    const row = result.rows[0];
    if (!row || !token) return undefined;
    const actual = Buffer.from(createHash("sha256").update(token).digest("hex"));
    const expected = Buffer.from(row.callback_token_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    return this.fromRow(row);
  }

  async verifyCodexAccess(jobId: string, token: string) {
    const result = await this.db.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1", [jobId]);
    const row = result.rows[0];
    if (!row || !token || !["dispatching", "running", "uploading"].includes(row.status)) return undefined;
    const actual = Buffer.from(token);
    const expected = Buffer.from(this.codexToken(jobId));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    return this.fromRow(row);
  }

  private redactForOwner(jobId: string, value: unknown, limit: number) {
    return String(value || "")
      .replaceAll(this.callbackToken(jobId), "[redacted]")
      .replaceAll(this.codexToken(jobId), "[redacted]")
      .replace(/\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[redacted]")
      .slice(0, limit);
  }

  private progressThrottle = new Map<string, number>();

  /** Live progress from the sandbox: a bounded label and/or a stage hint.
   * Writes bump the project revision, which is what the browser's event
   * stream watches - without this, a hosted generation looks frozen. */
  async recordProgress(job: HostedJob, input: { label?: unknown; stage?: unknown }) {
    const label = this.redactForOwner(
      job.id,
      typeof input.label === "string" ? input.label.replace(/\s+/g, " ").trim() : "",
      90,
    );
    const allowedStages = new Set(["authoring", "rendering", "inspecting"]);
    const stage =
      typeof input.stage === "string" && allowedStages.has(input.stage)
        ? (input.stage as StudioProject["stage"])
        : undefined;
    if (!label && !stage) return;
    const now = Date.now();
    // Labels are throttled; stage changes always land.
    if (!stage && now - (this.progressThrottle.get(job.id) || 0) < 1500) return;
    this.progressThrottle.set(job.id, now);
    await this.updateProjectProgress(job, stage, label || undefined);
  }

  private async updateProjectProgress(
    job: Pick<HostedJob, "id" | "projectId" | "ownerId">,
    stage: StudioProject["stage"] | undefined,
    label: string | undefined,
  ) {
    await this.db.transaction(async (client) => {
      const result = await client.query<{ document: StudioProject }>(
        `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [job.projectId, job.ownerId],
      );
      const project = result.rows[0]?.document;
      if (!project || project.status !== "running") return;
      if (stage) project.stage = stage;
      if (label) {
        const actions = project.actions || [];
        const last = actions.at(-1);
        if (last?.label !== label) {
          project.actions = [
            ...actions.slice(-29),
            {
              id: `${job.id}:${randomUUID().slice(0, 8)}`,
              label,
              status: "done" as const,
              createdAt: new Date().toISOString(),
            },
          ];
        }
      }
      project.updatedAt = new Date().toISOString();
      await client.query(
        `UPDATE projects SET document = $3::jsonb, revision = revision + 1, updated_at = now()
          WHERE id = $1 AND owner_id = $2`,
        [job.projectId, job.ownerId, JSON.stringify(project)],
      );
    });
  }

  async markUploading(jobId: string) {
    const result = await this.db.query<JobRow>(
      `UPDATE generation_jobs SET status = 'uploading', updated_at = now(),
          lease_expires_at = now() + interval '10 minutes'
        WHERE id = $1 AND status = 'running'
        RETURNING *`,
      [jobId],
    );
    if (result.rows[0])
      await this.updateProjectProgress(
        { id: jobId, projectId: result.rows[0].project_id, ownerId: result.rows[0].owner_id },
        "inspecting",
        "Checking and uploading the finished video",
      );
  }

  async fail(
    jobId: string,
    error: unknown,
    refund = true,
    options: { code?: string; userMessage?: string } = {},
  ) {
    const detail = diagnosticMessage(error);
    const code = (options.code || "generation_failed").replace(/[^a-z0-9_]/gi, "_").slice(0, 80);
    const message = (options.userMessage || "The video could not be generated. Your generation credits were restored.").slice(0, 500);
    await this.db.transaction(async (client) => {
      const result = await client.query<JobRow>(
        `UPDATE generation_jobs
            SET status = 'failed', error_code = $2, error_message = $3, error_detail = $4,
                dispatch_lease_id = NULL, lease_expires_at = NULL,
                completed_at = now(), updated_at = now()
          WHERE id = $1 AND status NOT IN ('complete', 'failed', 'cancelled')
          RETURNING *`,
        [jobId, code, message, detail],
      );
      const job = result.rows[0];
      if (!job) return;
      await this.queueSandboxCleanup(client, job.id, job.e2b_sandbox_id);
      if (refund) await this.refundReservation(client, job);
      const projectResult = await client.query<{ document: StudioProject }>(
        `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [job.project_id, job.owner_id],
      );
      const project = projectResult.rows[0]?.document;
      if (project) {
        project.status = "error";
        project.stage = "ready";
        project.error = message;
        project.updatedAt = new Date().toISOString();
        const action = project.actions.find((candidate) => candidate.id === job.id);
        if (action) action.status = "failed";
        await client.query(
          `UPDATE projects SET document = $3::jsonb, revision = revision + 1, updated_at = now()
            WHERE id = $1 AND owner_id = $2`,
          [job.project_id, job.owner_id, JSON.stringify(project)],
        );
      }
      await client.query(
        `INSERT INTO job_events (job_id, owner_id, event_type, payload)
         VALUES ($1, $2, 'failed', $3::jsonb)`,
        [job.id, job.owner_id, JSON.stringify({ message })],
      );
    });
  }

  async reconcileExpiredJobs() {
    const expired = await this.db.query<JobRow>(
      `SELECT * FROM generation_jobs
        WHERE status IN ('dispatching', 'running', 'uploading')
          AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
        ORDER BY lease_expires_at LIMIT 50`,
    );
    for (const row of expired.rows) {
      await this.fail(row.id, new Error(`Generation lease expired in ${row.status}.`), true, {
        code: "generation_timeout",
        userMessage: "The renderer timed out. Your generation credits were restored.",
      });
    }
    // Queued jobs hold no lease; if the Cloud Tasks dispatch was dropped or
    // exhausted, they would otherwise stay queued forever with credits held.
    const queuedTimeoutMs = Math.max(60_000, Number(process.env.GENERATION_QUEUED_TIMEOUT_MS || 30 * 60_000));
    const stale = await this.db.query<JobRow>(
      `SELECT * FROM generation_jobs
        WHERE status = 'queued'
          AND updated_at < now() - ($1::int * interval '1 millisecond')
        ORDER BY updated_at LIMIT 50`,
      [queuedTimeoutMs],
    );
    for (const row of stale.rows) {
      await this.fail(row.id, new Error("Generation stayed queued past its dispatch deadline."), true, {
        code: "dispatch_expired",
        userMessage: "The renderer could not be started. Your generation credits were restored.",
      });
    }
    return { reconciled: expired.rows.length + stale.rows.length };
  }

  async queueUntrackedTerminalSandboxes(limit = 50) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = await this.db.query<{ id: string; e2b_sandbox_id: string }>(
      `SELECT id, e2b_sandbox_id
         FROM generation_jobs
        WHERE status IN ('complete', 'failed', 'cancelled')
          AND e2b_sandbox_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM outbox_events
             WHERE topic = 'sandbox.cleanup'
               AND aggregate_id = generation_jobs.e2b_sandbox_id
          )
        ORDER BY completed_at NULLS FIRST, updated_at
        LIMIT $1`,
      [boundedLimit],
    );
    for (const row of result.rows) {
      await this.db.transaction((client) => this.queueSandboxCleanup(client, row.id, row.e2b_sandbox_id));
    }
    return result.rows.length;
  }

  async pendingSandboxCleanups(limit = 50) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    // Exponential backoff scheduled from created_at (the row has no
    // last-attempt column): attempt n becomes eligible 2^n - 1 minutes after
    // creation. Rows past the attempt cap are kept for manual inspection.
    const result = await this.db.query<{
      id: string;
      aggregate_id: string;
      payload: { jobId?: string; sandboxId?: string };
    }>(
      `SELECT id, aggregate_id, payload
         FROM outbox_events
        WHERE topic = 'sandbox.cleanup' AND published_at IS NULL
          AND attempt < $2
          AND now() >= created_at + ((power(2, LEAST(attempt, 12)) - 1) * interval '1 minute')
        ORDER BY created_at
        LIMIT $1`,
      [boundedLimit, this.sandboxCleanupMaxAttempts()],
    );
    return result.rows.map((row) => ({
      eventId: row.id,
      jobId: String(row.payload?.jobId || ""),
      sandboxId: String(row.payload?.sandboxId || row.aggregate_id),
    })).filter((row) => row.sandboxId.length > 0);
  }

  async finishSandboxCleanup(eventId: string, jobId: string, sandboxId: string) {
    await this.db.transaction(async (client) => {
      if (jobId) {
        await client.query(
          `UPDATE generation_jobs
              SET e2b_sandbox_id = NULL, updated_at = now()
            WHERE id = $1 AND e2b_sandbox_id = $2`,
          [jobId, sandboxId],
        );
      }
      await client.query(
        `UPDATE outbox_events
            SET published_at = now(), attempt = attempt + 1, last_error = NULL
          WHERE id = $1 AND topic = 'sandbox.cleanup' AND published_at IS NULL`,
        [eventId],
      );
    });
  }

  private sandboxCleanupMaxAttempts() {
    return Math.max(1, Math.min(20, Number(process.env.SANDBOX_CLEANUP_MAX_ATTEMPTS || 10)));
  }

  async recordSandboxCleanupFailure(eventId: string, error: unknown) {
    const result = await this.db.query<{ attempt: number; aggregate_id: string }>(
      `UPDATE outbox_events
          SET attempt = attempt + 1, last_error = $2
        WHERE id = $1 AND topic = 'sandbox.cleanup' AND published_at IS NULL
        RETURNING attempt, aggregate_id`,
      [eventId, diagnosticMessage(error).slice(0, 1000)],
    );
    const row = result.rows[0];
    if (row && row.attempt >= this.sandboxCleanupMaxAttempts()) {
      console.error("Giving up on sandbox cleanup after repeated failures; the outbox row is kept for manual inspection", {
        eventId,
        sandboxId: row.aggregate_id,
        attempts: row.attempt,
      });
    }
  }

  async complete(jobId: string, artifacts: VerifiedArtifact[], render: StudioProject["versions"][number]["render"]) {
    return this.db.transaction(async (client) => {
      const result = await client.query<JobRow>(
      `UPDATE generation_jobs
            SET status = 'complete', dispatch_lease_id = NULL, lease_expires_at = NULL,
                completed_at = now(), updated_at = now()
          WHERE id = $1 AND status IN ('running', 'uploading')
          RETURNING *`,
        [jobId],
      );
      const job = result.rows[0];
      if (!job) {
        const existing = await client.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1", [jobId]);
        if (existing.rows[0]?.status === "complete") return { duplicate: true };
        throw new Error("The generation job is not accepting completion.");
      }
      await this.queueSandboxCleanup(client, job.id, job.e2b_sandbox_id);
      const artifactIds = new Map<string, string>();
      for (const artifact of artifacts) {
        const artifactId = randomUUID();
        artifactIds.set(artifact.kind, artifactId);
        await client.query(
          `INSERT INTO artifacts
            (id, owner_id, project_id, job_id, kind, bucket, object_name, generation,
             content_type, byte_size, checksum, checksum_algorithm)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'crc32c')`,
          [artifactId, job.owner_id, job.project_id, job.id, artifact.kind, artifact.bucket,
            artifact.objectName, artifact.generation, artifact.contentType, artifact.byteSize, artifact.checksum],
        );
      }
      const projectResult = await client.query<{ document: StudioProject }>(
        `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [job.project_id, job.owner_id],
      );
      const project = projectResult.rows[0]?.document;
      if (!project) throw new Error("Project not found during completion.");
      const number = Math.max(0, ...project.versions.map((version) => version.number)) + 1;
      const id = `v${String(number).padStart(3, "0")}`;
      const videoId = artifactIds.get("video");
      if (!videoId) throw new Error("Completion is missing a video artifact.");
      project.versions.push({
        id,
        number,
        createdAt: new Date().toISOString(),
        prompt: job.prompt,
        videoUrl: `/api/artifacts/${videoId}`,
        posterUrl: artifactIds.has("poster") ? `/api/artifacts/${artifactIds.get("poster")}` : undefined,
        render,
      });
      project.videoUrl = `/api/artifacts/${videoId}`;
      project.posterUrl = artifactIds.has("poster") ? `/api/artifacts/${artifactIds.get("poster")}` : undefined;
      project.status = "complete";
      project.stage = "complete";
      project.error = undefined;
      project.updatedAt = new Date().toISOString();
      const action = project.actions.find((candidate) => candidate.id === job.id);
      if (action) {
        action.status = "done";
        action.label = number === 1 ? "First draft ready" : `Revision ${number} ready`;
      }
      project.messages.push({
        id: randomUUID(),
        role: "assistant",
        text: completionMessage(number, render),
        createdAt: new Date().toISOString(),
      });
      await client.query(
        `UPDATE projects SET document = $3::jsonb, revision = revision + 1, updated_at = now()
          WHERE id = $1 AND owner_id = $2`,
        [job.project_id, job.owner_id, JSON.stringify(project)],
      );
      await client.query(
        `INSERT INTO job_events (job_id, owner_id, event_type, payload)
         VALUES ($1, $2, 'complete', $3::jsonb)`,
        [job.id, job.owner_id, JSON.stringify({ versionId: id })],
      );
      return { duplicate: false, project };
    });
  }

  async cancelProject(projectId: string, ownerId: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<JobRow>(
        `UPDATE generation_jobs SET status = 'cancelled', dispatch_lease_id = NULL,
            lease_expires_at = NULL, completed_at = now(), updated_at = now()
          WHERE id = (
            SELECT id FROM generation_jobs
             WHERE project_id = $1 AND owner_id = $2
               AND status IN ('queued', 'dispatching', 'running', 'uploading')
             ORDER BY queued_at DESC LIMIT 1
          )
          RETURNING *`,
        [projectId, ownerId],
      );
      const job = result.rows[0];
      if (!job) return undefined;
      await this.queueSandboxCleanup(client, job.id, job.e2b_sandbox_id);
      await this.refundReservation(client, job);
      const projectResult = await client.query<{ document: StudioProject }>(
        `SELECT document FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [projectId, ownerId],
      );
      const project = projectResult.rows[0]?.document;
      if (project) {
        project.status = "cancelled";
        project.stage = "ready";
        project.updatedAt = new Date().toISOString();
        const action = project.actions.find((candidate) => candidate.id === job.id);
        if (action) action.status = "failed";
        await client.query(
          `UPDATE projects SET document = $3::jsonb, revision = revision + 1, updated_at = now()
            WHERE id = $1 AND owner_id = $2`,
          [projectId, ownerId, JSON.stringify(project)],
        );
      }
      await client.query(
        `INSERT INTO job_events (job_id, owner_id, event_type) VALUES ($1, $2, 'cancelled')`,
        [job.id, ownerId],
      );
      return this.fromRow(job);
    });
  }
}
