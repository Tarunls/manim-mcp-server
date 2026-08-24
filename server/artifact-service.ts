import { Storage } from "@google-cloud/storage";
import type { HostedJob } from "./hosted-generation-service.js";
import type { RenderInfo } from "./types.js";

export type ArtifactKind = "video" | "poster" | "contact_sheet" | "source_archive" | "metadata";

const definitions: Record<ArtifactKind, { filename: string; contentType: string; maxBytes: number; required: boolean }> = {
  video: { filename: "output.mp4", contentType: "video/mp4", maxBytes: 750 * 1024 * 1024, required: true },
  poster: { filename: "poster.png", contentType: "image/png", maxBytes: 20 * 1024 * 1024, required: false },
  contact_sheet: { filename: "contact-sheet.png", contentType: "image/png", maxBytes: 40 * 1024 * 1024, required: false },
  source_archive: { filename: "source.tar.gz", contentType: "application/gzip", maxBytes: 100 * 1024 * 1024, required: false },
  metadata: { filename: "metadata.json", contentType: "application/json", maxBytes: 1024 * 1024, required: true },
};

export type VerifiedArtifact = {
  kind: ArtifactKind;
  bucket: string;
  objectName: string;
  generation: number;
  contentType: string;
  byteSize: number;
  checksum: string;
};

export class ArtifactService {
  private readonly storage = new Storage();

  get configured() {
    return Boolean(process.env.STUDIO_ARTIFACT_BUCKET);
  }

  private bucketName() {
    const name = process.env.STUDIO_ARTIFACT_BUCKET?.trim();
    if (!name) throw new Error("STUDIO_ARTIFACT_BUCKET is required for hosted generation.");
    return name;
  }

  private objectName(jobId: string, kind: ArtifactKind) {
    return `generation-jobs/${jobId}/${definitions[kind].filename}`;
  }

  async createUploadManifest(job: HostedJob) {
    const bucket = this.storage.bucket(this.bucketName());
    const expires = Date.now() + 30 * 60_000;
    const uploads = await Promise.all((Object.keys(definitions) as ArtifactKind[]).map(async (kind) => {
      const definition = definitions[kind];
      const objectName = this.objectName(job.id, kind);
      const [url] = await bucket.file(objectName).getSignedUrl({
        version: "v4",
        action: "write",
        expires,
        contentType: definition.contentType,
      });
      return { kind, url, objectName, contentType: definition.contentType, required: definition.required };
    }));
    return { bucket: bucket.name, expiresAt: new Date(expires).toISOString(), uploads };
  }

  async verify(job: HostedJob, reportedKinds: ArtifactKind[]) {
    const uniqueKinds = [...new Set(reportedKinds)];
    for (const [kind, definition] of Object.entries(definitions) as [ArtifactKind, typeof definitions[ArtifactKind]][]) {
      if (definition.required && !uniqueKinds.includes(kind)) throw new Error(`The sandbox did not report the required ${kind} artifact.`);
    }
    const bucket = this.storage.bucket(this.bucketName());
    const verified: VerifiedArtifact[] = [];
    for (const kind of uniqueKinds) {
      const definition = definitions[kind];
      if (!definition) throw new Error("The sandbox reported an unsupported artifact kind.");
      const objectName = this.objectName(job.id, kind);
      const file = bucket.file(objectName);
      const [metadata] = await file.getMetadata();
      const byteSize = Number(metadata.size || 0);
      const contentType = metadata.contentType || "";
      const generation = Number(metadata.generation || 0);
      const checksum = metadata.crc32c || metadata.md5Hash || "";
      if (!byteSize || byteSize > definition.maxBytes) throw new Error(`The ${kind} artifact has an invalid size.`);
      if (contentType !== definition.contentType) throw new Error(`The ${kind} artifact has an invalid content type.`);
      if (!generation || !checksum) throw new Error(`The ${kind} artifact is missing immutable storage metadata.`);
      verified.push({ kind, bucket: bucket.name, objectName, generation, contentType, byteSize, checksum });
    }
    return verified;
  }

  async readRenderMetadata(jobId: string): Promise<RenderInfo> {
    const [contents] = await this.storage.bucket(this.bucketName()).file(this.objectName(jobId, "metadata")).download();
    if (contents.length > definitions.metadata.maxBytes) throw new Error("Render metadata is too large.");
    const parsed = JSON.parse(contents.toString("utf8")) as RenderInfo;
    if (!parsed || typeof parsed !== "object") throw new Error("Render metadata is invalid.");
    return parsed;
  }

  async signedReadUrl(bucketName: string, objectName: string, generation: number) {
    if (bucketName !== this.bucketName()) throw new Error("Artifact bucket mismatch.");
    const [url] = await this.storage.bucket(bucketName).file(objectName, { generation }).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 10 * 60_000,
      responseDisposition: "inline",
    });
    return url;
  }

  async storeProjectFile(projectId: string, fileId: string, filename: string, contentType: string, contents: Buffer) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
    const objectName = `project-files/${projectId}/${fileId}/${safeFilename}`;
    const file = this.storage.bucket(this.bucketName()).file(objectName);
    await file.save(contents, {
      resumable: contents.length > 8 * 1024 * 1024,
      validation: "crc32c",
      metadata: { contentType, cacheControl: "private, max-age=3600" },
    });
    const [metadata] = await file.getMetadata();
    return {
      bucket: this.bucketName(),
      objectName,
      generation: Number(metadata.generation),
      contentType: metadata.contentType || contentType,
      byteSize: Number(metadata.size || contents.length),
      checksum: metadata.crc32c || metadata.md5Hash || "",
    };
  }
}
