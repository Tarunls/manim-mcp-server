#!/usr/bin/env node
/** Generate timed narration segments and mux them into a project video. */

import { SpeechifyClient } from "@speechify/api";
import { execFileSync } from "node:child_process";
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
  const rate = voice.provider === "elevenlabs" ? "1.08x" : "+8%";
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
    const ssml = `<speak><speechify:style emotion="warm"><prosody rate="+8%">${escapeXml(segment.text)}</prosody></speechify:style></speak>`;
    const cacheKey = createHash("sha256").update(JSON.stringify({ text: segment.text, voiceKey, voiceId: voice.voiceId, model, outputFormat, rate })).digest("hex").slice(0, 16);
    const rawTarget = path.join(audioDir, `${voice.provider}-${cacheKey}-raw.mp3`);
    const target = path.join(audioDir, `${voice.provider}-${cacheKey}-compact.mp3`);
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
                    speed: 1.08,
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
        "-y", "-i", rawTarget,
        "-af",
        "silenceremove=start_periods=1:start_duration=0.04:start_threshold=-45dB:start_silence=0.03:" +
          "stop_periods=-1:stop_duration=0.45:stop_threshold=-45dB:stop_silence=0.18",
        "-c:a", "libmp3lame", "-b:a", "160k", target,
      ]);
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
    provider: voice.provider,
    model,
    voice: voiceKey,
    voiceId: voice.voiceId,
    segments: normalized.length,
    segmentDurations: audioDurations.map((value) => Number(value.toFixed(3))),
    audioFormat: outputFormat,
    style: voice.provider === "elevenlabs" ? "expressive" : "warm",
    rate,
    pausePolicy: "silence-over-450ms-capped-at-180ms",
    disclosure: "AI-generated voice",
  }));
}

await main();
