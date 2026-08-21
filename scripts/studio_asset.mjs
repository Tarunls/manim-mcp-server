#!/usr/bin/env node
/** Search and import licensed visual assets through the running Studio server. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(body.error || `Studio request failed (${response.status}).`);
  return body;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const allowedRoot = path.resolve(root, "studio", "projects");
const projectDir = path.resolve(process.argv[2] || "");
const relative = path.relative(allowedRoot, projectDir);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("Project directory must be a child of studio/projects.");

const command = process.argv[3];
const baseUrl = process.env.STUDIO_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4321}`;
const manifestPath = path.join(projectDir, "asset-candidates.json");
const previewDir = path.join(projectDir, ".asset-candidates");

if (command === "search") {
  const query = process.argv.slice(4).join(" ").trim();
  if (query.length < 3) fail("Use a precise search query with at least three characters.");
  const body = await jsonRequest(`${baseUrl}/api/assets/search?q=${encodeURIComponent(query)}`);
  const candidates = body.results.slice(0, 10);
  fs.rmSync(previewDir, { recursive: true, force: true });
  fs.mkdirSync(previewDir, { recursive: true });
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.thumbnailUrl);
      if (!response.ok) continue;
      const mime = response.headers.get("content-type") || "image/jpeg";
      const extension = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
      const localPreview = `.asset-candidates/${candidate.id}${extension}`;
      fs.writeFileSync(path.join(projectDir, localPreview), Buffer.from(await response.arrayBuffer()));
      candidate.localPreview = localPreview;
    } catch {
      // A missing preview simply removes that candidate from visual selection.
    }
  }
  const usable = candidates.filter((candidate) => candidate.localPreview);
  fs.writeFileSync(manifestPath, JSON.stringify({ query, searchedAt: new Date().toISOString(), candidates: usable }, null, 2));
  console.log(`Saved ${usable.length} licensed candidates to asset-candidates.json.`);
  for (const candidate of usable) console.log(`${candidate.id}: ${candidate.title} | ${candidate.description} | ${candidate.license} | ${candidate.localPreview}`);
} else if (command === "import") {
  const id = String(process.argv[4] || "");
  if (!fs.existsSync(manifestPath)) fail("Run the search command first.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const candidate = manifest.candidates?.find((item) => String(item.id) === id);
  if (!candidate) fail(`Candidate ${id} is not in asset-candidates.json.`);
  const asset = await jsonRequest(`${baseUrl}/api/projects/${path.basename(projectDir)}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidate),
  });
  console.log(JSON.stringify(asset, null, 2));
} else {
  fail("Usage: studio_asset.mjs PROJECT_DIR search QUERY | import CANDIDATE_ID");
}
