import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { authorLesson } from "../scripts/lesson_pipeline.mjs";
import { startNarrationProxy } from "./narration-proxy.mjs";

const execFileAsync = promisify(execFile);
const job = JSON.parse(await fs.readFile("/workspace/job.json", "utf8"));
const appRoot = "/opt/lesson-studio/app";
const projectRoot = path.join(appRoot, "studio", "projects", job.id);
const callbackUrl = process.env.JOB_CALLBACK_URL;
const callbackToken = process.env.JOB_CALLBACK_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
const openaiBaseUrl = process.env.OPENAI_BASE_URL;
let narrationProxy;

function required(value, name) {
  if (!value) throw new Error(`${name} is missing from the sandbox environment.`);
  return value;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function callback(suffix, body) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${required(callbackUrl, "JOB_CALLBACK_URL")}${suffix}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${required(callbackToken, "JOB_CALLBACK_TOKEN")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return;
      if (response.status < 500 && response.status !== 429)
        throw new Error(`Job callback was rejected with HTTP ${response.status}.`);
      lastError = new Error(`Job callback failed with HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError || new Error("Job callback failed.");
}

async function upload(kind, filePath) {
  const target = job.uploads.uploads.find((candidate) => candidate.kind === kind);
  if (!target) throw new Error(`Upload target ${kind} is missing.`);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || !stat.size || stat.size > 750 * 1024 * 1024)
    throw new Error(`Artifact ${kind} has an invalid size.`);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(target.url, {
        method: "PUT",
        headers: { "Content-Type": target.contentType, "Content-Length": String(stat.size) },
        body: createReadStream(filePath),
        duplex: "half",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (response.ok) return kind;
      lastError = new Error(`Artifact upload ${kind} failed with HTTP ${response.status}.`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError || new Error(`Artifact upload ${kind} failed.`);
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function download(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`Input download failed with HTTP ${response.status}.`);
  if (!response.body) throw new Error("Input download returned no body.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 150 * 1024 * 1024) throw new Error("Input download has an invalid size.");
  await fs.mkdir(path.dirname(target), { recursive: true });
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      done(received > 150 * 1024 * 1024 ? new Error("Input download has an invalid size.") : undefined, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(target, { mode: 0o600 }));
  if (!received) throw new Error("Input download has an invalid size.");
}

async function assertNoSecretMaterial(directory, secrets, accounting = { totalBytes: 0 }) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    if (directory === projectRoot && entry.name === "output.mp4") continue;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Generated source contains a symbolic link.");
    if (entry.isDirectory()) await assertNoSecretMaterial(target, secrets, accounting);
    else if (entry.isFile()) {
      const stat = await fs.stat(target);
      accounting.totalBytes += stat.size;
      if (accounting.totalBytes > 300 * 1024 * 1024) throw new Error("Generated source exceeds the allowed total size.");
      if (stat.size > 150 * 1024 * 1024) throw new Error("Generated source contains an oversized file.");
      const contents = await fs.readFile(target);
      if (secrets.some((secret) => secret && contents.includes(Buffer.from(secret)))) throw new Error("Generated source contains sandbox credential material.");
    } else throw new Error("Generated source contains a special file.");
  }
}

function redactSecrets(value, maximumLength = 4_000) {
  let safe = String(value || "");
  for (const secret of [apiKey, callbackToken]) {
    if (secret) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe.replace(/\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[redacted]").slice(0, maximumLength);
}

try {
  required(apiKey, "OPENAI_API_KEY");
  required(openaiBaseUrl, "OPENAI_BASE_URL");
  await fs.mkdir(projectRoot, { recursive: true });
  if (job.revisionSourceUrl) {
    await download(job.revisionSourceUrl, "/workspace/revision-source.tar.gz");
    const listing = await execFileAsync("tar", ["-tzf", "/workspace/revision-source.tar.gz"]);
    const entries = listing.stdout.split("\n").filter(Boolean);
    if (entries.length > 10_000) throw new Error("Revision source archive has too many entries.");
    if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) {
      throw new Error("Revision source archive contains an unsafe path.");
    }
    const verboseListing = await execFileAsync("tar", ["-tvzf", "/workspace/revision-source.tar.gz"]);
    const archiveRows = verboseListing.stdout.split("\n").filter(Boolean);
    if (archiveRows.some((entry) => !["-", "d"].includes(entry[0]))) {
      throw new Error("Revision source archive contains a link or special file.");
    }
    const expandedBytes = archiveRows.reduce((sum, entry) => sum + (Number(entry.trim().split(/\s+/)[2]) || 0), 0);
    if (expandedBytes > 300 * 1024 * 1024) throw new Error("Revision source archive expands beyond the allowed size.");
    await execFileAsync("tar", ["-xzf", "/workspace/revision-source.tar.gz", "-C", projectRoot]);
  }
  for (const asset of job.projectAssets || []) {
    if (!/^public\/assets\/[a-zA-Z0-9._-]+$/.test(asset.localPath)) throw new Error("Project asset path is invalid.");
    await download(asset.url, path.join(projectRoot, asset.localPath));
  }
  if ((job.projectAssets || []).length) {
    await fs.writeFile(path.join(projectRoot, "assets.json"), JSON.stringify({ assets: job.projectAssets.map((asset) => ({ ...asset.metadata, publicPath: asset.localPath.replace(/^public\//, "") })) }, null, 2));
  }
  const attachments = [];
  for (const attachment of job.attachments || []) {
    const target = path.join("/workspace/attachments", `${attachment.id}.png`);
    await download(attachment.url, target);
    attachments.push({ path: target, label: String(attachment.label || "Attached image").slice(0, 200) });
  }
  const design = job.designPreferences || { fontCategory: "serif", colorPalette: "paper" };
  const narration = job.narrationPreferences || { enabled: false };
  await Promise.all([
    fs.writeFile(path.join(projectRoot, "generation-request.json"), JSON.stringify({
      id: job.id,
      mode: "hosted-generation",
      renderer: "manim",
      prompt: job.prompt,
      startedAt: new Date().toISOString(),
    }, null, 2)),
    fs.writeFile(path.join(projectRoot, "design-config.json"), JSON.stringify(design, null, 2)),
    fs.writeFile(path.join(projectRoot, "narration-config.json"), JSON.stringify(narration, null, 2)),
  ]);
  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot });

  const vertical = job.format === "vertical";
  const expectedWidth = vertical ? 1080 : 1920;
  const expectedHeight = vertical ? 1920 : 1080;

  // A revision carries the previous storyboard and scene so the model edits
  // the existing video rather than starting over. The brief the video was
  // made from is stored in the storyboard; the job prompt is the change.
  const previousStoryboard = job.revisionSourceUrl ? await readJson(path.join(projectRoot, "storyboard.json")) : undefined;
  const previousScene = job.revisionSourceUrl && await exists(path.join(projectRoot, "scene.py"))
    ? await fs.readFile(path.join(projectRoot, "scene.py"), "utf8")
    : undefined;
  const isRevision = Boolean(previousStoryboard && previousScene);
  const brief = isRevision ? String(previousStoryboard.brief || job.prompt) : String(job.prompt);

  narrationProxy = narration.enabled
    ? await startNarrationProxy({ callbackUrl, callbackToken })
    : undefined;

  const requestedAgentTimeout = Number(process.env.GENERATION_AGENT_TIMEOUT_MS);
  const agentTimeoutMs = Number.isSafeInteger(requestedAgentTimeout) && requestedAgentTimeout >= 60_000
    ? Math.min(requestedAgentTimeout, 58 * 60_000)
    : 25 * 60_000;
  // Progress is best-effort and bounded: a dropped callback never fails the
  // job, labels are short, and the server throttles further.
  const progress = (body) => callback("/progress", body).catch(() => undefined);
  await progress({ stage: "brief", label: "Reading the brief" });

  await withTimeout(
    authorLesson({
      root: appRoot,
      projectDir: projectRoot,
      brief: String(brief).slice(0, 12_000),
      format: vertical ? "vertical" : "landscape",
      effort: job.effort,
      narration,
      design,
      assets: (job.projectAssets || []).map((asset) => ({ localPath: asset.localPath, title: asset.metadata?.title })),
      revision: isRevision
        ? { request: String(job.prompt).slice(0, 12_000), storyboard: previousStoryboard, scene: previousScene, attachments }
        : undefined,
      openai: { baseUrl: openaiBaseUrl, apiKey },
      tts: { proxyUrl: narrationProxy?.url },
      onProgress: ({ stage, label }) => progress({ stage, label }),
      log: (line) => console.error(redactSecrets(line, 600)),
      env: {
        ...process.env,
        PATH: `${appRoot}/.venv/bin:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}`,
        HOME: process.env.HOME || "/home/user",
        TMPDIR: "/tmp",
      },
    }),
    agentTimeoutMs,
    "Generation exceeded its execution deadline.",
  );
  await narrationProxy?.close();
  narrationProxy = undefined;

  if (!(await exists(path.join(projectRoot, "output.mp4")))) throw new Error("The render finished without output.mp4.");
  // Metadata is derived here, from the actual file, so the owner's copy can
  // never disagree with what was uploaded.
  const { stdout: probeJson } = await execFileAsync("ffprobe", [
    "-v", "error", "-print_format", "json",
    "-show_entries", "stream=codec_type,width,height,avg_frame_rate:format=duration,bit_rate",
    path.join(projectRoot, "output.mp4"),
  ]);
  const probe = JSON.parse(probeJson);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const hasAudio = (probe.streams || []).some((stream) => stream.codec_type === "audio");
  if (!videoStream) throw new Error("output.mp4 has no video stream.");
  const width = Number(videoStream.width || 0);
  const height = Number(videoStream.height || 0);
  if (width !== expectedWidth || height !== expectedHeight)
    throw new Error(`output.mp4 is ${width}x${height}, but this lesson must be ${expectedWidth}x${expectedHeight}.`);
  const narrationEnabled = narration.enabled === true;
  const rendererMetadata = await readJson(path.join(projectRoot, "metadata.json"));
  const spokenLines = narrationEnabled ? (await readJson(path.join(projectRoot, "narration.json")))?.segments?.length || 0 : 0;
  if (narrationEnabled && spokenLines && !hasAudio) {
    throw new Error("Narration is enabled but the rendered video has no audio track.");
  }
  const [fpsNumerator, fpsDenominator] = String(videoStream.avg_frame_rate || "30/1").split("/").map(Number);
  const derivedMetadata = {
    renderer: "manim",
    duration: Number(probe.format?.duration || 0),
    width,
    height,
    fps: fpsDenominator ? Math.round((fpsNumerator / fpsDenominator) * 1000) / 1000 : 30,
    bitRate: Number(probe.format?.bit_rate || 0),
    narration: {
      enabled: narrationEnabled,
      hasAudio,
      ...(rendererMetadata?.narration && typeof rendererMetadata.narration === "object"
        ? {
            status: rendererMetadata.narration.status,
            provider: rendererMetadata.narration.provider,
            model: rendererMetadata.narration.model,
            voice: rendererMetadata.narration.voice,
            segments: rendererMetadata.narration.segments,
          }
        : {}),
    },
  };
  await fs.writeFile(path.join(projectRoot, "metadata.json"), JSON.stringify(derivedMetadata, null, 2));
  await assertNoSecretMaterial(projectRoot, [apiKey, callbackToken]);
  await execFileAsync("tar", [
    "--exclude=.git", "--exclude=.env", "--exclude=.media", "--exclude=output.mp4", "--exclude=poster.png", "--exclude=contact-sheet.png",
    "-czf", "/workspace/source.tar.gz", "-C", projectRoot, ".",
  ]);

  const uploaded = [];
  uploaded.push(await upload("video", path.join(projectRoot, "output.mp4")));
  uploaded.push(await upload("metadata", path.join(projectRoot, "metadata.json")));
  uploaded.push(await upload("source_archive", "/workspace/source.tar.gz"));
  if (await exists(path.join(projectRoot, "poster.png"))) uploaded.push(await upload("poster", path.join(projectRoot, "poster.png")));
  if (await exists(path.join(projectRoot, "contact-sheet.png"))) uploaded.push(await upload("contact_sheet", path.join(projectRoot, "contact-sheet.png")));
  await callback("/complete", { artifacts: uploaded });
} catch (error) {
  await narrationProxy?.close().catch(() => undefined);
  narrationProxy = undefined;
  const diagnostic = redactSecrets(error instanceof Error ? error.stack || error.message : "Sandbox generation failed.");
  await fs.writeFile("/workspace/failure.log", `${diagnostic}\n`, { mode: 0o600 }).catch(() => undefined);
  await callback("/failure", { error: diagnostic }).catch(() => undefined);
  process.exitCode = 1;
}
