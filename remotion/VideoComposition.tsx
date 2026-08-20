import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ClipTransform, VideoAsset, VideoClip, VideoProjectIR } from "../shared/video-ir";

export interface VideoCompositionProps {
  project: VideoProjectIR;
  assetUrls?: Record<string, string>;
}

function animatedTransform(clip: VideoClip, localFrame: number, fps: number): ClipTransform & { volume: number } {
  const output = { ...clip.transform, volume: Number(clip.style.volume ?? 1) };
  for (const animation of clip.animations) {
    const numeric = animation.keyframes.filter((keyframe) => typeof keyframe.value === "number");
    if (!numeric.length) continue;
    const frames = numeric.map((keyframe) => keyframe.time * fps);
    const values = numeric.map((keyframe) => keyframe.value as number);
    const value = interpolate(localFrame, frames, values, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (animation.property === "volume") output.volume = value;
    else output[animation.property] = value;
  }
  return output;
}

function resolveAsset(asset: VideoAsset | undefined, assetUrls: Record<string, string>) {
  if (!asset) return undefined;
  return assetUrls[asset.id] || asset.sourceUrl || asset.localPath;
}

function ClipLayer({ clip, assets, assetUrls }: { clip: VideoClip; assets: VideoAsset[]; assetUrls: Record<string, string> }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const transform = animatedTransform(clip, frame, fps);
  const asset = clip.assetId ? assets.find((candidate) => candidate.id === clip.assetId) : undefined;
  const src = resolveAsset(asset, assetUrls);
  const sharedStyle: React.CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${transform.x}px)`,
    top: `calc(50% + ${transform.y}px)`,
    width: transform.width,
    height: transform.height,
    opacity: transform.opacity,
    transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${transform.scale})`,
    transformOrigin: "center",
    overflow: "hidden",
    ...clip.style,
  };

  if (clip.kind === "audio" && src) return <Audio src={src} volume={transform.volume} />;
  if (clip.kind === "asset" && src && asset?.kind === "video") return <OffthreadVideo src={src} style={sharedStyle} volume={transform.volume} />;
  if (clip.kind === "asset" && src) return <Img src={src} style={{ ...sharedStyle, objectFit: String(clip.style.objectFit || "cover") as React.CSSProperties["objectFit"] }} />;
  if (clip.kind === "shape") return <div style={{ ...sharedStyle, background: String(clip.style.background || "#356859") }} />;

  return (
    <div
      style={{
        ...sharedStyle,
        display: "flex",
        alignItems: clip.kind === "caption" ? "flex-end" : "center",
        justifyContent: "center",
        padding: Number(clip.style.padding ?? 24),
        color: String(clip.style.color || "#1d1d1b"),
        fontFamily: String(clip.style.fontFamily || "Manrope, sans-serif"),
        fontSize: Number(clip.style.fontSize || 64),
        fontWeight: Number(clip.style.fontWeight || 650),
        lineHeight: Number(clip.style.lineHeight || 1.08),
        textAlign: String(clip.style.textAlign || "center") as React.CSSProperties["textAlign"],
      }}
    >
      {clip.text || clip.name}
    </div>
  );
}

export function VideoComposition({ project, assetUrls = {} }: VideoCompositionProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: project.format.background || project.design.colors.background }}>
      {project.shots.map((shot) => (
        <Sequence key={shot.id} from={Math.round(shot.start * fps)} durationInFrames={Math.max(1, Math.round(shot.duration * fps))} name={shot.name}>
          <AbsoluteFill>
            {shot.tracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => (
              <Sequence key={clip.id} from={Math.round(clip.start * fps)} durationInFrames={Math.max(1, Math.round(clip.duration * fps))} name={clip.name}>
                <ClipLayer clip={clip} assets={project.assets} assetUrls={assetUrls} />
              </Sequence>
            )))}
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
