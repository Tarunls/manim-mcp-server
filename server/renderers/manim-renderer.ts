import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProjectIR, VideoShot } from "../../shared/video-ir.js";
import { normalizeShot } from "./media-normalize.js";

const execFileAsync = promisify(execFile);

export function resolveManimScene(projectDir: string, shot: VideoShot) {
  const metadata = shot.metadata || {};
  const relative = typeof metadata.sceneFile === "string" ? metadata.sceneFile : "scene.py";
  const sceneClass = typeof metadata.sceneClass === "string" ? metadata.sceneClass : "GeneratedScene";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sceneClass)) throw new Error("Invalid Manim scene class.");
  const projectRoot = path.resolve(projectDir);
  const source = path.resolve(projectRoot, relative);
  if (source !== projectRoot && !source.startsWith(projectRoot + path.sep)) throw new Error("Manim source must stay inside the project directory.");
  if (!fs.existsSync(source) || path.extname(source) !== ".py") throw new Error(`Manim source ${relative} does not exist.`);
  return { source, sceneClass };
}

export async function renderManimShot(root: string, projectDir: string, project: VideoProjectIR, shot: VideoShot, destination: string) {
  const manim = path.join(root, ".venv", "bin", "manim");
  if (!fs.existsSync(manim)) throw new Error("Manim is not installed. Run npm run setup:manim first.");
  const { source, sceneClass } = resolveManimScene(projectDir, shot);
  const mediaDir = path.join(projectDir, ".manim", shot.id);
  fs.mkdirSync(mediaDir, { recursive: true });
  await execFileAsync(manim, [
    "-r", `${project.format.width},${project.format.height}`,
    "--fps", String(project.format.fps),
    "--disable_caching",
    "--media_dir", mediaDir,
    source,
    sceneClass,
  ], {
    cwd: projectDir,
    env: { ...process.env, PYTHONPATH: `${path.join(root, "studio")}${path.delimiter}${process.env.PYTHONPATH || ""}` },
    timeout: 15 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const rendered = (fs.readdirSync(mediaDir, { recursive: true }) as string[])
    .map((name) => path.join(mediaDir, name))
    .filter((name) => path.basename(name) === `${sceneClass}.mp4`)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!rendered) throw new Error(`Manim completed without ${sceneClass}.mp4.`);
  await normalizeShot(rendered, destination, project.format, shot.duration);
  return destination;
}
