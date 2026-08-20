import fs from "node:fs";
import path from "node:path";
import type { VideoProjectIR, VideoShot } from "../../shared/video-ir.js";
import { normalizeShot } from "../renderers/media-normalize.js";
import { GeneratedVideoRegistry, type GeneratedVideoJob, type GeneratedVideoProviderId } from "./video-providers.js";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function renderGeneratedShot(
  projectDir: string,
  project: VideoProjectIR,
  shot: VideoShot,
  destination: string,
  registry = new GeneratedVideoRegistry(),
  onProgress?: (progress: number, detail: Record<string, unknown>) => void,
) {
  const stateDir = path.join(projectDir, ".generations");
  const stateFile = path.join(stateDir, `${shot.id}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  let job: GeneratedVideoJob | undefined;
  if (fs.existsSync(stateFile)) job = JSON.parse(fs.readFileSync(stateFile, "utf8")) as GeneratedVideoJob;
  const metadata = shot.metadata || {};
  const requestedProvider = typeof metadata.provider === "string" ? metadata.provider as GeneratedVideoProviderId : undefined;
  const provider = registry.get(job?.provider || requestedProvider);
  if (!job || job.status === "failed") {
    job = await provider.submit({
      prompt: typeof metadata.generationPrompt === "string" ? metadata.generationPrompt : shot.intent,
      width: project.format.width,
      height: project.format.height,
      seconds: shot.duration,
      referenceImageUrl: typeof metadata.referenceImageUrl === "string" ? metadata.referenceImageUrl : undefined,
      model: typeof metadata.model === "string" ? metadata.model : undefined,
    });
    fs.writeFileSync(stateFile, `${JSON.stringify(job, null, 2)}\n`);
  }
  const started = Date.now();
  while (["queued", "running"].includes(job.status)) {
    if (Date.now() - started > 30 * 60_000) throw new Error(`Generated-video job ${job.id} timed out.`);
    onProgress?.(job.progress, { provider: provider.id, externalJobId: job.id });
    await delay(10_000);
    job = await provider.inspect(job);
    fs.writeFileSync(stateFile, `${JSON.stringify(job, null, 2)}\n`);
  }
  if (job.status !== "complete") throw new Error(job.error || `Generated-video job ${job.id} failed.`);
  const raw = path.join(stateDir, `${shot.id}.raw.mp4`);
  if (!fs.existsSync(raw)) await provider.download(job, raw);
  await normalizeShot(raw, destination, project.format, shot.duration);
  return destination;
}
