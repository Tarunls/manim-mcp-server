import type { AgentModel, AgentReasoningEffort } from "./types.js";

export type RouterStage =
  | "intent"
  | "research-beat-plan"
  | "plan-critique"
  | "graph-authoring"
  | "code-authoring"
  | "visual-inspection"
  | "repair"
  | "narration"
  | "asset-triage"
  | "metadata-qa"
  | "acceptance-review";

export interface StageRouting {
  model: AgentModel;
  reasoningEffort: AgentReasoningEffort;
  maxOutputTokens?: number;
}

// Per 1M tokens, post 2026-07-30 pricing.
const PRICING: Record<AgentModel, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-sol": { input: 5.0, cachedInput: 0.5, output: 30.0 },
  "gpt-5.6-terra": { input: 2.0, cachedInput: 0.2, output: 12.0 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

// Stage-based routing. Quality-critical stages stay on Sol; everything
// cheap-and-safe is pushed down-tier. Config lives here so it can be tuned
// without touching call sites.
export const STAGE_ROUTING: Record<RouterStage, StageRouting> = {
  "intent": { model: "gpt-5.6-luna", reasoningEffort: "low" },
  "research-beat-plan": { model: "gpt-5.6-terra", reasoningEffort: "high" },
  "plan-critique": { model: "gpt-5.6-sol", reasoningEffort: "medium" },
  "graph-authoring": { model: "gpt-5.6-terra", reasoningEffort: "high" },
  "code-authoring": { model: "gpt-5.6-sol", reasoningEffort: "high" },
  "visual-inspection": { model: "gpt-5.6-sol", reasoningEffort: "medium" },
  "repair": { model: "gpt-5.6-sol", reasoningEffort: "high" },
  "narration": { model: "gpt-5.6-terra", reasoningEffort: "medium" },
  "asset-triage": { model: "gpt-5.6-luna", reasoningEffort: "low" },
  "metadata-qa": { model: "gpt-5.6-luna", reasoningEffort: "low" },
  "acceptance-review": { model: "gpt-5.6-sol", reasoningEffort: "medium" },
};

// User-facing effort tiers map onto the stages that matter most. Quick keeps
// Sol only where quality would visibly collapse without it.
const EFFORT_TIERS: Record<string, Partial<Record<RouterStage, StageRouting>>> = {
  quick: {
    "code-authoring": { model: "gpt-5.6-terra", reasoningEffort: "high" },
    "repair": { model: "gpt-5.6-terra", reasoningEffort: "high" },
    "visual-inspection": { model: "gpt-5.6-terra", reasoningEffort: "medium" },
    "acceptance-review": { model: "gpt-5.6-terra", reasoningEffort: "medium" },
  },
};

export function routingFor(stage: RouterStage, userTier = "balanced"): StageRouting {
  const override = EFFORT_TIERS[userTier]?.[stage];
  return override ?? STAGE_ROUTING[stage];
}

export function estimateCostUsd(
  model: AgentModel,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const price = PRICING[model] ?? PRICING["gpt-5.6-sol"];
  const uncached = Math.max(0, inputTokens - cachedInputTokens);
  return (
    (uncached / 1_000_000) * price.input +
    (cachedInputTokens / 1_000_000) * price.cachedInput +
    (outputTokens / 1_000_000) * price.output
  );
}

export interface TokenBudget {
  maxTotalOutputTokens: number;
  maxTurnDurationMs: number;
}

const BUDGETS: Record<string, TokenBudget> = {
  firstDraft: { maxTotalOutputTokens: 90_000, maxTurnDurationMs: 15 * 60_000 },
  revision: { maxTotalOutputTokens: 45_000, maxTurnDurationMs: 10 * 60_000 },
};

export function budgetFor(kind: "firstDraft" | "revision"): TokenBudget {
  return BUDGETS[kind];
}

// The thread-level model used by codex app-server for the main authoring loop.
// Sub-stage routing applies when orchestrator-side helper calls are added;
// thread turns always run on the strongest tier so quality never collapses.
export function threadModelFor(userTier = "balanced"): StageRouting {
  return userTier === "quick"
    ? { model: "gpt-5.6-terra", reasoningEffort: "high" }
    : STAGE_ROUTING["code-authoring"];
}
