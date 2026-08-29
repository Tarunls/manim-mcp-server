import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The freshness gate that actually blocks a render lives in the Manim render
// helper, so it is exercised through Python rather than re-implemented here.
const renderScene = fileURLToPath(new URL("../scripts/render_scene.py", import.meta.url));
const python = ["python3", "python"].find(
  (candidate) => spawnSync(candidate, ["-c", "pass"]).status === 0,
);
const skip = python ? false : "python is unavailable";

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function checkFreshness(projectDir) {
  const result = spawnSync(python, ["-c", `
import runpy, sys
from pathlib import Path
module = runpy.run_path(${JSON.stringify(renderScene)})
project = Path(sys.argv[1])
module["validate_generation_request"](project, project / "scene.py")
`, projectDir], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr || "" };
}

function seedProject(context, request, plan) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-studio-freshness-"));
  context.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  write(path.join(projectDir, "generation-request.json"), JSON.stringify(request));
  write(path.join(projectDir, "beat-plan.md"), plan);
  write(path.join(projectDir, "scene.py"), `# scene\n${"x = 1\n".repeat(120)}`);
  return projectDir;
}

test("a first draft whose plan ignores the requested topic cannot render", { skip }, (context) => {
  const projectDir = seedProject(context, {
    mode: "first-draft",
    renderer: "manim",
    prompt: "Create a video explaining integrals",
    startedAt: new Date(Date.now() - 5_000).toISOString(),
  }, `# Beat plan\n${"Rotate a phasor and rebuild the waveform from its components.\n".repeat(5)}`);

  const { status, stderr } = checkFreshness(projectDir);
  assert.notEqual(status, 0);
  assert.match(stderr, /does not appear to address the requested topic/);
});

test("a fresh topic plan and fresh Manim source pass", { skip }, (context) => {
  const projectDir = seedProject(context, {
    mode: "first-draft",
    renderer: "manim",
    prompt: "Create a video explaining integrals and volume",
    startedAt: new Date(Date.now() - 5_000).toISOString(),
  }, `# Integral beat plan\n${"Use narrowing slices to connect integral accumulation, exact area, and disk volume.\n".repeat(5)}`);

  const { status, stderr } = checkFreshness(projectDir);
  assert.equal(status, 0, stderr);
});

test("a stale beat plan cannot render as a new first draft", { skip }, (context) => {
  const projectDir = seedProject(context, {
    mode: "first-draft",
    renderer: "manim",
    prompt: "Create a video explaining integrals and volume",
    startedAt: new Date(Date.now() + 60_000).toISOString(),
  }, `# Integral beat plan\n${"Use narrowing slices to connect integral accumulation, exact area, and disk volume.\n".repeat(5)}`);

  const { status, stderr } = checkFreshness(projectDir);
  assert.notEqual(status, 0);
  assert.match(stderr, /beat-plan\.md predates this request/);
});
