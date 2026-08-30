import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isWindows, manimPath } from "./platform.js";
import {
  StudioService,
  colorPaletteOrDefault,
  fontCategoryOrDefault,
  generationPreferencesFor,
  looksLikeIndependentVideoRequest,
} from "./studio-service.js";
import { titleFromPrompt } from "./plan.js";
import { BillingService } from "./billing-service.js";
import { IdentityAuthService, type AuthUser } from "./auth-service.js";
import { database } from "./database.js";
import {
  ensureCsrfToken,
  requestContext,
  verifyMutationRequest,
} from "./security.js";
import { UserRepository } from "./user-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { HostedGenerationService } from "./hosted-generation-service.js";
import { GenerationQueue } from "./cloud-tasks.js";
import { ArtifactService, type ArtifactKind } from "./artifact-service.js";
import { E2BDispatcher } from "./e2b-dispatcher.js";
import { verifyCloudTask } from "./internal-auth.js";
import { HostedBillingService } from "./hosted-billing-service.js";
import { ScopedNarrationService } from "./scoped-narration.js";
import { HostedMediaService } from "./hosted-media-service.js";
import {
  CodexBudgetExceededError,
  ScopedCodexProxy,
} from "./scoped-codex-proxy.js";
import { attachScopedCodexWebSocketProxy } from "./scoped-codex-websocket.js";
import { routeAllowedForService, type ServiceRole } from "./service-role.js";
import type {
  BillingPlanId,
  ColorPalette,
  FontCategory,
  GenerationEffort,
  GenerationIntent,
  ReviewFocus,
  ReviewStrictness,
  StudioEvent,
} from "./types.js";

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
const dataRoot = process.env.STUDIO_DATA_ROOT
  ? path.resolve(process.env.STUDIO_DATA_ROOT)
  : root;
const app = express();
const studio = new StudioService(root, dataRoot);
const billing = new BillingService(dataRoot);
const auth = new IdentityAuthService();
const users = new UserRepository(database);
const projects = new ProjectRepository(database);
const generations = new HostedGenerationService(database);
const generationQueue = new GenerationQueue(database);
const artifacts = new ArtifactService();
const dispatcher = new E2BDispatcher(generations, artifacts);
const hostedBilling = new HostedBillingService(database);
const scopedNarration = new ScopedNarrationService(database);
const hostedMedia = new HostedMediaService(database, artifacts);
const scopedCodex = new ScopedCodexProxy(database);
const port = Number(process.env.PORT || 4321);
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const serviceRole: ServiceRole =
  process.env.SERVICE_ROLE === "api" ||
  process.env.SERVICE_ROLE === "dispatcher"
    ? process.env.SERVICE_ROLE
    : "all";

function validateProductionConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!database.configured) missing.push("DATABASE_URL");
  if (process.env.EXECUTION_MODE !== "e2b") missing.push("EXECUTION_MODE=e2b");
  if (!process.env.E2B_TEMPLATE_VERSION?.trim() || process.env.E2B_TEMPLATE_VERSION === "dev")
    missing.push("E2B_TEMPLATE_VERSION (immutable tag)");
  if (serviceRole !== "dispatcher" && !auth.configured)
    missing.push("IDENTITY_PLATFORM_API_KEY");
  if (serviceRole !== "api" && !dispatcher.configured)
    missing.push("E2B/artifact configuration");
  if (!generationQueue.configured)
    missing.push("Cloud Tasks identity and URL configuration");
  if (serviceRole !== "dispatcher" && !hostedBilling.configured)
    missing.push("Stripe configuration");
  if (serviceRole !== "dispatcher" && !scopedCodex.configured)
    missing.push("OpenAI proxy configuration");
  if (
    serviceRole !== "dispatcher" &&
    process.env.BILLING_MODE_REQUIRED &&
    hostedBilling.billingMode !== process.env.BILLING_MODE_REQUIRED
  ) {
    missing.push(
      `STRIPE_SECRET_KEY (${process.env.BILLING_MODE_REQUIRED} mode)`,
    );
  }
  if ((process.env.JOB_CALLBACK_SECRET?.length || 0) < 32)
    missing.push("JOB_CALLBACK_SECRET (32+ characters)");
  for (const name of ["APP_BASE_URL", "JOB_CALLBACK_BASE_URL"] as const) {
    const value = process.env[name];
    if (!value || !value.startsWith("https://"))
      missing.push(`${name} (HTTPS URL)`);
  }
  if (missing.length)
    throw new Error(
      `Production configuration is incomplete: ${missing.join(", ")}`,
    );
}

validateProductionConfiguration();

// A stray rejected promise must not crash the whole service; log it instead.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(requestContext);
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              mediaSrc: ["'self'", "blob:", "https:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'", "https://checkout.stripe.com"],
            },
          }
        : false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

app.get(["/healthz", "/api/health"], (_request, response) =>
  response.status(200).send("ok"),
);
app.get("/api/health/ready", async (_request, response) => {
  try {
    response.status(200).json(await database.healthcheck());
  } catch {
    response
      .status(503)
      .json({ configured: database.configured, ready: false });
  }
});

app.use((request, response, next) => {
  return routeAllowedForService(serviceRole, request.path)
    ? next()
    : response.status(404).end();
});

