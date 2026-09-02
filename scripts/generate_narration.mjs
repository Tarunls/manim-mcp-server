#!/usr/bin/env node
/** Generate timed narration segments and mux them into a project video. */

import { SpeechifyClient } from "@speechify/api";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import voiceCatalog from "../shared/narration-voices.json" with { type: "json" };

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

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout || 180_000,
  });
  if (result.error || result.status !== 0) {
    fail((result.stderr || "").slice(-2500) || `${command} failed.`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

const LOUDNESS = { i: -16, tp: -1.5, lra: 11 };

// Trim the provider's leading and trailing padding and nothing else. Pauses
// inside a passage are prosody and must survive untouched.
//
// The previous filter used stop_periods=-1, which does not mean "cap unusually
// long gaps" - it strips every silence in the passage. Measured on a clip whose
// pauses were 0.60s and 1.49s, it returned 0.23s and 0.23s: unrelated pauses
// flattened to the same length, so the delivery rushed some phrases and stalled
// on others. Raising the threshold did not help - at stop_duration=1.0 the same
// 0.60s pause came back as 0.05s. Only trimming the ends leaves both pauses
// exactly as spoken.
const CLEAN_FILTER = [
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:start_silence=0.05",
  "areverse",
  "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB:start_silence=0.08",
  "areverse",
].join(",");

/** Measure a segment so loudness can be corrected with one fixed gain. */
function measureLoudness(file) {
  const { stderr } = runCapture("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file,
    "-af", `loudnorm=I=${LOUDNESS.i}:TP=${LOUDNESS.tp}:LRA=${LOUDNESS.lra}:print_format=json`,
    "-f", "null", "-",
  ]);
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const measured = JSON.parse(stderr.slice(start, end + 1));
    return ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]
      .every((key) => Number.isFinite(Number(measured[key]))) ? measured : undefined;
  } catch {
    return undefined;
  }
}

