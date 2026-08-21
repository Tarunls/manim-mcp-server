import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateGenerationRequest } from "../scripts/validate_generation_request.mjs";

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("an untouched Fourier scaffold cannot render as a new topic", (context) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-studio-freshness-"));
  context.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const referenceVideo = Array.from({ length: 40 }, (_, index) => `const fourierLine${index} = "waveform frequency spectrum ${index}";`).join("\n");
  const referenceClip = `# Fourier waveform phasor\n${"x = 1\n".repeat(80)}`;
  const referenceManifest = JSON.stringify({ clips: [{ id: "wave", source: "manim/wave.py", scene: "GeneratedScene", transparent: true }] }, null, 2);
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  write(path.join(projectDir, "generation-request.json"), JSON.stringify({ mode: "first-draft", renderer: "composite", prompt: "Create a video explaining integrals", startedAt }));
  write(path.join(projectDir, "beat-plan.md"), `# Integral beat plan\n${"Accumulate slices beneath the curve and transform area into volume.\n".repeat(5)}`);
  write(path.join(projectDir, "reference-template", "video.tsx"), referenceVideo);
  write(path.join(projectDir, "reference-template", "composite.json"), referenceManifest);
  write(path.join(projectDir, "reference-template", "manim", "wave.py"), referenceClip);
  write(path.join(projectDir, "video.tsx"), referenceVideo);
  write(path.join(projectDir, "composite.json"), referenceManifest);
  write(path.join(projectDir, "manim", "wave.py"), referenceClip);

  assert.throws(() => validateGenerationRequest(projectDir, "composite"), /untouched Fourier template/);
});

test("a fresh topic plan and transformed Composite source pass", (context) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-studio-freshness-"));
  context.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const referenceVideo = Array.from({ length: 40 }, (_, index) => `const referenceLine${index} = "template ${index}";`).join("\n");
  const activeVideo = Array.from({ length: 40 }, (_, index) => `const integralLine${index} = "area slice volume ${index}";`).join("\n");
  write(path.join(projectDir, "generation-request.json"), JSON.stringify({ mode: "first-draft", renderer: "composite", prompt: "Create a video explaining integrals and volume", startedAt }));
  write(path.join(projectDir, "beat-plan.md"), `# Integral beat plan\n${"Use narrowing slices to connect integral accumulation, exact area, and disk volume.\n".repeat(5)}`);
  write(path.join(projectDir, "reference-template", "video.tsx"), referenceVideo);
  write(path.join(projectDir, "reference-template", "composite.json"), JSON.stringify({ clips: [{ id: "reference", source: "manim/reference.py" }] }));
  write(path.join(projectDir, "reference-template", "manim", "reference.py"), `# reference\n${"x = 1\n".repeat(80)}`);
  write(path.join(projectDir, "video.tsx"), activeVideo);
  write(path.join(projectDir, "composite.json"), JSON.stringify({ clips: [{ id: "area", source: "manim/area.py", scene: "GeneratedScene", transparent: true }] }, null, 2));
  write(path.join(projectDir, "manim", "area.py"), `# integral area scene\n${"area_slice = 2\n".repeat(40)}`);

  assert.doesNotThrow(() => validateGenerationRequest(projectDir, "composite"));
});
