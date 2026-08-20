import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmptyVideoIR } from "../shared/video-ir.js";
import { JobStore } from "./jobs/job-store.js";
import { RenderCache } from "./renderers/incremental-renderer.js";

test("durable jobs resume interrupted work from queued state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-jobs-"));
  const filename = path.join(dir, "jobs.json");
  const store = new JobStore(filename);
  const job = store.create("project", "render");
  store.update(job.id, { status: "running", progress: 0.4, checkpoint: { shot: "shot-1" } });
  const resumed = new JobStore(filename).get(job.id);
  assert.equal(resumed?.status, "queued");
  assert.deepEqual(resumed?.checkpoint, { shot: "shot-1" });
});

test("render cache keys ignore runtime status and change with creative edits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-cache-"));
  const cache = new RenderCache(dir);
  const project = createEmptyVideoIR("project", "Project");
  const shot = { id: "shot", name: "Opening", intent: "Title", start: 0, duration: 1, renderer: "remotion" as const, status: "planned" as const, tracks: [] };
  project.shots.push(shot);
  const first = cache.key(project, shot);
  shot.status = "complete" as typeof shot.status;
  assert.equal(cache.key(project, shot), first);
  shot.name = "Changed opening";
  assert.notEqual(cache.key(project, shot), first);
});
