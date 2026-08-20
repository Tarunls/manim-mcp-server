import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { QualityCheck, QualityReport } from "../../shared/quality.js";
import { validateVideoIR, type VideoProjectIR } from "../../shared/video-ir.js";

const execFileAsync = promisify(execFile);

function check(checks: QualityCheck[], value: Omit<QualityCheck, "severity"> & { severity?: QualityCheck["severity"] }) {
  checks.push({ severity: "error", ...value });
}

function parseHex(value: unknown) {
  const found = /^#([0-9a-f]{6})$/i.exec(String(value));
  if (!found) return undefined;
  return [0, 2, 4].map((offset) => Number.parseInt(found[1].slice(offset, offset + 2), 16) / 255);
}

function luminance(rgb: number[]) {
  const values = rgb.map((component) => component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(first: unknown, second: unknown) {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return undefined;
  const one = luminance(a);
  const two = luminance(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

export function inspectProject(project: VideoProjectIR): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const validation = validateVideoIR(project);
  for (const error of validation.errors) check(checks, { id: "schema", category: "project", message: error });
  if (project.format.width < 1280 || project.format.height < 720) check(checks, { id: "resolution", category: "video", severity: "warning", message: "Final output is below 720p.", value: `${project.format.width}x${project.format.height}` });
  if (project.format.fps < 24) check(checks, { id: "fps", category: "video", severity: "warning", message: "Frame rate below 24 fps can look choppy.", value: project.format.fps });
  if (!project.storyboard.length) check(checks, { id: "storyboard", category: "project", message: "The project has no storyboard." });

  const safe = project.design.safeArea;
  for (const shot of project.shots) {
    for (const track of shot.tracks) {
      for (const clip of track.clips) {
        const { x, y, width, height, scale } = clip.transform;
        const left = project.format.width / 2 + x - width * scale / 2;
        const right = project.format.width / 2 + x + width * scale / 2;
        const top = project.format.height / 2 + y - height * scale / 2;
        const bottom = project.format.height / 2 + y + height * scale / 2;
        const requiresSafeArea = ["text", "caption", "diagram", "chart"].includes(clip.kind) && clip.metadata.allowBleed !== true;
        if (requiresSafeArea && (left < safe || right > project.format.width - safe || top < safe || bottom > project.format.height - safe)) {
          check(checks, { id: "safe-area", category: "layout", message: `${clip.name} crosses the ${safe}px safe area.`, targetId: clip.id });
        }
        if (["text", "caption"].includes(clip.kind)) {
          const fontSize = Number(clip.style.fontSize || 0);
          if (!clip.text?.trim()) check(checks, { id: "empty-text", category: "layout", message: `${clip.name} has no text.`, targetId: clip.id });
          if (fontSize && fontSize < 32) check(checks, { id: "small-text", category: "layout", severity: "warning", message: `${clip.name} may be hard to read at ${fontSize}px.`, targetId: clip.id, value: fontSize });
          const ratio = contrast(clip.style.color || project.design.colors.text, clip.style.background || project.format.background);
          if (ratio !== undefined && ratio < 4.5) check(checks, { id: "contrast", category: "layout", message: `${clip.name} has ${ratio.toFixed(2)}:1 contrast; 4.5:1 is required.`, targetId: clip.id, value: Number(ratio.toFixed(2)) });
        }
      }
    }
  }

  for (const asset of project.assets) {
    if (!asset.license?.name) check(checks, { id: "asset-license", category: "assets", message: `${asset.name} has no recorded license.`, targetId: asset.id });
    if (!asset.license.commercialUse) check(checks, { id: "noncommercial", category: "assets", severity: "warning", message: `${asset.name} is not licensed for commercial use.`, targetId: asset.id });
    if (asset.license.attributionRequired && !asset.license.attribution) check(checks, { id: "attribution", category: "provenance", message: `${asset.name} requires attribution but has no credit line.`, targetId: asset.id });
    if (!asset.hash && asset.localPath) check(checks, { id: "asset-hash", category: "provenance", message: `${asset.name} has no content hash.`, targetId: asset.id });
  }

  const narration = [...project.narration].sort((a, b) => a.start - b.start);
  for (let index = 0; index < narration.length; index += 1) {
    const segment = narration[index];
    if (!segment.end || !segment.words?.length) check(checks, { id: "narration-timing", category: "audio", message: `Narration segment ${index + 1} is missing measured timing.`, targetId: segment.id });
    if (index > 0 && narration[index - 1].end && segment.start < narration[index - 1].end!) check(checks, { id: "narration-overlap", category: "audio", message: `Narration segments ${index} and ${index + 1} overlap.`, targetId: segment.id });
  }
  return checks;
}

async function inspectMedia(output: string, narrated: boolean) {
  const probe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate:format=duration,bit_rate", "-of", "json", output]);
  const data = JSON.parse(probe.stdout);
  const video = data.streams.find((stream: any) => stream.codec_type === "video") || {};
  const fraction = String(video.avg_frame_rate || "0/1").split("/").map(Number);
  const media = {
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: fraction[0] / Math.max(1, fraction[1]),
    duration: Number(data.format?.duration || 0),
    bitRate: Number(data.format?.bit_rate || 0),
    hasAudio: data.streams.some((stream: any) => stream.codec_type === "audio"),
  };
  const analysis = await execFileAsync("ffmpeg", ["-hide_banner", "-i", output, "-vf", "blackdetect=d=0.35:pix_th=0.10,freezedetect=n=-60dB:d=1.5", "-af", "silencedetect=n=-45dB:d=1.5", "-f", "null", "-"], { maxBuffer: 4 * 1024 * 1024 }).catch((error: any) => ({ stderr: String(error.stderr || "") }));
  const log = analysis.stderr || "";
  return { media, black: /black_start/.test(log), freeze: /freeze_start/.test(log), silence: /silence_start/.test(log), missingNarration: narrated && !media.hasAudio };
}

export async function createQualityReport(projectDir: string, project: VideoProjectIR): Promise<QualityReport> {
  const checks = inspectProject(project);
  const output = path.join(projectDir, "output.mp4");
  let media: QualityReport["media"];
  if (!fs.existsSync(output)) check(checks, { id: "missing-output", category: "video", message: "output.mp4 is missing." });
  else {
    const result = await inspectMedia(output, project.narration.length > 0);
    media = result.media;
    if (result.black) check(checks, { id: "black-frames", category: "video", severity: "warning", message: "The output contains a sustained black frame." });
    if (result.freeze) check(checks, { id: "frozen-video", category: "video", severity: "warning", message: "The output contains a sustained frozen frame." });
    if (result.silence && project.narration.length) check(checks, { id: "audio-silence", category: "audio", severity: "warning", message: "The narrated output contains a sustained silence." });
    if (result.missingNarration) check(checks, { id: "missing-audio", category: "audio", message: "Narration exists in the project but the output has no audio stream." });
    if (Math.abs((media.duration || 0) - project.format.duration) > 0.25) check(checks, { id: "duration-mismatch", category: "video", message: "Rendered duration does not match project duration.", value: media.duration || 0 });
  }
  if (!fs.existsSync(path.join(projectDir, "poster.png"))) check(checks, { id: "poster", category: "video", severity: "warning", message: "poster.png is missing." });
  if (!fs.existsSync(path.join(projectDir, "contact-sheet.png"))) check(checks, { id: "contact-sheet", category: "video", severity: "warning", message: "contact-sheet.png is missing." });

  const summary = {
    errors: checks.filter((item) => item.severity === "error").length,
    warnings: checks.filter((item) => item.severity === "warning").length,
    info: checks.filter((item) => item.severity === "info").length,
  };
  const report: QualityReport = {
    projectId: project.id,
    createdAt: new Date().toISOString(),
    passed: summary.errors === 0,
    score: Math.max(0, 100 - summary.errors * 15 - summary.warnings * 4),
    summary,
    checks,
    media,
    provenance: {
      assets: project.assets.length,
      licensedAssets: project.assets.filter((asset) => Boolean(asset.license?.name)).length,
      attributedAssets: project.assets.filter((asset) => !asset.license.attributionRequired || Boolean(asset.license.attribution)).length,
      generatedAssets: project.assets.filter((asset) => asset.kind === "generated").length,
    },
  };
  fs.writeFileSync(path.join(projectDir, "quality-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const provenance = { projectId: project.id, createdAt: report.createdAt, assets: project.assets.map((asset) => ({ id: asset.id, name: asset.name, hash: asset.hash, sourceUrl: asset.sourceUrl, provider: asset.provider, creator: asset.creator, license: asset.license, provenance: asset.provenance })) };
  fs.writeFileSync(path.join(projectDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  return report;
}
