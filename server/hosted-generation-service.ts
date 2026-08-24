import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { PRICING_PLANS } from "./billing-service.js";
import type { Database } from "./database.js";
import type { GenerationEffort, StudioProject } from "./types.js";
import type { VerifiedArtifact } from "./artifact-service.js";

type JobStatus = "queued" | "dispatching" | "running" | "uploading" | "complete" | "failed" | "cancelled";

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
  reservedCredits: number;
  input: { attachments?: Array<{ fileId: string; label: string }> };
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
  reserved_credits: number;
  callback_token_hash: string;
  input: HostedJob["input"];
};

type BillingRow = {
  plan: "free" | "creator" | "pro";
  status: "free" | "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  period_start: Date;
  period_end: Date;
  role: "user" | "staff" | "admin";
  balance: string;
};

function costFor(effort: GenerationEffort) {
  return effort === "thorough" ? 4 : effort === "balanced" ? 2 : 1;
}

function effortRank(effort: GenerationEffort) {
  return effort === "thorough" ? 3 : effort === "balanced" ? 2 : 1;
}

function activeJobLimit(plan: BillingRow["plan"], staff: boolean) {
  if (staff) return Number(process.env.STAFF_ACTIVE_JOB_LIMIT || 20);
  return plan === "pro" ? 5 : plan === "creator" ? 2 : 1;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Generation failed.";
}

export class HostedGenerationService {
  constructor(private readonly db: Database) {}

  get configured() {
    return this.db.configured && process.env.EXECUTION_MODE === "e2b";
  }

  private callbackSecret() {
    const secret = process.env.JOB_CALLBACK_SECRET?.trim();
    if (!secret || secret.length < 32) throw new Error("JOB_CALLBACK_SECRET must contain at least 32 characters.");
    return secret;
  }

  callbackToken(jobId: string) {
    return createHmac("sha256", this.callbackSecret()).update(`lesson-studio-job:${jobId}`).digest("base64url");
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
      const credits = staff ? 0 : costFor(input.effort);
      const remaining = definition.entitlements.creditsPerMonth + Number(billing.balance);
      if (!staff && remaining < credits) {
        throw new Error(`This request needs ${credits} generation credit${credits === 1 ? "" : "s"}. Upgrade or wait for your monthly credits to renew.`);
      }

      const mode = project.versions.length ? "revision" : "first-draft";
      project.messages.push({ id: randomUUID(), role: "user", text: input.prompt, createdAt: timestamp });
      project.prompt ||= input.prompt;
      if (project.title === "Untitled video") {
        project.title = input.prompt.replace(/[^a-zA-Z0-9\s-]/g, " ").trim().split(/\s+/).slice(0, 5).join(" ") || "Untitled video";
      }
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
          process.env.E2B_TEMPLATE_VERSION || "dev", this.callbackHash(jobId), credits,
          JSON.stringify({ attachments: input.attachments || [] })],
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
      reservedCredits: row.reserved_credits,
      input: row.input || {},
    };
  }

  async getForDispatch(jobId: string) {
    const result = await this.db.query<JobRow>("SELECT * FROM generation_jobs WHERE id = $1", [jobId]);
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  async claimDispatch(jobId: string) {
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
            SET status = 'dispatching', updated_at = now()
          WHERE id = $1
            AND (status = 'queued' OR (status = 'dispatching' AND updated_at < now() - interval '10 minutes'))
          RETURNING *`,
        [jobId],
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

  async markSandboxStarted(jobId: string, sandboxId: string) {
    const result = await this.db.query<JobRow>(
      `UPDATE generation_jobs
          SET status = 'running', e2b_sandbox_id = $2, started_at = COALESCE(started_at, now()),
              attempt = attempt + 1, updated_at = now()
        WHERE id = $1 AND status IN ('queued', 'dispatching')
        RETURNING *`,
      [jobId, sandboxId],
    );
    if (result.rows[0]) {
      await this.db.query(
        `INSERT INTO job_events (job_id, owner_id, event_type, payload)
         VALUES ($1, $2, 'sandbox_started', $3::jsonb)`,
        [jobId, result.rows[0].owner_id, JSON.stringify({ sandboxId })],
      );
    }
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
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

  async markUploading(jobId: string) {
    await this.db.query(
      `UPDATE generation_jobs SET status = 'uploading', updated_at = now()
        WHERE id = $1 AND status = 'running'`,
      [jobId],
    );
  }

  async fail(jobId: string, error: unknown, refund = true) {
    const message = safeMessage(error);
    await this.db.transaction(async (client) => {
      const result = await client.query<JobRow>(
        `UPDATE generation_jobs
            SET status = 'failed', error_code = 'generation_failed', error_message = $2,
                completed_at = now(), updated_at = now()
          WHERE id = $1 AND status NOT IN ('complete', 'failed', 'cancelled')
          RETURNING *`,
        [jobId, message],
      );
      const job = result.rows[0];
      if (!job) return;
      if (refund && job.reserved_credits > 0) {
        await client.query(
          `INSERT INTO credit_ledger (id, user_id, job_id, amount, reason, idempotency_key)
           VALUES ($1, $2, $3, $4, 'generation_refund', $5)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
          [randomUUID(), job.owner_id, job.id, job.reserved_credits, `job:${job.id}:refund`],
        );
      }
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

  async complete(jobId: string, artifacts: VerifiedArtifact[], render: StudioProject["versions"][number]["render"], assistantMessage?: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<JobRow>(
        `UPDATE generation_jobs
            SET status = 'complete', completed_at = now(), updated_at = now()
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
      const artifactIds = new Map<string, string>();
      for (const artifact of artifacts) {
        const artifactId = randomUUID();
        artifactIds.set(artifact.kind, artifactId);
        await client.query(
          `INSERT INTO artifacts
            (id, owner_id, project_id, job_id, kind, bucket, object_name, generation,
             content_type, byte_size, checksum, checksum_algorithm)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'crc32c')
           ON CONFLICT (job_id, kind) DO NOTHING`,
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
        text: assistantMessage?.slice(0, 2000) || (number === 1 ? "First draft ready." : `Revision ${number} ready.`),
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
        `UPDATE generation_jobs SET status = 'cancelled', completed_at = now(), updated_at = now()
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
      if (job.reserved_credits > 0) {
        await client.query(
          `INSERT INTO credit_ledger (id, user_id, job_id, amount, reason, idempotency_key)
           VALUES ($1, $2, $3, $4, 'generation_refund', $5)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
          [randomUUID(), ownerId, job.id, job.reserved_credits, `job:${job.id}:refund`],
        );
      }
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
