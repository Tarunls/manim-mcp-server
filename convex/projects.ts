import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { v } from "convex/values";

async function requireUserId(ctx: any) {
  const userId = await auth.getUserId(ctx);
  if (!userId) throw new Error("Not authenticated.");
  return userId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect();
  },
});

export const getOwned = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) {
      throw new Error("Project not found.");
    }
    return project;
  },
});

export const create = mutation({
  args: { name: v.string(), renderer: v.optional(v.string()) },
  handler: async (ctx, { name, renderer }) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      ownerId: userId,
      name,
      status: "active",
      renderer,
      latestVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
    return projectId;
  },
});

export const updateStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.union(
      v.literal("active"),
      v.literal("generating"),
      v.literal("failed"),
      v.literal("archived"),
    ),
    latestVersion: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, status, latestVersion }) => {
    const userId = await requireUserId(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Project not found.");
    const patch: any = { status, updatedAt: Date.now() };
    if (latestVersion !== undefined) patch.latestVersion = latestVersion;
    await ctx.db.patch(projectId, patch);
  },
});
