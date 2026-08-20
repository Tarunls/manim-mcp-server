export const VIDEO_IR_VERSION = "1.0" as const;

export type RendererKind = "remotion" | "manim" | "blender" | "generated" | "ffmpeg";
export type TrackKind = "video" | "overlay" | "audio" | "music" | "captions";
export type AssetKind = "image" | "video" | "audio" | "font" | "icon" | "model" | "texture" | "generated";
export type ClipKind = "text" | "shape" | "asset" | "diagram" | "chart" | "scene" | "caption" | "audio";

export interface VideoFormat {
  width: number;
  height: number;
  fps: number;
  duration: number;
  colorSpace: "srgb" | "rec709";
  background: string;
}

export interface DesignTokens {
  fontFamily: string;
  fontFamilyDisplay: string;
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
  };
  spacing: number[];
  radii: number[];
  safeArea: number;
  motion: {
    fast: number;
    normal: number;
    slow: number;
    easing: [number, number, number, number];
  };
}

export interface Keyframe<T = number | string> {
  time: number;
  value: T;
  easing?: [number, number, number, number];
}

export interface ClipTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  scale: number;
}

export interface ClipAnimation {
  property: keyof ClipTransform | "volume";
  keyframes: Keyframe[];
}

export interface VideoClip {
  id: string;
  name: string;
  kind: ClipKind;
  renderer: RendererKind;
  start: number;
  duration: number;
  sourceStart?: number;
  assetId?: string;
  text?: string;
  component?: string;
  transform: ClipTransform;
  animations: ClipAnimation[];
  style: Record<string, string | number | boolean>;
  metadata: Record<string, unknown>;
}

export interface VideoTrack {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
  clips: VideoClip[];
}

export interface VideoShot {
  id: string;
  name: string;
  intent: string;
  start: number;
  duration: number;
  renderer: RendererKind;
  status: "planned" | "ready" | "rendering" | "complete" | "error";
  cacheKey?: string;
  thumbnailUrl?: string;
  tracks: VideoTrack[];
}

export interface AssetLicense {
  name: string;
  url?: string;
  commercialUse: boolean;
  modifications: boolean;
  attributionRequired: boolean;
  attribution?: string;
}

export interface VideoAsset {
  id: string;
  kind: AssetKind;
  name: string;
  sourceUrl?: string;
  localPath?: string;
  provider: string;
  creator?: string;
  license: AssetLicense;
  hash?: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  tags: string[];
  provenance: Record<string, unknown>;
}

export interface NarrationSegment {
  id: string;
  start: number;
  end?: number;
  text: string;
  voice?: string;
  audioAssetId?: string;
  words?: Array<{ text: string; start: number; end: number }>;
}

export interface StoryboardBeat {
  id: string;
  title: string;
  purpose: string;
  narration: string;
  visual: string;
  renderer: RendererKind;
  duration: number;
  assetQueries: string[];
}

export interface VideoProjectIR {
  schemaVersion: typeof VIDEO_IR_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  format: VideoFormat;
  design: DesignTokens;
  brief: {
    prompt: string;
    audience: string;
    objective: string;
    style: string;
  };
  storyboard: StoryboardBeat[];
  shots: VideoShot[];
  assets: VideoAsset[];
  narration: NarrationSegment[];
  metadata: Record<string, unknown>;
}

export interface VideoIRValidation {
  valid: boolean;
  errors: string[];
}

export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  fontFamily: "Manrope",
  fontFamilyDisplay: "Manrope",
  colors: {
    background: "#f7f7f5",
    surface: "#ffffff",
    text: "#1d1d1b",
    muted: "#73736d",
    accent: "#356859",
  },
  spacing: [8, 12, 16, 24, 32, 48, 64],
  radii: [8, 12, 16],
  safeArea: 64,
  motion: { fast: 0.18, normal: 0.35, slow: 0.7, easing: [0.16, 1, 0.3, 1] },
};

export function createEmptyVideoIR(id: string, title: string, prompt = ""): VideoProjectIR {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: VIDEO_IR_VERSION,
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    format: { width: 1920, height: 1080, fps: 30, duration: 12, colorSpace: "rec709", background: "#f7f7f5" },
    design: structuredClone(DEFAULT_DESIGN_TOKENS),
    brief: { prompt, audience: "General audience", objective: "Explain clearly", style: "Minimal editorial motion" },
    storyboard: [],
    shots: [],
    assets: [],
    narration: [],
    metadata: { seed: 1, revision: 0 },
  };
}

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateVideoIR(value: unknown): VideoIRValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["Project must be an object."] };
  const project = value as Partial<VideoProjectIR>;
  if (project.schemaVersion !== VIDEO_IR_VERSION) errors.push(`schemaVersion must be ${VIDEO_IR_VERSION}.`);
  if (!project.id || typeof project.id !== "string") errors.push("id is required.");
  if (!project.title || typeof project.title !== "string") errors.push("title is required.");
  if (!project.format || !finitePositive(project.format.width) || !finitePositive(project.format.height)) errors.push("format width and height must be positive.");
  if (!project.format || !finitePositive(project.format.fps) || !finitePositive(project.format.duration)) errors.push("format fps and duration must be positive.");
  if (!Array.isArray(project.shots)) errors.push("shots must be an array.");
  if (!Array.isArray(project.assets)) errors.push("assets must be an array.");
  if (!Array.isArray(project.narration)) errors.push("narration must be an array.");

  const ids = new Set<string>();
  for (const shot of project.shots || []) {
    if (!shot.id) errors.push("Every shot requires an id.");
    if (ids.has(shot.id)) errors.push(`Duplicate id: ${shot.id}.`);
    ids.add(shot.id);
    if (!finitePositive(shot.duration) || shot.start < 0) errors.push(`Shot ${shot.id} has invalid timing.`);
    if (!Array.isArray(shot.tracks)) errors.push(`Shot ${shot.id} requires tracks.`);
    for (const track of shot.tracks || []) {
      if (ids.has(track.id)) errors.push(`Duplicate id: ${track.id}.`);
      ids.add(track.id);
      for (const clip of track.clips || []) {
        if (ids.has(clip.id)) errors.push(`Duplicate id: ${clip.id}.`);
        ids.add(clip.id);
        if (!finitePositive(clip.duration) || clip.start < 0) errors.push(`Clip ${clip.id} has invalid timing.`);
        if (clip.start + clip.duration > shot.duration + 0.001) errors.push(`Clip ${clip.id} extends beyond shot ${shot.id}.`);
        if (clip.assetId && !(project.assets || []).some((asset) => asset.id === clip.assetId)) errors.push(`Clip ${clip.id} references missing asset ${clip.assetId}.`);
      }
    }
  }
  const ordered = [...(project.shots || [])].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].start + ordered[index - 1].duration - 0.001) {
      errors.push(`Shots ${ordered[index - 1].id} and ${ordered[index].id} overlap.`);
    }
  }
  return { valid: errors.length === 0, errors };
}
