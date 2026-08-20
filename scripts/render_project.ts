import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readProjectBundle } from "../server/project-bundle.js";
import { renderRemotionProject } from "../server/renderers/remotion-renderer.js";

const projectDir = path.resolve(process.argv[2] || ".");
const root = path.resolve(import.meta.dirname, "..");
const project = readProjectBundle(projectDir);
const output = path.join(projectDir, "output.mp4");
await renderRemotionProject(root, projectDir, project, output);
let narration: Record<string, unknown> = { status: "not_requested", enabled: false };
if (fs.existsSync(path.join(projectDir, "narration.json"))) {
  const result = execFileSync("node", [path.join(root, "scripts", "generate_narration.mjs"), projectDir], { encoding: "utf8" });
  narration = JSON.parse(result.trim().split("\n").at(-1) || "{}");
}
execFileSync("ffmpeg", ["-y", "-ss", String(Math.min(1, project.format.duration / 4)), "-i", output, "-frames:v", "1", path.join(projectDir, "poster.png")], { stdio: "ignore" });
const interval = Math.max(project.format.duration / 6, 0.25);
execFileSync("ffmpeg", ["-y", "-i", output, "-vf", `fps=1/${interval},scale=480:-2,tile=3x2:padding=8:margin=8:color=white`, "-frames:v", "1", path.join(projectDir, "contact-sheet.png")], { stdio: "ignore" });
const metadata = {
  quality: "timeline",
  duration: project.format.duration,
  width: project.format.width,
  height: project.format.height,
  fps: project.format.fps,
  renderer: "remotion",
  source: "project.json",
  narration,
  renderedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(projectDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
