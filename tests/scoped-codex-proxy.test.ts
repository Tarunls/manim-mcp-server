import assert from "node:assert/strict";
import test from "node:test";
import {
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
    renderer: "composite",
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
