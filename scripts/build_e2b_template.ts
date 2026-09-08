import path from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "e2b";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.env.E2B_TEMPLATE?.trim() || "lesson-studio-renderer";
const version = process.env.E2B_TEMPLATE_VERSION?.trim() || "dev";
const buildTimeoutMs = Number(process.env.E2B_TEMPLATE_BUILD_TIMEOUT_MS || 20 * 60_000);
const pollIntervalMs = Number(process.env.E2B_TEMPLATE_BUILD_POLL_INTERVAL_MS || 2_000);

if (!Number.isFinite(buildTimeoutMs) || buildTimeoutMs <= 0)
  throw new Error("E2B_TEMPLATE_BUILD_TIMEOUT_MS must be a positive number.");
if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0)
  throw new Error("E2B_TEMPLATE_BUILD_POLL_INTERVAL_MS must be a positive number.");

// This script runs from the already-built application image in Cloud Run. That
// filesystem contains nearly a gigabyte of node_modules plus the Manim venv.
// Bare names in .dockerignore prevent those files from entering the archive,
// but glob still traverses them while E2B computes COPY hashes. Recursive
// patterns keep the SDK from walking runtime-only dependency trees at all.
const template = Template({
  fileContextPath: root,
  fileIgnorePatterns: [
    ".git/**",
    ".venv/**",
    "dist/**",
    "infra/terraform/.terraform/**",
    "node_modules/**",
    "playwright-report/**",
    "studio/cache/**",
    "studio/projects/**",
    "test-results/**",
  ],
}).fromDockerfile(path.join(root, "e2b", "Dockerfile"));

const build = await Template.buildInBackground(template, `${name}:${version}`, {
  // Manim rasterizes every frame and ffmpeg encodes them; both are compute
  // bound, and sandbox CPU is a rounding error next to the LLM cost per job.
  cpuCount: 4,
  memoryMB: 4096,
  onBuildLogs: (entry) => process.stdout.write(`${entry}\n`),
  requestTimeoutMs: 60_000,
  signal: AbortSignal.timeout(Math.min(buildTimeoutMs, 2 * 60_000)),
});

console.log(`E2B build accepted: ${name}:${version} (${build.buildId}).`);

const deadline = Date.now() + buildTimeoutMs;
let logsOffset = 0;
let lastHeartbeat = 0;

while (Date.now() < deadline) {
  const status = await Template.getBuildStatus(build, {
    logsOffset,
    requestTimeoutMs: 30_000,
  });
  logsOffset += status.logEntries.length;
  for (const entry of status.logEntries) process.stdout.write(`${entry}\n`);

  if (status.status === "ready") {
    console.log(`Built E2B template ${name}:${version} (${build.buildId}).`);
    process.exit(0);
  }
  if (status.status === "error") {
    const step = status.reason?.step ? ` at ${status.reason.step}` : "";
    const message = status.reason?.message || "E2B returned an unspecified build error.";
    throw new Error(`E2B template build failed${step}: ${message}`);
  }

  if (Date.now() - lastHeartbeat >= 30_000) {
    console.log(`E2B build ${build.buildId} is ${status.status}; ${Math.ceil((deadline - Date.now()) / 1000)}s remain.`);
    lastHeartbeat = Date.now();
  }
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}

throw new Error(`E2B template build ${build.buildId} exceeded ${buildTimeoutMs}ms.`);
