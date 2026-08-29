import assert from "node:assert/strict";
import { Sandbox } from "e2b";

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
    const result = await sandbox.commands.run(
      "set -eu; node --version; test -x /opt/lesson-studio/app/.venv/bin/python; /opt/lesson-studio/app/.venv/bin/python -m manim --version >/dev/null; /opt/lesson-studio/app/.venv/bin/python -c 'import manim'; cd /opt/lesson-studio/app && node -e \"import('@openai/codex-sdk')\"; ffmpeg -version >/dev/null; test -x e2b/bootstrap.mjs; test -f studio/AGENTS.md; if curl -fsS --max-time 5 https://example.com >/dev/null 2>&1; then exit 42; fi",
      { cwd: "/workspace", timeoutMs: 60_000 },
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^v22\./m);
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
