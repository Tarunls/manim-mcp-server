import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RENDERER_CATALOG, type RendererCapability } from "../../shared/renderers.js";

function executable(name: string, args = ["--version"]) {
  try {
    execFileSync(name, args, { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export function rendererCapabilities(root: string): RendererCapability[] {
  const availability = {
    remotion: fs.existsSync(path.join(root, "node_modules", "@remotion", "renderer")),
    manim: fs.existsSync(path.join(root, ".venv", "bin", "manim")),
    blender: executable("blender"),
    generated: Boolean(process.env.OPENAI_API_KEY || process.env.RUNWAY_API_KEY || process.env.GOOGLE_API_KEY),
    ffmpeg: executable("ffmpeg", ["-version"]),
  };
  return RENDERER_CATALOG.map((renderer) => ({
    ...renderer,
    available: availability[renderer.id],
    unavailableReason: availability[renderer.id]
      ? undefined
      : renderer.id === "generated"
        ? "Configure at least one video generation provider."
        : `${renderer.label} is not installed.`,
  }));
}
