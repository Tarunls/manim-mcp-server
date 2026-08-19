#!/usr/bin/env node
/** Generate timed Speechify segments and mux them into a project video. */

import { SpeechifyClient } from "@speechify/api";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 180_000,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(-2500) : "";
    fail(stderr || `${command} failed.`);
  }
}

async function main() {
  if (process.argv.length !== 3) fail("Usage: generate_narration.mjs PROJECT_DIR");

  const projectDir = path.resolve(process.argv[2]);
  const video = path.join(projectDir, "output.mp4");
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(video) || !fs.existsSync(specPath)) {
    fail("output.mp4 and narration.json are required.");
  }

  const apiKey = process.env.SPEECHIFY_API_KEY?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ status: "setup_required", enabled: false, provider: "speechify" }));
    return;
  }

  let segments;
  try {
    segments = JSON.parse(fs.readFileSync(specPath, "utf8")).segments;
  } catch (error) {
    fail(`Invalid narration.json: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 12) {
    fail("narration.json must contain 1-12 timed segments.");
  }

  const normalized = segments.map((segment, index) => {
    const start = Math.max(0, Number(segment?.start));
    const text = String(segment?.text || "").trim();
    if (!Number.isFinite(start) || !text || text.length > 1800) {
      fail(`Narration segment ${index + 1} must have a valid start and 1-1800 characters.`);
    }
    return { start, text };
  }).sort((a, b) => a.start - b.start);

  const duration = Number(run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", video,
  ]).trim());
  if (!Number.isFinite(duration) || duration <= 0) fail("Could not inspect video duration.");

  const audioDir = path.join(projectDir, ".narration");
  fs.mkdirSync(audioDir, { recursive: true });
  const voice = process.env.SPEECHIFY_VOICE_ID?.trim() || "geffen_32";
  const model = "simba-3.2";
  const client = new SpeechifyClient({ token: apiKey });
  const audioFiles = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const segment = normalized[index];
    let response;
    try {
      response = await client.audio.speech({
        input: segment.text,
        voice_id: voice,
        model,
        audio_format: "mp3",
      });
    } catch (error) {
      const code = typeof error?.statusCode === "number" ? ` (${error.statusCode})` : "";
      fail(`Speechify speech request failed${code}. Check the server key, voice, and account limits.`);
    }
    if (typeof response?.audio_data !== "string" || !response.audio_data) {
      fail("Speechify returned no audio_data.");
    }
    const target = path.join(audioDir, `segment-${String(index + 1).padStart(2, "0")}.mp3`);
    fs.writeFileSync(target, Buffer.from(response.audio_data, "base64"));
    audioFiles.push(target);
  }

  const narrationAudio = path.join(projectDir, "narration.m4a");
  const ffmpeg = ["-y"];
  for (const audioFile of audioFiles) ffmpeg.push("-i", audioFile);
  const chains = [];
  const labels = [];
  normalized.forEach((segment, index) => {
    const label = `a${index}`;
    chains.push(`[${index}:a]adelay=${Math.round(segment.start * 1000)}:all=1[${label}]`);
    labels.push(`[${label}]`);
  });
  chains.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `apad,atrim=0:${duration.toFixed(3)},alimiter=limit=0.95[aout]`,
  );
  ffmpeg.push(
    "-filter_complex", chains.join(";"), "-map", "[aout]",
    "-c:a", "aac", "-b:a", "160k", narrationAudio,
  );
  run("ffmpeg", ffmpeg);

  const muxed = path.join(projectDir, "output.narrated.mp4");
  run("ffmpeg", [
    "-y", "-i", video, "-i", narrationAudio,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy",
    "-movflags", "+faststart", "-shortest", muxed,
  ]);
  fs.renameSync(muxed, video);

  console.log(JSON.stringify({
    status: "ready",
    enabled: true,
    provider: "speechify",
    model,
    voice,
    segments: normalized.length,
    disclosure: "AI-generated voice",
  }));
}

await main();
