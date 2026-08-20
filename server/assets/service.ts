import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AssetCandidate, AssetProviderId, AssetSearchQuery, AssetSearchResponse } from "../../shared/assets.js";
import type { VideoAsset } from "../../shared/video-ir.js";
import { IconifyProvider, OpenverseProvider, PexelsProvider, PolyHavenProvider, type AssetProvider } from "./providers.js";

const MAX_ASSET_BYTES = 150 * 1024 * 1024;

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

export async function assertSafeRemoteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS assets may be imported.");
  if (url.username || url.password || url.port) throw new Error("Asset URLs may not contain credentials or custom ports.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Private network asset URLs are blocked.");
  return url;
}

function extension(candidate: AssetCandidate) {
  const pathname = new URL(candidate.downloadUrl).pathname;
  const found = path.extname(pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(found)) return found;
  const byMime: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/svg+xml": ".svg", "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/wav": ".wav" };
  return byMime[candidate.mimeType || ""] || ".bin";
}

export class AssetService {
  readonly providers: AssetProvider[] = [new PexelsProvider(), new OpenverseProvider(), new PolyHavenProvider(), new IconifyProvider()];

  async search(query: AssetSearchQuery): Promise<AssetSearchResponse> {
    const selected = query.provider ? this.providers.filter((provider) => provider.id === query.provider) : this.providers;
    const settled = await Promise.allSettled(selected.filter((provider) => provider.available().available).map((provider) => provider.search(query)));
    const results = settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter((candidate) => query.commercialUse === false || candidate.license.commercialUse)
      .filter((candidate) => query.modifications === false || candidate.license.modifications)
      .slice(0, Math.max(1, Math.min(query.limit || 24, 60)));
    return {
      query,
      providers: this.providers.map((provider) => ({ id: provider.id, ...provider.available() })),
      results,
    };
  }

  async import(projectDir: string, candidate: AssetCandidate): Promise<VideoAsset> {
    if (!this.providers.some((provider) => provider.id === candidate.provider)) throw new Error("Unknown asset provider.");
    await assertSafeRemoteUrl(candidate.downloadUrl);
    const response = await fetch(candidate.downloadUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`Asset download failed with ${response.status}.`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_ASSET_BYTES) throw new Error("Asset exceeds the 150 MB import limit.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_ASSET_BYTES) throw new Error("Asset exceeds the 150 MB import limit.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const assetsDir = path.join(projectDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const filename = `${hash.slice(0, 16)}${extension(candidate)}`;
    const target = path.join(assetsDir, filename);
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
    return {
      id: randomUUID(),
      kind: candidate.kind,
      name: candidate.name,
      sourceUrl: candidate.sourceUrl,
      localPath: path.join("assets", filename),
      provider: candidate.provider,
      creator: candidate.creator,
      license: candidate.license,
      hash,
      width: candidate.width,
      height: candidate.height,
      duration: candidate.duration,
      mimeType: candidate.mimeType || response.headers.get("content-type") || undefined,
      tags: candidate.tags,
      provenance: { importedAt: new Date().toISOString(), providerId: candidate.id, ...candidate.metadata },
    };
  }
}

export function parseProvider(value: unknown): AssetProviderId | undefined {
  return ["pexels", "openverse", "polyhaven", "iconify"].includes(String(value)) ? value as AssetProviderId : undefined;
}
