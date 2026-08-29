import {
  ArrowsOut,
  CircleNotch,
  ClockCounterClockwise,
  DownloadSimple,
  PencilSimple,
  SpeakerHigh,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { ProjectVersion, RuntimeState, StudioProject } from "../types";
import {
  generationLabel,
  stageLabel,
  videoEngineIsReady,
} from "../lib/studio";
import { FrameReviewDialog } from "./FrameReviewDialog";
import { ProgressVisual } from "./Progress";

export function VideoWorkspace({
  project,
  runtime,
}: {
  project?: StudioProject;
  runtime: RuntimeState;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  const versions = project?.versions || [];
  const selectedVersion: ProjectVersion | undefined =
    versions.find((version) => version.id === selectedVersionId) ||
    versions.at(-1);
  const videoUrl = selectedVersion?.videoUrl || project?.videoUrl;
  const posterUrl = selectedVersion?.posterUrl || project?.posterUrl;
  const rendererReady = videoEngineIsReady(runtime);
  const effectiveDuration = selectedVersion?.render?.duration || duration;
  const lastSafeFrame = Math.max(
    0,
    effectiveDuration -
      Math.max(0.25, 2 / (selectedVersion?.render?.fps || 30)),
  );
  const filmstripTimes =
    effectiveDuration > 0
      ? Array.from({ length: 7 }, (_, index) => (lastSafeFrame * index) / 6)
      : [];

  function selectVersion(versionId: string) {
    setSelectedVersionId(versionId);
    setCurrentTime(0);
    setDuration(0);
  }

  return (
    <section className="workspace" aria-label="Video preview">
      <div className="workspace-stage">
       <div className="stage-column">
        {versions.length > 0 && (
          <div className="revision-bar" aria-label="Video versions">
            <span className="revision-label">
              <ClockCounterClockwise size={14} /> Revisions
            </span>
            <div className="revision-list">
              {[...versions].reverse().map((version) => (
                <button
                  key={version.id}
                  className={selectedVersion?.id === version.id ? "active" : ""}
                  onClick={() => selectVersion(version.id)}
                  title={version.prompt}
                >
                  v{version.number}
                  {version.render?.width && (
                    <small>
                      {version.render.width === 1920
                        ? "HD"
                        : `${version.render.width}p`}
                    </small>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          ref={playerRef}
          className={`player-shell ${videoUrl ? "has-video" : ""}`}
        >
          {project?.status === "running" && videoUrl && (
            <div className="generation-overlay" aria-live="polite">
              <CircleNotch className="spin" size={15} />
              <div>
                <strong>
                  Creating {generationLabel(project).toLowerCase()}
                </strong>
                <span>
                  {stageLabel(project.stage)} · previewing v{versions.length}
                </span>
              </div>
            </div>
          )}
          {videoUrl ? (
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              poster={posterUrl}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              onLoadedMetadata={(event) =>
                setDuration(event.currentTarget.duration)
              }
            />
          ) : project?.status === "running" ? (
            <div className="render-state">
              <span className="kicker">Working</span>
              <h2>
                {project.stage === "rendering"
                  ? `Rendering ${generationLabel(project).toLowerCase()}`
                  : project.stage === "inspecting"
                    ? `Checking ${generationLabel(project).toLowerCase()}`
                    : `Building ${generationLabel(project).toLowerCase()}`}
              </h2>
              <p>
                Earlier revisions stay available above while this one is
                created.
              </p>
              <ProgressVisual project={project} />
            </div>
          ) : (
            <div className="canvas-empty">
              {/* A real rendered lesson, labelled as an example, so the first
                  screen shows what the studio makes instead of a black box. */}
              <video
                className="canvas-example"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/showcase/accumulation.jpg"
                src="/showcase/accumulation.mp4"
                aria-label="An example lesson rendered in Orune"
              />
              <div className="canvas-empty-copy">
                <span className="kicker">Example lesson</span>
                <h2>Yours appears here</h2>
                <p>
                  {rendererReady
                    ? "Describe a lesson and the render lands here the moment it is ready."
                    : "The video engine needs setup before it can render a preview."}
                </p>
              </div>
            </div>
          )}
        </div>
        {project && selectedVersion && filmstripTimes.length > 0 && (
          <div className="filmstrip" aria-label="Video frames">
            {filmstripTimes.map((time, index) => (
              <button
                key={index}
                className={
                  Math.abs(currentTime - time) <
                  Math.max(effectiveDuration / 12, 0.35)
                    ? "active"
                    : ""
                }
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = time;
                    videoRef.current.pause();
                    setCurrentTime(time);
                  }
                }}
                title={`Go to ${time.toFixed(1)} seconds`}
              >
                <img
                  src={`/api/projects/${project.id}/frames?version=${encodeURIComponent(selectedVersion.id)}&time=${time.toFixed(4)}`}
                  alt={`Frame at ${time.toFixed(1)} seconds`}
                />
                <span className="mono">{time.toFixed(1)}s</span>
              </button>
            ))}
          </div>
        )}
       </div>
      </div>

      <div className="workspace-footer">
        <span className="canvas-meta">
          {videoUrl ? (
            <>
              {effectiveDuration > 0 && (
                <span className="mono">{effectiveDuration.toFixed(1)}s</span>
              )}
              {selectedVersion?.render?.width && (
                <span className="mono">
                  {selectedVersion.render.width}×{selectedVersion.render.height}{" "}
                  · {selectedVersion.render.fps} fps
                </span>
              )}
              {selectedVersion?.render?.narration?.enabled && (
                <span
                  className="ai-voice"
                  title={`${selectedVersion.render.narration.model || "Speechify"}, ${selectedVersion.render.narration.voice || "configured voice"}`}
                >
                  <SpeakerHigh size={14} /> AI voice
                </span>
              )}
              {selectedVersion?.render?.narration?.status ===
                "setup_required" && <span>Speechify setup needed</span>}
            </>
          ) : (
            <span>16:9 · no render yet</span>
          )}
        </span>
        {videoUrl ? (
          <div className="video-actions">
            {project && selectedVersion && (
              <button
                className="button button-ghost review-frame-button"
                onClick={() => {
                  videoRef.current?.pause();
                  setCurrentTime(videoRef.current?.currentTime || currentTime);
                  setReviewOpen(true);
                }}
              >
                <PencilSimple size={16} /> Review frame
              </button>
            )}
            <button
              className="button button-ghost fullscreen-button"
              onClick={() => void playerRef.current?.requestFullscreen()}
            >
              <ArrowsOut size={16} /> Fullscreen
            </button>
            <a
              className="button button-secondary download-link"
              href={videoUrl}
              download={`${project?.title || "video"}.mp4`}
            >
              <DownloadSimple size={16} /> Download
            </a>
          </div>
        ) : (
          <span className="muted-action">
            <DownloadSimple size={15} /> Download
          </span>
        )}
      </div>
      {reviewOpen && project && selectedVersion && (
        <FrameReviewDialog
          project={project}
          version={selectedVersion}
          time={currentTime}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </section>
  );
}
