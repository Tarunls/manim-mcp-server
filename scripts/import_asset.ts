import fs from "node:fs";
import path from "node:path";
import { AssetService } from "../server/assets/service.js";
import { readProjectBundle, writeProjectBundle } from "../server/project-bundle.js";
import type { AssetCandidate } from "../shared/assets.js";

const projectDir = path.resolve(process.argv[2] || ".");
const candidatePath = path.resolve(process.argv[3] || "");
if (!process.argv[3] || !fs.existsSync(candidatePath)) throw new Error("Usage: import_asset.ts PROJECT_DIR CANDIDATE_JSON");
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8")) as AssetCandidate;
const asset = await new AssetService().import(projectDir, candidate);
const project = readProjectBundle(projectDir);
project.assets.push(asset);
writeProjectBundle(projectDir, project);
console.log(JSON.stringify(asset, null, 2));
