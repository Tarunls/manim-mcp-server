/**
 * Narration: synthesise the script, measure it, and later mix it into a
 * rendered video at the times the timeline says.
 *
 * The audio is produced BEFORE the scene is written, so the timeline the
 * animator works from is the real one. The whole script is read in one
 * request wherever the provider allows, so the voice keeps its flow across
 * beats, and beat times come from the provider's word timestamps.
 */

import { SpeechifyClient } from "@speechify/api";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import voiceCatalog from "../shared/narration-voices.json" with { type: "json" };

const LOUDNESS = { i: -16, tp: -1.5, lra: 11 };
// Providers meter by characters per request; keep one read comfortably inside.
const MAX_CHARS_PER_REQUEST = 1800;
const REQUEST_SPACING_MS = 1_100;

// Trim only the provider's leading and trailing padding. Pauses inside a line
// are prosody and stay exactly as spoken.
const CLEAN_FILTER = [
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:start_silence=0.05",
  "areverse",
  "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB:start_silence=0.08",
  "areverse",
].join(",");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: options.timeout || 180_000 });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr || "").slice(-2500) || `${command} failed.`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

export function probeDuration(file) {
  const value = Number(run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Could not measure ${path.basename(file)}.`);
  return value;
}

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

// Two-pass loudness: measure, then apply one static gain. Single-pass loudnorm
// rides the gain and is heard as the voice surging and fading.
function loudnormFilter(measured) {
  const base = `loudnorm=I=${LOUDNESS.i}:TP=${LOUDNESS.tp}:LRA=${LOUDNESS.lra}`;
  if (!measured) return base;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}`
    + `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}`
    + `:offset=${measured.target_offset}:linear=true`;
}

/** One static gain for a clip: measured integrated loudness to the target,
 * clamped so a mis-measurement cannot blast or bury a line. Pure gain, no
 * dynamics, so nothing pumps inside the clip. */
function staticGainFilter(file) {
  const measured = measureLoudness(file);
  if (!measured) return "anull";
  const gain = Math.max(-12, Math.min(12, LOUDNESS.i - Number(measured.input_i)));
  return `volume=${gain.toFixed(2)}dB,alimiter=limit=0.891:attack=5:release=50:level=false`;
}

export function compactNarrationText(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the speech engine should be handed. The engines read "pi r" as the
 * letters P R; saying "pi times r" is what a person means by it. This touches
 * only the spoken text, never the storyboard. */
export function spokenText(value) {
  return compactNarrationText(value)
    .replace(/\bpi r\b/gi, (match) => (match[0] === "P" ? "Pi times r" : "pi times r"))
    .replace(/\bpi times r r\b/gi, "pi times r times r");
}

export function resolveVoice(voiceKey) {
  const key = Object.hasOwn(voiceCatalog, String(voiceKey)) ? String(voiceKey) : "default-female";
  return { key, ...voiceCatalog[key] };
}

/** Where the audio comes from: a provider key on this machine, the sandbox's
 * loopback bridge, or the job callback. Read from explicit options first and
 * the environment second, so a caller can pin the route. */
export function narrationProviderFromEnv(env = process.env) {
  return {
    speechifyKey: env.SPEECHIFY_API_KEY?.trim() || undefined,
    elevenLabsKey: env.ELEVENLABS_API_KEY?.trim() || undefined,
    proxyUrl: env.NARRATION_PROXY_URL?.trim() || undefined,
    callbackUrl: env.JOB_CALLBACK_URL?.trim() || undefined,
    callbackToken: env.JOB_CALLBACK_TOKEN?.trim() || undefined,
  };
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Speechify word marks -> [{start, end, startTime, endTime}] with character
 * offsets into the plain text and times in seconds. */
export function marksFromSpeechify(speechMarks) {
  const chunks = speechMarks?.chunks || [];
  return chunks
    .filter((chunk) => chunk && chunk.type === "word" && Number.isFinite(Number(chunk.start_time)))
    .map((chunk) => ({
      start: Number(chunk.start),
      end: Number(chunk.end),
      startTime: Number(chunk.start_time) / 1000,
      endTime: Number(chunk.end_time) / 1000,
    }));
}

/** ElevenLabs character alignment -> word marks. */
export function marksFromElevenLabs(alignment) {
  const characters = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const marks = [];
  let word = null;
  characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (word) marks.push(word);
      word = null;
      return;
    }
    if (!word) word = { start: index, end: index + 1, startTime: Number(starts[index]), endTime: Number(ends[index]) };
    else {
      word.end = index + 1;
      word.endTime = Number(ends[index]);
    }
  });
  if (word) marks.push(word);
  return marks;
}

