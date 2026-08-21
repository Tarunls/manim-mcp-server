import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { isWindows, manimPath } from "./platform.js";
import { StudioService } from "./studio-service.js";
import { BillingService } from "./billing-service.js";
import { e2bConfigured, SandboxManager } from "./e2b-sandbox-manager.js";
import { E2BCodexBridge } from "./e2b-codex-bridge.js";
import { assertConcurrencyAllowed, assertPlanAllowsGeneration, quotaConfig } from "./quota-service.js";
import type { BillingPlanId, ColorPalette, FontCategory, GenerationEffort, GenerationIntent, LimitError, RendererKind, ReviewFocus, ReviewStrictness, StudioEvent } from "./types.js";

// The npm scripts used to set these with a `TMPDIR=/tmp node ...` prefix, which
// is bash syntax and fails on Windows, where /tmp does not exist either. Doing
// it here keeps the scripts portable and leaves the Windows temp dir alone.
if (!isWindows) {
  process.env.TMPDIR = "/tmp";
  process.env.TEMP = "/tmp";
  process.env.TMP = "/tmp";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = express();
const studio = new StudioService(root);
const billing = new BillingService(root);
const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

// ---------------------------------------------------------------------------
// Identity: Convex-auth session tokens arrive as `Authorization: Bearer`.
// Profiles are cached briefly so hot routes don't round-trip Convex.
// ---------------------------------------------------------------------------
const convexUrl = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || "";
const convex = convexUrl ? new ConvexHttpClient(convexUrl) : undefined;
const authRequired = process.env.AUTH_REQUIRED === "true";
const profileCache = new Map<string, { at: number; profile: Record<string, unknown> | null }>();
const PROFILE_CACHE_MS = 60_000;

async function profileFor(request: express.Request): Promise<Record<string, unknown> | null> {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !convex) return null;
  const cached = profileCache.get(token);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;
  try {
    const client = new ConvexHttpClient(convexUrl, { auth: token });
    const profile = await client.query(anyApi.users.viewer, {});
    profileCache.set(token, { at: Date.now(), profile: (profile as Record<string, unknown>) ?? null });
    if (profileCache.size > 5_000) profileCache.clear();
    return (profile as Record<string, unknown>) ?? null;
  } catch {
    profileCache.set(token, { at: Date.now(), profile: null });
    return null;
  }
}

function convexUserId(profile: Record<string, unknown> | null) {
  return typeof profile?.id === "string" ? (profile.id as string) : "";
}

// Per-session E2B execution. Falls back to the shared local bridge when E2B
// is not configured (local development without sandboxing).
let sandboxManager: SandboxManager | undefined;
if (e2bConfigured()) {
  sandboxManager = new SandboxManager(async () => {});
  const sandboxIdsByProject = new Map<string, string>();
  studio.setBridgeFactory(async (projectId) => {
    const entry = await sandboxManager!.acquire(projectId, sandboxIdsByProject.get(projectId));
    sandboxIdsByProject.set(projectId, entry.sandboxId);
    return new E2BCodexBridge(
      sandboxManager!,
      entry,
      path.join(root, "studio", "projects", projectId),
    );
  });
}


function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function userId(request: express.Request) {
  return String(request.res?.locals.studioUserId || "");
}

function ownedProject(request: express.Request) {
  const project = studio.getProject(String(request.params.id), userId(request));
  if (!project) throw new Error("Project not found.");
  return project;
}

function baseUrl(request: express.Request) {
  return process.env.APP_BASE_URL || `${request.protocol}://${request.get("host")}`;
}

function rendererFrom(value: unknown): RendererKind | undefined {
  return value === "manim" || value === "remotion" || value === "composite" ? value : undefined;
}

function generationEffortFrom(value: unknown): GenerationEffort | undefined {
  return value === "quick" || value === "balanced" || value === "thorough" ? value : undefined;
}

function generationIntentFrom(value: unknown): GenerationIntent | undefined {
  return value === "auto" || value === "new" || value === "revise" ? value : undefined;
}

function reviewFocusFrom(value: unknown): ReviewFocus | undefined {
  return ["balanced", "layout", "motion", "pedagogy", "accessibility", "polish"].includes(String(value)) ? value as ReviewFocus : undefined;
}

function reviewStrictnessFrom(value: unknown): ReviewStrictness | undefined {
  return ["quick", "normal", "obsessive"].includes(String(value)) ? value as ReviewStrictness : undefined;
}

function fontCategoryFrom(value: unknown): FontCategory | undefined {
  return ["modern", "editorial", "technical", "friendly", "classic"].includes(String(value)) ? value as FontCategory : undefined;
}

function colorPaletteFrom(value: unknown): ColorPalette | undefined {
  return ["cinematic", "studio", "ocean", "forest", "sunset", "monochrome", "high-contrast"].includes(String(value)) ? value as ColorPalette : undefined;
}

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (request, response) => {
  try {
    const signature = request.header("stripe-signature");
    if (!signature) return response.status(400).send("Missing Stripe signature.");
    const event = billing.constructWebhook(request.body as Buffer, signature);
    billing.handleWebhook(event);
    response.json({ received: true });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Stripe webhook failed.");
  }
});

