#!/usr/bin/env node
/**
 * Run a fixed set of briefs through the pipeline and measure what a viewer
 * would notice: how much of the video moves, how much of it is silent, how
 * long each stage took. Outputs land under studio/eval/<run>/<slug>/ with the
 * storyboard, scene, video, frame grid, and a metrics.json per lesson, plus
 * a summary.json for the run.
 *
 *   node --env-file=.env scripts/eval_lessons.mjs [--only slug,slug] [--run name] [--effort quick|balanced|thorough] [--silent] [--upload gs://bucket/prefix]
 *   ORUNE_SCRIPT_MODEL / ORUNE_CODE_MODEL override the models as usual.
 *   --upload copies the run directory to Cloud Storage, for runs made inside a
 *   Cloud Run job that holds the provider keys.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorLesson, resolveModels } from "./lesson_pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const runName = option("--run") || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const only = option("--only")?.split(",").map((value) => value.trim()).filter(Boolean);
const effort = option("--effort") || "balanced";
const narrationEnabled = !args.includes("--silent");

export const EVAL_BRIEFS = [
  {
    slug: "shadow-height",
    format: "vertical",
    brief: "Create a visual explanation of how you can measure the height of a tall object using only its shadow and the shadow of a smaller object whose height you already know. Start with a tall tree casting a long shadow and a short stick of known height casting a smaller shadow in the same sunlight. Show that both make the same triangle shape at different scales, then show that knowing the stick's height and both shadow lengths is enough to work out the tree's height. Keep the number of objects small.",
  },
  {
    slug: "halves-fill-square",
    format: "vertical",
    brief: "Create a visual explanation of why 1/2 + 1/4 + 1/8 + 1/16 + … equals exactly 1. Use a single square. Successively fill half of the remaining empty space, making each new region visually distinct enough to follow. The final composition should clearly show that infinitely many progressively smaller pieces perfectly fill one whole square.",
  },
  {
    slug: "mobius-one-side",
    format: "vertical",
    brief: "A Möbius strip has only one side. Show a flat strip of paper, give one end a half twist and join the ends. Put a dot on the surface and let it travel along the strip leaving a line behind it, never crossing an edge, until it returns to where it started having covered what looked like both sides. Do not explain topology or use equations; the moving dot and the unbroken line are the proof.",
  },
  {
    slug: "sine-from-circle",
    format: "vertical",
    brief: "Show where a sine wave comes from: a point going around a circle, and its height traced out over time. Make the connection between the circular motion and the wave unmistakable.",
  },
  {
    slug: "pythagoras-rearrange",
    format: "landscape",
    brief: "Explain the Pythagorean theorem to a curious 13-year-old using a rearrangement proof: four copies of the same right triangle inside a square, arranged two different ways, so the leftover area is a² + b² one way and c² the other. Use concrete side lengths like 3, 4 and 5 so the numbers can be checked.",
  },
];

function probe(file, entries) {
  return execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", file], { encoding: "utf8" });
}

/** Share of quarter-second samples where the picture changed at all. */
function motionShare(video, workDir) {
  const frames = path.join(workDir, "motion");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "fps=4,scale=96:-2,format=gray", path.join(frames, "%05d.png")]);
  const script = `
import glob, sys
from PIL import Image
import numpy as np
files = sorted(glob.glob(sys.argv[1] + "/*.png"))
prev = None; moving = 0; total = 0; timeline = []
for f in files:
    a = np.asarray(Image.open(f), dtype=np.float32)
    if prev is not None:
        d = np.abs(a - prev).mean(); total += 1; m = d > 0.6; moving += m; timeline.append("#" if m else ".")
    prev = a
print(round(100 * moving / max(total, 1)), "".join("#" if "#" in timeline[i:i+4] else "." for i in range(0, len(timeline), 4)))
`;
  const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const [share, timeline] = execFileSync(python, ["-c", script, frames], { encoding: "utf8" }).trim().split(" ");
  fs.rmSync(frames, { recursive: true, force: true });
  return { motionSharePercent: Number(share), motionTimeline: timeline };
}

