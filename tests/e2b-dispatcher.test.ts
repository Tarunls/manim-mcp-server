import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Sandbox } from "e2b";
import { E2BDispatcher, e2bExecutionTimeouts } from "../server/e2b-dispatcher.js";
import type { ArtifactService } from "../server/artifact-service.js";
import type { HostedGenerationService, HostedJob } from "../server/hosted-generation-service.js";

const previous = {
  E2B_API_KEY: process.env.E2B_API_KEY,
  E2B_TEMPLATE: process.env.E2B_TEMPLATE,
  E2B_TEMPLATE_VERSION: process.env.E2B_TEMPLATE_VERSION,
  JOB_CALLBACK_BASE_URL: process.env.JOB_CALLBACK_BASE_URL,
  E2B_SANDBOX_TIMEOUT_MS: process.env.E2B_SANDBOX_TIMEOUT_MS,
};

afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function activeJob(): HostedJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    ownerId: "owner-1",
    projectId: "project-1",
    status: "dispatching",
    prompt: "Explain limits",
    renderer: "composite",
    effort: "quick",
    templateVersion: "release-abc123",
    dispatchLeaseId: "00000000-0000-4000-8000-000000000002",
    reservedCredits: 1,
    input: {},
  };
}

function configure() {
  process.env.E2B_API_KEY = "e2b_test";
  process.env.E2B_TEMPLATE = "lesson-studio-renderer";
  process.env.E2B_TEMPLATE_VERSION = "release-abc123";
  process.env.JOB_CALLBACK_BASE_URL = "https://studio.example.test";
}

test("dispatch failures before sandbox creation fail and refund the claimed job", async () => {
  configure();
  const job = activeJob();
  let failed = false;
  const generations = {
    configured: true,
    claimDispatch: async () => job,
    fail: async (jobId: string, error: unknown, refund: boolean) => {
      assert.equal(jobId, job.id);
      assert.equal(refund, true);
      assert.match(String(error), /manifest unavailable/);
      failed = true;
    },
  } as unknown as HostedGenerationService;
  const artifacts = {
    configured: true,
    createUploadManifest: async () => {
      throw new Error("manifest unavailable");
    },
  } as unknown as ArtifactService;

  const result = await new E2BDispatcher(generations, artifacts).dispatch(job.id);
  assert.equal(result.status, "failed");
  assert.equal(failed, true);
});

test("dispatcher always starts the exact immutable template and records its lease", async () => {
  configure();
  const job = activeJob();
  let template = "";
  let started: string[] = [];
  let commandOptions: Record<string, unknown> | undefined;
  const generations = {
    configured: true,
    claimDispatch: async () => job,
    getProjectForJob: async () => ({
      assets: [],
      designPreferences: {},
      reviewPreferences: {},
      narrationPreferences: {},
    }),
    getRevisionSource: async () => undefined,
    getAttachmentFiles: async () => [],
    getProjectFilesByIds: async () => [],
    codexToken: () => "codex-token",
    callbackToken: () => "callback-token",
    markSandboxStarted: async (jobId: string, leaseId: string, sandboxId: string) => {
      started = [jobId, leaseId, sandboxId];
      return job;
    },
  } as unknown as HostedGenerationService;
  const artifacts = {
    configured: true,
    createUploadManifest: async () => ({ uploads: [] }),
  } as unknown as ArtifactService;
  const sandbox = {
    sandboxId: "sandbox-1",
    files: { write: async () => undefined },
    commands: {
      run: async (_command: string, options: Record<string, unknown>) => {
        commandOptions = options;
        return { disconnect: async () => undefined };
      },
    },
    kill: async () => undefined,
  };
  const sandboxApi = {
    create: async (name: string) => {
      template = name;
      return sandbox;
    },
    connect: async () => sandbox,
  } as unknown as typeof Sandbox;

  const result = await new E2BDispatcher(generations, artifacts, sandboxApi).dispatch(job.id);
  assert.equal(template, "lesson-studio-renderer:release-abc123");
  assert.deepEqual(started, [job.id, job.dispatchLeaseId, "sandbox-1"]);
  assert.deepEqual(commandOptions, {
    background: true,
    cwd: "/workspace",
    timeoutMs: 44 * 60_000,
    requestTimeoutMs: 30_000,
  });
  assert.equal(result.status, "running");
});

test("E2B execution timeout keeps the bootstrap alive beyond the request timeout", () => {
  process.env.E2B_SANDBOX_TIMEOUT_MS = String(30 * 60_000);
  assert.deepEqual(e2bExecutionTimeouts(), {
    sandboxMs: 30 * 60_000,
    agentMs: 28 * 60_000,
    commandMs: 29 * 60_000,
    requestMs: 30_000,
  });
});

test("reconcile terminates and clears every terminal sandbox", async () => {
  configure();
  const terminated: string[] = [];
  const cleared: string[][] = [];
  const generations = {
    configured: true,
    reconcileExpiredJobs: async () => ({ reconciled: 1 }),
    queueUntrackedTerminalSandboxes: async () => 0,
    pendingSandboxCleanups: async () => [
      { eventId: "event-complete", jobId: "job-complete", sandboxId: "sandbox-complete" },
      { eventId: "event-failed", jobId: "job-failed", sandboxId: "sandbox-failed" },
    ],
    finishSandboxCleanup: async (eventId: string, jobId: string, sandboxId: string) => {
      cleared.push([eventId, jobId, sandboxId]);
    },
    recordSandboxCleanupFailure: async () => undefined,
  } as unknown as HostedGenerationService;
  const artifacts = { configured: true } as unknown as ArtifactService;
  const sandboxApi = {
    connect: async (sandboxId: string) => ({
      kill: async () => {
        terminated.push(sandboxId);
      },
    }),
  } as unknown as typeof Sandbox;

  const result = await new E2BDispatcher(generations, artifacts, sandboxApi).reconcile();
  assert.deepEqual(result, { reconciled: 1, terminated: 2 });
  assert.deepEqual(terminated.sort(), ["sandbox-complete", "sandbox-failed"]);
  assert.deepEqual(cleared.sort(), [
    ["event-complete", "job-complete", "sandbox-complete"],
    ["event-failed", "job-failed", "sandbox-failed"],
  ]);
});
