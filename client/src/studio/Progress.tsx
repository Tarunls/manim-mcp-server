import {
  Check,
  CircleNotch,
  Code,
  MagicWand,
  MonitorPlay,
  Sparkle,
  Warning,
} from "@phosphor-icons/react";
import type { StudioProject } from "../types";
import { generationLabel, stageLabel } from "../lib/studio";

const STAGES = [
  { key: "brief", icon: MagicWand, label: "Plan" },
  { key: "authoring", icon: Code, label: "Draw" },
  { key: "rendering", icon: MonitorPlay, label: "Render" },
  { key: "inspecting", icon: Sparkle, label: "Review" },
] as const;

export function AgentActivity({ project }: { project: StudioProject }) {
  if (project.status !== "running") return null;
  return (
    <div className="agent-activity" aria-live="polite">
      <div className="agent-heading">
        <strong>{generationLabel(project)}</strong>
        <span>{stageLabel(project.stage)}</span>
      </div>
      <div className="action-list">
        {project.actions.slice(-3).map((action) => (
          <div className="action-row" key={action.id}>
            {action.status === "running" ? (
              <CircleNotch className="spin" size={13} />
            ) : action.status === "failed" ? (
              <Warning size={13} />
            ) : (
              <Check size={13} />
            )}
            <span>{action.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressVisual({ project }: { project: StudioProject }) {
  const activeIndex = Math.max(
    0,
    STAGES.findIndex((stage) => stage.key === project.stage),
  );
  return (
    <div className="progress-block">
      <strong>{generationLabel(project)}</strong>
      <span className="progress-caption">
        {activeIndex + 1} of 4 · {stageLabel(project.stage)}
      </span>
      <div className="progress-visual">
        <div className="progress-track" aria-hidden="true">
          <span
            style={{ transform: `scaleX(${Math.max(0.08, activeIndex / 3)})` }}
          />
        </div>
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          const state =
            index < activeIndex
              ? "done"
              : index === activeIndex
                ? "active"
                : "pending";
          return (
            <div className={`progress-step progress-${state}`} key={stage.key}>
              <span>
                {state === "done" ? <Check size={16} /> : <Icon size={17} />}
              </span>
              <small>{stage.label}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}
