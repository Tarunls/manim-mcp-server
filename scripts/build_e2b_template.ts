import path from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "e2b";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.env.E2B_TEMPLATE?.trim() || "lesson-studio-renderer";
const version = process.env.E2B_TEMPLATE_VERSION?.trim() || "dev";
const template = Template({ fileContextPath: root }).fromDockerfile(path.join(root, "e2b", "Dockerfile"));

const result = await Template.build(template, `${name}:${version}`, {
  // Manim rasterizes every frame and ffmpeg encodes them; both are compute
  // bound, and sandbox CPU is a rounding error next to the LLM cost per job.
  cpuCount: 4,
  memoryMB: 4096,
  onBuildLogs: (entry) => process.stdout.write(`${entry}\n`),
});
console.log(`Built E2B template ${name}:${version} (${result.buildId}).`);
