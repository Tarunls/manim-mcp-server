#!/usr/bin/env node
/** Render Manim inserts, then use Remotion as the single final compositor. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGenerationRequest } from "./validate_generation_request.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, timeout = 900_000) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    fail(typeof error?.stderr === "string" ? error.stderr.slice(-5000) : `${command} failed.`);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const allowedRoot = path.resolve(root, "studio", "projects");
const projectDir = path.resolve(process.argv[2] || "");
const quality = process.argv[3] || "balanced";
const relative = path.relative(allowedRoot, projectDir);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("Project directory must be a child of studio/projects.");
try { validateGenerationRequest(projectDir, "composite"); } catch (error) { fail(error instanceof Error ? error.message : "Generation freshness check failed."); }

const manifestPath = path.join(projectDir, "composite.json");
if (!fs.existsSync(manifestPath)) fail("composite.json does not exist.");
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { fail("composite.json is not valid JSON."); }
if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) fail("composite.json must contain at least one Manim clip.");

const ids = new Set();
const rendered = [];
for (const clip of manifest.clips) {
  if (!clip || !/^[a-zA-Z0-9_-]+$/.test(clip.id || "") || ids.has(clip.id)) fail("Every composite clip needs a unique safe id.");
  ids.add(clip.id);
  const source = String(clip.source || "");
  if (!source.startsWith("manim/") || !source.endsWith(".py")) fail(`Clip ${clip.id} source must be inside manim/.`);
  const scene = String(clip.scene || "GeneratedScene");
  const transparent = clip.transparent !== false;
  const output = `public/manim/${clip.id}`;
  const python = process.platform === "win32" ? "python" : "python3";
  const raw = run(python, [path.join(root, "scripts", "render_manim_insert.py"), projectDir, source, scene, output, String(transparent)]);
  rendered.push(JSON.parse(raw.trim().split(/\r?\n/).at(-1)));
}
fs.writeFileSync(path.join(projectDir, "composite-metadata.json"), JSON.stringify({ renderedAt: new Date().toISOString(), clips: rendered }, null, 2));
run("node", [path.join(root, "scripts", "render_remotion.mjs"), projectDir, quality, "composite"]);
console.log(fs.readFileSync(path.join(projectDir, "metadata.json"), "utf8"));
