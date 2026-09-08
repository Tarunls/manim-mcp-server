#!/usr/bin/env node
/**
 * Attach narration to a rendered project video.
 *
 * narration.json holds one segment per spoken line: {text, start, end, audio,
 * duration}. The pipeline normally writes the clips and the timeline before
 * the scene exists, so this step only mixes. Lines that have no clip yet are
 * synthesised here, and a missing timeline is laid out end to end.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildTimeline,
  muxNarration,
  narrationProviderFromEnv,
  resolveVoice,
  synthesizeSegments,
} from "./narration.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (process.argv.length !== 3) fail("Usage: generate_narration.mjs PROJECT_DIR");
  const projectDir = path.resolve(process.argv[2]);
  const video = path.join(projectDir, "output.mp4");
  const specPath = path.join(projectDir, "narration.json");
  if (!fs.existsSync(video) || !fs.existsSync(specPath)) fail("output.mp4 and narration.json are required.");

  let narrationPreferences = { enabled: true, voice: "default-female" };
  const configPath = path.join(projectDir, "narration-config.json");
  if (fs.existsSync(configPath)) {
    try {
      narrationPreferences = { ...narrationPreferences, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
    } catch {
      fail("narration-config.json must contain valid JSON.");
    }
  }

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  } catch (error) {
    fail(`Invalid narration.json: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  const segments = Array.isArray(spec?.segments) ? spec.segments : [];
  if (!segments.length) fail("narration.json has no segments.");

  const voice = resolveVoice(narrationPreferences.voice);
  const missing = segments.some((segment) => !segment.audio || !fs.existsSync(path.join(projectDir, segment.audio)));
  let providerInfo = { provider: spec.provider || voice.provider, model: spec.model, key: voice.key, voiceId: voice.voiceId };
  if (missing) {
    const synthesized = await synthesizeSegments({
      projectDir,
      texts: segments.map((segment) => String(segment.text || "")),
      voiceKey: voice.key,
      provider: narrationProviderFromEnv(),
    });
    synthesized.segments.forEach((clip, index) => {
      if (clip) Object.assign(segments[index], { audio: clip.audio, duration: clip.duration, text: clip.text });
    });
    providerInfo = { provider: synthesized.provider, model: synthesized.model, key: synthesized.voice, voiceId: synthesized.voiceId };
  }
  const spoken = segments.filter((segment) => segment.audio);
  if (spoken.some((segment) => !Number.isFinite(Number(segment.start)))) {
    const timeline = buildTimeline(spoken.map((segment) => Number(segment.duration)));
    spoken.forEach((segment, index) => Object.assign(segment, timeline[index]));
  }
  fs.writeFileSync(specPath, JSON.stringify({ ...spec, segments, provider: providerInfo.provider, model: providerInfo.model }, null, 2));

  const result = muxNarration({ projectDir, video, segments: spoken, voice: providerInfo });
  console.log(JSON.stringify(result));
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
