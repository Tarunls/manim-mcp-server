import { createEmptyVideoIR, type RendererKind, type VideoClip, type VideoProjectIR } from "../../shared/video-ir.js";

export interface RegressionCase {
  id: string;
  expectedRenderer: RendererKind;
  project: VideoProjectIR;
}

function project(id: string, title: string, duration: number, width = 1920, height = 1080) {
  const value = createEmptyVideoIR(id, title, title);
  value.format = { width, height, fps: 30, duration, colorSpace: "rec709", background: "#f7f7f5" };
  value.design.safeArea = Math.round(Math.min(width, height) * 0.06);
  return value;
}

function beat(value: VideoProjectIR, renderer: RendererKind, duration: number, visual: string, narration = "") {
  value.storyboard.push({ id: `${value.id}-beat`, title: value.title, purpose: "Communicate one clear idea", narration, visual, renderer, duration, assetQueries: [] });
}

function clip(id: string, kind: VideoClip["kind"], text: string | undefined, duration: number, transform: Partial<VideoClip["transform"]> = {}, style: VideoClip["style"] = {}): VideoClip {
  return {
    id,
    name: text || id,
    kind,
    renderer: "remotion",
    start: 0,
    duration,
    text,
    transform: { x: 0, y: 0, width: 1100, height: 260, rotation: 0, opacity: 1, scale: 1, ...transform },
    animations: [{ property: "opacity", keyframes: [{ time: 0, value: 0 }, { time: 0.35, value: 1 }] }],
    style: { color: "#1d1d1b", fontSize: 72, fontWeight: 700, ...style },
    metadata: {},
  };
}

function remotionCase() {
  const value = project("editorial-title", "Why simple systems scale", 6);
  beat(value, "remotion", 6, "Large editorial title with a supporting rule");
  value.shots.push({
    id: "editorial-shot",
    name: "Editorial title",
    intent: "Minimal editorial typography",
    start: 0,
    duration: 6,
    renderer: "remotion",
    status: "ready",
    tracks: [{ id: "editorial-track", name: "Type", kind: "overlay", muted: false, locked: false, clips: [
      clip("editorial-heading", "text", "Simple systems scale", 6, { y: -90, width: 1260, height: 240 }, { fontSize: 104 }),
      clip("editorial-rule", "shape", undefined, 6, { y: 90, width: 620, height: 8 }, { background: "#d95c32" }),
    ] }],
  });
  return { id: value.id, expectedRenderer: "remotion" as const, project: value };
}

function mathCase() {
  const value = project("math-diagram", "The derivative as local slope", 8);
  beat(value, "manim", 8, "Axes, a curve, and a moving tangent", "The tangent line reveals how quickly the curve changes at one point.");
  value.shots.push({
    id: "math-shot",
    name: "Moving tangent",
    intent: "Explain a calculus graph with a moving tangent line",
    start: 0,
    duration: 8,
    renderer: "manim",
    status: "ready",
    metadata: { sceneFile: "scene.py", sceneClass: "GeneratedScene" },
    tracks: [{ id: "math-track", name: "Diagram", kind: "video", muted: false, locked: false, clips: [clip("math-diagram-clip", "diagram", undefined, 8, { width: 1500, height: 760 })] }],
  });
  return { id: value.id, expectedRenderer: "manim" as const, project: value };
}

function verticalCase() {
  const value = project("vertical-social", "Three signals of a strong idea", 7, 1080, 1920);
  beat(value, "remotion", 7, "A large number and readable lower caption");
  value.shots.push({
    id: "vertical-shot",
    name: "Signal one",
    intent: "Vertical social title card",
    start: 0,
    duration: 7,
    renderer: "remotion",
    status: "ready",
    tracks: [{ id: "vertical-track", name: "Captions", kind: "captions", muted: false, locked: false, clips: [
      clip("vertical-number", "text", "01", 7, { y: -280, width: 700, height: 360 }, { fontSize: 210, color: "#9b3d1f" }),
      clip("vertical-caption", "caption", "People repeat it without prompting.", 7, { y: 430, width: 860, height: 260 }, { fontSize: 58, lineHeight: 1.15 }),
    ] }],
  });
  return { id: value.id, expectedRenderer: "remotion" as const, project: value };
}

function narrationCase() {
  const value = project("narrated-explainer", "How feedback compounds", 8);
  beat(value, "remotion", 8, "A loop diagram and concise label", "A fast feedback loop turns every attempt into information for the next one.");
  value.shots.push({
    id: "narrated-shot",
    name: "Feedback loop",
    intent: "Explain a feedback loop with readable labels",
    start: 0,
    duration: 8,
    renderer: "remotion",
    status: "ready",
    tracks: [{ id: "narrated-track", name: "Labels", kind: "overlay", muted: false, locked: false, clips: [clip("narrated-title", "text", "Attempt → Signal → Better attempt", 8, { width: 1460, height: 240 }, { fontSize: 76 })] }],
  });
  value.narration.push({
    id: "narration-1",
    start: 0.4,
    end: 6.8,
    text: "A fast feedback loop turns every attempt into information for the next one.",
    words: [{ text: "A", start: 0.4, end: 0.7 }, { text: "fast", start: 0.7, end: 1.1 }, { text: "feedback", start: 1.1, end: 1.7 }, { text: "loop", start: 1.7, end: 2.1 }],
  });
  return { id: value.id, expectedRenderer: "remotion" as const, project: value };
}

function generatedCase() {
  const value = project("generated-footage", "A city learning to breathe", 8);
  beat(value, "generated", 8, "Aerial cinematic footage of a green city");
  value.shots.push({
    id: "generated-shot",
    name: "Living city",
    intent: "Cinematic aerial nature footage through a sustainable city",
    start: 0,
    duration: 8,
    renderer: "generated",
    status: "ready",
    metadata: { generationPrompt: "Slow aerial push through a quiet sustainable city at sunrise, rooftop gardens moving in a light breeze, realistic materials, stable architecture, gentle natural light" },
    tracks: [],
  });
  return { id: value.id, expectedRenderer: "generated" as const, project: value };
}

function blenderCase() {
  const value = project("product-3d", "A precise product reveal", 6);
  beat(value, "blender", 6, "A lit 3D product turntable");
  value.shots.push({
    id: "blender-shot",
    name: "Product reveal",
    intent: "3D product render with an orbit camera and controlled lighting",
    start: 0,
    duration: 6,
    renderer: "blender",
    status: "ready",
    metadata: {
      blenderScene: {
        worldColor: [0.025, 0.028, 0.03, 1],
        camera: { location: [0, -8, 3.5], target: [0, 0, 0.4], lens: 58 },
        lights: [{ type: "AREA", location: [4, -4, 6], target: [0, 0, 0], energy: 1400, size: 5 }],
        objects: [{ name: "Product", primitive: "cylinder", location: [0, 0, 0], scale: [1.4, 1.4, 1.8], color: [0.83, 0.32, 0.16, 1], keyframes: [{ frame: 1, rotation: [0, 0, 0] }, { frame: 180, rotation: [0, 0, 360] }] }],
      },
    },
    tracks: [],
  });
  return { id: value.id, expectedRenderer: "blender" as const, project: value };
}

export function regressionCases(): RegressionCase[] {
  return [remotionCase(), mathCase(), verticalCase(), narrationCase(), generatedCase(), blenderCase()];
}
