import { RateLimitError, Sandbox, SandboxNotFoundError, TimeoutError } from "e2b";
import { createHash } from "node:crypto";
import type { ArtifactService } from "./artifact-service.js";
import type { HostedGenerationService } from "./hosted-generation-service.js";

export class E2BDispatcher {
  constructor(
    private readonly generations: HostedGenerationService,
    private readonly artifacts: ArtifactService,
    private readonly sandboxApi: typeof Sandbox = Sandbox,
  ) {}

  get configured() {
    const version = process.env.E2B_TEMPLATE_VERSION?.trim();
    return Boolean(
      this.generations.configured &&
        this.artifacts.configured &&
        process.env.E2B_API_KEY?.trim() &&
        version &&
        version !== "dev",
    );
  }

  async dispatch(jobId: string) {
    if (!this.configured) throw new Error("E2B dispatch is not fully configured.");
    const job = await this.generations.claimDispatch(jobId);
    if (!job) {
      const existing = await this.generations.getForDispatch(jobId);
      if (!existing) throw new Error("Generation job not found.");
      if (existing.status === "dispatching" && !existing.sandboxId)
        return { accepted: false, status: "dispatching", sandboxId: undefined };
      if (existing.status === "queued") {
        await this.generations.fail(jobId, new Error("Dispatch retry limit reached."), true, {
          code: "dispatch_attempts_exhausted",
          userMessage: "The renderer could not be started. Your generation credits were restored.",
        });
        return { accepted: false, status: "failed", sandboxId: undefined };
      }
      return { accepted: false, status: existing.status, sandboxId: existing.sandboxId };
    }
    let sandbox: Sandbox | undefined;
    try {
      const callbackBaseUrl = process.env.JOB_CALLBACK_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim();
      if (!callbackBaseUrl) throw new Error("JOB_CALLBACK_BASE_URL is required for E2B callbacks.");
      const callbackOrigin = new URL(callbackBaseUrl);
      if (process.env.NODE_ENV === "production" && callbackOrigin.protocol !== "https:")
        throw new Error("E2B callbacks require HTTPS in production.");
      const callbackHost = callbackOrigin.hostname;
      const uploads = await this.artifacts.createUploadManifest(job);
      const project = await this.generations.getProjectForJob(job);
      if (!project) throw new Error("Generation project not found.");
      const revisionSource = await this.generations.getRevisionSource(job);
      const revisionSourceUrl = revisionSource
        ? await this.artifacts.signedReadUrl(revisionSource.bucket, revisionSource.object_name, Number(revisionSource.generation))
        : undefined;
      const attachmentRows = await this.generations.getAttachmentFiles(job);
      const attachments = await Promise.all(attachmentRows.map(async (file) => ({
        id: file.id,
        label: file.label,
        url: await this.artifacts.signedReadUrl(file.bucket, file.object_name, Number(file.generation)),
      })));
      const assetIds = project.assets.map((asset) => asset.mediaUrl.match(/^\/api\/project-files\/([0-9a-f-]{36})$/i)?.[1]).filter((id): id is string => Boolean(id));
      const assetRows = await this.generations.getProjectFilesByIds(job, assetIds);
      const assetById = new Map(assetRows.map((row) => [row.id, row]));
      const projectAssets = await Promise.all(project.assets.flatMap((asset) => {
        const fileId = asset.mediaUrl.match(/^\/api\/project-files\/([0-9a-f-]{36})$/i)?.[1];
        const row = fileId ? assetById.get(fileId) : undefined;
        return row ? [{
          localPath: asset.localPath,
          metadata: asset,
          urlPromise: this.artifacts.signedReadUrl(row.bucket, row.object_name, Number(row.generation)),
        }] : [];
      }).map(async (asset) => ({ localPath: asset.localPath, metadata: asset.metadata, url: await asset.urlPromise })));
      const templateName = process.env.E2B_TEMPLATE?.trim() || "lesson-studio-renderer";
      if (!job.templateVersion || job.templateVersion === "dev")
        throw new Error("Generation job does not have an immutable E2B template version.");
      const template = `${templateName}:${job.templateVersion}`;
      sandbox = await this.sandboxApi.create(template, {
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 45 * 60_000),
        metadata: { app: "lesson-studio", jobId: job.id, ownerHash: createHash("sha256").update(job.ownerId).digest("hex").slice(0, 16) },
        envs: {
          OPENAI_API_KEY: this.generations.codexToken(job.id),
          OPENAI_BASE_URL: `${callbackBaseUrl.replace(/\/$/, "")}/api/internal/codex/${job.id}/v1`,
          JOB_CALLBACK_TOKEN: this.generations.callbackToken(job.id),
          JOB_CALLBACK_URL: `${callbackBaseUrl.replace(/\/$/, "")}/api/internal/generation/${job.id}`,
        },
        allowInternetAccess: true,
        network: {
          allowOut: ["storage.googleapis.com", callbackHost],
          denyOut: ({ allTraffic }) => [allTraffic],
          allowPublicTraffic: false,
        },
      });
      await sandbox.files.write("/workspace/job.json", JSON.stringify({
        id: job.id,
        prompt: job.prompt,
        renderer: job.renderer,
        effort: job.effort,
        projectId: job.projectId,
        designPreferences: project.designPreferences,
        reviewPreferences: project.reviewPreferences,
        narrationPreferences: project.narrationPreferences,
        revisionSourceUrl,
        attachments,
        projectAssets,
        uploads,
      }));
      const processHandle = await sandbox.commands.run("node /opt/lesson-studio/app/e2b/bootstrap.mjs", {
        background: true,
        cwd: "/workspace",
        timeoutMs: 30_000,
      });
      await processHandle.disconnect();
      const started = await this.generations.markSandboxStarted(job.id, job.dispatchLeaseId!, sandbox.sandboxId);
      if (!started) throw new Error("Generation dispatch lease was lost before the sandbox started.");
      return { accepted: true, status: "running", sandboxId: sandbox.sandboxId };
    } catch (error) {
      await sandbox?.kill().catch(() => undefined);
      if (error instanceof RateLimitError || error instanceof TimeoutError) {
        await this.generations.retryDispatch(job.id, job.dispatchLeaseId!, error);
        throw error;
      }
      await this.generations.fail(job.id, error, true, {
        code: "dispatch_failed",
        userMessage: "The renderer could not be started. Your generation credits were restored.",
      });
      console.error("E2B dispatch reached a terminal failure", {
        jobId: job.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      return { accepted: false, status: "failed", sandboxId: undefined };
    }
  }

  async terminate(sandboxId: string | undefined) {
    if (!sandboxId) return;
    try {
      const sandbox = await this.sandboxApi.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
      await sandbox.kill();
    } catch (error) {
      if (!(error instanceof SandboxNotFoundError)) throw error;
    }
  }

  async reconcile() {
    const result = await this.generations.reconcileExpiredJobs();
    await this.generations.queueUntrackedTerminalSandboxes();
    const pending = await this.generations.pendingSandboxCleanups();
    const settled = await Promise.all(pending.map(async ({ eventId, jobId, sandboxId }) => {
      try {
        await this.terminate(sandboxId);
        await this.generations.finishSandboxCleanup(eventId, jobId, sandboxId);
        return true;
      } catch (error) {
        await this.generations.recordSandboxCleanupFailure(eventId, error).catch(() => undefined);
        console.error("Could not terminate terminal E2B sandbox", {
          jobId,
          sandboxId,
          message: error instanceof Error ? error.message : "unknown",
        });
        return false;
      }
    }));
    return { reconciled: result.reconciled, terminated: settled.filter(Boolean).length };
  }
}
