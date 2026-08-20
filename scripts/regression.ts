import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import baseline from "../fixtures/regression/baseline.json" with { type: "json" };
import { regressionCases } from "../fixtures/regression/cases.js";
import { validateVideoIR } from "../shared/video-ir.js";
import { inspectProject } from "../server/quality/project-quality.js";
import { writeProjectBundle } from "../server/project-bundle.js";
import { RenderCache, renderIncrementally } from "../server/renderers/incremental-renderer.js";

const root = path.resolve(import.meta.dirname, "..");
const render = process.argv.includes("--render");
const results: Array<Record<string, unknown>> = [];

for (const fixture of regressionCases()) {
  const expected = baseline[fixture.id as keyof typeof baseline];
  assert.ok(expected, `Missing baseline for ${fixture.id}.`);
  const validation = validateVideoIR(fixture.project);
  assert.equal(validation.valid, true, validation.errors.join(" "));
  const errors = inspectProject(fixture.project).filter((item) => item.severity === "error");
  assert.deepEqual(errors, [], `${fixture.id}: ${errors.map((item) => item.message).join(" ")}`);
  const renderers = new Set(fixture.project.shots.map((shot) => shot.renderer));
  assert.deepEqual([...renderers], [expected.renderer]);
  assert.equal(fixture.expectedRenderer, expected.renderer);
  assert.equal(fixture.project.format.width, expected.width);
  assert.equal(fixture.project.format.height, expected.height);
  assert.equal(fixture.project.format.duration, expected.duration);
  assert.ok(fixture.project.shots.flatMap((shot) => shot.tracks.flatMap((track) => track.clips)).length >= expected.minimumClips);

  let rendered = false;
  if (render && expected.renderer === "remotion") {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `studio-regression-${fixture.id}-`));
    writeProjectBundle(projectDir, fixture.project);
    await renderIncrementally(root, projectDir, fixture.project, new RenderCache(path.join(projectDir, "cache")));
    assert.ok(fs.statSync(path.join(projectDir, "output.mp4")).size > 0);
    rendered = true;
  }
  results.push({ id: fixture.id, renderer: expected.renderer, errors: 0, rendered });
}

assert.deepEqual(Object.keys(baseline).sort(), regressionCases().map((item) => item.id).sort(), "Baseline and fixture IDs differ.");
console.log(JSON.stringify({ passed: true, cases: results.length, rendered: results.filter((item) => item.rendered).length, results }));