/** Silences longer than a second inside the narration, and the total speech. */
function silence(video) {
  const output = execFileSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-af", "silencedetect=noise=-40dB:d=1.0", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const gaps = [];
  const starts = [...output.matchAll(/silence_start: ([0-9.]+)/g)].map((match) => Number(match[1]));
  const ends = [...output.matchAll(/silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  ends.forEach(([end, duration], index) => gaps.push({ start: starts[index] ?? end - duration, end, seconds: Number(duration.toFixed(2)) }));
  return gaps;
}

async function evaluate(item, runDir) {
  const projectDir = path.join(root, "studio", "projects", `eval-${runName}-${item.slug}`.replace(/[^a-zA-Z0-9-]/g, "-"));
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  const outDir = path.join(runDir, item.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "narration-config.json"), JSON.stringify({ enabled: narrationEnabled, voice: "default-female" }));
  const design = JSON.parse(fs.readFileSync(path.join(root, "studio", "eval-design.json"), "utf8"));
  fs.writeFileSync(path.join(projectDir, "design-config.json"), JSON.stringify(design));
  const stages = [];
  const started = Date.now();
  let lastStage = { stage: "start", at: started };
  const metrics = { slug: item.slug, format: item.format, models: resolveModels(effort), effort };
  try {
    const result = await authorLesson({
      root,
      projectDir,
      brief: item.brief,
      format: item.format,
      effort,
      narration: { enabled: narrationEnabled, voice: "default-female" },
      design,
      openai: { baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY },
      onProgress: ({ stage, label }) => {
        const at = Date.now();
        stages.push({ stage: lastStage.stage, label: lastStage.label, seconds: Number(((at - lastStage.at) / 1000).toFixed(1)) });
        lastStage = { stage, label, at };
        console.log(`  ${((at - started) / 1000).toFixed(1).padStart(6)}s  ${stage}: ${label}`);
      },
      log: (line) => console.log(`  · ${line.slice(0, 200)}`),
    });
    stages.push({ stage: lastStage.stage, label: lastStage.label, seconds: Number(((Date.now() - lastStage.at) / 1000).toFixed(1)) });
    const video = path.join(projectDir, "output.mp4");
    const duration = Number(JSON.parse(probe(video, "format=duration")).format.duration);
    const spoken = result.storyboard.beats.filter((beat) => beat.narration).reduce((sum, beat) => sum + beat.duration, 0);
    Object.assign(metrics, {
      ok: true,
      totalSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      stages: stages.slice(1),
      videoSeconds: Number(duration.toFixed(1)),
      beats: result.storyboard.beats.length,
      speechSeconds: Number(spoken.toFixed(1)),
      speechSharePercent: Math.round((100 * spoken) / Math.max(duration, 0.1)),
      gapsOverOneSecond: narrationEnabled ? silence(video) : [],
      ...motionShare(video, outDir),
      narration: result.metadata.narration,
      storyboard: result.storyboard.beats.map((beat) => ({ id: beat.id, start: beat.start, end: beat.end, narration: beat.narration, visual: beat.visual })),
    });
    for (const file of ["output.mp4", "storyboard.json", "scene.py", "contact-sheet.png", "poster.png", "metadata.json", "narration.json"]) {
      if (fs.existsSync(path.join(projectDir, file))) fs.copyFileSync(path.join(projectDir, file), path.join(outDir, file));
    }
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "fps=1/2.5,scale=270:-2,tile=6x4:padding=6:margin=6:color=white", "-frames:v", "1", path.join(outDir, "frames.png")]);
  } catch (error) {
    Object.assign(metrics, { ok: false, error: String(error?.message || error).slice(0, 2000), totalSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), stages });
  }
  fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2));
  return metrics;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
  const runDir = path.join(root, "studio", "eval", runName);
  fs.mkdirSync(runDir, { recursive: true });
  const briefs = EVAL_BRIEFS.filter((item) => !only || only.includes(item.slug));
  const summary = [];
  for (const item of briefs) {
    console.log(`\n== ${item.slug} (${item.format}, ${effort})`);
    const metrics = await evaluate(item, runDir);
    summary.push(metrics);
    if (metrics.ok) {
      console.log(`  video ${metrics.videoSeconds}s · ${metrics.beats} beats · speech ${metrics.speechSharePercent}% · motion ${metrics.motionSharePercent}% · gaps>1s ${metrics.gapsOverOneSecond.length} · took ${metrics.totalSeconds}s`);
    } else {
      console.log(`  FAILED after ${metrics.totalSeconds}s: ${metrics.error.slice(0, 300)}`);
    }
  }
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${runDir}`);
  const upload = option("--upload");
  if (upload) {
    const match = upload.match(/^gs:\/\/([^/]+)\/?(.*)$/);
    if (!match) throw new Error("--upload expects gs://bucket/prefix");
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(match[1]);
    const prefix = `${match[2].replace(/\/$/, "")}/${runName}`.replace(/^\//, "");
    const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
    for (const file of walk(runDir)) {
      const destination = `${prefix}/${path.relative(runDir, file).split(path.sep).join("/")}`;
      await bucket.upload(file, { destination });
    }
    console.log(`Uploaded to gs://${match[1]}/${prefix}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
