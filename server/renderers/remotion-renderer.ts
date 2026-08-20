import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { VideoProjectIR } from "../../shared/video-ir.js";

let bundlePromise: Promise<string> | undefined;

function getBundle(root: string) {
  bundlePromise ||= bundle({ entryPoint: path.join(root, "remotion", "index.ts") });
  return bundlePromise;
}

function assetUrls(project: VideoProjectIR, projectDir: string) {
  return Object.fromEntries(project.assets.flatMap((asset) => {
    if (asset.sourceUrl) return [[asset.id, asset.sourceUrl]];
    if (!asset.localPath) return [];
    const absolute = path.isAbsolute(asset.localPath) ? asset.localPath : path.join(projectDir, asset.localPath);
    return [[asset.id, pathToFileURL(absolute).href]];
  }));
}

export async function renderRemotionProject(root: string, projectDir: string, project: VideoProjectIR, outputLocation: string) {
  const serveUrl = await getBundle(root);
  const inputProps = { project, assetUrls: assetUrls(project, projectDir) };
  const composition = await selectComposition({ serveUrl, id: "VideoProject", inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation,
    inputProps,
    concurrency: "50%",
    colorSpace: "bt709",
  });
  return outputLocation;
}