function authUser(request: express.Request) {
  return request.res?.locals.authUser as AuthUser | undefined;
}

function userId(request: express.Request) {
  return authUser(request)?.uid || "";
}

async function billingState(request: express.Request) {
  return database.configured
    ? hostedBilling.getState(userId(request))
    : billing.getState(userId(request), authUser(request)?.email);
}

async function assertEffort(
  request: express.Request,
  effort: GenerationEffort,
) {
  if (database.configured)
    return hostedBilling.assertEffort(userId(request), effort);
  billing.assertEffort(userId(request), effort);
}

async function assertNarration(request: express.Request) {
  if (database.configured)
    return hostedBilling.assertNarration(userId(request));
  billing.assertNarration(userId(request));
}

async function assertLicensedAssets(request: express.Request) {
  if (database.configured)
    return hostedBilling.assertLicensedAssets(userId(request));
  billing.assertLicensedAssets(userId(request));
}

function hostedRuntime() {
  const ready =
    generations.configured &&
    generationQueue.configured &&
    artifacts.configured;
  return { codex: ready, manim: ready, ffmpeg: ready };
}

// What the browser needs to know is whether this service can ACCEPT a
// generation. The API role submits through Cloud Tasks and never holds the
// E2B key, so gating the composer on dispatcher.configured blocked every
// hosted user with "Generation service needs configuration".
function hostedAuthState() {
  return {
    connected:
      generations.configured &&
      generationQueue.configured &&
      artifacts.configured,
    mode: "hosted-e2b",
  };
}

async function ownedProject(request: express.Request) {
  const project = generations.configured
    ? await projects.get(String(request.params.id), userId(request))
    : studio.getProject(String(request.params.id), userId(request));
  if (!project) throw new Error("Project not found.");
  return generations.configured ? studio.restoreProject(project) : project;
}

async function persistHostedProject(
  project: ReturnType<typeof studio.getProject>,
) {
  if (generations.configured && project)
    await projects.save(project, project.ownerId);
  return project;
}

function baseUrl(request: express.Request) {
  return (
    process.env.APP_BASE_URL || `${request.protocol}://${request.get("host")}`
  );
}

function generationEffortFrom(value: unknown): GenerationEffort | undefined {
  return value === "quick" || value === "balanced" || value === "thorough"
    ? value
    : undefined;
}

function generationIntentFrom(value: unknown): GenerationIntent | undefined {
  return value === "auto" || value === "new" || value === "revise"
    ? value
    : undefined;
}

function reviewFocusFrom(value: unknown): ReviewFocus | undefined {
  return [
    "balanced",
    "layout",
    "motion",
    "pedagogy",
    "accessibility",
    "polish",
  ].includes(String(value))
    ? (value as ReviewFocus)
    : undefined;
}

function reviewStrictnessFrom(value: unknown): ReviewStrictness | undefined {
  return ["quick", "normal", "obsessive"].includes(String(value))
    ? (value as ReviewStrictness)
    : undefined;
}

// Design preferences saved before the paper house style (and any client still
// sending the retired names) resolve to the current default rather than being
// rejected, so an old project never fails to open.
function fontCategoryFrom(value: unknown): FontCategory {
  return fontCategoryOrDefault(value);
}

function colorPaletteFrom(value: unknown): ColorPalette {
  return colorPaletteOrDefault(value);
}

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    try {
      const signature = request.header("stripe-signature");
      if (!signature)
        return response.status(400).send("Missing Stripe signature.");
      const event = database.configured
        ? hostedBilling.constructWebhook(request.body as Buffer, signature)
        : billing.constructWebhook(request.body as Buffer, signature);
      if (database.configured) await hostedBilling.handleWebhook(event);
      else billing.handleWebhook(event);
      response.json({ received: true });
    } catch (error) {
      response
        .status(400)
        .send(
          error instanceof Error ? error.message : "Stripe webhook failed.",
        );
    }
  },
);

app.use(express.json({ limit: "16mb" }));
app.use((request, response, next) =>
  request.path.startsWith("/api/internal/")
    ? next()
    : verifyMutationRequest(request, response, next),
);

const authLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (request) =>
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS",
});
const generationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

app.post(
  "/api/internal/generation/dispatch",
  verifyCloudTask,
  async (request, response) => {
    const jobId =
      typeof request.body?.jobId === "string" ? request.body.jobId : "";
    if (!/^[0-9a-f-]{36}$/i.test(jobId))
      return response.status(400).json({ error: "Invalid job ID." });
    try {
      response.status(202).json(await dispatcher.dispatch(jobId));
    } catch (error) {
      console.error("E2B dispatch failed", {
        jobId,
        message: error instanceof Error ? error.message : "unknown",
      });
      response
        .status(503)
        .json({ error: "Generation dispatch will be retried." });
    }
  },
);

