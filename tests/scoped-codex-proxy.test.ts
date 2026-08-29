import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexBudgetExceededError,
  codexCostLimitMicrousd,
  codexPolicy,
  constrainCodexRequest,
} from "../server/scoped-codex-proxy.js";
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

test("Codex policy uses the cost-efficient model unless thorough reasoning is purchased", () => {
  assert.equal(codexPolicy("quick").model, "gpt-5.6-terra");
  assert.equal(codexPolicy("balanced").model, "gpt-5.6-terra");
  assert.equal(codexPolicy("thorough").model, "gpt-5.6-sol");
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
  assert.equal(constrained.model, "gpt-5.6-terra");
  assert.equal(constrained.max_output_tokens, 12_000);
  assert.equal(constrained.input, "lesson");
  assert.throws(() => constrainCodexRequest(job("quick"), []), /invalid/);
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
