import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { v } from "convex/values";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

async function ensureProfile(ctx: any, userId: any) {
  let profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .first();
  if (!profile) {
    const now = Date.now();
    const profileId = await ctx.db.insert("profiles", {
      userId,
      plan: "free",
      subscriptionStatus: "free",
      creditsUsedThisPeriod: 0,
      periodStart: now,
      role: "user",
    });
    profile = await ctx.db.get(profileId);
  } else if (Date.now() - profile.periodStart > MONTH_MS) {
    await ctx.db.patch(profile._id, {
      creditsUsedThisPeriod: 0,
      periodStart: Date.now(),
    });
    profile = { ...profile, creditsUsedThisPeriod: 0 };
  }
  return profile;
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await ensureProfile(ctx, userId);
    return {
      id: userId,
      email: user.email ?? "",
      plan: profile.plan,
      subscriptionStatus: profile.subscriptionStatus,
      creditsUsedThisPeriod: profile.creditsUsedThisPeriod,
      periodStart: profile.periodStart,
      role: profile.role,
    };
  },
});

export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated.");
    const profile = await ensureProfile(ctx, userId);
    return profile._id;
  },
});