app.post(
  "/api/internal/generation/reconcile",
  verifyCloudTask,
  async (_request, response) => {
    try {
      response.json(await dispatcher.reconcile());
    } catch (error) {
      console.error("Generation reconciliation failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      response.status(503).json({ error: "Generation reconciliation will be retried." });
    }
  },
);

app.post(
  "/api/internal/generation/:jobId/complete",
  async (request, response) => {
    const token = (request.header("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const job = await generations.verifyCallback(
      String(request.params.jobId),
      token,
    );
    if (!job || !["running", "uploading", "complete"].includes(job.status))
      return response
        .status(401)
        .json({ error: "Invalid or expired job callback." });
    if (job.status === "complete")
      return response.json({ received: true, duplicate: true });
    try {
      const reported = Array.isArray(request.body?.artifacts)
        ? request.body.artifacts.filter((kind: unknown): kind is ArtifactKind =>
            [
              "video",
              "poster",
              "contact_sheet",
              "source_archive",
              "metadata",
            ].includes(String(kind)),
          )
        : [];
      await generations.markUploading(job.id);
      const verified = await artifacts.verify(job, reported);
      const render = await artifacts.readRenderMetadata(job.id);
      await generations.complete(
        job.id,
        verified,
        render,
        typeof request.body?.assistantMessage === "string"
          ? request.body.assistantMessage
          : undefined,
      );
      response.json({ received: true });
    } catch (error) {
      console.error("Generation artifact validation failed", {
        jobId: job.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      await generations.fail(job.id, error, true);
      response.status(409).json({ error: "Artifact validation failed." });
    }
  },
);

app.post(
  "/api/internal/generation/:jobId/failure",
  async (request, response) => {
    const token = (request.header("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const job = await generations.verifyCallback(
      String(request.params.jobId),
      token,
    );
    if (!job)
      return response.status(401).json({ error: "Invalid job callback." });
    const diagnostic =
      typeof request.body?.error === "string"
        ? request.body.error.slice(0, 4000)
        : "Sandbox generation failed.";
    console.error("E2B sandbox generation failed", {
      jobId: job.id,
      sandboxId: job.sandboxId,
      message: diagnostic,
    });
    await generations.fail(
      job.id,
      new Error(diagnostic),
      true,
    );
    response.json({ received: true });
  },
);

app.post(
  "/api/internal/generation/:jobId/narration",
  async (request, response) => {
    const token = (request.header("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const job = await generations.verifyCallback(
      String(request.params.jobId),
      token,
    );
    if (!job || !["running", "uploading"].includes(job.status))
      return response.status(401).json({ error: "Invalid job callback." });
    try {
      response.json(await scopedNarration.speak(job, request.body || {}));
    } catch (error) {
      response
        .status(409)
        .json({
          error: error instanceof Error ? error.message : "Narration failed.",
        });
    }
  },
);

app.post(
  "/api/internal/generation/:jobId/progress",
  async (request, response) => {
    const token = (request.header("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const job = await generations.verifyCallback(
      String(request.params.jobId),
      token,
    );
    if (!job || !["dispatching", "running", "uploading"].includes(job.status))
      return response.status(401).json({ error: "Invalid job callback." });
    await generations
      .recordProgress(job, request.body || {})
      .catch(() => undefined);
    response.status(204).end();
  },
);

app.post(
  [
    "/api/internal/codex/:jobId/v1/responses",
    "/api/internal/codex/:jobId/v1/responses/compact",
  ],
  async (request, response) => {
    const token = (request.header("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const job = await generations.verifyCodexAccess(
      String(request.params.jobId),
      token,
    );
    if (!job)
      return response
        .status(401)
        .json({ error: "Invalid or expired Codex credential." });
    try {
      const upstream = await scopedCodex.responses(job, request.body, {
        headers: Object.fromEntries(
          [
            "accept",
            "openai-beta",
            "x-client-request-id",
            "x-codex-installation-id",
            "x-codex-routing-hint",
            "x-codex-turn-state",
            "x-oai-attestation",
            "x-openai-subagent",
          ].map((name) => [name, request.header(name)]),
        ),
        compact: request.path.endsWith("/compact"),
      });
      response.status(upstream.status);
      for (const header of [
        "content-type",
        "openai-processing-ms",
        "retry-after",
        "x-codex-turn-state",
        "x-request-id",
      ]) {
        const value = upstream.headers.get(header);
        if (value) response.setHeader(header, value);
      }
      if (!upstream.body) return response.end();
      await pipeline(
        Readable.fromWeb(
          upstream.body as import("node:stream/web").ReadableStream,
        ),
        response,
      );
    } catch (error) {
      if (response.headersSent)
        return response.destroy(error instanceof Error ? error : undefined);
      // Budget exhaustion is terminal: the Codex SDK in the sandbox retries
      // 5xx responses, so it must see a 4xx and fail fast.
      if (error instanceof CodexBudgetExceededError)
        return response
          .status(error.statusCode)
          .json({ error: error.message, terminal: true });
      response
        .status(502)
        .json({
          error:
            error instanceof Error ? error.message : "OpenAI request failed.",
        });
    }
  },
);

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
  response.json({
    configured: auth.configured,
    authenticated: Boolean(user),
    user,
    csrfToken,
  });
});

app.post("/api/auth/signup", async (request, response) => {
  try {
    const result = await auth.signUp(
      request.body?.email,
      request.body?.password,
    );
    response.status(201).json({ authenticated: false, ...result });
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not create the account.",
      });
  }
});

app.post("/api/auth/login", async (request, response) => {
  try {
    const { user, sessionCookie } = await auth.signIn(
      request.body?.email,
      request.body?.password,
    );
    await users.syncIdentity(user);
    setAuthCookie(response, sessionCookie);
    response.json({ authenticated: true, user });
  } catch (error) {
    response
      .status(401)
      .json({
        error: error instanceof Error ? error.message : "Could not sign in.",
      });
  }
});

app.post("/api/auth/password-reset", async (request, response) => {
  try {
    await auth.sendPasswordReset(request.body?.email);
    response.status(204).end();
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not send a reset email.",
      });
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
  const protectedPath =
    request.path.startsWith("/api/") || request.path.startsWith("/media/");
  const publicPath =
    request.path === "/api/pricing" || request.path.startsWith("/api/health");
  if (!protectedPath || publicPath) return next();
  const user = await auth.authenticate(request.header("cookie"));
  if (!user)
    return response.status(401).json({ error: "Sign in to continue." });
  response.locals.authUser = user;
  billing.setStaffAccess(user.uid, user.isStaff);
  next();
});

app.get("/api/state", async (request, response) => {
  const snapshot = studio.getSnapshot(
    userId(request),
    await billingState(request),
  );
  if (generations.configured) {
    snapshot.projects = (await projects.list(userId(request))).map((project) =>
      studio.restoreProject(project),
    );
    snapshot.runtime = hostedRuntime();
    snapshot.auth = hostedAuthState();
  }
  response.json(snapshot);
});
app.get("/api/pricing", (_request, response) => {
  const billingMode = database.configured
    ? hostedBilling.billingMode
    : billing.billingMode;
  response.json({
    plans: billing.listPlans(),
    billingMode,
    checkoutEnabled:
      billingMode === "live" ||
      (billingMode === "test" && process.env.ALLOW_TEST_CHECKOUT === "true"),
    contactEmail: "tarun.l.sankar@gmail.com",
  });
});
app.get("/api/billing", async (request, response) =>
  response.json(await billingState(request)),
);

app.get("/api/account/export", async (request, response) => {
  if (!database.configured)
    return response
      .status(409)
      .json({ error: "Account export is available in the hosted service." });
  const ownerId = userId(request);
  const [user, projectRows, jobs, billingProfile, usage] = await Promise.all([
    database.query(
      "SELECT email, email_verified, role, created_at, updated_at FROM app_users WHERE id = $1",
      [ownerId],
    ),
    database.query(
      "SELECT document, created_at, updated_at FROM projects WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [ownerId],
    ),
    database.query(
      "SELECT id, project_id, status, prompt, renderer, effort, reserved_credits, error_code, queued_at, started_at, completed_at FROM generation_jobs WHERE owner_id = $1 ORDER BY queued_at",
      [ownerId],
    ),
    database.query(
      "SELECT plan, status, period_start, period_end, created_at, updated_at FROM billing_profiles WHERE user_id = $1",
      [ownerId],
    ),
    database.query(
      `SELECT COALESCE(sum(pc.input_tokens), 0)::text AS input_tokens,
              COALESCE(sum(pc.cached_input_tokens), 0)::text AS cached_input_tokens,
              COALESCE(sum(pc.output_tokens), 0)::text AS output_tokens,
              COALESCE(sum(pc.estimated_cost_microusd), 0)::text AS estimated_cost_microusd
         FROM job_provider_calls pc
         JOIN generation_jobs job ON job.id = pc.job_id
        WHERE job.owner_id = $1`,
      [ownerId],
    ),
  ]);
  const exported = {
    exportedAt: new Date().toISOString(),
    account: user.rows[0],
    billing: billingProfile.rows[0],
    providerUsage: usage.rows[0],
    projects: projectRows.rows,
    generationJobs: jobs.rows,
  };
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="lesson-studio-export-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  response.type("application/json").send(JSON.stringify(exported, null, 2));
});

app.delete("/api/account", async (request, response) => {
  if (!database.configured)
    return response
      .status(409)
      .json({ error: "Account deletion is available in the hosted service." });
  const user = authUser(request)!;
  if (
    typeof request.body?.email !== "string" ||
    request.body.email.trim().toLowerCase() !== user.email
  ) {
    return response
      .status(400)
      .json({ error: "Enter your account email to confirm deletion." });
  }
  const active = await database.query<{ id: string }>(
    "SELECT id FROM generation_jobs WHERE owner_id = $1 AND status IN ('queued', 'dispatching', 'running', 'uploading') LIMIT 1",
    [user.uid],
  );
  if (active.rowCount)
    return response
      .status(409)
      .json({
        error: "Cancel the active generation before deleting your account.",
      });
  try {
    const [projectRows, jobRows] = await Promise.all([
      database.query<{ id: string }>(
        "SELECT id FROM projects WHERE owner_id = $1",
        [user.uid],
      ),
      database.query<{ id: string }>(
        "SELECT id FROM generation_jobs WHERE owner_id = $1",
        [user.uid],
      ),
    ]);
    await hostedBilling.cancelForAccountDeletion(user.uid);
    await artifacts.deleteAccountObjects(
      projectRows.rows.map((row) => row.id),
      jobRows.rows.map((row) => row.id),
    );
    await database.query("DELETE FROM app_users WHERE id = $1", [user.uid]);
    await auth.deleteIdentity(user.uid);
    response.clearCookie(auth.cookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    response.status(204).end();
  } catch (error) {
    console.error("Account deletion failed", {
      userId: user.uid,
      message: error instanceof Error ? error.message : "unknown",
    });
    response
      .status(503)
      .json({
        error:
          "Account deletion could not be completed. No additional charges were created; contact support if this continues.",
      });
  }
});

app.post("/api/billing/checkout", async (request, response) => {
  try {
    const plan = request.body?.plan as BillingPlanId;
    if (plan !== "creator" && plan !== "pro" && plan !== "studio")
      return response.status(400).json({ error: "Choose a paid plan." });
    const email = authUser(request)?.email;
    const url = database.configured
      ? await hostedBilling.createCheckout(
          userId(request),
          plan,
          email,
          baseUrl(request),
        )
      : await billing.createCheckout(
          userId(request),
          plan,
          email,
          baseUrl(request),
        );
    response.json({ url });
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not start Stripe Checkout.",
      });
  }
});

app.post("/api/billing/portal", async (request, response) => {
  try {
    const url = database.configured
      ? await hostedBilling.createPortal(userId(request), baseUrl(request))
      : await billing.createPortal(userId(request), baseUrl(request));
    response.json({ url });
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error ? error.message : "Could not open billing.",
      });
  }
});

