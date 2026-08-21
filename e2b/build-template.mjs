// Builds the lesson-studio-agent sandbox template via E2B's v2 build system.
//
//   E2B_API_KEY=... node e2b/build-template.mjs
//
import { readFileSync } from "node:fs";
import { Template, defaultBuildLogger } from "e2b";

const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
const template = Template().fromDockerfile(dockerfile);

console.log("Building lesson-studio-agent template (4 vCPU / 8 GiB)…");
const result = await Template.build(template, "lesson-studio-agent", {
  apiKey: process.env.E2B_API_KEY,
  cpuCount: 4,
  memoryMB: 8192,
  onBuildLogs: defaultBuildLogger(),
});

console.log(`Template built: ${result.templateId}`);
