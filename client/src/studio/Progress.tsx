import { Check, CircleNotch, Warning } from "@phosphor-icons/react";
import type { StudioProject } from "../types";
import { generationLabel, stageLabel } from "../lib/studio";

const STAGES = [
  { key: "brief", label: "Plan" },
  { key: "authoring", label: "Draw" },
  { key: "rendering", label: "Render" },
  { key: "inspecting", label: "Review" },
] as const;

function clockTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AgentActivity({ project }: { project: StudioProject }) {
  if (project.status !== "running") return null;
  const actions = project.actions.slice(-3);
  return (
    <div className="agent-activity" aria-live="polite">
      <div className="agent-heading">
        <span className="status-dot" data-state="running" aria-hidden="true" />
        <strong>{generationLabel(project)}</strong>
        <span>{stageLabel(project.stage)}</span>
      </div>
      {actions.length > 0 && (
        <div className="action-list">
          {actions.map((action) => (
            <div
              className={`action-row action-row-${action.status}`}
              key={action.id}
            >
              {action.status === "running" ? (
                <CircleNotch className="spin" size={13} />
              ) : action.status === "failed" ? (
                <Warning size={13} />
              ) : (
                <Check size={13} />
              )}
              <span>{action.label}</span>
              {clockTime(action.createdAt) && (
                <span className="mono">{clockTime(action.createdAt)}</span>
              )}
            </div>
          ))}
        </div>
      )}
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
      <div className="progress-track" aria-hidden="true">
        <span
          style={{ transform: `scaleX(${Math.max(0.06, activeIndex / 3)})` }}
        />
      </div>
      <div className="progress-steps">
        {STAGES.map((stage, index) => (
          <span
            className={`progress-step ${
              index < activeIndex
                ? "progress-done"
                : index === activeIndex
                  ? "progress-active"
                  : "progress-pending"
            }`}
            key={stage.key}
          >
            <i aria-hidden="true" />
            {stage.label}
          </span>
        ))}
      </div>
      <p className="progress-caption">
        <span>{generationLabel(project)}</span>
        <span>step {activeIndex + 1} of 4</span>
      </p>
    </div>
  );
}
