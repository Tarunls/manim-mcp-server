import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Database } from "../server/database.js";
import { HostedGenerationService } from "../server/hosted-generation-service.js";
import { ProjectRepository } from "../server/project-repository.js";
import { CodexBudgetExceededError, ScopedCodexProxy } from "../server/scoped-codex-proxy.js";
import type { StudioProject } from "../server/types.js";

const connectionString = process.env.TEST_DATABASE_URL;

test("hosted generation reserves credits and jobs atomically", { skip: !connectionString }, async () => {
  const previousMode = process.env.EXECUTION_MODE;
  const previousSecret = process.env.JOB_CALLBACK_SECRET;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousCodexLimit = process.env.CODEX_MAX_API_CALLS_PER_JOB;
  const previousCodexBudget = process.env.CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB;
  const previousDatabaseSsl = process.env.DATABASE_SSL;
  const previousTemplateVersion = process.env.E2B_TEMPLATE_VERSION;
  const originalFetch = globalThis.fetch;
  process.env.EXECUTION_MODE = "e2b";
  process.env.JOB_CALLBACK_SECRET = "integration-test-callback-secret-32-characters";
  process.env.OPENAI_API_KEY = "integration-upstream-key";
  process.env.CODEX_MAX_API_CALLS_PER_JOB = "1";
  process.env.DATABASE_SSL = "disable";
  process.env.E2B_TEMPLATE_VERSION = "integration-test-release";
  const db = new Database(connectionString);
  let testOwnerId: string | undefined;
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    await db.migrate(path.join(root, "db", "migrations"));
    const ownerId = `test-${randomUUID()}`;
    testOwnerId = ownerId;
    const projectId = randomUUID();
    await db.query(
      "INSERT INTO app_users (id, email, email_verified) VALUES ($1, $2, true)",
      [ownerId, `${ownerId}@example.test`],
    );
    const project: StudioProject = {
      id: projectId,
      ownerId,
      favorite: false,
      title: "Untitled video",
      prompt: "",
      renderer: "composite",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "idle",
      stage: "ready",
      versions: [],
      reviews: [],
      assets: [],
      reviewPreferences: { focus: "balanced", strictness: "normal" },
      designPreferences: { fontCategory: "modern", colorPalette: "cinematic" },
      narrationPreferences: { enabled: false },
      generationPreferences: { effort: "quick", model: "gpt-5.6-terra", reasoningEffort: "medium" },
      messages: [],
      actions: [],
    };
    await new ProjectRepository(db).save(project, ownerId);
    const service = new HostedGenerationService(db);
    const idempotencyKey = `request:${randomUUID()}`;
    const first = await service.submit({ ownerId, project, prompt: "Explain prime numbers", effort: "quick", idempotencyKey });
    const duplicate = await service.submit({ ownerId, project, prompt: "Explain prime numbers", effort: "quick", idempotencyKey });
    assert.equal(duplicate.jobId, first.jobId);
    assert.equal(duplicate.duplicate, true);
    const ledger = await db.query<{ count: string; balance: string }>(
      "SELECT count(*)::text AS count, COALESCE(sum(amount), 0)::text AS balance FROM credit_ledger WHERE user_id = $1",
      [ownerId],
    );
    assert.deepEqual(ledger.rows[0], { count: "1", balance: "-1" });
    const firstClaim = await service.claimDispatch(first.jobId);
    assert.equal(firstClaim?.templateVersion, "integration-test-release");
    assert.ok(firstClaim?.dispatchLeaseId);
    assert.equal(await service.retryDispatch(first.jobId, firstClaim.dispatchLeaseId, new Error("provider busy")), true);
    const secondClaim = await service.claimDispatch(first.jobId);
    assert.ok(secondClaim?.dispatchLeaseId);
    assert.notEqual(secondClaim?.dispatchLeaseId, firstClaim.dispatchLeaseId);
    assert.equal(await service.markSandboxStarted(first.jobId, firstClaim.dispatchLeaseId, "stale-sandbox"), undefined);
    // Unique per run: sandbox cleanup rows are deduplicated by sandbox id and
    // outlive the test's cascade cleanup, so a fixed id breaks reruns.
    const sandboxId = `sandbox-${randomUUID()}`;
    assert.equal((await service.markSandboxStarted(first.jobId, secondClaim.dispatchLeaseId!, sandboxId))?.status, "running");
    const callbackToken = service.callbackToken(first.jobId);
    const codexToken = service.codexToken(first.jobId);
    assert.notEqual(callbackToken, codexToken);
    assert.equal((await service.verifyCallback(first.jobId, callbackToken))?.id, first.jobId);
    assert.equal((await service.verifyCodexAccess(first.jobId, codexToken))?.id, first.jobId);
    assert.equal(await service.verifyCodexAccess(first.jobId, callbackToken), undefined);
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses/compact");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer integration-upstream-key");
      assert.equal((init?.headers as Record<string, string>)["openai-beta"], "responses=test");
      return new Response(JSON.stringify({ id: "response_test" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const proxy = new ScopedCodexProxy(db);
    const activeJob = (await service.getForDispatch(first.jobId))!;
    const calls = await Promise.allSettled([
      proxy.responses(activeJob, { model: "test", input: "hello" }, { compact: true, headers: { "openai-beta": "responses=test" } }),
      proxy.responses(activeJob, { model: "test", input: "duplicate" }, { compact: true, headers: { "openai-beta": "responses=test" } }),
    ]);
    assert.equal(calls.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(calls.filter((result) => result.status === "rejected").length, 1);
    process.env.CODEX_MAX_API_CALLS_PER_JOB = "10";
    process.env.CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB = "100000";
    await db.query(
      "UPDATE job_provider_calls SET estimated_cost_microusd = 250000 WHERE job_id = $1 AND provider = 'openai'",
      [first.jobId],
    );
    await assert.rejects(
      () => proxy.responses(activeJob, { model: "test", input: "over budget" }, { compact: true }),
      (error: unknown) =>
        error instanceof CodexBudgetExceededError &&
        error.statusCode === 400 &&
        error.terminal === true,
    );
    // Backdate the reservation so the refund's period stamping is observable.
    await db.query(
      "UPDATE credit_ledger SET created_at = created_at - interval '45 days' WHERE user_id = $1 AND idempotency_key = $2",
      [ownerId, `job:${first.jobId}:reserve`],
    );
    await db.query("UPDATE generation_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1", [first.jobId]);
    const reconciled = await service.reconcileExpiredJobs();
    assert.deepEqual(reconciled, { reconciled: 1 });
    const cleanup = await service.pendingSandboxCleanups();
    assert.equal(cleanup.length, 1);
    assert.deepEqual({ jobId: cleanup[0].jobId, sandboxId: cleanup[0].sandboxId }, { jobId: first.jobId, sandboxId });
    assert.equal(await service.verifyCodexAccess(first.jobId, codexToken), undefined);
    const failed = await db.query<{ error_code: string; error_message: string; error_detail: string }>(
      "SELECT error_code, error_message, error_detail FROM generation_jobs WHERE id = $1",
      [first.jobId],
    );
    assert.equal(failed.rows[0].error_code, "generation_timeout");
    assert.doesNotMatch(failed.rows[0].error_message, /lease expired/i);
    assert.match(failed.rows[0].error_detail, /lease expired/i);
    const refunded = await db.query<{ balance: string }>(
      "SELECT COALESCE(sum(amount), 0)::text AS balance FROM credit_ledger WHERE user_id = $1",
      [ownerId],
    );
    assert.equal(refunded.rows[0].balance, "0");
    // The refund must land in the reservation's billing period, not now().
    const ledgerTimes = await db.query<{ reason: string; created_at: Date }>(
      "SELECT reason, created_at FROM credit_ledger WHERE user_id = $1 AND job_id = $2 ORDER BY reason",
      [ownerId, first.jobId],
    );
    assert.deepEqual(
      ledgerTimes.rows.map((row) => row.reason),
      ["generation_refund", "generation_reservation"],
    );
    assert.equal(
      ledgerTimes.rows[0].created_at.getTime(),
      ledgerTimes.rows[1].created_at.getTime(),
    );
    // A queued job whose Cloud Tasks dispatch never arrived is failed and
    // refunded once it exceeds the queued-age bound.
    const second = await service.submit({
      ownerId,
      project,
      prompt: "Explain composite numbers",
      effort: "quick",
      idempotencyKey: `request:${randomUUID()}`,
    });
    await db.query(
      "UPDATE generation_jobs SET updated_at = now() - interval '2 hours' WHERE id = $1",
      [second.jobId],
    );
    assert.deepEqual(await service.reconcileExpiredJobs(), { reconciled: 1 });
    const stuck = await db.query<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM generation_jobs WHERE id = $1",
      [second.jobId],
    );
    assert.equal(stuck.rows[0].status, "failed");
    assert.equal(stuck.rows[0].error_code, "dispatch_expired");
    const afterStuck = await db.query<{ balance: string }>(
      "SELECT COALESCE(sum(amount), 0)::text AS balance FROM credit_ledger WHERE user_id = $1",
      [ownerId],
    );
    assert.equal(afterStuck.rows[0].balance, "0");
    await db.query("DELETE FROM app_users WHERE id = $1", [ownerId]);
    testOwnerId = undefined;
    assert.equal((await service.pendingSandboxCleanups())[0]?.eventId, cleanup[0].eventId);
    await service.finishSandboxCleanup(cleanup[0].eventId, cleanup[0].jobId, cleanup[0].sandboxId);
    assert.deepEqual(await service.pendingSandboxCleanups(), []);
  } finally {
    if (testOwnerId) await db.query("DELETE FROM app_users WHERE id = $1", [testOwnerId]);
    await db.close();
    if (previousMode === undefined) delete process.env.EXECUTION_MODE;
    else process.env.EXECUTION_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.JOB_CALLBACK_SECRET;
    else process.env.JOB_CALLBACK_SECRET = previousSecret;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousCodexLimit === undefined) delete process.env.CODEX_MAX_API_CALLS_PER_JOB;
    else process.env.CODEX_MAX_API_CALLS_PER_JOB = previousCodexLimit;
    if (previousCodexBudget === undefined) delete process.env.CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB;
    else process.env.CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB = previousCodexBudget;
    if (previousDatabaseSsl === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = previousDatabaseSsl;
    if (previousTemplateVersion === undefined) delete process.env.E2B_TEMPLATE_VERSION;
    else process.env.E2B_TEMPLATE_VERSION = previousTemplateVersion;
    globalThis.fetch = originalFetch;
  }
});
