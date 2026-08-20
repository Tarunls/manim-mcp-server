import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoAsset, VideoProjectIR, VideoShot } from "../../shared/video-ir.js";

const execFileAsync = promisify(execFile);

function time(value: number, rate: number) {
  return { OTIO_SCHEMA: "RationalTime.1", value: Math.round(value * rate), rate };
}

function range(start: number, duration: number, rate: number) {
  return { OTIO_SCHEMA: "TimeRange.1", start_time: time(start, rate), duration: time(duration, rate) };
}

function externalReference(targetUrl: string, duration: number, rate: number) {
  return {
    OTIO_SCHEMA: "ExternalReference.1",
    name: path.basename(targetUrl),
    target_url: targetUrl,
    available_range: range(0, duration, rate),
    available_image_bounds: null,
    metadata: {},
  };
}

function missingReference() {
  return { OTIO_SCHEMA: "MissingReference.1", name: "Unrendered shot", available_range: null, available_image_bounds: null, metadata: {} };
}

function otioClip(shot: VideoShot, rate: number) {
  const reference = shot.cacheKey ? externalReference(`shots/${shot.id}.mp4`, shot.duration, rate) : missingReference();
  return {
    OTIO_SCHEMA: "Clip.2",
    name: shot.name,
    source_range: range(0, shot.duration, rate),
    enabled: true,
    color: null,
    effects: [],
    markers: [],
    active_media_reference_key: "DEFAULT_MEDIA",
    media_references: { DEFAULT_MEDIA: reference },
    metadata: {
      manim_studio: {
        id: shot.id,
        intent: shot.intent,
        renderer: shot.renderer,
        status: shot.status,
        tracks: shot.tracks,
        metadata: shot.metadata || {},
      },
    },
  };
}

function gap(duration: number, rate: number) {
  return { OTIO_SCHEMA: "Gap.1", name: "Gap", source_range: range(0, duration, rate), enabled: true, color: null, effects: [], markers: [], metadata: {} };
}

export function buildOtio(project: VideoProjectIR) {
  const children: Record<string, unknown>[] = [];
  let cursor = 0;
  for (const shot of [...project.shots].sort((a, b) => a.start - b.start)) {
    if (shot.start > cursor) children.push(gap(shot.start - cursor, project.format.fps));
    children.push(otioClip(shot, project.format.fps));
    cursor = shot.start + shot.duration;
  }
  if (cursor < project.format.duration) children.push(gap(project.format.duration - cursor, project.format.fps));
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: project.title,
    global_start_time: time(0, project.format.fps),
    metadata: { manim_studio: { schemaVersion: project.schemaVersion, projectId: project.id, design: project.design, brief: project.brief } },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "Tracks",
      children: [{ OTIO_SCHEMA: "Track.1", name: "Rendered shots", kind: "Video", children, source_range: null, enabled: true, color: null, effects: [], markers: [], metadata: {} }],
      source_range: null,
      enabled: true,
      color: null,
      effects: [],
      markers: [],
      metadata: {},
    },
  };
}

function assetCredit(asset: VideoAsset) {
  const creator = asset.creator ? ` by ${asset.creator}` : "";
  const source = asset.sourceUrl ? `\n  Source: ${asset.sourceUrl}` : "";
  const license = asset.license.url ? `${asset.license.name} (${asset.license.url})` : asset.license.name;
  const attribution = asset.license.attribution ? `\n  Credit: ${asset.license.attribution}` : "";
  return `${asset.name}${creator}\n  Provider: ${asset.provider}\n  License: ${license}${source}${attribution}`;
}

export function buildCredits(project: VideoProjectIR) {
  const assets = project.assets.length ? project.assets.map(assetCredit).join("\n\n") : "No third-party assets.";
  return `${project.title}\n\nASSET CREDITS\n\n${assets}\n\nGenerated ${new Date().toISOString()}\n`;
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const secs = Math.floor(milliseconds % 60_000 / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(project: VideoProjectIR) {
  return project.narration.map((segment, index) => `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end || Math.min(project.format.duration, segment.start + 3))}\n${segment.text}\n`).join("\n");
}

function copyIfPresent(source: string, destination: string) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

export async function createDeliveryBundle(root: string, projectDir: string, project: VideoProjectIR) {
  const exportsDir = path.join(projectDir, "exports");
  const exportId = new Date().toISOString().replace(/[:.]/g, "-");
  const packageRoot = path.join(exportsDir, exportId);
  const deliveryDir = path.join(packageRoot, "delivery");
  fs.mkdirSync(deliveryDir, { recursive: true });
  fs.writeFileSync(path.join(deliveryDir, "timeline.otio"), `${JSON.stringify(buildOtio(project), null, 2)}\n`);
  fs.writeFileSync(path.join(deliveryDir, "credits.txt"), buildCredits(project));
  fs.writeFileSync(path.join(deliveryDir, "captions.srt"), buildSrt(project));
  copyIfPresent(path.join(projectDir, "project.json"), path.join(deliveryDir, "project.json"));
  for (const name of ["output.mp4", "proxy.mp4", "poster.png", "contact-sheet.png", "quality-report.json", "provenance.json", "metadata.json", "narration-timing.json"]) {
    copyIfPresent(path.join(projectDir, name), path.join(deliveryDir, name));
  }
  if (fs.existsSync(path.join(projectDir, "assets"))) fs.cpSync(path.join(projectDir, "assets"), path.join(deliveryDir, "assets"), { recursive: true });
  for (const shot of project.shots) {
    if (!shot.cacheKey) continue;
    const cached = path.join(root, "studio", "cache", shot.cacheKey.slice(0, 2), shot.cacheKey, "shot.mp4");
    copyIfPresent(cached, path.join(deliveryDir, "shots", `${shot.id}.mp4`));
  }
  const archive = path.join(packageRoot, `${project.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "video"}-delivery.zip`);
  await execFileAsync("zip", ["-q", "-r", archive, "delivery"], { cwd: packageRoot, timeout: 120_000 });
  return archive;
}

export function writeInterchange(projectDir: string, project: VideoProjectIR, format: "otio" | "credits" | "srt") {
  const exportsDir = path.join(projectDir, "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const filename = format === "otio" ? "timeline.otio" : format === "credits" ? "credits.txt" : "captions.srt";
  const content = format === "otio" ? `${JSON.stringify(buildOtio(project), null, 2)}\n` : format === "credits" ? buildCredits(project) : buildSrt(project);
  const target = path.join(exportsDir, filename);
  fs.writeFileSync(target, content);
  return target;
}
