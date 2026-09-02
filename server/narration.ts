import voiceCatalog from "../shared/narration-voices.json";
import type { NarrationVoice } from "./types.js";

export const DEFAULT_NARRATION_VOICE: NarrationVoice = "default-female";
export const ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
// Providers synthesise prosody for natural delivery; asking them to speak
// off-tempo warps that synthesis and is heard as stumbling and drifting pace.
// Pacing belongs in how much text a passage carries, not in a speed multiplier.
export const NARRATION_SPEED = 1;

export function narrationVoiceOrDefault(value: unknown): NarrationVoice {
  return Object.hasOwn(voiceCatalog, String(value))
    ? (value as NarrationVoice)
    : DEFAULT_NARRATION_VOICE;
}

export function narrationVoiceDefinition(value: unknown) {
  const key = narrationVoiceOrDefault(value);
  return { key, ...voiceCatalog[key] };
}

export function compactNarrationText(value: string) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\.{3,}|…+/g, ".")
    .replace(/([!?])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