app.use(express.json({ limit: "16mb" }));
app.use(["/api", "/media"], async (request, response, next) => {
  // Authenticated users carry a Convex session token; anonymous visitors keep
  // the legacy cookie identity so local development still works end to end.
  
  const profile = await profileFor(request);
  response.locals.authProfile = profile;
  if (profile) {
    response.locals.studioUserId = convexUserId(profile);
  } else {
    if (authRequired && request.originalUrl.startsWith("/api") && !request.originalUrl.startsWith("/api/pricing") && !request.originalUrl.startsWith("/api/auth")) {
      return response.status(401).json({ error: "Sign in to continue.", code: "auth-required" });
    }
    let id = cookieValue(request.header("cookie"), "lesson_studio_user");
    if (!id || !/^[a-zA-Z0-9-]{12,64}$/.test(id)) {
      id = randomUUID();
      response.cookie("lesson_studio_user", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 24 * 60 * 60 * 1_000 });
    }
    response.locals.studioUserId = id;
  }
  studio.claimLegacyProjects(String(response.locals.studioUserId));
  next();
});

app.get("/api/state", (request, response) => response.json(studio.getSnapshot(userId(request), billing.getState(userId(request)))));
app.get("/api/pricing", (_request, response) => response.json({ plans: billing.listPlans(), contactEmail: "tarun.l.sankar@gmail.com" }));
app.get("/api/billing", (request, response) => response.json(billing.getState(userId(request), studio.getAuthState().email)));

app.post("/api/billing/checkout", async (request, response) => {
  try {
    const plan = request.body?.plan as BillingPlanId;
    if (plan !== "creator" && plan !== "pro") return response.status(400).json({ error: "Choose Creator or Pro." });
    const email = typeof request.body?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.body.email.trim()) ? request.body.email.trim() : studio.getAuthState().email;
    response.json({ url: await billing.createCheckout(userId(request), plan, email, baseUrl(request)) });
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not start Stripe Checkout." });
  }
});

app.post("/api/billing/portal", async (request, response) => {
  try {
    response.json({ url: await billing.createPortal(userId(request), baseUrl(request)) });
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not open billing." });
  }
});

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const currentUserId = userId(request);
  const send = (event: StudioEvent) => {
    if (event.type === "project" && event.project.ownerId !== currentUserId) return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send(studio.getSnapshot(currentUserId, billing.getState(currentUserId)));
  studio.on("event", send);
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    studio.off("event", send);
  });
});

app.post("/api/projects", (request, response) => {
  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
  const state = billing.getState(userId(request));
  const project = studio.createProject(prompt, "composite", { narrationPreferences: { enabled: state.entitlements.narration } }, userId(request));
  response.status(201).json(studio.updateGenerationPreferences(project.id, state.plan === "free" ? "quick" : "balanced"));
});

app.patch("/api/projects/:id/favorite", (request, response) => {
  if (typeof request.body?.favorite !== "boolean") return response.status(400).json({ error: "Choose whether this video is a favorite." });
  try {
    response.json(studio.updateFavorite(request.params.id, userId(request), request.body.favorite));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Project not found." });
  }
});

app.post("/api/projects/:id/messages", async (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) return response.status(400).json({ error: "Write a prompt first." });
  try {
    const profile = (request.res?.locals.authProfile ?? null) as Record<string, unknown> | null;
    assertPlanAllowsGeneration(profile as never);
    const project = ownedProject(request);
    const effort = request.body?.effort === undefined ? undefined : generationEffortFrom(request.body.effort);
    const intent = request.body?.intent === undefined ? "auto" : generationIntentFrom(request.body.intent);
    if (!intent || (request.body?.effort !== undefined && !effort)) return response.status(400).json({ error: "Choose a valid generation mode and thinking setting." });
    if (profile && convex) {
      try {
        const active = await new ConvexHttpClient(convexUrl!, { auth: request.header("authorization")!.slice(7) })
          .query(anyApi.sessions.countActiveForUser, {});
        assertConcurrencyAllowed(profile as never, Number(active ?? 0));
      } catch (error) {
        if ((error as LimitError)?.code) throw error;
      }
    }
    const selectedEffort = effort || project.generationPreferences.effort;
    if (project.narrationPreferences.enabled) billing.assertNarration(userId(request));
    const credits = billing.reserveGeneration(userId(request), selectedEffort);
    try {
      response.status(202).json(await studio.sendMessage(request.params.id, text, undefined, { intent, requestedEffort: effort }));
    } catch (error) {
      billing.refundGeneration(userId(request), credits);
      throw error;
    }
  } catch (error) {
    const limit = error as LimitError;
    const status = limit?.code ? 429 : 409;
    response.status(status).json({ error: error instanceof Error ? error.message : "Could not start generation.", code: limit?.code });
  }
});