// Single-pass loudnorm rides gain continuously, so on a track that is mostly
// silence it lifts the noise floor between passages and ducks each entry: the
// pumping reads as the voice surging and fading. Measuring first lets the
// second pass apply one static gain (linear=true) instead.
function loudnormFilter(measured) {
  const base = `loudnorm=I=${LOUDNESS.i}:TP=${LOUDNESS.tp}:LRA=${LOUDNESS.lra}`;
  if (!measured) return base;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true`;
}

async function main() {
  if (process.argv.length !== 3) fail("Usage: generate_narration.mjs PROJECT_DIR");

  const projectDir = path.resolve(process.argv[2]);
  const video = path.join(projectDir, "output.mp4");
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(video) || !fs.existsSync(specPath)) {
    fail("output.mp4 and narration.json are required.");
  }

  let narrationPreferences = { enabled: true, voice: "default-female" };
  const narrationConfigPath = path.join(projectDir, "narration-config.json");
  if (fs.existsSync(narrationConfigPath)) {
    try {
      narrationPreferences = {
        ...narrationPreferences,
        ...JSON.parse(fs.readFileSync(narrationConfigPath, "utf8")),
      };
    } catch {
      fail("narration-config.json must contain valid JSON.");
    }
  }
  const voiceKey = Object.hasOwn(voiceCatalog, narrationPreferences.voice)
    ? narrationPreferences.voice
    : "default-female";
  const voice = voiceCatalog[voiceKey];
  const apiKey = voice.provider === "elevenlabs"
    ? process.env.ELEVENLABS_API_KEY?.trim()
    : process.env.SPEECHIFY_API_KEY?.trim();
  const proxyUrl = process.env.NARRATION_PROXY_URL?.trim();
  const callbackUrl = process.env.JOB_CALLBACK_URL?.trim();
  const callbackToken = process.env.JOB_CALLBACK_TOKEN?.trim();
  if (!apiKey && !proxyUrl && (!callbackUrl || !callbackToken)) fail("A server-scoped narration provider is required. Narration will not use a fallback voice.");

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
    const text = String(segment?.text || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\.{3,}|…+/g, ".")
      .replace(/([!?])\1+/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
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
  const model = voice.provider === "elevenlabs" ? "eleven_multilingual_v2" : "simba-3.2";
  const outputFormat = voice.provider === "elevenlabs" ? "mp3_44100_128" : "mp3_24000_160";
  const rate = "natural";
  const speechifyClient = apiKey && voice.provider === "speechify"
    ? new SpeechifyClient({ token: apiKey })
    : undefined;
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
    const ssml = `<speak><speechify:style emotion="warm">${escapeXml(segment.text)}</speechify:style></speak>`;
    const cacheKey = createHash("sha256").update(JSON.stringify({ text: segment.text, voiceKey, voiceId: voice.voiceId, model, outputFormat, rate })).digest("hex").slice(0, 16);
    const rawTarget = path.join(audioDir, `${voice.provider}-${cacheKey}-raw.mp3`);
    const trimmed = path.join(audioDir, `${voice.provider}-${cacheKey}-trim.wav`);
    // The intermediates are PCM on purpose. Re-encoding each passage to MP3
    // stacked a second lossy generation on the provider's output and prepended
    // encoder delay, so every passage drifted a little later than the timeline
    // said it should.
    const target = path.join(audioDir, `${voice.provider}-${cacheKey}-clean.wav`);
    if (!fs.existsSync(rawTarget)) {
      let response;
      try {
        if (apiKey) {
          if (voice.provider === "speechify") {
            response = await speechifyClient.audio.speech({
              input: ssml,
              voice_id: voice.voiceId,
              model,
              audio_format: "mp3",
              output_format: outputFormat,
              language: "en-US",
            });
          } else {
            const providerResponse = await fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${outputFormat}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
                body: JSON.stringify({
                  text: segment.text,
                  model_id: model,
                  voice_settings: {
                    stability: 0.45,
                    similarity_boost: 0.8,
                    style: 0.2,
                    use_speaker_boost: true,
                    speed: 1,
                  },
                }),
                signal: AbortSignal.timeout(120_000),
              },
            );
            if (!providerResponse.ok) throw new Error(`ElevenLabs returned HTTP ${providerResponse.status}.`);
            response = { audio_data: Buffer.from(await providerResponse.arrayBuffer()).toString("base64") };
          }
        } else {
          const providerResponse = await fetch(proxyUrl || `${callbackUrl}/narration`, {
            method: "POST",
            headers: {
              ...(proxyUrl ? {} : { Authorization: `Bearer ${callbackToken}` }),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ index, text: segment.text }),
          });
          if (!providerResponse.ok) throw new Error(`Scoped narration failed with HTTP ${providerResponse.status}.`);
          const providerBody = await providerResponse.json();
          response = { audio_data: providerBody.audioData };
        }
      } catch (error) {
        const code = typeof error?.statusCode === "number" ? ` (${error.statusCode})` : "";
        fail(`Narration request failed${code}. Check the server key, voice, and account limits.`);
      }
      if (typeof response?.audio_data !== "string" || !response.audio_data) {
        fail("The narration provider returned no audio data.");
      }
      fs.writeFileSync(rawTarget, Buffer.from(response.audio_data, "base64"));
    }
    if (!fs.existsSync(target)) {
      run("ffmpeg", [
        "-y", "-i", rawTarget, "-af", CLEAN_FILTER,
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", trimmed,
      ]);
      run("ffmpeg", [
        "-y", "-i", trimmed, "-af", loudnormFilter(measureLoudness(trimmed)),
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", target,
      ]);
      fs.rmSync(trimmed, { force: true });
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
    // Short fades only exist to stop a click at the splice. On a very short
    // passage a fixed 100ms tail would eat the last word, so both edges stay a
    // fraction of the passage.
    const fadeIn = Math.min(0.025, audioDurations[index] / 8).toFixed(3);
    const fadeOut = Math.min(0.08, audioDurations[index] / 8);
    const fadeOutStart = Math.max(0, audioDurations[index] - fadeOut).toFixed(3);
    chains.push(
      `[${index}:a]afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(3)},` +
      `adelay=${Math.round(segment.start * 1000)}:all=1[${label}]`,
    );
    labels.push(`[${label}]`);
  });
  // Each passage is already at the target loudness, and passages never overlap,
  // so the mix needs no second normalisation pass.
  chains.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `apad,atrim=0:${duration.toFixed(3)}[aout]`,
  );
  ffmpeg.push(
    "-filter_complex", chains.join(";"), "-map", "[aout]",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", narrationAudio,
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
    provider: voice.provider,
    model,
    voice: voiceKey,
    voiceId: voice.voiceId,
    segments: normalized.length,
    segmentDurations: audioDurations.map((value) => Number(value.toFixed(3))),
    audioFormat: outputFormat,
    style: voice.provider === "elevenlabs" ? "expressive" : "warm",
    rate,
    loudness: `I=${LOUDNESS.i} TP=${LOUDNESS.tp} linear`,
    pausePolicy: "provider-padding-trimmed-spoken-pauses-preserved",
    disclosure: "AI-generated voice",
  }));
}

await main();
