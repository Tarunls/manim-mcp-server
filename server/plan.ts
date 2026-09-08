import type { GenerationEffort } from "./types.js";

export function effortRank(effort: GenerationEffort) {
  return effort === "thorough" ? 3 : effort === "balanced" ? 2 : 1;
}

export function generationCost(effort: GenerationEffort) {
  return effort === "thorough" ? 4 : effort === "balanced" ? 2 : 1;
}

export function titleFromPrompt(prompt: string) {
  return prompt.replace(/[^a-zA-Z0-9\s-]/g, " ").trim().split(/\s+/).slice(0, 5).join(" ") || "Untitled video";
}

/** What the owner reads when a draft lands, written from the probed file so
 * it can never disagree with the video. */
export function completionMessage(number: number, render: { duration?: number; narration?: { hasAudio?: boolean } } | undefined) {
  const opening = number === 1 ? "First draft ready" : `Revision ${number} ready`;
  const seconds = Math.round(Number(render?.duration) || 0);
  if (!seconds) return `${opening}.`;
  const narrated = render?.narration?.hasAudio ? ", with narration" : "";
  return `${opening} - ${seconds} seconds${narrated}.`;
}