// Open SSE responses, so shutdown can end them instead of hanging server.close().
const sseResponses = new Set<express.Response>();
type ProjectPollSubscriber = (event: StudioEvent) => void;
const projectPollers = new Map<
  string,
  {
    timer: NodeJS.Timeout;
    subscribers: Set<ProjectPollSubscriber>;
    knownRevisions: Map<string, number>;
  }
>();

// One shared poller per user: N open tabs cost one projects.list query.
function subscribeToProjectChanges(
  pollUserId: string,
  subscriber: ProjectPollSubscriber,
) {
  let poller = projectPollers.get(pollUserId);
  if (!poller) {
    const created = {
      subscribers: new Set<ProjectPollSubscriber>(),
      knownRevisions: new Map<string, number>(),
      timer: setInterval(() => {
        void projects
          .list(pollUserId)
          .then((items) => {
            for (const item of items) {
              const revision = Number(
                (item as typeof item & { storageRevision?: number })
                  .storageRevision || 0,
              );
              if (created.knownRevisions.get(item.id) !== revision)
                // Mirror the snapshot path: the browser expects restored
                // projects, not raw repository rows.
                for (const send of created.subscribers)
                  send({ type: "project", project: studio.restoreProject(item) });
              created.knownRevisions.set(item.id, revision);
            }
          })
          .catch(() => undefined);
      }, 2_000),
    };
    projectPollers.set(pollUserId, created);
    poller = created;
  }
  poller.subscribers.add(subscriber);
  return () => {
    poller.subscribers.delete(subscriber);
    if (!poller.subscribers.size) {
      clearInterval(poller.timer);
      projectPollers.delete(pollUserId);
    }
  };
}

