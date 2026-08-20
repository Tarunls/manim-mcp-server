import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { VideoShot } from "../shared/video-ir.js";
import { resolveManimScene } from "./renderers/manim-renderer.js";

function shot(metadata: Record<string, unknown>): VideoShot {
  return { id: "shot", name: "Technical", intent: "Explain", start: 0, duration: 2, renderer: "manim", status: "ready", metadata, tracks: [] };
}

test("Manim renderer resolves only project-local scene sources", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-manim-"));
  fs.writeFileSync(path.join(projectDir, "equation.py"), "class Equation: pass\n");
  const resolved = resolveManimScene(projectDir, shot({ sceneFile: "equation.py", sceneClass: "Equation" }));
  assert.equal(resolved.source, path.join(projectDir, "equation.py"));
  assert.equal(resolved.sceneClass, "Equation");
  assert.throws(() => resolveManimScene(projectDir, shot({ sceneFile: "../outside.py" })), /inside the project/);
  assert.throws(() => resolveManimScene(projectDir, shot({ sceneFile: "equation.py", sceneClass: "Bad;Class" })), /Invalid/);
});
