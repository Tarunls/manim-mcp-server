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