app.get("/api/events", async (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const currentUserId = userId(request);
  const send = (event: StudioEvent) => {
    if (event.type === "project" && event.project.ownerId !== currentUserId)
      return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const initial = studio.getSnapshot(
    currentUserId,
    await billingState(request),
  );
  if (generations.configured) {
    initial.projects = (await projects.list(currentUserId)).map((project) =>
      studio.restoreProject(project),
    );
    initial.runtime = hostedRuntime();
    initial.auth = hostedAuthState();
  }
  send(initial);
  if (!generations.configured) studio.on("event", send);
  const heartbeat = setInterval(
    () => response.write(": keepalive\n\n"),
    20_000,
  );
  sseResponses.add(response);
  const unsubscribe = generations.configured
    ? subscribeToProjectChanges(currentUserId, send)
    : undefined;
  request.on("close", () => {
    clearInterval(heartbeat);
    sseResponses.delete(response);
    if (unsubscribe) unsubscribe();
    if (!generations.configured) studio.off("event", send);
  });
});

app.post(
  "/api/projects",
  // A local-mode create with a prompt starts a generation, so it must pass
  // the same rate limit as the messages route.
  (request, response, next) => {
    const prompt =
      typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    if (!generations.configured && prompt)
      return generationLimiter(request, response, next);
    next();
  },
  async (request, response) => {
    const prompt =
      typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    const state = await billingState(request);
    const effort = state.plan === "free" ? "quick" : "balanced";
    let credits = 0;
    if (!generations.configured && prompt) {
      try {
        credits = billing.reserveGeneration(userId(request), effort);
      } catch (error) {
        return response.status(409).json({
          error:
            error instanceof Error
              ? error.message
              : "Could not start generation.",
        });
      }
    }
    const project = studio.createProject(
      "",
      { narrationPreferences: { enabled: state.entitlements.narration } },
      userId(request),
    );
    if (generations.configured && prompt) {
      project.prompt = prompt;
      project.title = titleFromPrompt(prompt);
    }
    const updated = studio.updateGenerationPreferences(project.id, effort);
    if (!generations.configured && prompt) {
      try {
        await studio.sendMessage(project.id, prompt);
      } catch (error) {
        billing.refundGeneration(userId(request), credits);
        return response.status(409).json({
          error:
            error instanceof Error
              ? error.message
              : "Could not start generation.",
        });
      }
    }
    await persistHostedProject(updated);
    response.status(201).json(updated);
  },
);

app.patch("/api/projects/:id/favorite", async (request, response) => {
  if (typeof request.body?.favorite !== "boolean")
    return response
      .status(400)
      .json({ error: "Choose whether this video is a favorite." });
  try {
    const favorite = request.body.favorite as boolean;
    const project = generations.configured
      ? await projects.update(String(request.params.id), userId(request), (stored) => {
          stored.favorite = favorite;
        })
      : studio.updateFavorite(
          String(request.params.id),
          userId(request),
          favorite,
        );
    response.json(project);
  } catch (error) {
    response
      .status(404)
      .json({
        error: error instanceof Error ? error.message : "Project not found.",
      });
  }
});

app.post(
  "/api/projects/:id/messages",
  generationLimiter,
  async (request, response) => {
    const text =
      typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text)
      return response.status(400).json({ error: "Write a prompt first." });
    try {
      let project = await ownedProject(request);
      const effort =
        request.body?.effort === undefined
          ? undefined
          : generationEffortFrom(request.body.effort);
      const intent =
        request.body?.intent === undefined
          ? "auto"
          : generationIntentFrom(request.body.intent);
      if (!intent || (request.body?.effort !== undefined && !effort))
        return response
          .status(400)
          .json({
            error: "Choose a valid generation mode and thinking setting.",
          });
      const hasPriorWork = Boolean(
        project.messages.length || project.versions.length,
      );
      const startFresh =
        generations.configured &&
        hasPriorWork &&
        (intent === "new" ||
          (intent === "auto" &&
            looksLikeIndependentVideoRequest(text, project)));
      if (startFresh) {
        project = studio.createProject(
          "",
          {
            reviewPreferences: project.reviewPreferences,
            designPreferences: project.designPreferences,
            narrationPreferences: project.narrationPreferences,
            generationPreferences: project.generationPreferences,
          },
          userId(request),
        );
        await projects.save(project, userId(request));
      }
      const selectedEffort = effort || project.generationPreferences.effort;
      if (project.narrationPreferences.enabled) await assertNarration(request);
      if (generations.configured) {
        const idempotencyKey = request.header("idempotency-key") || "";
        let result;
        try {
          result = await generations.submit({
            ownerId: userId(request),
            project,
            prompt: text,
            effort: selectedEffort,
            idempotencyKey,
          });
        } catch (error) {
          // Do not leave the empty fresh project behind if its first
          // generation was rejected.
          if (startFresh)
            await projects
              .delete(project.id, userId(request))
              .catch(() => undefined);
          throw error;
        }
        void generationQueue
          .flush()
          .catch((error) =>
            console.error("Outbox flush failed", {
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
        return response
          .status(202)
          .json({
            project: result.project,
            startedFresh: startFresh,
            mode: project.versions.length ? "revision" : "first-draft",
            jobId: result.jobId,
          });
      }
      const credits = billing.reserveGeneration(
        userId(request),
        selectedEffort,
      );
      try {
        response
          .status(202)
          .json(
            await studio.sendMessage(String(request.params.id), text, {
              intent,
              requestedEffort: effort,
            }),
          );
      } catch (error) {
        billing.refundGeneration(userId(request), credits);
        throw error;
      }
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Could not start generation.",
        });
    }
  },
);

app.patch(
  "/api/projects/:id/generation-preferences",
  async (request, response) => {
    const effort = generationEffortFrom(request.body?.effort);
    if (!effort)
      return response
        .status(400)
        .json({ error: "Choose how hard the studio should think." });
    try {
      await ownedProject(request);
      await assertEffort(request, effort);
      const project = generations.configured
        ? await projects.update(
            String(request.params.id),
            userId(request),
            (stored) => {
              if (stored.status === "running")
                throw new Error("Wait for the current generation to finish.");
              stored.generationPreferences = generationPreferencesFor(effort);
            },
          )
        : studio.updateGenerationPreferences(String(request.params.id), effort);
      response.json(project);
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Could not update generation settings.",
        });
    }
  },
);

