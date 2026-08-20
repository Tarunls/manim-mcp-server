import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { alignTimelineToNarration, muxSpeechifyNarration, prepareSpeechifyNarration } from "./narration-worker.js";
import { writeProjectBundle } from "./project-bundle.js";

test("measured Speechify timing extends its visual shot and keeps the timeline sequential", () => {
  const project = createEmptyVideoIR("narrated", "Narrated");
  project.storyboard = [
    { id: "beat-1", title: "First", purpose: "Open", narration: "First", visual: "Title", renderer: "remotion", duration: 3, assetQueries: [] },
    { id: "beat-2", title: "Second", purpose: "Explain", narration: "Second", visual: "Diagram", renderer: "manim", duration: 3, assetQueries: [] },
  ];
  project.shots = [
    { id: "shot-1", name: "First", intent: "Open", start: 0, duration: 3, renderer: "remotion", status: "ready", tracks: [] },
    { id: "shot-2", name: "Second", intent: "Explain", start: 3, duration: 3, renderer: "manim", status: "ready", tracks: [] },
  ];
  const spec = { segments: [{ start: 0, text: "First" }, { start: 3, text: "Second" }] };
  const timing = {
    provider: "speechify",
    model: "simba-3.2",
    voice: "geffen_32",
    recommendedDuration: 8,
    segments: [
      { start: 0, end: 2, duration: 2, text: "First" },
      { start: 3, end: 7.2, duration: 4.2, text: "Second" },
    ],
  };
  const aligned = alignTimelineToNarration(project, spec, timing);
  assert.equal(aligned.timeline.shots[0].duration, 3);
  assert.equal(aligned.timeline.shots[1].start, 3);
  assert.equal(aligned.timeline.shots[1].duration, 4.55);
  assert.equal(aligned.timeline.format.duration, 7.55);
  assert.equal(aligned.spec.segments[1].start, 3);
  assert.equal(aligned.timeline.storyboard[1].duration, 4.55);
});

test("an empty narration spec skips Speechify without failing the render", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-no-narration-"));
  const project = createEmptyVideoIR("silent", "Silent");
  writeProjectBundle(projectDir, project);
  fs.writeFileSync(path.join(projectDir, "narration.json"), '{"segments":[]}\n');
  assert.equal(await prepareSpeechifyNarration("/missing", projectDir, project), project);
  assert.deepEqual(await muxSpeechifyNarration("/missing", projectDir), { status: "not_requested", enabled: false });
});
