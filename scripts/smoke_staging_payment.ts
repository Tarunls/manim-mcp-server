import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { GoogleAuth } from "google-auth-library";
import type {
  BillingState,
  StudioEvent,
  StudioProject,
} from "../server/types.js";

const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const projectId = process.env.GCP_PROJECT?.trim();
if (!baseUrl?.startsWith("https://"))
  throw new Error("APP_BASE_URL must be the staging HTTPS origin.");
if (!projectId) throw new Error("GCP_PROJECT is required.");

const email = `payment-smoke-${Date.now()}@example.com`;
const password = `Smoke-${randomBytes(18).toString("base64url")}!`;
const cookies = new Map<string, string>();
const googleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
let csrfToken = "";
let identityId = "";
let authenticated = false;
let browser: Browser | undefined;
let project: StudioProject | undefined;

function captureCookies(response: Response) {
  for (const value of response.headers.getSetCookie?.() || []) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0)
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function appRequest<T>(path: string, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookies.size
        ? {
            Cookie: [...cookies]
              .map(([name, value]) => `${name}=${value}`)
              .join("; "),
          }
        : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { Origin: baseUrl!, "X-CSRF-Token": csrfToken }
        : {}),
      ...init.headers,
    },
  });
  captureCookies(response);
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  return (text ? JSON.parse(text) : undefined) as T;
}

async function accessToken() {
  const client = await googleAuth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result.token;
  if (!token)
    throw new Error(
      "Google application-default credentials did not return an access token.",
    );
  return token;
}

async function identityRequest(path: string, body: unknown) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "x-goog-user-project": projectId!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new Error(
      `Identity request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
}

async function fillVisible(page: import("@playwright/test").Page, selector: string, value: string) {
  const field = page.locator(selector).first();
  if ((await field.count()) && (await field.isVisible())) await field.fill(value);
}

async function main() {
  const status = await appRequest<{ csrfToken: string }>("/api/auth/status");
  csrfToken = status.csrfToken;
  const signup = await appRequest<{
    user: { uid: string };
    verificationRequired: boolean;
  }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  identityId = signup.user.uid;
  assert.equal(signup.verificationRequired, true);
  await identityRequest("update", { localId: identityId, emailVerified: true });
  await appRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  authenticated = true;
  console.log("Payment smoke: verified user session established.");

  const checkout = await appRequest<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "creator" }),
  });
  assert.match(checkout.url, /^https:\/\/checkout\.stripe\.com\//);

  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(checkout.url, { waitUntil: "domcontentloaded" });
  const cardButton = page.getByRole("button", { name: /pay with card/i });
  await cardButton.waitFor({ state: "attached", timeout: 60_000 });
  assert.equal(await cardButton.count(), 1);
  await cardButton.dispatchEvent("click");
  await page.locator('input[name="cardNumber"]').waitFor({ timeout: 60_000 });
  await fillVisible(page, 'input[name="email"]', email);
  await page.locator('input[name="cardNumber"]').fill("4242424242424242");
  await page.locator('input[name="cardExpiry"]').fill("1234");
  await page.locator('input[name="cardCvc"]').fill("123");
  await fillVisible(page, 'input[name="billingName"]', "Lesson Studio Smoke");
  await fillVisible(page, 'input[name="billingPostalCode"]', "60601");
  await fillVisible(page, 'input[name="phoneNumber"]', "2015550123");
  await page.getByTestId("hosted-payment-submit-button").click();
  await page.waitForURL(
    (url) =>
      url.origin === new URL(baseUrl!).origin &&
      url.pathname.replace(/\/$/, "") === "/studio" &&
      url.searchParams.get("checkout") === "success",
    { timeout: 90_000, waitUntil: "domcontentloaded" },
  );
  console.log("Payment smoke: Stripe hosted test payment completed.");

  const deadline = Date.now() + 90_000;
  let billing: BillingState | undefined;
  while (Date.now() < deadline) {
    billing = await appRequest<BillingState>("/api/billing");
    if (billing.plan === "creator" && billing.status === "active") break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert.equal(billing?.plan, "creator");
  assert.equal(billing.status, "active");
  assert.equal(billing.creditsRemaining, 10);
  assert.equal(billing.entitlements.narration, true);
  assert.equal(billing.hasStripeCustomer, true);

  const portal = await appRequest<{ url: string }>("/api/billing/portal", {
    method: "POST",
    body: "{}",
  });
  assert.match(portal.url, /^https:\/\/billing\.stripe\.com\//);

  project = await appRequest<StudioProject>("/api/projects", {
    method: "POST",
    body: "{}",
  });
  assert.equal(project.narrationPreferences.enabled, true);
  const accepted = await appRequest<{ jobId: string }>(
    `/api/projects/${project.id}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `payment-smoke:${randomUUID()}` },
      body: JSON.stringify({
        text: "Create a concise four-second narrated explanation that three plus three equals six.",
        renderer: "composite",
        intent: "auto",
        effort: "quick",
      }),
    },
  );
  assert.match(accepted.jobId, /^[0-9a-f-]{36}$/i);
  console.log(`Payment smoke: narrated generation accepted (${accepted.jobId}).`);

  const generationDeadline =
    Date.now() + Number(process.env.STAGING_SMOKE_TIMEOUT_MS || 20 * 60_000);
  while (Date.now() < generationDeadline) {
    const event = await appRequest<StudioEvent>("/api/state");
    if (event.type !== "snapshot")
      throw new Error("Staging state did not return a snapshot.");
    project = event.projects.find((candidate) => candidate.id === project!.id);
    if (!project) throw new Error("Payment smoke project disappeared.");
    if (project.status === "error" || project.status === "cancelled")
      throw new Error(
        project.error || `Narrated generation ended as ${project.status}.`,
      );
    if (project.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  assert.equal(project?.status, "complete");
  assert.ok(project.videoUrl);
  const latest = project.versions.at(-1);
  assert.equal(latest?.render?.narration?.enabled, true);
  assert.equal(latest?.render?.narration?.status, "ready");
  assert.equal(latest?.render?.narration?.provider, "speechify");
  assert.equal(latest?.render?.narration?.model, "simba-3.2");

  const video = await fetch(`${baseUrl}${project.videoUrl}`, {
    headers: {
      Cookie: [...cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });
  assert.equal(video.ok, true);
  const reader = video.body?.getReader();
  const first = await reader?.read();
  await reader?.cancel();
  assert.equal(
    Buffer.from(first?.value || []).subarray(4, 8).toString("ascii"),
    "ftyp",
  );
  const billedAfterGeneration = await appRequest<BillingState>("/api/billing");
  assert.equal(billedAfterGeneration.creditsRemaining, 9);
  console.log(
    "Payment smoke passed: hosted Checkout, signed webhook provisioning, Customer Portal, and paid narrated generation.",
  );
}

try {
  await main();
} finally {
  await browser?.close().catch(() => undefined);
  if (authenticated) {
    if (project?.status === "running")
      await appRequest(`/api/projects/${project.id}/cancel`, {
        method: "POST",
        body: "{}",
      }).catch(() => undefined);
    await appRequest("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
  }
  if (identityId) {
    await identityRequest("update", { localId: identityId, disableUser: true }).catch(
      () => undefined,
    );
    await identityRequest("batchDelete", { localIds: [identityId] }).catch(
      () => undefined,
    );
  }
}
