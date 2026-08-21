import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeIndependentVideoRequest } from "../server/studio-service.js";
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
