import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { createDeliveryBundle, buildCredits, buildOtio, buildSrt } from "./exports/interchange.js";
import { writeProjectBundle } from "./project-bundle.js";

test("interchange export preserves edit metadata, timing, credits, and captions", () => {
  const project = createEmptyVideoIR("export", "Export test");
  project.format.duration = 5;
  project.storyboard.push({ id: "beat", title: "Beat", purpose: "Test", narration: "Hello", visual: "Title", renderer: "remotion", duration: 3, assetQueries: [] });
  project.shots.push({ id: "shot", name: "Opening", intent: "Test opening", start: 1, duration: 3, renderer: "remotion", status: "complete", cacheKey: "a".repeat(64), tracks: [] });
  project.narration.push({ id: "narration", start: 1, end: 2.5, text: "A clear explanation." });
  project.assets.push({ id: "asset", kind: "image", name: "Photo", provider: "openverse", creator: "Creator", sourceUrl: "https://example.com/source", localPath: "assets/photo.jpg", license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercialUse: true, modifications: true, attributionRequired: true, attribution: "Photo by Creator" }, tags: [], provenance: {} });

  const otio = buildOtio(project) as any;
  assert.equal(otio.OTIO_SCHEMA, "Timeline.1");
  assert.equal(otio.tracks.children[0].children[0].OTIO_SCHEMA, "Gap.1");
  assert.equal(otio.tracks.children[0].children[1].OTIO_SCHEMA, "Clip.2");
  assert.equal(otio.tracks.children[0].children[1].metadata.manim_studio.id, "shot");
  assert.match(buildCredits(project), /Photo by Creator/);
  assert.match(buildSrt(project), /00:00:01,000 --> 00:00:02,500/);
});

test("delivery bundle contains source, review media, and professional handoff files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-delivery-"));
  const projectDir = path.join(root, "studio", "projects", "delivery");
  const project = createEmptyVideoIR("delivery", "Delivery test");
  project.format.duration = 1;
  project.storyboard.push({ id: "beat", title: "Beat", purpose: "Test", narration: "", visual: "Frame", renderer: "remotion", duration: 1, assetQueries: [] });
  project.shots.push({ id: "shot", name: "Shot", intent: "Test", start: 0, duration: 1, renderer: "remotion", status: "complete", tracks: [] });
  fs.mkdirSync(projectDir, { recursive: true });
  writeProjectBundle(projectDir, project);
  fs.writeFileSync(path.join(projectDir, "output.mp4"), "video");
  const archive = await createDeliveryBundle(root, projectDir, project);
  const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  assert.match(listing, /delivery\/timeline\.otio/);
  assert.match(listing, /delivery\/project\.json/);
  assert.match(listing, /delivery\/credits\.txt/);
  assert.match(listing, /delivery\/output\.mp4/);
});
