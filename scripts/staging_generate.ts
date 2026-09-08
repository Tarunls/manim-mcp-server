/**
 * Generate one lesson on staging through the public API with a disposable
 * account, then download what came back so it can be watched.
 *
 *   APP_BASE_URL=https://useorune.com GCP_PROJECT=educationalvideo-506219 \
 *   node --import tsx scripts/staging_generate.ts --brief "..." [--format vertical] [--effort quick] [--out dir] [--keep]
 *
 * The account is a free-plan signup (one credit, silent, Faster), so this
 * exercises the hosted path end to end without touching anyone's real account.
 * Without --keep the account and its data are deleted afterwards.
 */

import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import type { StudioEvent, StudioProject } from "../server/types.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const projectId = process.env.GCP_PROJECT?.trim();
if (!baseUrl?.startsWith("https://")) throw new Error("APP_BASE_URL must be the staging HTTPS origin.");
if (!projectId) throw new Error("GCP_PROJECT is required.");
const brief = option("--brief") || "Explain why the angles of a triangle add up to a straight line, by tearing the corners off and lining them up.";
const format = option("--format") === "vertical" ? "vertical" : "landscape";
const effort = option("--effort") || "quick";
const outDir = option("--out") || path.join("studio", "eval", "staging", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
const keep = args.includes("--keep");

const email = `staging-generate-${Date.now()}@example.com`;
const password = `Gen-${randomBytes(18).toString("base64url")}!`;
const cookies = new Map<string, string>();
let csrfToken = "";
let identityId = "";
let authenticated = false;
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

function captureCookies(response: Response) {
  for (const value of response.headers.getSetCookie?.() || []) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function appRequest<T>(route: string, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookies.size ? { Cookie: cookieHeader() } : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { Origin: baseUrl!, "X-CSRF-Token": csrfToken } : {}),
      ...init.headers,
    },
  });
  captureCookies(response);
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function identityRequest(route: string, body: unknown) {
  const client = await googleAuth.getClient();
  const token = await client.getAccessToken();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${typeof token === "string" ? token : token.token}`,
      "x-goog-user-project": projectId!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Identity request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function download(route: string, target: string) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookieHeader() } });
  if (!response.ok) throw new Error(`Download ${route} failed with HTTP ${response.status}.`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const status = await appRequest<{ csrfToken: string }>("/api/auth/status");
  csrfToken = status.csrfToken;
  const signup = await appRequest<{ user: { uid: string } }>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
  identityId = signup.user.uid;
  await identityRequest("update", { localId: identityId, emailVerified: true });
  await appRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  authenticated = true;
  console.log(`Signed in as ${email}.`);

  let project = await appRequest<StudioProject>("/api/projects", { method: "POST", body: "{}" });
  await appRequest(`/api/projects/${project.id}/generation-preferences`, { method: "PATCH", body: JSON.stringify({ effort, format }) }).catch((error) => {
    console.log(`Could not set format (${error instanceof Error ? error.message : error}); continuing with the default.`);
  });
  const started = Date.now();
  const accepted = await appRequest<{ jobId: string }>(`/api/projects/${project.id}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `staging-generate:${randomUUID()}` },
    body: JSON.stringify({ text: brief, renderer: "manim", intent: "auto", effort }),
  });
  console.log(`Job ${accepted.jobId} accepted.`);
  const deadline = Date.now() + Number(process.env.STAGING_GENERATE_TIMEOUT_MS || 25 * 60_000);
  let last = "";
  const timeline: Array<{ seconds: number; stage: string; label?: string }> = [];
  while (Date.now() < deadline) {
    const event = await appRequest<StudioEvent>("/api/state");
    if (event.type !== "snapshot") throw new Error("State did not return a snapshot.");
    project = event.projects.find((candidate) => candidate.id === project.id)!;
    const label = project.actions.at(-1)?.label;
    const progress = `${project.status}:${project.stage}:${label || ""}`;
    if (progress !== last) {
      const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
      timeline.push({ seconds, stage: `${project.status}:${project.stage}`, label });
      console.log(`${String(seconds).padStart(7)}s  ${project.status}/${project.stage}  ${label || ""}`);
      last = progress;
    }
    if (project.status === "error" || project.status === "cancelled") throw new Error(project.error || `Generation ended as ${project.status}.`);
    if (project.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (project.status !== "complete" || !project.videoUrl) throw new Error("Generation did not complete in time.");
  const totalSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
  await download(project.videoUrl, path.join(outDir, "output.mp4"));
  if (project.posterUrl) await download(project.posterUrl, path.join(outDir, "poster.png"));
  fs.writeFileSync(path.join(outDir, "project.json"), JSON.stringify({ jobId: accepted.jobId, totalSeconds, timeline, project }, null, 2));
  console.log(`Complete in ${totalSeconds}s. Video: ${path.join(outDir, "output.mp4")} (job ${accepted.jobId})`);
}

try {
  await main();
} finally {
  if (authenticated && !keep) {
    await appRequest("/api/account", { method: "DELETE", body: JSON.stringify({ email }) }).catch(() => undefined);
  }
  if (identityId && !keep) {
    await identityRequest("update", { localId: identityId, disableUser: true }).catch(() => undefined);
    await identityRequest("batchDelete", { localIds: [identityId] }).catch(() => undefined);
  }
}
