#!/usr/bin/env node
/** Generate timed Speechify segments and mux them into a project video. */

import { SpeechifyClient } from "@speechify/api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  if (process.argv.length < 3 || process.argv.length > 4) fail("Usage: generate_narration.mjs PROJECT_DIR [--prepare]");

  const projectDir = path.resolve(process.argv[2]);
  const prepareOnly = process.argv[3] === "--prepare";
  const video = path.join(projectDir, "output.mp4");
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(specPath) || (!prepareOnly && !fs.existsSync(video))) {
    fail(prepareOnly ? "narration.json is required." : "output.mp4 and narration.json are required.");
  }

  const apiKey = process.env.SPEECHIFY_API_KEY?.trim();
  if (!apiKey) {
    fail("SPEECHIFY_API_KEY is required. Narration will not use a fallback voice.");
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

  const audioDir = path.join(projectDir, ".narration");
  fs.mkdirSync(audioDir, { recursive: true });
  const voice = process.env.SPEECHIFY_VOICE_ID?.trim() || "geffen_32";
  const model = "simba-3.2";
  const client = new SpeechifyClient({ token: apiKey });
  const audioFiles = [];
  const audioDurations = [];

  const escapeXml = (value) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

  for (let index = 0; index < normalized.length; index += 1) {
    const segment = normalized[index];
    const ssml = `<speak><speechify:style emotion="warm"><prosody rate="-5%">${escapeXml(segment.text)}</prosody></speechify:style></speak>`;
    const cacheKey = createHash("sha256").update(JSON.stringify({ ssml, voice, model, output: "mp3_24000_160" })).digest("hex").slice(0, 16);
    const target = path.join(audioDir, `speechify-${cacheKey}.mp3`);
    if (!fs.existsSync(target)) {
      let response;
      try {
        response = await client.audio.speech({
          input: ssml,
          voice_id: voice,
          model,
          audio_format: "mp3",
          output_format: "mp3_24000_160",
          language: "en-US",
        });
      } catch (error) {
        const code = typeof error?.statusCode === "number" ? ` (${error.statusCode})` : "";
        fail(`Speechify speech request failed${code}. Check the server key, voice, and account limits.`);
      }
      if (typeof response?.audio_data !== "string" || !response.audio_data) {
        fail("Speechify returned no audio_data.");
      }
      fs.writeFileSync(target, Buffer.from(response.audio_data, "base64"));
    }
    audioFiles.push(target);
    const segmentDuration = Number(run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", target,
    ]).trim());
    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
      fail(`Could not inspect narration segment ${index + 1}.`);
    }
    audioDurations.push(segmentDuration);
  }

  const timedSegments = normalized.map((segment, index) => {
    const words = segment.text.split(/\s+/).filter(Boolean);
    const weights = words.map((word) => Math.max(1, word.replace(/[^a-z0-9]/gi, "").length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = segment.start;
    const wordTimings = words.map((word, wordIndex) => {
      const wordDuration = audioDurations[index] * (weights[wordIndex] / totalWeight);
      const timing = { text: word, start: Number(cursor.toFixed(3)), end: Number((cursor + wordDuration).toFixed(3)) };
      cursor += wordDuration;
      return timing;
    });
    return {
      id: `narration-${index + 1}`,
      start: segment.start,
      end: Number((segment.start + audioDurations[index]).toFixed(3)),
      duration: Number(audioDurations[index].toFixed(3)),
      text: segment.text,
      words: wordTimings,
    };
  });
  const recommendedDuration = Number((Math.max(...timedSegments.map((segment) => segment.end)) + 0.8).toFixed(3));
  const timing = { provider: "speechify", model, voice, recommendedDuration, segments: timedSegments };
  fs.writeFileSync(path.join(projectDir, "narration-timing.json"), `${JSON.stringify(timing, null, 2)}\n`);

  const projectPath = path.join(projectDir, "project.json");
  if (fs.existsSync(projectPath)) {
    try {
      const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
      project.narration = timedSegments.map(({ id, start, end, text, words }) => ({ id, start, end, text, voice, words }));
      project.format.duration = Math.max(Number(project.format.duration || 0), recommendedDuration);
      project.updatedAt = new Date().toISOString();
      fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    } catch (error) {
      fail(`Could not update project.json with narration timing: ${error instanceof Error ? error.message : "invalid project"}`);
    }
  }

  if (prepareOnly) {
    console.log(JSON.stringify({ status: "prepared", enabled: true, provider: "speechify", model, voice, recommendedDuration, segments: timedSegments.length }));
    return;
  }

  const duration = Number(run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", video,
  ]).trim());
  if (!Number.isFinite(duration) || duration <= 0) fail("Could not inspect video duration.");

  normalized.forEach((segment, index) => {
    const slotEnd = index + 1 < normalized.length ? normalized[index + 1].start : duration;
    const available = slotEnd - segment.start;
    const required = audioDurations[index] + 0.22;
    if (required > available) {
      fail(
        `Narration segment ${index + 1} needs ${required.toFixed(2)} seconds but its visual slot is only ${available.toFixed(2)} seconds. ` +
        "Shorten the passage or extend the scene before rendering.",
      );
    }
  });

  const narrationAudio = path.join(projectDir, "narration.m4a");
  const ffmpeg = ["-y"];
  for (const audioFile of audioFiles) ffmpeg.push("-i", audioFile);
  const chains = [];
  const labels = [];
  normalized.forEach((segment, index) => {
    const label = `a${index}`;
    const fadeOutStart = Math.max(0, audioDurations[index] - 0.10).toFixed(3);
    chains.push(
      `[${index}:a]afade=t=in:st=0:d=0.025,afade=t=out:st=${fadeOutStart}:d=0.10,` +
      `adelay=${Math.round(segment.start * 1000)}:all=1[${label}]`,
    );
    labels.push(`[${label}]`);
  });
  chains.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:${duration.toFixed(3)}[aout]`,
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
    segmentDurations: audioDurations.map((value) => Number(value.toFixed(3))),
    audioFormat: "mp3_24000_160",
    style: "warm",
    rate: "-5%",
    disclosure: "AI-generated voice",
  }));
}

await main();
