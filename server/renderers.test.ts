import assert from "node:assert/strict";
import test from "node:test";
import { recommendRenderer, routeProjectShots } from "../shared/renderers.js";
import { createEmptyVideoIR } from "../shared/video-ir.js";

test("routes specialized shots without forcing them through one engine", () => {
  assert.equal(recommendRenderer("Animate a quadratic equation"), "manim");
  assert.equal(recommendRenderer("A cinematic person walking through a forest"), "generated");
  assert.equal(recommendRenderer("A 3D product render with orbit camera"), "blender");
  assert.equal(recommendRenderer("Kinetic title and captions"), "remotion");
});

test("routes all project shots as an editable transform", () => {
  const project = createEmptyVideoIR("route", "Route");
  project.shots.push({
    id: "shot",
    name: "Graph",
    intent: "Explain a graph",
    start: 0,
    duration: 2,
    renderer: "remotion",
    status: "planned",
    tracks: [],
  });
  const routed = routeProjectShots(project);
  assert.equal(routed.shots[0].renderer, "manim");
  assert.equal(project.shots[0].renderer, "remotion");
});
