import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { renderRemotionProject } from "../server/renderers/remotion-renderer.js";

const root = path.resolve(import.meta.dirname, "..");
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "manim-studio-remotion-"));
const project = createEmptyVideoIR("smoke", "Renderer smoke test");
project.format.width = 640;
project.format.height = 360;
project.format.fps = 24;
project.format.duration = 1;
project.shots.push({
  id: "shot-1",
  name: "Opening",
  intent: "Show a title",
  start: 0,
  duration: 1,
  renderer: "remotion",
  status: "ready",
  tracks: [{
    id: "track-1",
    name: "Titles",
    kind: "overlay",
    muted: false,
    locked: false,
    clips: [{
      id: "clip-1",
      name: "Studio ready",
      kind: "text",
      renderer: "remotion",
      start: 0,
      duration: 1,
      text: "Studio ready",
      transform: { x: 0, y: 0, width: 520, height: 120, rotation: 0, opacity: 1, scale: 1 },
      animations: [],
      style: { fontSize: 52 },
      metadata: {},
    }],
  }],
});
const output = path.join(projectDir, "output.mp4");
await renderRemotionProject(root, projectDir, project, output);
if (!fs.existsSync(output) || fs.statSync(output).size < 1_000) throw new Error("Remotion smoke render did not produce a playable file.");
console.log(output);
