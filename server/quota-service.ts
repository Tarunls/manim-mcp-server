import { LimitError } from "./types.js";

export interface QuotaConfig {
  maxVideoDurationSeconds: number;
  maxTurnsPerGeneration: number;
  turnSoftTimeoutMs: number;
  turnHardTimeoutMs: number;
  sandboxTtlMs: number;
  concurrentGenerationsFree: number;
  concurrentGenerationsPaid: number;
  monthlyCreditsByPlan: Record<string, number>;
}

const DEFAULTS: QuotaConfig = {
  maxVideoDurationSeconds: Number(process.env.LIMIT_MAX_VIDEO_SECONDS || 90),
  maxTurnsPerGeneration: Number(process.env.LIMIT_MAX_TURNS || 14),
  turnSoftTimeoutMs: Number(process.env.LIMIT_TURN_SOFT_MS || 8 * 60_000),
  turnHardTimeoutMs: Number(process.env.LIMIT_TURN_HARD_MS || 15 * 60_000),
  sandboxTtlMs: Number(process.env.E2B_SANDBOX_TTL_MS || 45 * 60_000),
  concurrentGenerationsFree: Number(process.env.LIMIT_CONCURRENT_FREE || 1),
  concurrentGenerationsPaid: Number(process.env.LIMIT_CONCURRENT_PAID || 3),
  monthlyCreditsByPlan: {
    free: Number(process.env.LIMIT_CREDITS_FREE || 6),
    creator: Number(process.env.LIMIT_CREDITS_CREATOR || 40),
    pro: Number(process.env.LIMIT_CREDITS_PRO || 120),
  },
};

export const quotaConfig = DEFAULTS;

// Global daily spend circuit breaker (USD). When OpenAI burn for the day
// crosses this, new generations stop until an operator raises it.
function dailySpendCap() {
  return Number(process.env.LIMIT_DAILY_SPEND_USD || 250);
}

interface UserProfileLike {
  plan: string;
  subscriptionStatus: string;
  creditsUsedThisPeriod: number;
}

export function assertPlanAllowsGeneration(profile: UserProfileLike | null) {
  if (!profile) return; // anonymous local-dev usage keeps working
  const cap = DEFAULTS.monthlyCreditsByPlan[profile.plan] ?? DEFAULTS.monthlyCreditsByPlan.free;
  if (profile.creditsUsedThisPeriod >= cap) {
    throw new LimitError(
      "credits-exhausted",
      `You have used all ${cap} generation credits on the ${profile.plan} plan this period. Upgrade or wait for the next cycle.`,
    );
  }
  if (process.env.SPEND_BREAKER_OPEN === "true") {
    throw new LimitError(
      "spend-breaker",
      "The studio hit its daily spending limit. Generation is paused and will resume shortly.",
    );
  }
}

export function assertConcurrencyAllowed(profile: UserProfileLike | null, activeSessions: number) {
  if (!profile) return;
  const paid = profile.plan !== "free" && ["active", "trialing", "past_due"].includes(profile.subscriptionStatus);
  const cap = paid ? DEFAULTS.concurrentGenerationsPaid : DEFAULTS.concurrentGenerationsFree;
  if (activeSessions >= cap) {
    throw new LimitError(
      "concurrency-limit",
      paid
        ? `You already have ${activeSessions} videos generating. Wait for one to finish.`
        : "Free plans generate one video at a time. Upgrade for parallel generations.",
    );
  }
}

export function assertVideoDuration(seconds: number) {
  if (seconds > DEFAULTS.maxVideoDurationSeconds) {
    throw new LimitError(
      "duration-cap",
      `Videos are capped at ${DEFAULTS.maxVideoDurationSeconds} seconds. Trim your beat plan to fit.`,
    );
  }
}

export function assertTurnBudget(turnCount: number) {
  if (turnCount >= DEFAULTS.maxTurnsPerGeneration) {
    throw new LimitError(
      "turn-budget",
      `This generation reached the ${DEFAULTS.maxTurnsPerGeneration}-turn limit. Start a revision to continue.`,
    );
  }
}

export function assertDailySpend(todayUsd: number) {
  if (todayUsd >= dailySpendCap()) {
    throw new LimitError(
      "spend-breaker",
      "The studio hit its daily spending limit. Generation is paused and will resume shortly.",
    );
  }
}
