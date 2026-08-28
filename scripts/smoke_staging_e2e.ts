import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type { StudioEvent, StudioProject } from "../server/types.js";

const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const projectId = process.env.GCP_PROJECT?.trim();
if (!baseUrl?.startsWith("https://")) throw new Error("APP_BASE_URL must be the staging HTTPS origin.");
if (!projectId) throw new Error("GCP_PROJECT is required.");

const email = `release-smoke-${Date.now()}@example.com`;
const password = `Smoke-${randomBytes(18).toString("base64url")}!`;
const cookies = new Map<string, string>();
let csrfToken = "";
let identityId = "";
let project: StudioProject | undefined;
let authenticated = false;
const googleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

function captureCookies(response: Response) {
  const values = response.headers.getSetCookie?.() || [];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function appRequest<T>(path: string, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { Origin: baseUrl!, "X-CSRF-Token": csrfToken } : {}),
      ...init.headers,
    },
  });
  captureCookies(response);
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function accessToken() {
  const client = await googleAuth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result.token;
  if (!token) throw new Error("Google application-default credentials did not return an access token.");
  return token;
}

async function identityRequest(path: string, body: unknown) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "x-goog-user-project": projectId!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Identity cleanup failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function forceDeleteIdentity() {
  if (!identityId) return;
  await identityRequest("update", { localId: identityId, disableUser: true }).catch(() => undefined);
  await identityRequest("batchDelete", { localIds: [identityId] }).catch(() => undefined);
}

async function main() {
  const status = await appRequest<{ csrfToken: string }>("/api/auth/status");
  csrfToken = status.csrfToken;
  const signup = await appRequest<{ user: { uid: string }; verificationRequired: boolean }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  identityId = signup.user.uid;
  assert.equal(signup.verificationRequired, true);
  await identityRequest("update", { localId: identityId, emailVerified: true });
  await appRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  authenticated = true;

  const checkout = await appRequest<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "creator" }),
  });
  assert.match(checkout.url, /^https:\/\/checkout\.stripe\.com\//);

  project = await appRequest<StudioProject>("/api/projects", { method: "POST", body: "{}" });
  const accepted = await appRequest<{ jobId: string }>(`/api/projects/${project.id}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `release-smoke:${randomUUID()}` },
    body: JSON.stringify({
      text: "Create a concise four-second visual explanation that two plus two equals four.",
      renderer: "composite",
      intent: "auto",
      effort: "quick",
    }),
  });
  assert.match(accepted.jobId, /^[0-9a-f-]{36}$/i);

  const deadline = Date.now() + Number(process.env.STAGING_SMOKE_TIMEOUT_MS || 20 * 60_000);
  while (Date.now() < deadline) {
    const event = await appRequest<StudioEvent>("/api/state");
    if (event.type !== "snapshot") throw new Error("Staging state did not return a snapshot.");
    project = event.projects.find((candidate) => candidate.id === project!.id);
    if (!project) throw new Error("Smoke project disappeared.");
    if (project.status === "error" || project.status === "cancelled")
      throw new Error(project.error || `Generation ended as ${project.status}.`);
    if (project.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (project?.status !== "complete" || !project.videoUrl) throw new Error("Generation did not complete before the smoke timeout.");

  const video = await fetch(`${baseUrl}${project.videoUrl}`, {
    headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
  });
  assert.equal(video.ok, true);
  const reader = video.body?.getReader();
  const first = await reader?.read();
  await reader?.cancel();
  assert.equal(Buffer.from(first?.value || []).subarray(4, 8).toString("ascii"), "ftyp");
  console.log(`Staging smoke passed: auth, Stripe checkout, E2B generation, and private MP4 (${accepted.jobId}).`);
}

try {
  await main();
} finally {
  if (authenticated) {
    if (project?.status === "running")
      await appRequest(`/api/projects/${project.id}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    await appRequest("/api/account", { method: "DELETE", body: JSON.stringify({ email }) }).catch(() => undefined);
  }
  await forceDeleteIdentity();
}
