import { AssetService, parseProvider } from "../server/assets/service.js";
import type { AssetKind } from "../shared/video-ir.js";

const query = String(process.argv[2] || "").trim();
if (!query) throw new Error("Usage: search_assets.ts QUERY [KIND] [PROVIDER]");
const kind = process.argv[3] as AssetKind | undefined;
const provider = parseProvider(process.argv[4]);
const result = await new AssetService().search({ query, kind, provider, commercialUse: true, modifications: true, limit: 12 });
console.log(JSON.stringify(result, null, 2));
