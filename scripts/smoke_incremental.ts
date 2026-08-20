import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmptyVideoIR, type VideoShot } from "../shared/video-ir.js";
import { RenderCache, renderIncrementally } from "../server/renderers/incremental-renderer.js";

const root = path.resolve(import.meta.dirname, "..");
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-incremental-project-"));
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-incremental-cache-"));
const project = createEmptyVideoIR("smoke", "Incremental smoke test");
project.format.width = 640;
project.format.height = 360;
project.format.fps = 24;
project.format.duration = 1;
project.shots = ["First shot", "Second shot"].map((text, index): VideoShot => ({
  id: `shot-${index + 1}`,
  name: text,
  intent: "Show a title",
  start: index * 0.5,
  duration: 0.5,
  renderer: "remotion",
  status: "ready",
  tracks: [{
    id: `track-${index + 1}`,
    name: "Titles",
    kind: "overlay",
    muted: false,
    locked: false,
    clips: [{
      id: `clip-${index + 1}`,
      name: text,
      kind: "text",
      renderer: "remotion",
      start: 0,
      duration: 0.5,
      text,
      transform: { x: 0, y: 0, width: 560, height: 140, rotation: 0, opacity: 1, scale: 1 },
      animations: [],
      style: { fontSize: 48 },
      metadata: {},
    }],
  }],
}));
const cache = new RenderCache(cacheDir);
const first = await renderIncrementally(root, projectDir, project, cache);
const second = await renderIncrementally(root, projectDir, project, cache);
if (first.misses !== 2 || second.hits !== 2 || !fs.existsSync(second.proxy)) throw new Error("Incremental render cache smoke test failed.");
console.log(JSON.stringify({ first, second }));
