import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StudioService } from "./studio-service.js";
import { readProjectBundle, writeProjectBundle } from "./project-bundle.js";

test("branching a revision creates an independent editable project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-revision-"));
  const studio = new StudioService(root);
  const source = studio.createProject("Explain orbital motion");
  const sourceDir = path.join(root, "studio", "projects", source.id);
  const timeline = readProjectBundle(sourceDir);
  timeline.metadata.marker = "archived-state";
  const versionDir = path.join(sourceDir, "versions", "v001");
  fs.mkdirSync(versionDir, { recursive: true });
  writeProjectBundle(versionDir, timeline);
  fs.mkdirSync(path.join(sourceDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "assets", "marker.txt"), "asset");
  source.versions.push({ id: "v001", number: 1, createdAt: new Date().toISOString(), prompt: source.prompt, videoUrl: `/media/${source.id}/versions/v001/output.mp4` });

  const branch = studio.branchVersion(source.id, "v001");
  const branchTimeline = studio.getTimeline(branch.id);

  assert.notEqual(branch.id, source.id);
  assert.equal(branchTimeline.id, branch.id);
  assert.equal(branchTimeline.metadata.marker, "archived-state");
  assert.deepEqual(branchTimeline.metadata.branchedFrom, { projectId: source.id, versionId: "v001", version: 1 });
  assert.ok(fs.existsSync(path.join(root, "studio", "projects", branch.id, "assets", "marker.txt")));
  branchTimeline.title = "Independent edit";
  studio.updateTimeline(branch.id, branchTimeline);
  assert.notEqual(studio.getTimeline(source.id).title, "Independent edit");
});
