import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ArtifactService } from "./artifact-service.js";
import type { Database } from "./database.js";
import type { ProjectAsset, StudioProject } from "./types.js";

const execFileAsync = promisify(execFile);

type FileRow = {
  id: string;
  bucket: string;
  object_name: string;
  generation: string;
  content_type: string;
};

function plain(value: unknown) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Shared by hosted and local asset import: HTTPS Wikimedia origin only, a
 * post-redirect host re-check, a bounded download, and a raster-only content
 * type allowlist (no SVG, which can carry script).
 */
export async function fetchVerifiedCommonsImage(candidate: Record<string, unknown>) {
  const download = new URL(String(candidate.downloadUrl || ""));
  const source = new URL(String(candidate.sourceUrl || ""));
  if (download.protocol !== "https:" || download.hostname !== "upload.wikimedia.org" || source.hostname !== "commons.wikimedia.org") {
    throw new Error("Only Wikimedia Commons assets from the search picker can be imported.");
  }
  const response = await fetch(download, {
    headers: { "User-Agent": "LessonStudio/1.0 educational-video-asset-import" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("The selected asset could not be downloaded.");
  if (new URL(response.url).hostname !== "upload.wikimedia.org") throw new Error("The asset download redirected to an untrusted host.");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const contents = await boundedResponse(response, 20 * 1024 * 1024);
  const contentType = response.headers.get("content-type")?.split(";")[0] || "";
  if (!contents.length || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType)) {
    throw new Error("The selected file is not a supported image under 20 MB.");
  }
  const extension = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : contentType === "image/gif" ? ".gif" : ".jpg";
  return { contents, contentType, extension, source };
}

async function boundedResponse(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("The asset download returned no data.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Choose an image smaller than 20 MB.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export class HostedMediaService {
  constructor(private readonly db: Database, private readonly artifacts: ArtifactService) {}

  async importAsset(ownerId: string, project: StudioProject, candidate: Record<string, unknown>) {
    const { contents, contentType, extension, source } = await fetchVerifiedCommonsImage(candidate);
    const fileId = randomUUID();
    const stored = await this.artifacts.storeProjectFile(project.id, fileId, `asset${extension}`, contentType, contents);
    await this.db.query(
      `INSERT INTO project_files
        (id, owner_id, project_id, kind, bucket, object_name, generation, content_type, byte_size, checksum, metadata)
       VALUES ($1, $2, $3, 'licensed_asset', $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [fileId, ownerId, project.id, stored.bucket, stored.objectName, stored.generation, stored.contentType,
        stored.byteSize, stored.checksum, JSON.stringify({ sourceUrl: source.toString(), license: candidate.license })],
    );
    let licenseUrl: string | undefined;
    try {
      const parsed = new URL(String(candidate.licenseUrl || ""));
      if (parsed.protocol === "https:") licenseUrl = parsed.toString();
    } catch {
      // Missing or invalid license links remain unset; the verified source page is retained.
    }
    const asset: ProjectAsset = {
      id: fileId,
      title: plain(candidate.title) || "Imported asset",
      description: plain(candidate.description) || undefined,
      provider: "Wikimedia Commons",
      sourceUrl: source.toString(),
      license: plain(candidate.license) || "See source",
      licenseUrl,
      creator: plain(candidate.creator) || undefined,
      localPath: `public/assets/${fileId}${extension}`,
      mediaUrl: `/api/project-files/${fileId}`,
      sha256: stored.checksum,
      importedAt: new Date().toISOString(),
    };
    return asset;
  }

  async storeReviewImages(ownerId: string, projectId: string, clean: Buffer, annotated: Buffer) {
    const cleanId = randomUUID();
    const annotatedId = randomUUID();
    const [cleanStored, annotatedStored] = await Promise.all([
      this.artifacts.storeProjectFile(projectId, cleanId, "clean.png", "image/png", clean),
      this.artifacts.storeProjectFile(projectId, annotatedId, "annotated.png", "image/png", annotated),
    ]);
    await this.db.transaction(async (client) => {
      for (const [id, kind, stored] of [
        [cleanId, "review_clean", cleanStored],
        [annotatedId, "review_annotated", annotatedStored],
      ] as const) {
        await client.query(
          `INSERT INTO project_files
            (id, owner_id, project_id, kind, bucket, object_name, generation, content_type, byte_size, checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, ownerId, projectId, kind, stored.bucket, stored.objectName, stored.generation,
            stored.contentType, stored.byteSize, stored.checksum],
        );
      }
    });
    return { cleanId, annotatedId };
  }

  // Best-effort rollback for review frames whose generation submit failed.
  async deleteProjectFiles(ownerId: string, projectId: string, fileIds: string[]) {
    await this.db.query(
      "DELETE FROM project_files WHERE owner_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])",
      [ownerId, projectId, fileIds],
    );
    await this.artifacts.deleteProjectFileObjects(projectId, fileIds);
  }

  async ownedFile(fileId: string, ownerId: string) {
    const result = await this.db.query<FileRow>(
      `SELECT id, bucket, object_name, generation::text, content_type
         FROM project_files WHERE id = $1 AND owner_id = $2`,
      [fileId, ownerId],
    );
    return result.rows[0];
  }

  async extractFrame(ownerId: string, project: StudioProject, versionId: string, requestedTime: number) {
    const version = project.versions.find((item) => item.id === versionId);
    if (!version) throw new Error("Video version not found.");
    const artifactId = version.videoUrl.match(/^\/api\/artifacts\/([0-9a-f-]{36})$/i)?.[1];
    if (!artifactId) throw new Error("That hosted video version is unavailable.");
    const result = await this.db.query<FileRow>(
      `SELECT id, bucket, object_name, generation::text, content_type
         FROM artifacts WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND kind = 'video'`,
      [artifactId, ownerId, project.id],
    );
    const artifact = result.rows[0];
    if (!artifact) throw new Error("That hosted video version is unavailable.");
    const fps = Math.max(1, Number(version.render?.fps || 30));
    const duration = Math.max(0, Number(version.render?.duration || 0));
    const time = Math.min(Math.max(Number.isFinite(requestedTime) ? requestedTime : 0, 0), Math.max(duration - 1 / fps, 0));
    const frame = Math.max(0, Math.round(time * fps));
    const directory = await mkdtemp(path.join(os.tmpdir(), "lesson-studio-frame-"));
    const output = path.join(directory, "frame.png");
    const url = await this.artifacts.signedReadUrl(artifact.bucket, artifact.object_name, Number(artifact.generation));
    await execFileAsync("ffmpeg", ["-nostdin", "-loglevel", "error", "-ss", (frame / fps).toFixed(6), "-i", url, "-frames:v", "1", output], { timeout: 90_000 });
    return { path: output, frame, time: frame / fps, fps, cleanup: () => rm(directory, { recursive: true, force: true }) };
  }
}
