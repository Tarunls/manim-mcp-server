import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexBudgetExceededError,
  codexCostLimitMicrousd,
  codexPolicy,
  constrainCodexRequest,
  estimatedCostMicrousd,
} from "../server/scoped-codex-proxy.js";
import { generationPreferencesFor } from "../server/studio-service.js";
import type { HostedJob } from "../server/hosted-generation-service.js";

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

test("Faster stays economical and Astra gets bounded reasoning for paid work", () => {
  assert.equal(codexPolicy("quick").model, "gpt-5.6-terra");
  assert.equal(codexPolicy("balanced").model, "gpt-6-astra");
  assert.equal(codexPolicy("balanced").reasoningEffort, "medium");
  assert.equal(codexPolicy("thorough").model, "gpt-6-astra");
  assert.equal(codexPolicy("thorough").reasoningEffort, "high");
  for (const effort of ["quick", "balanced", "thorough"] as const) {
    const local = generationPreferencesFor(effort);
    assert.equal(local.model, codexPolicy(effort).model);
    assert.equal(local.reasoningEffort, codexPolicy(effort).reasoningEffort);
  }
});

test("Codex cost policy bounds normal work and gives thorough work a larger envelope", () => {
  assert.equal(codexCostLimitMicrousd("quick"), 2_000_000);
  assert.equal(codexCostLimitMicrousd("balanced"), 2_000_000);
  assert.equal(codexCostLimitMicrousd("thorough"), 4_000_000);
});

test("Codex proxy overrides model selection and caps output tokens", () => {
  const constrained = constrainCodexRequest(job("balanced"), {
    model: "gpt-5.6-sol",
    max_output_tokens: 999_999,
    input: "lesson",
  });
  assert.equal(constrained.model, "gpt-6-astra");
  assert.equal(constrained.max_output_tokens, 12_000);
  assert.equal(constrained.input, "lesson");
  assert.throws(() => constrainCodexRequest(job("quick"), []), /invalid/);
});

test("an agent cannot upgrade reasoning or buy priority processing", () => {
  const constrained = constrainCodexRequest(job("balanced"), {
    input: "lesson",
    reasoning: { effort: "max", summary: "auto" },
    service_tier: "priority",
    max_output_tokens: 8000,
  });
  assert.deepEqual(constrained.reasoning, { effort: "medium", summary: "auto" });
  assert.equal(constrained.service_tier, "default");
  assert.equal(constrained.max_output_tokens, 8000);
  const compact = constrainCodexRequest(job("balanced"), { input: "lesson" }, true);
  assert.equal("max_output_tokens" in compact, false);
  assert.equal("reasoning" in compact, false);
  assert.equal("service_tier" in compact, false);
});

test("Astra accounting includes cached input, reasoning output and long-context rates", () => {
  assert.equal(estimatedCostMicrousd("gpt-6-astra", {
    inputTokens: 10000, cachedInputTokens: 6000, outputTokens: 2000,
  }), 156000);
  assert.equal(estimatedCostMicrousd("gpt-6-astra", {
    inputTokens: 300000, cachedInputTokens: 200000, outputTokens: 2000,
  }), 3050000);
  assert.throws(() => estimatedCostMicrousd("unknown", {
    inputTokens: 1, cachedInputTokens: 0, outputTokens: 0,
  }), /Missing model pricing/);
});

test("Codex proxy never lets the sandbox persist responses or attach metadata", () => {
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
