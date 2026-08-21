import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { v } from "convex/values";

function assertOrchestrator(secret: string) {
  if (!secret || secret !== process.env.ORCHESTRATOR_SECRET) {
    throw new Error("Unauthorized orchestrator call.");
  }
}

export const start = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated.");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Project not found.");
    const now = Date.now();
    const sessionId = await ctx.db.insert("sessions", {
      projectId,
      ownerId: userId,
      status: "starting",
      startedAt: now,
      lastActivityAt: now,
    });
    return sessionId;
  },
});

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function expired(session: any, now: number) {
  return session.status === "closed" || session.status === "failed"
    ? true
    : now - session.startedAt > SESSION_TTL_MS;
}

export const activeForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect();
    const now = Date.now();
    const live = sessions.find(
      (s) =>
        s.ownerId === userId &&
        (s.status === "running" || s.status === "idle" || s.status === "starting") &&
        !expired(s, now),
    );
    if (!live) return null;
    return {
      id: live._id,
      sandboxId: live.sandboxId,
      codexPid: live.codexPid,
      codexThreadId: live.codexThreadId,
      status: live.status,
    };
  },
});

export const attachSandbox = mutation({
  args: {
    sessionId: v.id("sessions"),
    sandboxId: v.string(),
    codexPid: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, sandboxId, codexPid }) => {
    await ctx.db.patch(sessionId, {
      sandboxId,
      codexPid,
      status: "running",
      lastActivityAt: Date.now(),
    });
  },
});

export const recordActivity = mutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(v.union(v.literal("running"), v.literal("idle"))),
  },
  handler: async (ctx, { sessionId, status }) => {
    const patch: any = { lastActivityAt: Date.now() };
    if (status) patch.status = status;
    await ctx.db.patch(sessionId, patch);
  },
});

export const setThread = mutation({
  args: { sessionId: v.id("sessions"), codexThreadId: v.string() },
  handler: async (ctx, { sessionId, codexThreadId }) => {
    await ctx.db.patch(sessionId, { codexThreadId });
  },
});

export const close = mutation({
  args: { sessionId: v.id("sessions"), reason: v.string(), failed: v.optional(v.boolean()) },
  handler: async (ctx, { sessionId, reason, failed }) => {
    await ctx.db.patch(sessionId, {
      status: failed ? "failed" : "closed",
      closedAt: Date.now(),
      closeReason: reason,
    });
  },
});

export const countActiveForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return -1;
    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", userId))
      .collect();
    return sessions.filter((s) => !expired(s, now)).length;
  },
});

// Orchestrator (Vercel) functions — guarded by a shared secret.

export const listLive = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertOrchestrator(secret);
    const now = Date.now();
    const all = await ctx.db.query("sessions").collect();
    return all.filter((s) => !expired(s, now));
  },
});

export const closeBySandbox = mutation({
  args: { secret: v.string(), sandboxId: v.string(), reason: v.string(), failed: v.optional(v.boolean()) },
  handler: async (ctx, { secret, sandboxId, reason, failed }) => {
    assertOrchestrator(secret);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sandbox", (q) => q.eq("sandboxId", sandboxId))
      .first();
    if (session) {
      await ctx.db.patch(session._id, {
        status: failed ? "failed" : "closed",
        closedAt: Date.now(),
        closeReason: reason,
      });
    }
  },
});
