import { Check, Warning } from "@phosphor-icons/react";
import type { AgentAction, StudioProject } from "../types";
import { generationLabel, stageLabel } from "../lib/studio";

const STAGES = [
  { key: "brief", label: "Plan" },
  { key: "authoring", label: "Draw" },
  { key: "rendering", label: "Render" },
  { key: "inspecting", label: "Review" },
] as const;

/* The feed stays readable on long runs: the last few steps in full, with a
   quiet count standing in for everything older. */
const MAX_VISIBLE_ACTIONS = 6;

function clockTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* "Step 3 of 5 - write the scene beats" → a small chip plus the sentence.
   Presentation only: nothing is invented, and labels without the prefix pass
   through untouched. */
function splitStep(label: string): { step?: string; text: string } {
  const match = label.match(/^step\s+(\d+)\s+of\s+(\d+)\s*(?:[-–—·:]\s*)?(.*)$/i);
  const rest = match?.[3].trim();
  if (!match || !rest) return { text: label };
  return {
    step: `${match[1]}/${match[2]}`,
    text: rest.charAt(0).toUpperCase() + rest.slice(1),
  };
}

function ActionRow({
  action,
  latest,
  working,
}: {
  action: AgentAction;
  latest: boolean;
  working: boolean;
}) {
  const { step, text } = splitStep(action.label);
  const time = clockTime(action.createdAt);
  const pulsing = working && action.status !== "failed";
  return (
    <div
      className={`action-row action-row-${action.status} ${latest ? "action-row-latest" : ""}`}
      data-working={pulsing || undefined}
    >
      <span className="action-marker" aria-hidden="true">
        {pulsing ? (
          <i className="working-dot" />
        ) : action.status === "failed" ? (
          <Warning size={12} />
        ) : (
          <Check size={12} />
        )}
      </span>
      <span className="action-label">
        {step && <span className="action-chip mono">Step {step}</span>}
        {text}
      </span>
      {time && <span className="action-time mono">{time}</span>}
    </div>
  );
}

export function AgentActivity({ project }: { project: StudioProject }) {
  if (project.status !== "running") return null;
  const hiddenCount = Math.max(0, project.actions.length - MAX_VISIBLE_ACTIONS);
  const actions = project.actions.slice(-MAX_VISIBLE_ACTIONS);
  const latestId = actions.at(-1)?.id;
  return (
    <div className="agent-activity" aria-live="polite">
      <div className="agent-heading">
        <span className="status-dot" data-state="running" aria-hidden="true" />
        <strong>{generationLabel(project)}</strong>
        <span>{stageLabel(project.stage)}</span>
      </div>
      <div className="action-list">
        {hiddenCount > 0 && (
          <span className="action-earlier">
            {hiddenCount} earlier step{hiddenCount === 1 ? "" : "s"}
          </span>
        )}
        {actions.length === 0 ? (
          /* Never an empty feed: while the run spins up, one synthetic row
             carries the liveness signal. */
          <div className="action-row action-row-latest" data-working="true">
            <span className="action-marker" aria-hidden="true">
              <i className="working-dot" />
            </span>
            <span className="action-label">Waiting for the workspace…</span>
          </div>
        ) : (
          actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              latest={action.id === latestId}
              working={action.id === latestId}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function ProgressVisual({ project }: { project: StudioProject }) {
  const stageIndex = STAGES.findIndex((stage) => stage.key === project.stage);
  const complete = project.stage === "complete";
  const activeIndex = complete ? STAGES.length - 1 : Math.max(0, stageIndex);
  /* Half a segment past the stages already cleared, so the bar visibly moves
     on every stage change yet never claims to be done early. */
  const fill = complete ? 1 : (activeIndex + 0.5) / STAGES.length;
  return (
    <div className="progress-block">
      <div className="progress-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${fill})` }} />
      </div>
      <div className="progress-steps">
        {STAGES.map((stage, index) => (
          <span
            className={`progress-step ${
              index < activeIndex || complete
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