app.patch("/api/projects/:id/review-preferences", async (request, response) => {
  const focus = reviewFocusFrom(request.body?.focus);
  const strictness = reviewStrictnessFrom(request.body?.strictness);
  if (!focus || !strictness)
    return response
      .status(400)
      .json({ error: "Choose a valid review focus and strictness." });
  try {
    await ownedProject(request);
    const project = generations.configured
      ? await projects.update(
          String(request.params.id),
          userId(request),
          (stored) => {
            if (stored.status === "running")
              throw new Error("Wait for the current generation to finish.");
            stored.reviewPreferences = { focus, strictness };
          },
        )
      : studio.updateReviewPreferences(
          String(request.params.id),
          focus,
          strictness,
        );
    response.json(project);
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not update review settings.",
      });
  }
});

app.patch("/api/projects/:id/design-preferences", async (request, response) => {
  const fontCategory =
    request.body?.fontCategory === undefined
      ? undefined
      : fontCategoryFrom(request.body.fontCategory);
  const colorPalette =
    request.body?.colorPalette === undefined
      ? undefined
      : colorPaletteFrom(request.body.colorPalette);
  if (!fontCategory && !colorPalette)
    return response
      .status(400)
      .json({ error: "Choose a font category or color palette." });
  try {
    await ownedProject(request);
    const project = generations.configured
      ? await projects.update(
          String(request.params.id),
          userId(request),
          (stored) => {
            if (stored.status === "running")
              throw new Error("Wait for the current generation to finish.");
            stored.designPreferences = {
              fontCategory: fontCategoryOrDefault(
                fontCategory ?? stored.designPreferences.fontCategory,
              ),
              colorPalette: colorPaletteOrDefault(
                colorPalette ?? stored.designPreferences.colorPalette,
              ),
            };
          },
        )
      : studio.updateDesignPreferences(String(request.params.id), {
          fontCategory,
          colorPalette,
        });
    response.json(project);
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not update design settings.",
      });
  }
});

