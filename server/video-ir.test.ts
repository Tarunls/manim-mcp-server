import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVideoIR, validateVideoIR } from "../shared/video-ir.js";

test("empty projects conform to the video IR", () => {
  const project = createEmptyVideoIR("project-1", "Example", "Make an example");
  assert.deepEqual(validateVideoIR(project), { valid: true, errors: [] });
});

test("clips may not reference missing assets", () => {
  const project = createEmptyVideoIR("project-1", "Example");
  project.shots.push({
    id: "shot-1",
    name: "Opening",
    intent: "Introduce the idea",
    start: 0,
    duration: 4,
    renderer: "remotion",
    status: "planned",
    tracks: [{
      id: "track-1",
      name: "Titles",
      kind: "overlay",
      muted: false,
      locked: false,
      clips: [{
        id: "clip-1",
        name: "Title",
        kind: "asset",
        renderer: "remotion",
        start: 0,
        duration: 2,
        assetId: "missing",
        transform: { x: 0, y: 0, width: 800, height: 200, rotation: 0, opacity: 1, scale: 1 },
        animations: [],
        style: {},
        metadata: {},
      }],
    }],
  });
  const result = validateVideoIR(project);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /missing asset/);
});
