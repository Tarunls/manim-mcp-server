import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    plan: v.union(v.literal("free"), v.literal("creator"), v.literal("pro")),
    subscriptionStatus: v.string(),
    creditsUsedThisPeriod: v.number(),
    periodStart: v.number(),
    stripeCustomerId: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  projects: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("generating"),
      v.literal("failed"),
      v.literal("archived"),
    ),
    renderer: v.optional(v.string()),
    storageKey: v.optional(v.string()),
    latestVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  sessions: defineTable({
    projectId: v.id("projects"),
    ownerId: v.id("users"),
    sandboxId: v.optional(v.string()),
    codexPid: v.optional(v.number()),
    codexThreadId: v.optional(v.string()),
    status: v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("idle"),
      v.literal("closed"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    closedAt: v.optional(v.number()),
    closeReason: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_sandbox", ["sandboxId"])
    .index("by_status", ["status"]),

  usageReceipts: defineTable({
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    sessionId: v.optional(v.id("sessions")),
    stage: v.string(),
    model: v.string(),
    reasoningEffort: v.string(),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    estimatedCostUsd: v.number(),
    at: v.number(),
  }).index("by_user_at", ["userId", "at"]),
});
