import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { writeProjectBundle } from "../server/project-bundle.js";
import { RenderCache, createProxy, renderIncrementally } from "../server/renderers/incremental-renderer.js";
import { createQualityReport } from "../server/quality/project-quality.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "manim-studio-quality-"));
const project = createEmptyVideoIR("quality-smoke", "Quality smoke test", "Explain a clean quality gate");
project.format = { width: 1280, height: 720, fps: 24, duration: 1, colorSpace: "rec709", background: "#f7f7f5" };
project.design.safeArea = 48;
project.storyboard.push({ id: "beat-1", title: "Quality", purpose: "Show a readable title", narration: "", visual: "Centered title", renderer: "remotion", duration: 1, assetQueries: [] });
project.shots.push({
  id: "shot-1",
  name: "Quality",
  intent: "Show a readable title",
  start: 0,
  duration: 1,
  renderer: "remotion",
  status: "ready",
  tracks: [{
    id: "track-1",
    name: "Title",
    kind: "overlay",
    muted: false,
    locked: false,
    clips: [{
      id: "clip-1",
      name: "Quality checked",
      kind: "text",
      renderer: "remotion",
      start: 0,
      duration: 1,
      text: "Quality checked",
      transform: { x: 0, y: 0, width: 720, height: 160, rotation: 0, opacity: 1, scale: 1 },
      animations: [],
      style: { fontSize: 72, fontWeight: 700, color: "#1d1d1b" },
      metadata: {},
    }],
  }],
});
writeProjectBundle(projectDir, project);
await renderIncrementally(root, projectDir, project, new RenderCache(path.join(projectDir, "cache")));
await createProxy(path.join(projectDir, "output.mp4"), path.join(projectDir, "proxy.mp4"));
await execFileAsync("ffmpeg", ["-y", "-i", path.join(projectDir, "output.mp4"), "-frames:v", "1", path.join(projectDir, "poster.png")]);
await execFileAsync("ffmpeg", ["-y", "-i", path.join(projectDir, "output.mp4"), "-vf", "fps=1,scale=480:-2,tile=3x2:padding=8:margin=8:color=white", "-frames:v", "1", path.join(projectDir, "contact-sheet.png")]);
const report = await createQualityReport(projectDir, project);
assert.equal(report.passed, true, JSON.stringify(report.checks));
assert.equal(report.media?.width, 1280);
assert.ok(fs.existsSync(path.join(projectDir, "provenance.json")));
console.log(JSON.stringify({ passed: report.passed, score: report.score, media: report.media }));
