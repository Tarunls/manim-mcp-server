import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StudioJob, StudioJobType } from "../../shared/jobs.js";

function now() { return new Date().toISOString(); }

export class JobStore extends EventEmitter {
  private jobs = new Map<string, StudioJob>();
  constructor(private filename: string) {
    super();
    this.load();
  }
  private load() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.filename, "utf8")) as StudioJob[];
      for (const job of stored) {
        if (job.status === "running") { job.status = "queued"; job.stage = "Ready to resume"; }
        this.jobs.set(job.id, job);
      }
      this.persist();
    } catch {
      // The first run has no durable job store.
    }
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(this.filename, `${JSON.stringify(this.list(), null, 2)}\n`);
  }
  list(projectId?: string) {
    return [...this.jobs.values()].filter((job) => !projectId || job.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string) { return this.jobs.get(id); }
  create(projectId: string, type: StudioJobType) {
    const timestamp = now();
    const job: StudioJob = { id: randomUUID(), projectId, type, status: "queued", progress: 0, stage: "Queued", createdAt: timestamp, updatedAt: timestamp };
    this.jobs.set(job.id, job);
    this.save(job);
    return job;
  }
  update(id: string, patch: Partial<StudioJob>) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Job not found.");
    Object.assign(job, patch, { updatedAt: now() });
    this.save(job);
    return job;
  }
  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Job not found.");
    if (["complete", "failed"].includes(job.status)) return job;
    return this.update(id, { status: "cancelled", stage: "Cancelled", completedAt: now() });
  }
  private save(job: StudioJob) {
    this.persist();
    this.emit("job", structuredClone(job));
  }
}
