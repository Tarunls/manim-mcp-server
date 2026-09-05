import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexBudgetExceededError,
  codexCostLimitMicrousd,
  codexPolicy,
  constrainCodexRequest,
  stageFromHeader,
} from "../server/scoped-codex-proxy.js";
import type { HostedJob } from "../server/hosted-generation-service.js";
import { resolveModels } from "../scripts/lesson_pipeline.mjs";

function job(effort: HostedJob["effort"]): HostedJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    ownerId: "owner",
    projectId: "project",
    status: "running",
    prompt: "Explain limits",
    renderer: "manim",
    effort,
    templateVersion: "release",
    reservedCredits: 1,
    input: {},
  };
}

test("the script stage uses the fast model and code stages use the purchased tier", () => {
  const models = { quick: resolveModels("quick"), balanced: resolveModels("balanced"), thorough: resolveModels("thorough") };
  assert.equal(codexPolicy("quick", "script").model, models.quick.script.model);
  assert.equal(codexPolicy("thorough", "script").model, models.thorough.script.model);
  assert.equal(codexPolicy("quick", "code").model, models.quick.code.model);
  assert.equal(codexPolicy("balanced", "repair").model, models.balanced.code.model);
  assert.equal(codexPolicy("thorough", "review").model, models.thorough.code.model);
  assert.notEqual(codexPolicy("thorough", "code").model, codexPolicy("balanced", "code").model);
});

test("environment overrides pick the models without a code change", () => {
  const env = { ORUNE_SCRIPT_MODEL: "tiny-fast", ORUNE_CODE_MODEL: "mid", ORUNE_CODE_MODEL_THOROUGH: "big", ORUNE_SCRIPT_REASONING: "minimal" };
  assert.deepEqual(resolveModels("balanced", env).script, { model: "tiny-fast", reasoning: "minimal" });
  assert.equal(resolveModels("balanced", env).code.model, "mid");
  assert.equal(resolveModels("thorough", env).code.model, "big");
});

test("unknown stage headers fall back to the code tier", () => {
  assert.equal(stageFromHeader(undefined), "code");
  assert.equal(stageFromHeader("script"), "script");
  assert.equal(stageFromHeader("anything-else"), "code");
});

test("cost policy bounds normal work and gives thorough work a larger envelope", () => {
  assert.equal(codexCostLimitMicrousd("quick"), 2_000_000);
  assert.equal(codexCostLimitMicrousd("balanced"), 2_000_000);
  assert.equal(codexCostLimitMicrousd("thorough"), 4_000_000);
});

test("the proxy overrides model selection and caps output tokens", () => {
  const constrained = constrainCodexRequest(job("balanced"), {
    model: "something-the-sandbox-chose",
    max_output_tokens: 999_999,
    input: "lesson",
  }, false, "script");
  assert.equal(constrained.model, resolveModels("balanced").script.model);
  assert.equal(constrained.max_output_tokens, 32_000);
  assert.equal(constrained.input, "lesson");
  assert.throws(() => constrainCodexRequest(job("quick"), []), /invalid/);
});

test("the proxy never lets the sandbox persist responses or attach metadata", () => {
  const constrained = constrainCodexRequest(job("quick"), {
    input: "lesson",
    store: true,
    metadata: { exfil: "user-data" },
  });
  assert.equal(constrained.store, false);
  assert.equal("metadata" in constrained, false);
});

test("budget exhaustion is a terminal client error, not a retryable 5xx", () => {
  const error = new CodexBudgetExceededError("budget reached");
  assert.equal(error.statusCode, 400);
  assert.equal(error.terminal, true);
  assert.ok(error instanceof Error);
});