app.patch(
  "/api/projects/:id/narration-preferences",
  async (request, response) => {
    if (typeof request.body?.enabled !== "boolean")
      return response
        .status(400)
        .json({ error: "Choose whether AI voice is on or off." });
    try {
      await ownedProject(request);
      const enabled = request.body.enabled as boolean;
      if (enabled) await assertNarration(request);
      const project = generations.configured
        ? await projects.update(
            String(request.params.id),
            userId(request),
            (stored) => {
              if (stored.status === "running")
                throw new Error("Wait for the current generation to finish.");
              stored.narrationPreferences = { enabled };
            },
          )
        : studio.updateNarrationPreferences(String(request.params.id), enabled);
      response.json(project);
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Could not update voice settings.",
        });
    }
  },
);

app.get("/api/projects/:id/frames", async (request, response) => {
  const versionId =
    typeof request.query.version === "string" ? request.query.version : "";
  const time = Number(request.query.time || 0);
  try {
    const project = await ownedProject(request);
    const frame = generations.configured
      ? await hostedMedia.extractFrame(
          userId(request),
          project,
          versionId,
          time,
        )
      : await studio.extractFrame(String(request.params.id), versionId, time);
    response.setHeader("X-Video-Frame", String(frame.frame));
    response.setHeader("X-Video-Time", frame.time.toFixed(6));
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    const cleanup =
      "cleanup" in frame && typeof frame.cleanup === "function"
        ? frame.cleanup
        : undefined;
    response.sendFile(frame.path, (error) => {
      if (cleanup) void cleanup();
      if (error && !response.headersSent) response.status(404).end();
    });
  } catch (error) {
    response
      .status(404)
      .json({
        error:
          error instanceof Error ? error.message : "Could not extract frame.",
      });
  }
});

app.post("/api/projects/:id/reviews", async (request, response) => {
  try {
    const project = await ownedProject(request);
    if (generations.configured) {
      if (project.status === "running")
        throw new Error(
          "Wait for the current revision to finish before sending frame feedback.",
        );
      const versionId = String(request.body?.versionId || "");
      const note = String(request.body?.note || "").trim();
      if (!note || note.length > 4000)
        throw new Error("Add a review note under 4,000 characters.");
      const match = String(request.body?.annotatedImageData || "").match(
        /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw new Error("The annotated frame must be a PNG image.");
      const annotated = Buffer.from(match[1], "base64");
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      if (
        !annotated.subarray(0, 8).equals(pngSignature) ||
        annotated.length > 12 * 1024 * 1024
      )
        throw new Error("The annotated frame is not a valid PNG under 12 MB.");
      const extracted = await hostedMedia.extractFrame(
        userId(request),
        project,
        versionId,
        Number(request.body?.time || 0),
      );
      try {
        const clean = fs.readFileSync(extracted.path);
        const stored = await hostedMedia.storeReviewImages(
          userId(request),
          project.id,
          clean,
          annotated,
        );
        const review = {
          id: randomUUID(),
          versionId,
          time: extracted.time,
          frame: extracted.frame,
          note,
          createdAt: new Date().toISOString(),
          cleanFrameUrl: `/api/project-files/${stored.cleanId}`,
          annotatedFrameUrl: `/api/project-files/${stored.annotatedId}`,
        };
        // Submit first: a rejected submit must not leave an orphaned review
        // in the project or stray frame uploads behind.
        let result;
        try {
          result = await generations.submit({
            ownerId: userId(request),
            project,
            prompt: `Frame review at ${review.time.toFixed(2)} seconds: ${note}`,
            effort: project.generationPreferences.effort,
            idempotencyKey: request.header("idempotency-key") || "",
            attachments: [
              { fileId: stored.cleanId, label: "Clean rendered frame" },
              { fileId: stored.annotatedId, label: "Reviewer-annotated frame" },
            ],
          });
        } catch (error) {
          await hostedMedia
            .deleteProjectFiles(userId(request), project.id, [
              stored.cleanId,
              stored.annotatedId,
            ])
            .catch(() => undefined);
          throw error;
        }
        if (result.duplicate) {
          // An idempotent retry reuses the original job; drop this attempt's
          // redundant frame uploads instead of appending a second review.
          await hostedMedia
            .deleteProjectFiles(userId(request), project.id, [
              stored.cleanId,
              stored.annotatedId,
            ])
            .catch(() => undefined);
        } else {
          await projects.update(project.id, userId(request), (current) => {
            current.reviews.push(review);
          });
        }
        void generationQueue
          .flush()
          .catch((error) =>
            console.error("Outbox flush failed", {
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
        return response.status(202).json({ ...review, jobId: result.jobId });
      } finally {
        await extracted.cleanup();
      }
    }
    const review = await studio.createFrameReview(request.params.id, {
      versionId: String(request.body?.versionId || ""),
      time: Number(request.body?.time || 0),
      note: String(request.body?.note || ""),
      annotatedImageData: String(request.body?.annotatedImageData || ""),
    });
    await persistHostedProject(
      studio.getProject(String(request.params.id), userId(request)),
    );
    response.status(202).json(review);
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not send frame feedback.",
      });
  }
});

app.get("/api/assets/search", async (request, response) => {
  const query =
    typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2)
    return response
      .status(400)
      .json({ error: "Search with at least two characters." });
  try {
    await assertLicensedAssets(request);
    response.json({ results: await studio.searchAssets(query) });
  } catch (error) {
    response
      .status(502)
      .json({
        error: error instanceof Error ? error.message : "Asset search failed.",
      });
  }
});

app.post("/api/projects/:id/assets", async (request, response) => {
  try {
    const project = await ownedProject(request);
    await assertLicensedAssets(request);
    const asset = generations.configured
      ? await hostedMedia.importAsset(
          userId(request),
          project,
          request.body || {},
        )
      : await studio.importAsset(String(request.params.id), request.body);
    if (generations.configured) {
      await projects.update(project.id, userId(request), (current) => {
        current.assets.push(asset);
      });
    }
    response.status(201).json(asset);
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error ? error.message : "Could not import asset.",
      });
  }
});

