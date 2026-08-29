import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { venvBin } from "../server/platform.js";

test("runtime prefers the local hidden virtualenv and supports the visible E2B environment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-studio-platform-"));
  try {
    fs.mkdirSync(path.join(root, "venv"));
    assert.match(venvBin(root, "manim"), /[/\\]venv[/\\]/);
    fs.mkdirSync(path.join(root, ".venv"));
    assert.match(venvBin(root, "manim"), /[/\\]\.venv[/\\]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the sandbox renderer invokes Manim through the virtualenv interpreter", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "render_scene.py"), "utf8");
  assert.match(source, /str\(python\)[\s\S]{0,100}"-m",[\s\S]{0,40}"manim"/);
  assert.doesNotMatch(source, /str\(manim\)/);
});
