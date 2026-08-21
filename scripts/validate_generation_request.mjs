import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`Generation freshness check failed: ${message}`);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(`${label} must contain valid JSON.`);
  }
}

function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function requireFreshFile(file, startedAt, label, minimumBytes = 1) {
  if (!fs.existsSync(file)) fail(`${label} was not created for this request.`);
  const stat = fs.statSync(file);
  if (stat.size < minimumBytes) fail(`${label} is too small to represent completed work.`);
  if (stat.mtimeMs < startedAt - 1_000) fail(`${label} predates this request.`);
}

function meaningfulKeywords(prompt) {
  const stop = new Set(["create", "video", "explaining", "explain", "beautiful", "beautifully", "relate", "related", "their", "there", "about", "under", "with", "from", "into", "that", "this", "they", "them", "used", "using", "calculate", "show", "animate"]);
  const keywords = new Set();
  for (const word of prompt.toLowerCase().match(/[a-z]{5,}/g) || []) {
    if (stop.has(word)) continue;
    keywords.add(word);
    if (word.endsWith("s") && word.length > 5) keywords.add(word.slice(0, -1));
  }
  return [...keywords];
}

function changedLineRatio(active, reference) {
  const referenceLines = new Set(reference.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const activeLines = active.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!activeLines.length) return 0;
  return activeLines.filter((line) => !referenceLines.has(line)).length / activeLines.length;
}

export function validateGenerationRequest(projectDir, renderer) {
  const requestPath = path.join(projectDir, "generation-request.json");
  if (!fs.existsSync(requestPath)) return;
  const request = readJson(requestPath, "generation-request.json");
  if (request.mode !== "first-draft") return;

  const startedAt = Date.parse(request.startedAt);
  if (!Number.isFinite(startedAt)) fail("generation-request.json has an invalid startedAt value.");
  if (request.renderer !== renderer) fail(`the request expects ${request.renderer}, not ${renderer}.`);

  const planPath = path.join(projectDir, "beat-plan.md");
  requireFreshFile(planPath, startedAt, "beat-plan.md", 180);
  const plan = fs.readFileSync(planPath, "utf8").toLowerCase();
  const keywords = meaningfulKeywords(String(request.prompt || ""));
  if (keywords.length && !keywords.some((word) => plan.includes(word))) {
    fail("beat-plan.md does not appear to address the requested topic.");
  }

  const sourceName = renderer === "manim" ? "scene.py" : "video.tsx";
  const sourcePath = path.join(projectDir, sourceName);
  requireFreshFile(sourcePath, startedAt, sourceName, 500);

  if (renderer !== "composite") return;
  const manifestPath = path.join(projectDir, "composite.json");
  requireFreshFile(manifestPath, startedAt, "composite.json", 80);
  const manifest = readJson(manifestPath, "composite.json");
  if (!Array.isArray(manifest.clips) || !manifest.clips.length) fail("composite.json needs at least one transformed Manim clip.");

  const referenceDir = path.join(projectDir, "reference-template");
  const referenceVideo = path.join(referenceDir, "video.tsx");
  const referenceManifest = path.join(referenceDir, "composite.json");
  if (fs.existsSync(referenceVideo)) {
    if (hash(sourcePath) === hash(referenceVideo)) fail("video.tsx is still the untouched Fourier template.");
    const ratio = changedLineRatio(fs.readFileSync(sourcePath, "utf8"), fs.readFileSync(referenceVideo, "utf8"));
    if (ratio < 0.12) fail("video.tsx changes too little of the Fourier template to count as a new lesson.");
  }
  if (fs.existsSync(referenceManifest) && hash(manifestPath) === hash(referenceManifest)) {
    fail("composite.json is still the untouched Fourier template.");
  }

  const referenceClipHashes = new Set();
  const referenceManim = path.join(referenceDir, "manim");
  if (fs.existsSync(referenceManim)) {
    for (const file of fs.readdirSync(referenceManim).filter((name) => name.endsWith(".py"))) {
      referenceClipHashes.add(hash(path.join(referenceManim, file)));
    }
  }
  let combined = fs.readFileSync(sourcePath, "utf8") + "\n" + fs.readFileSync(manifestPath, "utf8");
  for (const clip of manifest.clips) {
    const clipSource = String(clip?.source || "");
    if (!clipSource.startsWith("manim/") || !clipSource.endsWith(".py")) fail("every clip source must be an active manim/*.py file.");
    const clipPath = path.join(projectDir, clipSource);
    requireFreshFile(clipPath, startedAt, clipSource, 300);
    if (referenceClipHashes.has(hash(clipPath))) fail(`${clipSource} is an untouched Fourier template clip.`);
    combined += `\n${fs.readFileSync(clipPath, "utf8")}`;
  }

  const prompt = String(request.prompt || "").toLowerCase();
  if (!prompt.includes("fourier")) {
    const leftovers = ["fourier", "time domain", "inverse transform", "waveform", "phasor", "frequency spectrum", "rotating components", "signal = many simple waves"];
    const normalizedSource = combined.toLowerCase();
    const found = leftovers.filter((term) => normalizedSource.includes(term));
    if (found.length) fail(`active source still contains Fourier-specific material: ${found.join(", ")}.`);
  }
}
