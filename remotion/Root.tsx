import React from "react";
import { Composition } from "remotion";
import { createEmptyVideoIR } from "../shared/video-ir";
import { VideoComposition, type VideoCompositionProps } from "./VideoComposition";

const defaultProject = createEmptyVideoIR("preview", "Preview");

export function RemotionRoot() {
  return (
    <Composition
      id="VideoProject"
      component={VideoComposition as React.FC<Record<string, unknown>>}
      width={defaultProject.format.width}
      height={defaultProject.format.height}
      fps={defaultProject.format.fps}
      durationInFrames={defaultProject.format.fps * defaultProject.format.duration}
      defaultProps={{ project: defaultProject, assetUrls: {} }}
      calculateMetadata={({ props }) => {
        const typed = props as VideoCompositionProps;
        return {
          width: typed.project.format.width,
          height: typed.project.format.height,
          fps: typed.project.format.fps,
          durationInFrames: Math.max(1, Math.ceil(typed.project.format.duration * typed.project.format.fps)),
        };
      }}
    />
  );
}
