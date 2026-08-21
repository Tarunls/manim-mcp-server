#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, renderStill } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const publicDir = path.join(root, "client", "public");
const source = path.join(root, "remotion", "marketing-reel.tsx");
const rawVideo = path.join(publicDir, "lesson-studio-reel.raw.mp4");
const outputVideo = path.join(publicDir, "lesson-studio-reel.mp4");
const poster = path.join(publicDir, "lesson-studio-reel-poster.jpg");

fs.mkdirSync(publicDir, { recursive: true });
fs.rmSync(rawVideo, { force: true });
fs.rmSync(outputVideo, { force: true });

const serveUrl = await bundle({ entryPoint: source });
const composition = await selectComposition({ serveUrl, id: "MarketingMathReel" });

await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: rawVideo,
  concurrency: "50%",
  crf: 22,
  colorSpace: "bt709",
  pixelFormat: "yuv420p",
});

execFileSync("ffmpeg", ["-y", "-i", rawVideo, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", outputVideo], { stdio: "inherit" });
await renderStill({ composition, serveUrl, output: poster, frame: 54, imageFormat: "jpeg", jpegQuality: 88 });
fs.rmSync(rawVideo, { force: true });

console.log(`Marketing reel written to ${outputVideo}`);
