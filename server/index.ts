import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { isWindows, manimPath } from "./platform.js";
import { StudioService } from "./studio-service.js";
import { BillingService } from "./billing-service.js";
import { IdentityAuthService, type AuthUser } from "./auth-service.js";
import { database } from "./database.js";
import { ensureCsrfToken, requestContext, verifyMutationRequest } from "./security.js";
import { UserRepository } from "./user-repository.js";
import type { BillingPlanId, ColorPalette, FontCategory, GenerationEffort, GenerationIntent, RendererKind, ReviewFocus, ReviewStrictness, StudioEvent } from "./types.js";

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
const dataRoot = process.env.STUDIO_DATA_ROOT ? path.resolve(process.env.STUDIO_DATA_ROOT) : root;
const app = express();
const studio = new StudioService(root, dataRoot);
const billing = new BillingService(dataRoot);
const auth = new IdentityAuthService();
const users = new UserRepository(database);
const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(requestContext);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      connectSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://checkout.stripe.com"],
    },
  } : false,
  crossOriginResourcePolicy: { policy: "same-site" },
}));

app.get(["/healthz", "/api/health"], (_request, response) => response.status(200).send("ok"));
app.get("/api/health/ready", async (_request, response) => {
  try {
    response.status(200).json(await database.healthcheck());
  } catch {
    response.status(503).json({ configured: database.configured, ready: false });
  }
});

function authUser(request: express.Request) {
  return request.res?.locals.authUser as AuthUser | undefined;
}

function userId(request: express.Request) {
  return authUser(request)?.uid || "";
}

function billingState(request: express.Request) {
  return billing.getState(userId(request), authUser(request)?.email);
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
app.use((request, response, next) => request.path.startsWith("/api/internal/") ? next() : verifyMutationRequest(request, response, next));

const authLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
const generationLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });
app.use("/api/auth", authLimiter);

function setAuthCookie(response: express.Response, sessionCookie: string) {
  response.cookie(auth.cookieName, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: auth.sessionDurationMs,
  });
}

app.get("/api/auth/status", async (request, response) => {
  const csrfToken = ensureCsrfToken(request, response);
  const user = await auth.authenticate(request.header("cookie"));
  response.json({ configured: auth.configured, authenticated: Boolean(user), user, csrfToken });
});

app.post("/api/auth/signup", async (request, response) => {
  try {
    const result = await auth.signUp(request.body?.email, request.body?.password);
    response.status(201).json({ authenticated: false, ...result });
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not create the account." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  try {
    const { user, sessionCookie } = await auth.signIn(request.body?.email, request.body?.password);
    await users.syncIdentity(user);
    setAuthCookie(response, sessionCookie);
    response.json({ authenticated: true, user });
  } catch (error) {
    response.status(401).json({ error: error instanceof Error ? error.message : "Could not sign in." });
  }
});

app.post("/api/auth/password-reset", async (request, response) => {
  try {
    await auth.sendPasswordReset(request.body?.email);
    response.status(204).end();
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not send a reset email." });
  }
});

app.post("/api/auth/logout", async (request, response) => {
  await auth.revoke(request.header("cookie"));
  response.clearCookie(auth.cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  response.status(204).end();
});

app.use(async (request, response, next) => {
  const protectedPath = request.path.startsWith("/api/") || request.path.startsWith("/media/");
  const publicPath = request.path === "/api/pricing" || request.path.startsWith("/api/health");
  if (!protectedPath || publicPath) return next();
  const user = await auth.authenticate(request.header("cookie"));
  if (!user) return response.status(401).json({ error: "Sign in to continue." });
  response.locals.authUser = user;
  billing.setStaffAccess(user.uid, user.isStaff);
  next();
});

app.get("/api/state", (request, response) => response.json(studio.getSnapshot(userId(request), billingState(request))));
app.get("/api/pricing", (_request, response) => response.json({ plans: billing.listPlans(), billingMode: billing.billingMode, contactEmail: "tarun.l.sankar@gmail.com" }));
app.get("/api/billing", (request, response) => response.json(billingState(request)));

app.post("/api/billing/checkout", async (request, response) => {
  try {
    const plan = request.body?.plan as BillingPlanId;
    if (plan !== "creator" && plan !== "pro") return response.status(400).json({ error: "Choose Creator or Pro." });
    const email = authUser(request)?.email;
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
  send(studio.getSnapshot(currentUserId, billingState(request)));
  studio.on("event", send);
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    studio.off("event", send);
  });
});

app.post("/api/projects", (request, response) => {
  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
  const state = billingState(request);
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

app.post("/api/projects/:id/messages", generationLimiter, async (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) return response.status(400).json({ error: "Write a prompt first." });
  try {
    const project = ownedProject(request);
    const effort = request.body?.effort === undefined ? undefined : generationEffortFrom(request.body.effort);
    const intent = request.body?.intent === undefined ? "auto" : generationIntentFrom(request.body.intent);
    if (!intent || (request.body?.effort !== undefined && !effort)) return response.status(400).json({ error: "Choose a valid generation mode and thinking setting." });
    const selectedEffort = effort || project.generationPreferences.effort;
    if (project.narrationPreferences.enabled) billing.assertNarration(userId(request));
    const credits = billing.reserveGeneration(userId(request), selectedEffort);
    try {
      response.status(202).json(await studio.sendMessage(String(request.params.id), text, undefined, { intent, requestedEffort: effort }));
    } catch (error) {
      billing.refundGeneration(userId(request), credits);
      throw error;
    }
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not start generation." });
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

app.use("/media", express.static(studio.projectRoot, {
  fallthrough: false,
  immutable: false,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-cache");
  },
}));

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(root, "dist", "client");
  app.use(express.static(clientDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(clientDir, "index.html")));
} else {
  const vite = await createViteServer({
    root: path.join(root, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const server = app.listen(port, host, () => {
  console.log(`Lesson Studio is running at http://${host}:${port}`);
});

void studio.initialize();

function shutdown() {
  studio.bridge.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (!fs.existsSync(manimPath(root))) {
  console.warn("Manim is not installed yet. Run: npm run setup:manim");
}
