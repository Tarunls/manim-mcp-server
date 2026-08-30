import assert from "node:assert/strict";
import test from "node:test";

import { completionMessage } from "../server/hosted-generation-service.js";
import { generationPreferencesFor, looksLikeIndependentVideoRequest } from "../server/studio-service.js";
import type { StudioProject } from "../server/types.js";

const project = { prompt: "Create a video explaining Fourier transforms" } as StudioProject;

test("standalone and repeated video briefs start independently", () => {
  assert.equal(looksLikeIndependentVideoRequest("Create a video explaining integrals", project), true);
  assert.equal(looksLikeIndependentVideoRequest("Create a video explaining Fourier transforms", project), true);
  assert.equal(looksLikeIndependentVideoRequest("Explain gradient descent visually", project), true);
});

test("localized change requests remain revisions", () => {
  assert.equal(looksLikeIndependentVideoRequest("Make the title black", project), false);
  assert.equal(looksLikeIndependentVideoRequest("Move this label left", project), false);
});

test("the completion note describes the video, never the agent's build report", () => {
  assert.equal(
    completionMessage(1, { duration: 43.56, narration: { hasAudio: true } }),
    "First draft ready - 44 seconds, with narration.",
  );
  assert.equal(
    completionMessage(2, { duration: 20, narration: { hasAudio: false } }),
    "Revision 2 ready - 20 seconds.",
  );
  // A render we could not measure still reads as a finished draft.
  assert.equal(completionMessage(1, undefined), "First draft ready.");
});

test("the chosen frame survives, because it decides how the scene is written", () => {
  assert.equal(generationPreferencesFor("balanced").format, "landscape");
  assert.equal(generationPreferencesFor("thorough", "vertical").format, "vertical");
  // Raising the effort on a vertical project must not quietly send it back to
  // widescreen: the grid, not just the output size, depends on this.
  assert.equal(generationPreferencesFor("quick", "vertical").format, "vertical");
});
