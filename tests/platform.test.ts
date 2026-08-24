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
