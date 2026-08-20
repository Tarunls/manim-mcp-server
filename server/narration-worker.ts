import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProjectIR } from "../shared/video-ir.js";
import { readProjectBundle, writeProjectBundle } from "./project-bundle.js";

const execFileAsync = promisify(execFile);

interface NarrationSpec {
  segments: Array<{ start: number; text: string }>;
}

interface NarrationTiming {
  provider: string;
  model: string;
  voice: string;
  recommendedDuration: number;
  segments: Array<{ start: number; end: number; duration: number; text: string }>;
}

export function narrationRequested(projectDir: string) {
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(specPath)) return false;
  try {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as NarrationSpec;
    return Array.isArray(spec.segments) && spec.segments.length > 0;
  } catch {
    return false;
  }
}

function round(value: number) {
  return Number(value.toFixed(3));
}

export function alignTimelineToNarration(project: VideoProjectIR, sourceSpec: NarrationSpec, timing: NarrationTiming) {
  const timeline = structuredClone(project);
  const spec = structuredClone(sourceSpec);
  if (spec.segments.length !== timing.segments.length) throw new Error("Speechify timing does not match narration.json.");
  if (spec.segments.length && !timeline.shots.length) throw new Error("Narration requires at least one visual shot.");

  const originalShots = timeline.shots.map((shot) => ({ start: shot.start, duration: shot.duration }));
  const assignments = spec.segments.map((segment, segmentIndex) => {
    const start = Number(segment.start);
    let shotIndex = originalShots.findIndex((shot, index) => start >= shot.start && (start < shot.start + shot.duration || index === originalShots.length - 1));
    if (shotIndex < 0) {
      shotIndex = 0;
      for (let index = originalShots.length - 1; index >= 0; index -= 1) {
        if (start >= originalShots[index].start) {
          shotIndex = index;
          break;
        }
      }
    }
    return {
      segmentIndex,
      shotIndex,
      offset: Math.max(0, start - originalShots[shotIndex].start),
      duration: Number(timing.segments[segmentIndex].duration),
    };
  });

  let cursor = 0;
  for (let shotIndex = 0; shotIndex < timeline.shots.length; shotIndex += 1) {
    const shot = timeline.shots[shotIndex];
    const oldDuration = shot.duration;
    const required = assignments
      .filter((item) => item.shotIndex === shotIndex)
      .reduce((longest, item) => Math.max(longest, item.offset + item.duration + 0.35), 0);
    shot.start = round(cursor);
    shot.duration = round(Math.max(oldDuration, required));
    const extension = shot.duration - oldDuration;
    if (extension > 0) {
      for (const clip of shot.tracks.flatMap((track) => track.clips)) {
        if (Math.abs(clip.start + clip.duration - oldDuration) <= 0.05) clip.duration = round(clip.duration + extension);
      }
    }
    for (const assignment of assignments.filter((item) => item.shotIndex === shotIndex)) {
      spec.segments[assignment.segmentIndex].start = round(cursor + assignment.offset);
    }
    if (timeline.storyboard[shotIndex]) timeline.storyboard[shotIndex].duration = shot.duration;
    cursor += shot.duration;
  }
  timeline.format.duration = round(cursor);
  return { timeline, spec };
}

function parseResult(stdout: string) {
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("Narration worker returned no result.");
  return JSON.parse(line) as Record<string, unknown>;
}

async function runNarrationScript(root: string, projectDir: string, prepareOnly: boolean) {
  try {
    const result = await execFileAsync("node", [
      path.join(root, "scripts", "generate_narration.mjs"),
      projectDir,
      ...(prepareOnly ? ["--prepare"] : []),
    ], { env: process.env, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    return parseResult(result.stdout);
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr.trim() : "";
    throw new Error(stderr || (error instanceof Error ? error.message : "Speechify narration failed."));
  }
}

export async function prepareSpeechifyNarration(root: string, projectDir: string, project: VideoProjectIR) {
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(specPath)) return project;
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as NarrationSpec;
  if (!Array.isArray(spec.segments) || spec.segments.length === 0) return project;
  await runNarrationScript(root, projectDir, true);
  const timing = JSON.parse(fs.readFileSync(path.join(projectDir, "narration-timing.json"), "utf8")) as NarrationTiming;
  const aligned = alignTimelineToNarration(project, spec, timing);
  writeProjectBundle(projectDir, aligned.timeline);
  fs.writeFileSync(specPath, `${JSON.stringify(aligned.spec, null, 2)}\n`);
  await runNarrationScript(root, projectDir, true);
  return readProjectBundle(projectDir);
}

export async function muxSpeechifyNarration(root: string, projectDir: string) {
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(specPath)) return { status: "not_requested", enabled: false };
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as NarrationSpec;
  if (!Array.isArray(spec.segments) || spec.segments.length === 0) return { status: "not_requested", enabled: false };
  return runNarrationScript(root, projectDir, false);
}