app.post("/api/projects/:id/cancel", async (request, response) => {
  try {
    await ownedProject(request);
    if (generations.configured) {
      const job = await generations.cancelProject(
        String(request.params.id),
        userId(request),
      );
      await dispatcher.terminate(job?.sandboxId).catch(() => undefined);
    } else {
      await studio.cancel(String(request.params.id));
    }
    response.status(204).end();
  } catch (error) {
    response
      .status(500)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Could not cancel generation.",
      });
  }
});

app.get("/api/artifacts/:artifactId", async (request, response) => {
  const result = await database.query<{
    bucket: string;
    object_name: string;
    generation: string;
  }>(
    `SELECT bucket, object_name, generation::text
       FROM artifacts
      WHERE id = $1 AND owner_id = $2`,
    [String(request.params.artifactId), userId(request)],
  );
  const artifact = result.rows[0];
  if (!artifact)
    return response.status(404).json({ error: "Artifact not found." });
  response.setHeader("Cache-Control", "private, no-store");
  response.redirect(
    303,
    await artifacts.signedReadUrl(
      artifact.bucket,
      artifact.object_name,
      Number(artifact.generation),
    ),
  );
});

app.get("/api/project-files/:fileId", async (request, response) => {
  const file = await hostedMedia.ownedFile(
    String(request.params.fileId),
    userId(request),
  );
  if (!file) return response.status(404).json({ error: "File not found." });
  response.setHeader("Cache-Control", "private, no-store");
  response.redirect(
    303,
    await artifacts.signedReadUrl(
      file.bucket,
      file.object_name,
      Number(file.generation),
    ),
  );
});

app.use("/media/:projectId", (request, response, next) => {
  if (!studio.getProject(String(request.params.projectId), userId(request)))
    return response.status(404).end();
  next();
});

app.use(
  "/media",
  express.static(studio.projectRoot, {
    fallthrough: false,
    immutable: false,
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-cache");
    },
  }),
);

// Any /api path that no route claimed is JSON 404, never the SPA fallback.
app.use("/api", (_request, response) =>
  response.status(404).json({ error: "Not found." }),
);

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(root, "dist", "client");
  app.use(express.static(clientDir));
  app.get("/{*path}", (_request, response) =>
    response.sendFile(path.join(clientDir, "index.html")),
  );
} else {
  // Dynamic import keeps vite out of production installs (npm ci --omit=dev).
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: path.join(root, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const server = app.listen(port, host, () => {
  console.log(`Orune is running at http://${host}:${port}`);
});
attachScopedCodexWebSocketProxy(server, { generations, proxy: scopedCodex });

if (!generations.configured) void studio.initialize();

// In-process background work belongs to the dispatcher role; the api role
// must not run a second reconciler/outbox loop (mirrors the route gating).
const runsBackgroundWork = serviceRole !== "api";

const outboxTimer = runsBackgroundWork && generationQueue.configured
  ? setInterval(
      () => {
        void generationQueue
          .flush()
          .catch((error) =>
            console.error("Outbox flush failed", {
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
      },
      Number(process.env.OUTBOX_POLL_INTERVAL_MS || 5_000),
    )
  : undefined;

const reconciliationTimer = runsBackgroundWork && dispatcher.configured
  ? setInterval(
      () => {
        void dispatcher.reconcile().catch((error) =>
          console.error("Generation reconciliation failed", {
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      },
      Number(process.env.GENERATION_RECONCILE_INTERVAL_MS || 60_000),
    )
  : undefined;

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (outboxTimer) clearInterval(outboxTimer);
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  studio.bridge.stop();
  // Open SSE streams would keep server.close() waiting forever.
  for (const response of sseResponses) response.end();
  sseResponses.clear();
  server.close(() => void database.close().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => {
    console.error("Forced exit: connections did not drain within 10 seconds.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (!generations.configured && !fs.existsSync(manimPath(root))) {
  console.warn("Manim is not installed yet. Run: npm run setup:manim");
}
