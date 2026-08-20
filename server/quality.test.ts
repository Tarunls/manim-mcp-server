import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { inspectProject } from "./quality/project-quality.js";

test("quality inspection catches unsafe text and missing asset provenance", () => {
  const project = createEmptyVideoIR("quality", "Quality test");
  project.format.duration = 4;
  project.storyboard.push({
    id: "beat-1",
    title: "Opening",
    purpose: "Introduce the concept",
    narration: "",
    visual: "A title",
    renderer: "remotion",
    duration: 4,
    assetQueries: [],
  });
  project.assets.push({
    id: "asset-1",
    kind: "image",
    name: "Unverified image",
    localPath: "assets/image.png",
    provider: "upload",
    license: { name: "", commercialUse: true, modifications: true, attributionRequired: false },
    tags: [],
    provenance: {},
  });
  project.shots.push({
    id: "shot-1",
    name: "Opening",
    intent: "Title",
    start: 0,
    duration: 4,
    renderer: "remotion",
    status: "ready",
    tracks: [{
      id: "track-1",
      name: "Titles",
      kind: "overlay",
      muted: false,
      locked: false,
      clips: [{
        id: "clip-1",
        name: "Tiny title",
        kind: "text",
        renderer: "remotion",
        start: 0,
        duration: 4,
        text: "Title",
        transform: { x: -900, y: 0, width: 400, height: 100, rotation: 0, opacity: 1, scale: 1 },
        animations: [],
        style: { fontSize: 24, color: "#aaaaaa", background: "#ffffff" },
        metadata: {},
      }],
    }],
  });

  const checks = inspectProject(project);
  assert.ok(checks.some((item) => item.id === "safe-area" && item.severity === "error"));
  assert.ok(checks.some((item) => item.id === "small-text" && item.severity === "warning"));
  assert.ok(checks.some((item) => item.id === "contrast" && item.severity === "error"));
  assert.ok(checks.some((item) => item.id === "asset-license" && item.severity === "error"));
  assert.ok(checks.some((item) => item.id === "asset-hash" && item.severity === "error"));
});

test("full-bleed visual clips are exempt from title-safe checks", () => {
  const project = createEmptyVideoIR("bleed", "Full bleed");
  project.storyboard.push({ id: "beat", title: "Visual", purpose: "Fill frame", narration: "", visual: "Color", renderer: "remotion", duration: 12, assetQueries: [] });
  project.shots.push({
    id: "shot",
    name: "Visual",
    intent: "Fill frame",
    start: 0,
    duration: 12,
    renderer: "remotion",
    status: "ready",
    tracks: [{
      id: "track",
      name: "Background",
      kind: "video",
      muted: false,
      locked: false,
      clips: [{
        id: "clip",
        name: "Canvas",
        kind: "shape",
        renderer: "remotion",
        start: 0,
        duration: 12,
        transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, scale: 1 },
        animations: [],
        style: { background: "#ffffff" },
        metadata: {},
      }],
    }],
  });

  assert.equal(inspectProject(project).some((item) => item.id === "safe-area"), false);
});

test("quality inspection tolerates optional AI-authored clip metadata", () => {
  const project = createEmptyVideoIR("metadata", "Metadata");
  project.storyboard.push({ id: "beat", title: "Title", purpose: "Open", narration: "", visual: "Title", renderer: "remotion", duration: 2, assetQueries: [] });
  project.shots.push({
    id: "shot", name: "Shot", intent: "Open", start: 0, duration: 2, renderer: "remotion", status: "ready",
    tracks: [{
      id: "track", name: "Type", kind: "overlay", muted: false, locked: false,
      clips: [{
        id: "title", name: "Title", kind: "text", renderer: "remotion", start: 0, duration: 2, text: "Readable",
        transform: { x: 0, y: 0, width: 800, height: 160, rotation: 0, opacity: 1, scale: 1 },
        animations: [], style: { fontSize: 72, color: "#1d1d1b" }, metadata: undefined as never,
      }],
    }],
  });
  assert.doesNotThrow(() => inspectProject(project));
});
