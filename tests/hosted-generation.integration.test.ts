import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Database } from "../server/database.js";
import { HostedGenerationService } from "../server/hosted-generation-service.js";
import { ProjectRepository } from "../server/project-repository.js";
import type { StudioProject } from "../server/types.js";

const connectionString = process.env.TEST_DATABASE_URL;

test("hosted generation reserves credits and jobs atomically", { skip: !connectionString }, async () => {
  const previousMode = process.env.EXECUTION_MODE;
  const previousSecret = process.env.JOB_CALLBACK_SECRET;
  process.env.EXECUTION_MODE = "e2b";
  process.env.JOB_CALLBACK_SECRET = "integration-test-callback-secret-32-characters";
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
    await service.fail(first.jobId, new Error("test failure"), true);
    const refunded = await db.query<{ balance: string }>(
      "SELECT COALESCE(sum(amount), 0)::text AS balance FROM credit_ledger WHERE user_id = $1",
      [ownerId],
    );
    assert.equal(refunded.rows[0].balance, "0");
  } finally {
    if (testOwnerId) await db.query("DELETE FROM app_users WHERE id = $1", [testOwnerId]);
    await db.close();
    if (previousMode === undefined) delete process.env.EXECUTION_MODE;
    else process.env.EXECUTION_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.JOB_CALLBACK_SECRET;
    else process.env.JOB_CALLBACK_SECRET = previousSecret;
  }
});
