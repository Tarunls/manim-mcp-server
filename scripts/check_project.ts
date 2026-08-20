import path from "node:path";
import { readProjectBundle } from "../server/project-bundle.js";
import { createQualityReport } from "../server/quality/project-quality.js";

const projectDir = path.resolve(process.argv[2] || ".");
const report = await createQualityReport(projectDir, readProjectBundle(projectDir));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
