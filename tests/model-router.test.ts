import { test } from "node:test";
import assert from "node:assert/strict";

import { routingFor, estimateCostUsd, threadModelFor, budgetFor } from "../server/model-router.js";
import {
  assertPlanAllowsGeneration,
  assertConcurrencyAllowed,
  assertVideoDuration,
  assertTurnBudget,
} from "../server/quota-service.js";
import { LimitError } from "../server/types.js";

test("quality-critical stages stay on Sol while cheap stages drop to Luna", () => {
  assert.equal(routingFor("code-authoring").model, "gpt-5.6-sol");
  assert.equal(routingFor("repair").model, "gpt-5.6-sol");
  assert.equal(routingFor("intent").model, "gpt-5.6-luna");
  assert.equal(routingFor("asset-triage").reasoningEffort, "low");
});

test("quick tier downgrades authoring but never below Terra", () => {
  assert.equal(threadModelFor("quick").model, "gpt-5.6-terra");
  assert.equal(threadModelFor("balanced").model, "gpt-5.6-sol");
});

test("cost estimation uses cached-input discounts", () => {
  const uncached = estimateCostUsd("gpt-5.6-sol", 100_000, 0, 10_000);
  const cached = estimateCostUsd("gpt-5.6-sol", 100_000, 100_000, 10_000);
  assert.ok(uncached > cached * 2, "cached input should be far cheaper");
  const luna = estimateCostUsd("gpt-5.6-luna", 1_000_000, 0, 1_000_000);
  assert.ok(luna < 1.5, `luna full turn should cost under $1.50, was ${luna}`);
});

function expectLimit(code: string, run: () => void) {
  try {
    run();
    assert.fail(`expected LimitError ${code}`);
  } catch (error) {
    assert.ok(error instanceof LimitError);
    assert.equal((error as LimitError).code, code);
  }
}

test("quota guards reject over-limit usage with typed codes", () => {
  expectLimit("credits-exhausted", () =>
    assertPlanAllowsGeneration({ plan: "free", subscriptionStatus: "free", creditsUsedThisPeriod: 999 }));
  assert.doesNotThrow(() =>
    assertPlanAllowsGeneration({ plan: "free", subscriptionStatus: "free", creditsUsedThisPeriod: 0 }));
  expectLimit("concurrency-limit", () =>
    assertConcurrencyAllowed({ plan: "free", subscriptionStatus: "free", creditsUsedThisPeriod: 0 }, 1));
  expectLimit("duration-cap", () => assertVideoDuration(91));
  expectLimit("turn-budget", () => assertTurnBudget(14));
});

test("token budgets bound both draft and revision turns", () => {
  assert.ok(budgetFor("firstDraft").maxTotalOutputTokens > budgetFor("revision").maxTotalOutputTokens);
});
