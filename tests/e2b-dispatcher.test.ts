import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Sandbox } from "e2b";
import { E2BDispatcher } from "../server/e2b-dispatcher.js";
import type { ArtifactService } from "../server/artifact-service.js";
import type { HostedGenerationService, HostedJob } from "../server/hosted-generation-service.js";

const previous = {
  E2B_API_KEY: process.env.E2B_API_KEY,
  E2B_TEMPLATE: process.env.E2B_TEMPLATE,
  E2B_TEMPLATE_VERSION: process.env.E2B_TEMPLATE_VERSION,
  JOB_CALLBACK_BASE_URL: process.env.JOB_CALLBACK_BASE_URL,
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
      run: async () => ({ disconnect: async () => undefined }),
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
  assert.equal(result.status, "running");
});
