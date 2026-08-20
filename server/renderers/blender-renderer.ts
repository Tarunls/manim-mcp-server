import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProjectIR, VideoShot } from "../../shared/video-ir.js";
import { normalizeShot } from "./media-normalize.js";

const execFileAsync = promisify(execFile);

export async function renderBlenderShot(root: string, projectDir: string, project: VideoProjectIR, shot: VideoShot, destination: string) {
  const metadata = shot.metadata || {};
  if (!metadata.blenderScene || typeof metadata.blenderScene !== "object") throw new Error(`Shot ${shot.name} has no constrained blenderScene description.`);
  const workDir = path.join(projectDir, ".blender");
  fs.mkdirSync(workDir, { recursive: true });
  const spec = {
    ...(metadata.blenderScene as Record<string, unknown>),
    width: project.format.width,
    height: project.format.height,
    fps: project.format.fps,
    frames: Math.max(1, Math.round(shot.duration * project.format.fps)),
  };
  const specFile = path.join(workDir, `${shot.id}.json`);
  const raw = path.join(workDir, `${shot.id}.raw.mp4`);
  fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
  await execFileAsync("blender", ["--background", "--python", path.join(root, "scripts", "blender_worker.py"), "--", specFile, raw], { timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  await normalizeShot(raw, destination, project.format, shot.duration);
  return destination;
}
