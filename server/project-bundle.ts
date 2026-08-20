import fs from "node:fs";
import path from "node:path";
import { createEmptyVideoIR, validateVideoIR, type VideoProjectIR } from "../shared/video-ir.js";

export const PROJECT_FILE = "project.json";

export function projectFile(projectDir: string) {
  return path.join(projectDir, PROJECT_FILE);
}

export function ensureProjectBundle(projectDir: string, id: string, title: string, prompt = "") {
  fs.mkdirSync(projectDir, { recursive: true });
  const filename = projectFile(projectDir);
  if (!fs.existsSync(filename)) writeProjectBundle(projectDir, createEmptyVideoIR(id, title, prompt));
  return readProjectBundle(projectDir);
}

export function readProjectBundle(projectDir: string): VideoProjectIR {
  const parsed = JSON.parse(fs.readFileSync(projectFile(projectDir), "utf8")) as unknown;
  const validation = validateVideoIR(parsed);
  if (!validation.valid) throw new Error(`Invalid project.json: ${validation.errors.join(" ")}`);
  return parsed as VideoProjectIR;
}

export function writeProjectBundle(projectDir: string, project: VideoProjectIR) {
  const validation = validateVideoIR(project);
  if (!validation.valid) throw new Error(`Invalid project.json: ${validation.errors.join(" ")}`);
  project.updatedAt = new Date().toISOString();
  const target = projectFile(projectDir);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function snapshotProjectBundle(projectDir: string, destination: string) {
  const source = projectFile(projectDir);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(destination, PROJECT_FILE));
}
