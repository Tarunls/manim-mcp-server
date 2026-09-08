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

export interface WordMark {
  start: number;
  end: number;
  startTime: number;
  endTime: number;
}

/** Speechify word marks -> character offsets and seconds. */
export function marksFromSpeechify(speechMarks: unknown): WordMark[] {
  const chunks = (speechMarks as { chunks?: Array<Record<string, unknown>> } | undefined)?.chunks || [];
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
export function marksFromElevenLabs(alignment: unknown): WordMark[] {
  const data = (alignment || {}) as {
    characters?: string[];
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
  };
  const characters = data.characters || [];
  const starts = data.character_start_times_seconds || [];
  const ends = data.character_end_times_seconds || [];
  const marks: WordMark[] = [];
  let word: WordMark | null = null;
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
