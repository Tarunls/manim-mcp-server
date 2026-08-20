import type { AssetKind, AssetLicense } from "./video-ir.js";

export type AssetProviderId = "pexels" | "openverse" | "polyhaven" | "iconify";

export interface AssetSearchQuery {
  query: string;
  kind?: AssetKind;
  provider?: AssetProviderId;
  commercialUse?: boolean;
  modifications?: boolean;
  limit?: number;
}

export interface AssetCandidate {
  id: string;
  provider: AssetProviderId;
  kind: AssetKind;
  name: string;
  creator?: string;
  sourceUrl: string;
  downloadUrl: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  tags: string[];
  license: AssetLicense;
  metadata: Record<string, unknown>;
}

export interface AssetSearchResponse {
  query: AssetSearchQuery;
  providers: Array<{ id: AssetProviderId; available: boolean; reason?: string }>;
  results: AssetCandidate[];
}