app.patch("/api/projects/:id/generation-preferences", (request, response) => {
  const effort = generationEffortFrom(request.body?.effort);
  if (!effort) return response.status(400).json({ error: "Choose how hard the studio should think." });
  try {
    ownedProject(request);
    billing.assertEffort(userId(request), effort);
    response.json(studio.updateGenerationPreferences(request.params.id, effort));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update generation settings." });
  }
});

app.patch("/api/projects/:id/review-preferences", (request, response) => {
  const focus = reviewFocusFrom(request.body?.focus);
  const strictness = reviewStrictnessFrom(request.body?.strictness);
  if (!focus || !strictness) return response.status(400).json({ error: "Choose a valid review focus and strictness." });
  try {
    ownedProject(request);
    response.json(studio.updateReviewPreferences(request.params.id, focus, strictness));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update review settings." });
  }
});

app.patch("/api/projects/:id/design-preferences", (request, response) => {
  const fontCategory = request.body?.fontCategory === undefined ? undefined : fontCategoryFrom(request.body.fontCategory);
  const colorPalette = request.body?.colorPalette === undefined ? undefined : colorPaletteFrom(request.body.colorPalette);
  if ((!fontCategory && request.body?.fontCategory !== undefined) || (!colorPalette && request.body?.colorPalette !== undefined) || (!fontCategory && !colorPalette)) return response.status(400).json({ error: "Choose a valid font category or color palette." });
  try {
    ownedProject(request);
    response.json(studio.updateDesignPreferences(request.params.id, { fontCategory, colorPalette }));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update design settings." });
  }
});

app.patch("/api/projects/:id/narration-preferences", (request, response) => {
  if (typeof request.body?.enabled !== "boolean") return response.status(400).json({ error: "Choose whether AI voice is on or off." });
  try {
    ownedProject(request);
    if (request.body.enabled) billing.assertNarration(userId(request));
    response.json(studio.updateNarrationPreferences(request.params.id, request.body.enabled));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update voice settings." });
  }
});

app.get("/api/projects/:id/frames", async (request, response) => {
  const versionId = typeof request.query.version === "string" ? request.query.version : "";
  const time = Number(request.query.time || 0);
  try {
    ownedProject(request);
    const frame = await studio.extractFrame(request.params.id, versionId, time);
    response.setHeader("X-Video-Frame", String(frame.frame));
    response.setHeader("X-Video-Time", frame.time.toFixed(6));
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.sendFile(frame.path);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Could not extract frame." });
  }
});

app.post("/api/projects/:id/reviews", async (request, response) => {
  try {
    ownedProject(request);
    const review = await studio.createFrameReview(request.params.id, {
      versionId: String(request.body?.versionId || ""),
      time: Number(request.body?.time || 0),
      note: String(request.body?.note || ""),
      annotatedImageData: String(request.body?.annotatedImageData || ""),
    });
    response.status(202).json(review);
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not send frame feedback." });
  }
});

app.get("/api/assets/search", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2) return response.status(400).json({ error: "Search with at least two characters." });
  try {
    billing.assertLicensedAssets(userId(request));
    response.json({ results: await studio.searchAssets(query) });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Asset search failed." });
  }
});

app.post("/api/projects/:id/assets", async (request, response) => {
  try {
    ownedProject(request);
    billing.assertLicensedAssets(userId(request));
    response.status(201).json(await studio.importAsset(request.params.id, request.body));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not import asset." });
  }
});

app.post("/api/projects/:id/cancel", async (request, response) => {
  try {
    ownedProject(request);
    await studio.cancel(request.params.id);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not cancel generation." });
  }
});

app.use("/media/:projectId", (request, response, next) => {
  if (!studio.getProject(String(request.params.projectId), userId(request))) return response.status(404).end();
  next();
});

app.use("/media", express.static(path.join(process.env.STUDIO_DATA_ROOT?.trim() || root, "studio", "projects"), {
  fallthrough: false,
  immutable: false,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-cache");
  },
}));

if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
  const clientDir = path.join(root, "dist", "client");
  app.use(express.static(clientDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(clientDir, "index.html")));
} else if (process.env.NODE_ENV !== "production") {
  // Lazy import: vite is a devDependency and must never enter the serverless
  // bundle in production.
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: path.join(root, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

export const studioApp = app;
export const initializeStudio = () => studio.initialize();

function runStandalone() {
  const server = app.listen(port, host, () => {
    console.log(`Lesson Studio is running at http://${host}:${port}`);
  });
  void studio.initialize();

  function shutdown() {
    studio.bridge.stop();
    void sandboxManager?.stopAll().finally(() => server.close(() => process.exit(0)));
    if (!sandboxManager) server.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (!process.env.VERCEL) runStandalone();

if (!fs.existsSync(manimPath(root)) && !e2bConfigured()) {
  console.warn("Manim is not installed yet. Run: npm run setup:manim");
}
