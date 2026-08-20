import assert from "node:assert/strict";
import test from "node:test";
import { productionRequest } from "./planning.js";

test("production requests enforce planning and audio-first gates", () => {
  const request = productionRequest("Explain orbital motion", false);
  assert.match(request, /project\.json/);
  assert.match(request, /validate_project/);
  assert.match(request, /--prepare/);
  assert.match(request, /actual speech/);
});

test("revision requests constrain edits to the smallest project region", () => {
  const request = productionRequest("Make the second title blue", true);
  assert.match(request, /Revise the existing/);
  assert.match(request, /smallest possible portion/);
});
