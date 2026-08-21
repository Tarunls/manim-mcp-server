import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { v } from "convex/values";

function assertOrchestrator(secret: string) {
  if (!secret || secret !== process.env.ORCHESTRATOR_SECRET) {
    throw new Error("Unauthorized orchestrator call.");
  }
}

export const record = mutation({
  args: {
    secret: v.string(),
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
  },
  handler: async (ctx, args) => {
    assertOrchestrator(args.secret);
    const { secret: _secret, ...receipt } = args;
    await ctx.db.insert("usageReceipts", { ...receipt, at: Date.now() });
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", receipt.userId))
      .first();
    if (profile) {
      await ctx.db.patch(profile._id, {
        creditsUsedThisPeriod: profile.creditsUsedThisPeriod + receipt.estimatedCostUsd,
      });
    }
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated.");
    const receipts = await ctx.db
      .query("usageReceipts")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);
    const total = receipts.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    return { count: receipts.length, totalCostUsd: total };
  },
});