function isRateLimited(error) {
  const message = String(error?.message || error || "");
  return /429|rate.?limit|concurrency|too many requests/i.test(message) || error?.statusCode === 429;
}

/** Providers meter narration tightly (Speechify's plan allows one request at
 * a time and one per second), so a 429 is normal and just means wait. */
async function requestAudioWithRetry(options) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (options.signal?.aborted) throw new Error("Narration was cancelled.");
    try {
      return await requestAudio(options);
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function requestAudio({ voice, text, index, provider, signal }) {
  const directKey = voice.provider === "elevenlabs" ? provider.elevenLabsKey : provider.speechifyKey;
  if (directKey) {
    if (voice.provider === "speechify") {
      const client = new SpeechifyClient({ token: directKey });
      const response = await client.audio.speech({
        input: `<speak><speechify:style emotion="warm">${escapeXml(text)}</speechify:style></speak>`,
        voice_id: voice.voiceId,
        model: "simba-3.2",
        audio_format: "mp3",
        output_format: "mp3_24000_160",
        language: "en-US",
      }, { timeoutInSeconds: 120 });
      if (!response?.audio_data) throw new Error("Speechify returned no audio data.");
      return {
        audio: Buffer.from(response.audio_data, "base64"),
        marks: marksFromSpeechify(response.speech_marks),
        provider: "speechify",
        model: "simba-3.2",
      };
    }
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": directKey },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 1 },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
    const body = await response.json();
    if (typeof body?.audio_base64 !== "string" || !body.audio_base64) throw new Error("ElevenLabs returned no audio data.");
    return {
      audio: Buffer.from(body.audio_base64, "base64"),
      marks: marksFromElevenLabs(body.alignment),
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
    };
  }
  const url = provider.proxyUrl || (provider.callbackUrl ? `${provider.callbackUrl.replace(/\/$/, "")}/narration` : undefined);
  if (!url) throw new Error("No narration provider is configured. Set SPEECHIFY_API_KEY or ELEVENLABS_API_KEY.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(provider.proxyUrl ? {} : { Authorization: `Bearer ${provider.callbackToken}` }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ index, text }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Narration request failed with HTTP ${response.status}.`);
  const body = await response.json();
  if (typeof body?.audioData !== "string" || !body.audioData) throw new Error("The narration provider returned no audio data.");
  return {
    audio: Buffer.from(body.audioData, "base64"),
    marks: Array.isArray(body.marks) ? body.marks : [],
    provider: typeof body.provider === "string" ? body.provider : voice.provider,
    model: typeof body.model === "string" ? body.model : undefined,
  };
}

function cacheKeyFor(voice, text) {
  return createHash("sha256").update(JSON.stringify({ text, voiceKey: voice.key, voiceId: voice.voiceId })).digest("hex").slice(0, 16);
}

/** Fetch (or reuse) the raw provider audio and marks for one text. */
async function fetchClip({ audioDir, voice, text, index, provider, signal, providerInfo }) {
  const key = cacheKeyFor(voice, text);
  const raw = path.join(audioDir, `${voice.provider}-${key}-raw.mp3`);
  const marksFile = path.join(audioDir, `${voice.provider}-${key}-marks.json`);
  if (!fs.existsSync(raw) || !fs.existsSync(marksFile)) {
    const response = await requestAudioWithRetry({ voice, text, index, provider, signal });
    fs.writeFileSync(raw, response.audio);
    fs.writeFileSync(marksFile, JSON.stringify(response.marks || []));
    providerInfo.provider = response.provider || providerInfo.provider;
    providerInfo.model = response.model || providerInfo.model;
    // One request per second is the tightest plan limit among the providers.
    await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
  }
  let marks = [];
  try {
    marks = JSON.parse(fs.readFileSync(marksFile, "utf8"));
  } catch {
    marks = [];
  }
  return { key, raw, marks };
}

/** Decode to PCM and apply one static gain. Nothing is trimmed, so the
 * provider's word timestamps stay valid. */
function levelClip(raw, target) {
  if (fs.existsSync(target)) return;
  const decoded = `${target}.decoded.wav`;
  run("ffmpeg", ["-y", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", decoded]);
  run("ffmpeg", ["-y", "-i", decoded, "-af", staticGainFilter(decoded), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", target]);
  fs.rmSync(decoded, { force: true });
}

/**
 * Read the script as continuously as the provider allows.
 *
 * Consecutive narrated beats are joined into one request (up to the
 * per-request character limit), so the voice flows from line to line instead
 * of restarting at each beat. Each beat's start and end come from the word
 * timestamps of that read. A silent beat between two narrated ones breaks the
 * run, since a gap has to be inserted there.
 *
 * Returns { chunks, provider, model, voice, voiceId }. Each chunk:
 *   { text, audio, duration, beats: [{ id, startOffset, endOffset }] }
 * where offsets are seconds from the start of the chunk's audio.
 */
export async function synthesizeScript({ projectDir, beats, voiceKey, provider, signal }) {
  const voice = resolveVoice(voiceKey);
  const audioDir = path.join(projectDir, ".narration");
  fs.mkdirSync(audioDir, { recursive: true });
  const providerInfo = { provider: voice.provider, model: undefined };

  // Group consecutive narrated beats into requests.
  const groups = [];
  let current = null;
  for (const beat of beats) {
    const text = spokenText(beat.narration);
    if (!text) {
      current = null;
      continue;
    }
    if (!current || current.length + 1 + text.length > MAX_CHARS_PER_REQUEST) {
      current = { items: [], length: 0 };
      groups.push(current);
    }
    current.items.push({ id: beat.id, text });
    current.length += (current.items.length > 1 ? 1 : 0) + text.length;
  }

  const chunks = [];
  for (const [index, group] of groups.entries()) {
    if (signal?.aborted) throw new Error("Narration was cancelled.");
    const spans = [];
    let joined = "";
    for (const item of group.items) {
      if (joined) joined += " ";
      spans.push({ id: item.id, start: joined.length, end: joined.length + item.text.length, text: item.text });
      joined += item.text;
    }
    const { key, raw, marks } = await fetchClip({ audioDir, voice, text: joined, index, provider, signal, providerInfo });
    const clean = path.join(audioDir, `${voice.provider}-${key}-script.wav`);
    levelClip(raw, clean);
    const duration = probeDuration(clean);
    const beatTimes = spans.map((span) => {
      const words = marks.filter((mark) => mark.start >= span.start && mark.end <= span.end && Number.isFinite(mark.startTime));
      if (words.length) {
        return {
          id: span.id,
          startOffset: Number(Math.min(...words.map((word) => word.startTime)).toFixed(3)),
          endOffset: Number(Math.min(duration, Math.max(...words.map((word) => word.endTime))).toFixed(3)),
        };
      }
      // No timestamps from this provider: share the read by character count.
      return {
        id: span.id,
        startOffset: Number(((span.start / joined.length) * duration).toFixed(3)),
        endOffset: Number(((span.end / joined.length) * duration).toFixed(3)),
      };
    });
    chunks.push({ text: joined, audio: path.relative(projectDir, clean), duration: Number(duration.toFixed(3)), beats: beatTimes, hasMarks: marks.length > 0 });
  }
  return { chunks, voice: voice.key, voiceId: voice.voiceId, ...providerInfo };
}

/**
 * Synthesise every line separately and return its cleaned clip and duration.
 * Kept for callers that want one clip per line; the pipeline reads the whole
 * script with synthesizeScript.
 */
export async function synthesizeSegments({ projectDir, texts, voiceKey, provider, signal }) {
  const voice = resolveVoice(voiceKey);
  const audioDir = path.join(projectDir, ".narration");
  fs.mkdirSync(audioDir, { recursive: true });
  const providerInfo = { provider: voice.provider, model: undefined };
  const results = [];
  for (const [index, value] of texts.entries()) {
    if (signal?.aborted) throw new Error("Narration was cancelled.");
    const text = spokenText(value);
    if (!text) {
      results.push(undefined);
      continue;
    }
    const { key, raw } = await fetchClip({ audioDir, voice, text, index, provider, signal, providerInfo });
    const trimmed = path.join(audioDir, `${voice.provider}-${key}-trim.wav`);
    const clean = path.join(audioDir, `${voice.provider}-${key}-clean.wav`);
    if (!fs.existsSync(clean)) {
      run("ffmpeg", ["-y", "-i", raw, "-af", CLEAN_FILTER, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", trimmed]);
      run("ffmpeg", ["-y", "-i", trimmed, "-af", loudnormFilter(measureLoudness(trimmed)), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", clean]);
      fs.rmSync(trimmed, { force: true });
    }
    results.push({ text, audio: path.relative(projectDir, clean), duration: Number(probeDuration(clean).toFixed(3)) });
  }
  return { segments: results, voice: voice.key, voiceId: voice.voiceId, ...providerInfo };
}

/** Lay clips end to end with a breath between them. Returns start/end pairs. */
export function buildTimeline(durations, { lead = 0.4, gap = 0.45 } = {}) {
  const timeline = [];
  let clock = lead;
  for (const duration of durations) {
    const start = Number(clock.toFixed(3));
    const end = Number((clock + duration).toFixed(3));
    timeline.push({ start, end });
    clock = end + gap;
  }
  return timeline;
}

/**
 * Mix the clips at their start times and attach the result to the video.
 * If the picture ends before the voice does, the last frame is held rather
 * than the voice being cut.
 */
export function muxNarration({ projectDir, video, segments, voice }) {
  const placed = segments
    .filter((segment) => segment && segment.audio)
    .map((segment) => ({
      start: Math.max(0, Number(segment.start) || 0),
      file: path.isAbsolute(segment.audio) ? segment.audio : path.join(projectDir, segment.audio),
    }))
    .sort((a, b) => a.start - b.start);
  if (!placed.length) throw new Error("There are no narration clips to mix.");
  for (const clip of placed) {
    if (!fs.existsSync(clip.file)) throw new Error(`Narration clip is missing: ${path.basename(clip.file)}`);
    clip.duration = probeDuration(clip.file);
  }
  let videoDuration = probeDuration(video);
  const audioEnd = Math.max(...placed.map((clip) => clip.start + clip.duration));
  const tail = audioEnd + 0.4 - videoDuration;
  if (tail > 0.05) {
    const padded = path.join(projectDir, "output.padded.mp4");
    run("ffmpeg", [
      "-y", "-i", video,
      "-vf", `tpad=stop_mode=clone:stop_duration=${tail.toFixed(3)}`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-an", "-movflags", "+faststart", padded,
    ], { timeout: 600_000 });
    fs.renameSync(padded, video);
    videoDuration = probeDuration(video);
  }

  const narrationAudio = path.join(projectDir, "narration.m4a");
  const args = ["-y"];
  for (const clip of placed) args.push("-i", clip.file);
  const chains = [];
  const labels = [];
  placed.forEach((clip, index) => {
    const label = `a${index}`;
    const fadeIn = Math.min(0.025, clip.duration / 8).toFixed(3);
    const fadeOut = Math.min(0.08, clip.duration / 8);
    const fadeOutStart = Math.max(0, clip.duration - fadeOut).toFixed(3);
    chains.push(
      `[${index}:a]afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(3)},`
      + `adelay=${Math.round(clip.start * 1000)}:all=1[${label}]`,
    );
    labels.push(`[${label}]`);
  });
  chains.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,`
    + `apad,atrim=0:${videoDuration.toFixed(3)}[aout]`,
  );
  args.push("-filter_complex", chains.join(";"), "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", narrationAudio);
  run("ffmpeg", args, { timeout: 300_000 });

  const muxed = path.join(projectDir, "output.narrated.mp4");
  run("ffmpeg", [
    "-y", "-i", video, "-i", narrationAudio,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy",
    "-movflags", "+faststart", "-shortest", muxed,
  ], { timeout: 300_000 });
  fs.renameSync(muxed, video);

  return {
    status: "ready",
    enabled: true,
    provider: voice?.provider,
    model: voice?.model,
    voice: voice?.key,
    voiceId: voice?.voiceId,
    segments: placed.length,
    segmentDurations: placed.map((clip) => Number(clip.duration.toFixed(3))),
    starts: placed.map((clip) => clip.start),
    paddedSeconds: tail > 0.05 ? Number(tail.toFixed(3)) : 0,
    disclosure: "AI-generated voice",
  };
}
