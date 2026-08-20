import type { AssetCandidate, AssetProviderId, AssetSearchQuery } from "../../shared/assets.js";
import type { AssetLicense } from "../../shared/video-ir.js";

export interface AssetProvider {
  id: AssetProviderId;
  available(): { available: boolean; reason?: string };
  search(query: AssetSearchQuery): Promise<AssetCandidate[]>;
}

function capped(query: AssetSearchQuery) {
  return Math.max(1, Math.min(query.limit || 12, 30));
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Asset provider returned ${response.status}.`);
  return response.json() as Promise<T>;
}

function openLicense(code = ""): AssetLicense {
  const normalized = code.toLowerCase();
  const publicDomain = normalized === "cc0" || normalized === "pdm";
  return {
    name: publicDomain ? normalized.toUpperCase() : `CC ${normalized.toUpperCase()}`,
    url: normalized ? `https://creativecommons.org/licenses/${normalized.replace(/^by-?/, "by-")}/4.0/` : undefined,
    commercialUse: !normalized.includes("nc"),
    modifications: !normalized.includes("nd"),
    attributionRequired: !publicDomain,
  };
}

export class PexelsProvider implements AssetProvider {
  id = "pexels" as const;
  available() {
    return process.env.PEXELS_API_KEY ? { available: true } : { available: false, reason: "Set PEXELS_API_KEY." };
  }
  async search(query: AssetSearchQuery) {
    if (!process.env.PEXELS_API_KEY) return [];
    const limit = capped(query);
    const headers = { Authorization: process.env.PEXELS_API_KEY };
    const license: AssetLicense = {
      name: "Pexels License",
      url: "https://www.pexels.com/license/",
      commercialUse: true,
      modifications: true,
      attributionRequired: true,
      attribution: "Photo or video provided by Pexels",
    };
    if (query.kind === "video") {
      const data = await json<{ videos: Array<any> }>(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query.query)}&per_page=${limit}`, { headers });
      return data.videos.flatMap((video) => {
        const file = [...(video.video_files || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (!file?.link) return [];
        return [{
          id: `pexels-video-${video.id}`,
          provider: this.id,
          kind: "video" as const,
          name: `Pexels video ${video.id}`,
          creator: video.user?.name,
          sourceUrl: video.url,
          downloadUrl: file.link,
          previewUrl: video.image,
          width: file.width,
          height: file.height,
          duration: video.duration,
          mimeType: file.file_type,
          tags: query.query.split(/\s+/),
          license: { ...license, attribution: video.user?.name ? `Video by ${video.user.name} on Pexels` : license.attribution },
          metadata: { pexelsId: video.id },
        }];
      });
    }
    const data = await json<{ photos: Array<any> }>(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query.query)}&per_page=${limit}`, { headers });
    return data.photos.map((photo) => ({
      id: `pexels-image-${photo.id}`,
      provider: this.id,
      kind: "image" as const,
      name: photo.alt || `Pexels photo ${photo.id}`,
      creator: photo.photographer,
      sourceUrl: photo.url,
      downloadUrl: photo.src.original,
      previewUrl: photo.src.medium,
      width: photo.width,
      height: photo.height,
      mimeType: "image/jpeg",
      tags: query.query.split(/\s+/),
      license: { ...license, attribution: `Photo by ${photo.photographer} on Pexels` },
      metadata: { pexelsId: photo.id, averageColor: photo.avg_color },
    }));
  }
}

export class OpenverseProvider implements AssetProvider {
  id = "openverse" as const;
  available() { return { available: true }; }
  async search(query: AssetSearchQuery) {
    if (query.kind && !["image", "audio"].includes(query.kind)) return [];
    const media = query.kind === "audio" ? "audio" : "images";
    const licenseType = query.commercialUse === false ? "all" : query.modifications === false ? "commercial" : "commercial,modification";
    const data = await json<{ results: Array<any> }>(`https://api.openverse.org/v1/${media}/?q=${encodeURIComponent(query.query)}&page_size=${capped(query)}&license_type=${encodeURIComponent(licenseType)}`);
    return data.results.flatMap((item) => {
      const downloadUrl = item.url || item.audio_set?.[0]?.url;
      if (!downloadUrl) return [];
      const license = openLicense(item.license);
      license.url = item.license_url || license.url;
      license.attribution = item.attribution;
      return [{
        id: `openverse-${media}-${item.id}`,
        provider: this.id,
        kind: media === "audio" ? "audio" as const : "image" as const,
        name: item.title || `${query.query} asset`,
        creator: item.creator,
        sourceUrl: item.foreign_landing_url || downloadUrl,
        downloadUrl,
        previewUrl: item.thumbnail,
        width: item.width,
        height: item.height,
        duration: item.duration,
        mimeType: item.filetype ? `${media === "audio" ? "audio" : "image"}/${item.filetype}` : undefined,
        tags: (item.tags || []).map((tag: any) => typeof tag === "string" ? tag : tag.name).filter(Boolean),
        license,
        metadata: { source: item.source, category: item.category },
      }];
    });
  }
}

