import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProjectIR, VideoShot } from "../../shared/video-ir.js";
import { renderRemotionProject } from "./remotion-renderer.js";
import { renderBlenderShot } from "./blender-renderer.js";
import { renderGeneratedShot } from "../generation/generated-renderer.js";
import { renderManimShot } from "./manim-renderer.js";
import { normalizeShot } from "./media-normalize.js";

const execFileAsync = promisify(execFile);

function shotDigest(project: VideoProjectIR, shot: VideoShot) {
  const assetIds = new Set(shot.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean)));
  const assets = project.assets.filter((asset) => assetIds.has(asset.id)).map((asset) => ({ id: asset.id, hash: asset.hash, sourceUrl: asset.sourceUrl }));
  const { cacheKey: _cacheKey, status: _status, thumbnailUrl: _thumbnailUrl, ...stableShot } = shot;
  return createHash("sha256").update(JSON.stringify({ pipeline: 2, schema: project.schemaVersion, format: project.format, design: project.design, shot: stableShot, assets })).digest("hex");
}

export class RenderCache {
  constructor(private root: string) { fs.mkdirSync(root, { recursive: true }); }
  key(project: VideoProjectIR, shot: VideoShot) { return shotDigest(project, shot); }
  file(key: string) { return path.join(this.root, key.slice(0, 2), key, "shot.mp4"); }
  has(key: string) { return fs.existsSync(this.file(key)); }
  prepare(key: string) { const file = this.file(key); fs.mkdirSync(path.dirname(file), { recursive: true }); return file; }
}

export interface IncrementalRenderResult {
  output: string;
  proxy: string;
  hits: number;
  misses: number;
  shotKeys: Record<string, string>;
}

export async function createProxy(output: string, proxy: string) {
  await execFileAsync("ffmpeg", ["-y", "-i", output, "-vf", "scale='min(960,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", proxy]);
  return proxy;
}

export async function renderIncrementally(
  root: string,
  projectDir: string,
  project: VideoProjectIR,
  cache: RenderCache,
  onProgress?: (progress: number, stage: string, checkpoint: Record<string, unknown>) => void,
): Promise<IncrementalRenderResult> {
  if (!project.shots.length) throw new Error("Add at least one shot before rendering.");
  const files: string[] = [];
  const shotKeys: Record<string, string> = {};
  let hits = 0;
  let misses = 0;
  for (let index = 0; index < project.shots.length; index += 1) {
    const shot = project.shots[index];
    const key = cache.key(project, shot);
    shotKeys[shot.id] = key;
    const cached = cache.file(key);
    if (cache.has(key)) hits += 1;
    else {
      misses += 1;
      const partial = structuredClone(project);
      partial.format.duration = shot.duration;
      partial.shots = [{ ...structuredClone(shot), start: 0 }];
      partial.narration = [];
      const target = cache.prepare(key);
      if (shot.renderer === "manim") await renderManimShot(root, projectDir, partial, partial.shots[0], target);
      else if (shot.renderer === "blender") await renderBlenderShot(root, projectDir, partial, partial.shots[0], target);
      else if (shot.renderer === "generated") await renderGeneratedShot(projectDir, partial, partial.shots[0], target, undefined, (providerProgress, detail) => onProgress?.((index + providerProgress / 100) / (project.shots.length + 1), `Generating ${shot.name}`, { ...detail, shotId: shot.id, shotKeys }));
      else {
        const raw = `${target}.raw.mp4`;
        await renderRemotionProject(root, projectDir, partial, raw);
        await normalizeShot(raw, target, partial.format, shot.duration);
        fs.unlinkSync(raw);
      }
    }
    files.push(cached);
    onProgress?.((index + 1) / (project.shots.length + 1), `Rendered ${index + 1} of ${project.shots.length} shots`, { completedShotIds: project.shots.slice(0, index + 1).map((item) => item.id), shotKeys });
  }
  const output = path.join(projectDir, "output.mp4");
  if (files.length === 1) fs.copyFileSync(files[0], output);
  else {
    const concatFile = path.join(projectDir, ".render-concat.txt");
    fs.writeFileSync(concatFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"));
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", output]);
  }
  const proxy = path.join(projectDir, "proxy.mp4");
  await createProxy(output, proxy);
  onProgress?.(1, "Finalized preview proxy", { completedShotIds: project.shots.map((shot) => shot.id), shotKeys });
  return { output, proxy, hits, misses, shotKeys };
}
