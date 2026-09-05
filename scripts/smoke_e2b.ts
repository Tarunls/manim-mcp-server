import assert from "node:assert/strict";
import { Sandbox } from "e2b";

const checks = [
  ["Node runtime", "node --version"],
  [
    "Manim runtime",
    "test -x /opt/lesson-studio/app/.venv/bin/python && /opt/lesson-studio/app/.venv/bin/python -m manim --version && /opt/lesson-studio/app/.venv/bin/python -c 'import manim'",
  ],
  [
    "Orune fonts",
    "fc-list : family | grep -q 'Orune Serif' && fc-list : family | grep -q 'Orune Serif Text'",
  ],
  [
    "renderer dependencies",
    "cd /opt/lesson-studio/app && node -e \"import('./scripts/lesson_pipeline.mjs')\" && ffmpeg -version >/dev/null && test -x e2b/bootstrap.mjs && test -f scripts/manim_runner.py && test -f scripts/render_scene.py",
  ],
  [
    "blocked internet egress",
    "if node -e \"fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0)).catch(() => process.exit(1))\"; then echo 'unexpected internet access' >&2; exit 42; fi",
  ],
] as const;

async function main(): Promise<void> {
  const apiKey = process.env.E2B_API_KEY?.trim();
  const name = process.env.E2B_TEMPLATE?.trim() || "lesson-studio-renderer";
  const version = process.env.E2B_TEMPLATE_VERSION?.trim();
  if (!apiKey)
    throw new Error("E2B_API_KEY is required for the E2B smoke test.");
  if (!version || version === "dev")
    throw new Error("Set E2B_TEMPLATE_VERSION to an immutable built version.");

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create(`${name}:${version}`, {
      apiKey,
      timeoutMs: 5 * 60_000,
      allowInternetAccess: false,
      metadata: { app: "lesson-studio", purpose: "release-smoke" },
    });
    await sandbox.files.write("/workspace/smoke.txt", "isolated");
    assert.equal(await sandbox.files.read("/workspace/smoke.txt"), "isolated");
    for (const [label, command] of checks) {
      console.log(`E2B smoke check started: ${label}.`);
      const result = await sandbox.commands.run(`set -eu; ${command}`, {
        cwd: "/workspace",
        timeoutMs: 2 * 60_000,
      });
      assert.equal(result.exitCode, 0, `${label} failed: ${result.stderr.slice(0, 500)}`);
      if (label === "Node runtime") assert.match(result.stdout, /^v22\./m);
      console.log(`E2B smoke check passed: ${label}.`);
    }
    console.log(`E2B smoke passed for ${name}:${version}.`);
  } finally {
    await sandbox?.kill().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.split("\n", 1)[0]
      : "Unknown provider error";
  console.error(`E2B smoke failed: ${message.slice(0, 500)}`);
  process.exitCode = 1;
});
