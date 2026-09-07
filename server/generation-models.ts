import policies from "../e2b/generation-models.json";
import type { AgentModel, AgentReasoningEffort, GenerationEffort } from "./types.js";

// Shared with the sandbox bootstrap so local, hosted and proxy routing agree.
export function generationModelPolicy(effort: GenerationEffort): {
  model: AgentModel;
  reasoningEffort: AgentReasoningEffort;
} {
  return { ...policies[effort] } as { model: AgentModel; reasoningEffort: AgentReasoningEffort };
}
