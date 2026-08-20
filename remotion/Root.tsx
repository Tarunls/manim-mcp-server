import React from "react";
import { Composition } from "remotion";
import { createEmptyVideoIR } from "../shared/video-ir";
import { VideoComposition, type VideoCompositionProps } from "./VideoComposition";

const defaultProject = createEmptyVideoIR("preview", "Preview");

export function RemotionRoot() {
  return (
    <Composition
      id="VideoProject"
      component={VideoComposition}
      width={defaultProject.format.width}
      height={defaultProject.format.height}
      fps={defaultProject.format.fps}
      durationInFrames={defaultProject.format.fps * defaultProject.format.duration}
      defaultProps={{ project: defaultProject, assetUrls: {} }}
      calculateMetadata={({ props }: { props: VideoCompositionProps }) => ({
        width: props.project.format.width,
        height: props.project.format.height,
        fps: props.project.format.fps,
        durationInFrames: Math.max(1, Math.ceil(props.project.format.duration * props.project.format.fps)),
      })}
    />
  );
}
