import assert from "node:assert/strict";
import test from "node:test";
import { productionRequest } from "./planning.js";

test("production requests stop after authoring and leave privileged work to the host", () => {
  const request = productionRequest("Explain orbital motion", false);
  assert.match(request, /project\.json/);
  assert.match(request, /validate_project/);
  assert.match(request, /host worker/);
  assert.match(request, /Do not render/);
  assert.doesNotMatch(request, /generate_narration/);
  assert.doesNotMatch(request, /render_project/);
});

test("revision requests constrain edits to the smallest project region", () => {
  const request = productionRequest("Make the second title blue", true);
  assert.match(request, /Revise the existing/);
  assert.match(request, /smallest possible portion/);
});