export class PolyHavenProvider implements AssetProvider {
  id = "polyhaven" as const;
  available() { return { available: true }; }
  async search(query: AssetSearchQuery): Promise<AssetCandidate[]> {
    if (query.kind && !["model", "texture", "image"].includes(query.kind)) return [];
    const assets = await json<Record<string, any>>("https://api.polyhaven.com/assets?t=all");
    const terms = query.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = Object.entries(assets).filter(([, asset]) => {
      const haystack = `${asset.name} ${asset.description || ""} ${(asset.tags || []).join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).slice(0, capped(query));
    const candidates = await Promise.all(matching.map(async ([id, asset]): Promise<AssetCandidate | undefined> => {
      const files = await json<any>(`https://api.polyhaven.com/files/${id}`);
      const model = asset.type === 2;
      const texture = asset.type === 1;
      const choices = model ? files.blend || files.gltf : texture ? files.blend || files.DIFF : files.hdri;
      const findUrl = (value: any): string | undefined => {
        if (!value || typeof value !== "object") return undefined;
        if (typeof value.url === "string") return value.url;
        for (const child of Object.values(value)) { const found = findUrl(child); if (found) return found; }
        return undefined;
      };
      const downloadUrl = findUrl(choices) || findUrl(files);
      if (!downloadUrl) return undefined;
      const candidate: AssetCandidate = {
        id: `polyhaven-${id}`,
        provider: this.id,
        kind: model ? "model" as const : texture ? "texture" as const : "image" as const,
        name: asset.name,
        creator: Object.keys(asset.authors || {}).join(", "),
        sourceUrl: `https://polyhaven.com/a/${id}`,
        downloadUrl,
        previewUrl: asset.thumbnail_url,
        tags: asset.tags || [],
        license: { name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: true, modifications: true, attributionRequired: false },
        metadata: { polyHavenId: id, dimensions: asset.dimensions, polycount: asset.polycount },
      };
      return candidate;
    }));
    return candidates.filter((item): item is AssetCandidate => item !== undefined);
  }
}

export class IconifyProvider implements AssetProvider {
  id = "iconify" as const;
  available() { return { available: true }; }
  async search(query: AssetSearchQuery) {
    if (query.kind && query.kind !== "icon" && query.kind !== "image") return [];
    const data = await json<{ icons: string[] }>(`https://api.iconify.design/search?query=${encodeURIComponent(query.query)}&limit=${capped(query)}`);
    const prefixes = [...new Set(data.icons.map((icon) => icon.split(":")[0]))];
    const collections = await json<Record<string, any>>(`https://api.iconify.design/collections?prefixes=${encodeURIComponent(prefixes.join(","))}`);
    return data.icons.map((icon) => {
      const [prefix, name] = icon.split(":");
      const info = collections[prefix] || {};
      const spdx = String(info.license?.spdx || "");
      return {
        id: `iconify-${prefix}-${name}`,
        provider: this.id,
        kind: "icon" as const,
        name: name.replace(/-/g, " "),
        creator: info.author?.name,
        sourceUrl: info.author?.url || `https://icon-sets.iconify.design/${prefix}/${name}/`,
        downloadUrl: `https://api.iconify.design/${prefix}/${name}.svg`,
        previewUrl: `https://api.iconify.design/${prefix}/${name}.svg?width=128&height=128`,
        mimeType: "image/svg+xml",
        tags: [prefix, ...name.split("-")],
        license: {
          name: info.license?.title || spdx || "Unknown icon-set license",
          url: info.license?.url,
          commercialUse: !spdx.includes("NC"),
          modifications: !spdx.includes("ND"),
          attributionRequired: /CC-BY/i.test(spdx),
        },
        metadata: { collection: prefix, spdx },
      };
    });
  }
}
