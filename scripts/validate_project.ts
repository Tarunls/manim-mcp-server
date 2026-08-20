import path from "node:path";
import { readProjectBundle } from "../server/project-bundle.js";

const projectDir = path.resolve(process.argv[2] || ".");
const project = readProjectBundle(projectDir);
console.log(JSON.stringify({ valid: true, shots: project.shots.length, assets: project.assets.length, duration: project.format.duration }));
