import type { RendererKind, VideoClip, VideoProjectIR, VideoShot } from "./video-ir.js";

export interface RendererCapability {
  id: RendererKind;
  label: string;
  description: string;
  strengths: string[];
  clipKinds: VideoClip["kind"][];
  deterministic: boolean;
  requiresGpu: boolean;
  available: boolean;
  unavailableReason?: string;
}

export const RENDERER_CATALOG: Omit<RendererCapability, "available" | "unavailableReason">[] = [
  {
    id: "remotion",
    label: "Motion compositor",
    description: "Primary renderer for typography, footage, UI, captions, shapes, charts and 2D motion.",
    strengths: ["Typography", "2D animation", "Footage", "Browser preview", "Captions"],
    clipKinds: ["text", "shape", "asset", "chart", "caption", "audio", "scene"],
    deterministic: true,
    requiresGpu: false,
  },
  {
    id: "manim",
    label: "Technical animation",
    description: "Specialized deterministic renderer for equations, graphs and explanatory diagrams.",
    strengths: ["Mathematics", "Graphs", "Diagrams", "Vector motion"],
    clipKinds: ["diagram", "chart", "text", "shape", "scene"],
    deterministic: true,
    requiresGpu: false,
  },
  {
    id: "blender",
    label: "3D renderer",
    description: "3D scenes, product visualization, cameras, materials, particles and physical simulation.",
    strengths: ["3D", "Lighting", "Physics", "Camera motion", "Product shots"],
    clipKinds: ["scene", "asset"],
    deterministic: true,
    requiresGpu: true,
  },
  {
    id: "generated",
    label: "Generative footage",
    description: "Provider-routed cinematic or organic footage created from text and references.",
    strengths: ["People", "Nature", "Cinematic shots", "Imaginative footage"],
    clipKinds: ["scene", "asset"],
    deterministic: false,
    requiresGpu: false,
  },
  {
    id: "ffmpeg",
    label: "Media assembler",
    description: "Final assembly, encoding, loudness normalization, transitions and delivery formats.",
    strengths: ["Encoding", "Audio mix", "Transcode", "Assembly", "Delivery"],
    clipKinds: ["asset", "audio", "caption", "scene"],
    deterministic: true,
    requiresGpu: false,
  },
];

function words(value: string) {
  return value.toLowerCase();
}

export function recommendRenderer(intent: string, clips: VideoClip[] = []): RendererKind {
  const text = words(intent);
  if (/(equation|math|geometry|graph|theorem|calculus|vector|diagram)/.test(text)) return "manim";
  if (/(3d|product render|physics|particle|material|lighting|orbit camera)/.test(text)) return "blender";
  if (/(cinematic|photoreal|person|people|nature|landscape|fantasy|live action)/.test(text)) return "generated";
  if (clips.length && clips.every((clip) => clip.kind === "audio")) return "ffmpeg";
  return "remotion";
}

export function routeProjectShots(project: VideoProjectIR): VideoProjectIR {
  const routed = structuredClone(project);
  for (const shot of routed.shots) {
    const clips = shot.tracks.flatMap((track) => track.clips);
    shot.renderer = recommendRenderer(shot.intent, clips);
    for (const clip of clips) {
      if (clip.renderer === "ffmpeg" && clip.kind !== "audio") clip.renderer = shot.renderer;
    }
  }
  routed.updatedAt = new Date().toISOString();
  return routed;
}

export function totalProjectDuration(shots: VideoShot[], fallback = 1) {
  return Math.max(fallback, ...shots.map((shot) => shot.start + shot.duration));
}
