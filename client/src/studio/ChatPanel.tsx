import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ArrowsLeftRight,
  CaretDown,
  Check,
  Code,
  ImageSquare,
  PushPin,
  SlidersHorizontal,
  Stop,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AuthState,
  BillingState,
  ColorPalette,
  FontCategory,
  GenerationEffort,
  GenerationIntent,
  ReviewFocus,
  ReviewStrictness,
  RuntimeState,
  StudioProject,
} from "../types";
import {
  clampEffort,
  THINKING_OPTIONS,
  videoEngineIsReady,
  type ChatMode,
  type ChatSide,
  type FloatingPosition,
} from "../lib/studio";
import { AgentActivity } from "./Progress";
import { AssetPicker } from "./AssetPicker";

const INTENT_OPTIONS: Array<{
  value: GenerationIntent;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Smart choice",
    description: "Reads the prompt and decides whether to edit or start fresh.",
  },
  {
    value: "revise",
    label: "Edit this video",
    description: "Changes this video and preserves everything else.",
  },
  {
    value: "new",
    label: "Separate video",
    description: "Creates a separate project from the default style.",
  },
];

/*
 * The old control here was a native <select> styled flat: no caret, no
 * disabled state, so "Smart choice" read as a label that swallowed clicks.
 * A real menu makes the choice visible and explains each option in place.
 */
function IntentMenu({
  value,
  disabled,
  onChange,
}: {
  value: GenerationIntent;
  disabled?: boolean;
  onChange: (value: GenerationIntent) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected =
    INTENT_OPTIONS.find((option) => option.value === value) ??
    INTENT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLButtonElement>("[aria-checked='true']")
      ?.focus();
  }, [open]);

  function moveFocus(delta: number) {
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitemradio']",
      ) ?? [],
    );
    if (!options.length) return;
    const index = options.findIndex(
      (option) => option === document.activeElement,
    );
    options[(index + delta + options.length) % options.length].focus();
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={`intent-control ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="intent-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Next prompt: ${selected.label}`}
        title="Choose how the next prompt is applied"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected.label}</span>
        <CaretDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="intent-menu"
          role="menu"
          aria-label="How to apply the next prompt"
          onKeyDown={onMenuKeyDown}
        >
          {INTENT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                close(true);
              }}
            >
              <span className="intent-option-label">
                {option.label}
                {option.value === value && (
                  <Check size={13} aria-hidden="true" />
                )}
              </span>
              <span className="intent-option-desc">{option.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingControl({
  value,
  disabled,
  maxEffort = "thorough",
  onChange,
}: {
  value: GenerationEffort;
  disabled?: boolean;
  maxEffort?: GenerationEffort;
  onChange: (value: GenerationEffort) => void;
}) {
  const selectedIndex = Math.max(
    0,
    THINKING_OPTIONS.findIndex((option) => option.value === value),
  );
  const maxIndex = Math.max(
    0,
    THINKING_OPTIONS.findIndex((option) => option.value === maxEffort),
  );
  return (
    <label className="thinking-control">
      <span className="thinking-heading">
        <span>Thinking</span>
        <strong>{THINKING_OPTIONS[selectedIndex].label}</strong>
      </span>
      <input
        type="range"
        min="0"
        max={maxIndex}
        step="1"
        value={selectedIndex}
        disabled={disabled}
        aria-label="Thinking effort"
        aria-valuetext={THINKING_OPTIONS[selectedIndex].label}
        onChange={(event) =>
          onChange(THINKING_OPTIONS[Number(event.target.value)].value)
        }
      />
      <span className="thinking-scale" aria-hidden="true">
        {THINKING_OPTIONS.map((option) => (
          <span key={option.value}>{option.label}</span>
        ))}
      </span>
    </label>
  );
}

export function ChatPanel({
  project,
  auth,
  billing,
  runtime,
  draft,
  sendError,
  sending,
  onDraft,
  onSend,
  onCancel,
  onReviewPreferences,
  onDesignPreferences,
  onNarrationPreferences,
  onGenerationPreferences,
  onNotify,
  mode,
  side,
  floatingPosition,
  onToggleMode,
  onToggleSide,
  onClose,
  onFloatingPosition,
}: {
  project?: StudioProject;
  auth: AuthState;
  billing: BillingState;
  runtime: RuntimeState;
  draft: string;
  sendError: string;
  sending: boolean;
  onDraft: (text: string) => void;
  onSend: (
    text: string,
    intent: GenerationIntent,
    effort: GenerationEffort,
  ) => Promise<boolean>;
  onCancel: () => void;
  onReviewPreferences: (
    focus: ReviewFocus,
    strictness: ReviewStrictness,
  ) => Promise<void>;
  onDesignPreferences: (changes: {
    fontCategory?: FontCategory;
    colorPalette?: ColorPalette;
  }) => Promise<void>;
  onNarrationPreferences: (enabled: boolean) => Promise<void>;
  onGenerationPreferences: (effort: GenerationEffort) => Promise<void>;
  onNotify: (message: string) => void;
  mode: ChatMode;
  side: ChatSide;
  floatingPosition: FloatingPosition;
  onToggleMode: () => void;
  onToggleSide: () => void;
  onClose: () => void;
  onFloatingPosition: (position: FloatingPosition) => void;
}) {
  const [intent, setIntent] = useState<GenerationIntent>("auto");
  const [generationEffort, setGenerationEffort] = useState<GenerationEffort>(
    clampEffort(
      project?.generationPreferences?.effort || "balanced",
      billing.entitlements.maxEffort,
    ),
  );
  const [assetsOpen, setAssetsOpen] = useState(false);
  const running = project?.status === "running";
  const hasPriorWork = Boolean(
    project?.threadId || project?.messages.length || project?.versions.length,
  );
  const videoReady = videoEngineIsReady(runtime);
  const suggestions = [
    "Explain eigenvectors geometrically",
    "How a Fourier series builds a square wave",
    "Why the derivative is a slope",
    "Bayes' theorem with real numbers",
  ];

  async function submit() {
    const value = draft.trim();
    if (!value || running || sending) return;
    const sent = await onSend(value, intent, generationEffort);
    if (sent) setIntent("auto");
  }

  function beginChatDrag(event: ReactPointerEvent<HTMLElement>) {
    if (
      mode !== "floating" ||
      (event.target as HTMLElement).closest("button, select, textarea, input")
    )
      return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = floatingPosition;
    const bounds = (event.currentTarget.closest(".chat-panel") as HTMLElement)
      ?.getBoundingClientRect();
    const panelWidth = bounds?.width || 500;
    const panelHeight = bounds?.height || 640;
    const move = (pointer: PointerEvent) => {
      onFloatingPosition({
        x: Math.min(
          Math.max(12, window.innerWidth - panelWidth - 12),
          Math.max(12, origin.x + pointer.clientX - startX),
        ),
        y: Math.min(
          Math.max(64, window.innerHeight - panelHeight - 12),
          Math.max(64, origin.y + pointer.clientY - startY),
        ),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <section
      className={`chat-panel chat-${mode}`}
      aria-label="Video chat"
      style={
        mode === "floating"
          ? { left: floatingPosition.x, top: floatingPosition.y }
          : undefined
      }
    >
      <header className="panel-header" onPointerDown={beginChatDrag}>
        <div className="chat-title">
          {/* Docked, the topbar already names the project, so the panel just
              labels itself; floated away it has to carry its own title. */}
          <h1>
            {mode === "floating"
              ? project?.title || "New video"
              : "Conversation"}
          </h1>
        </div>
        <div className="chat-window-controls">
          {mode === "docked" && (
            <button
              className="icon-button"
              onClick={onToggleSide}
              aria-label={`Move chat to the ${side === "left" ? "right" : "left"}`}
              title={`Move chat to the ${side === "left" ? "right" : "left"}`}
            >
              <ArrowsLeftRight size={16} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={onToggleMode}
            aria-label={mode === "floating" ? "Dock chat" : "Float chat"}
            title={mode === "floating" ? "Dock chat" : "Float chat"}
          >
            {mode === "floating" ? (
              <PushPin size={16} />
            ) : (
              <ArrowUpRight size={16} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Hide chat"
            title="Hide chat"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/*
        The list is rendered bottom-up inside a column-reverse container, so
        the browser keeps the scroll position pinned to the newest content
        while messages stream in - no scroll effect needed.
      */}
      {/* tabIndex keeps the transcript reachable by keyboard once it scrolls:
          it can hold no focusable content of its own. */}
      <div className="messages" tabIndex={0} role="log" aria-label="Conversation">
        {project?.error && (
          <div className="inline-error">
            <Warning size={15} />
            <span>{project.error}</span>
          </div>
        )}
        {project && <AgentActivity project={project} />}
        {project?.messages
          .map((message) => (
            <div className={`message message-${message.role}`} key={message.id}>
              <div className="message-bubble">
                {message.attachment?.type === "frameReview" && (
                  <div className="message-frame">
                    <img
                      src={message.attachment.imageUrl}
                      alt={`Annotated frame ${message.attachment.label}`}
                    />
                    <span>{message.attachment.label}</span>
                  </div>
                )}
                {message.text ||
                  (message.streaming ? (
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    ""
                  ))}
              </div>
            </div>
          ))
          .reverse()}
        {!project?.messages.length && (
          <div className="chat-empty">
            <h2 className="serif">Turn an idea into motion.</h2>
            <p>
              Describe the idea and the moment it should click. The studio
              plans the lesson, animates it, renders it, then reviews its own
              frames.
            </p>
            <div className="suggestions">
              <span className="suggestions-label">Try one of these</span>
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => onDraft(suggestion)}>
                  {suggestion}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
            <span className="chat-empty-hint">
              Enter sends · Shift + Enter adds a line
            </span>
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {!auth.connected && (
          <div className="runtime-callout">
            <Warning size={14} /> Generation service needs configuration
          </div>
        )}
        {!videoReady && (
          <div className="runtime-callout">
            <Code size={14} /> Video engine needs setup
          </div>
        )}

        <details className="creative-controls">
          <summary>
            <SlidersHorizontal size={15} />
            Creative controls
            <CaretDown className="creative-controls-caret" size={12} />
          </summary>
          <div className="creative-controls-body">
            {project && (
              <div
                className="generation-settings"
                aria-label="Generation settings"
              >
                <ThinkingControl
                  value={generationEffort}
                  maxEffort={billing.entitlements.maxEffort}
                  disabled={running}
                  onChange={(effort) => {
                    const previous = generationEffort;
                    setGenerationEffort(effort);
                    onGenerationPreferences(effort).catch(() =>
                      setGenerationEffort(previous),
                    );
                  }}
                />
              </div>
            )}
            {project && (
              <div
                className="review-settings"
                aria-label="Automatic review settings"
              >
                <label>
                  Review
                  <select
                    value={project.reviewPreferences?.focus || "balanced"}
                    disabled={running}
                    onChange={(event) =>
                      void onReviewPreferences(
                        event.target.value as ReviewFocus,
                        project.reviewPreferences?.strictness || "normal",
                      ).catch(() => undefined)
                    }
                  >
                    <option value="balanced">Balanced</option>
                    <option value="layout">Layout</option>
                    <option value="motion">Motion</option>
                    <option value="pedagogy">Teaching</option>
                    <option value="accessibility">Accessibility</option>
                    <option value="polish">Polish</option>
                  </select>
                </label>
                <label>
                  Depth
                  <select
                    value={project.reviewPreferences?.strictness || "normal"}
                    disabled={running}
                    onChange={(event) =>
                      void onReviewPreferences(
                        project.reviewPreferences?.focus || "balanced",
                        event.target.value as ReviewStrictness,
                      ).catch(() => undefined)
                    }
                  >
                    <option value="quick">Quick</option>
                    <option value="normal">Normal</option>
                    <option value="obsessive">Frame-heavy</option>
                  </select>
                </label>
              </div>
            )}
            {project && (
              <div
                className="design-settings"
                aria-label="Video style settings"
              >
                <label>
                  Font
                  <select
                    value={project.designPreferences?.fontCategory || "serif"}
                    disabled={running}
                    onChange={(event) =>
                      void onDesignPreferences({
                        fontCategory: event.target.value as FontCategory,
                      }).catch(() => undefined)
                    }
                  >
                    <option value="serif">Serif · Default</option>
                    <option value="sans">Sans</option>
                    <option value="mono">Mono</option>
                  </select>
                </label>
                <label>
                  Colors
                  <select
                    value={project.designPreferences?.colorPalette || "paper"}
                    disabled={running}
                    onChange={(event) =>
                      void onDesignPreferences({
                        colorPalette: event.target.value as ColorPalette,
                      }).catch(() => undefined)
                    }
                  >
                    <option value="paper">Paper · Default</option>
                    <option value="ochre">Ochre</option>
                    <option value="sage">Sage</option>
                    <option value="monochrome">Monochrome</option>
                  </select>
                </label>
              </div>
            )}
            {project && (
              <div
                className="narration-settings"
                aria-label="Narration settings"
              >
                <label>
                  AI voice
                  <select
                    value={
                      project.narrationPreferences?.enabled === false
                        ? "off"
                        : "on"
                    }
                    disabled={running}
                    onChange={(event) =>
                      void onNarrationPreferences(
                        event.target.value === "on",
                      ).catch(() => undefined)
                    }
                  >
                    <option
                      value="on"
                      disabled={!billing.entitlements.narration}
                    >
                      Speechify narration
                      {billing.entitlements.narration ? "" : " · Creator"}
                    </option>
                    <option value="off">Off · silent video</option>
                  </select>
                </label>
                <span>
                  {project.narrationPreferences?.enabled === false
                    ? "Silent video"
                    : "Generated during final render"}
                </span>
              </div>
            )}
          </div>
        </details>

        <label className="sr-only" htmlFor="prompt">
          Video prompt
        </label>
        <div className={`composer ${sendError ? "composer-error" : ""}`}>
          <textarea
            id="prompt"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              intent === "new"
                ? "Describe the separate video you want to create…"
                : project?.videoUrl
                  ? "Describe an edit, or ask for a completely new video…"
                  : "Describe the lesson you want to bring to life…"
            }
            rows={2}
            disabled={running}
          />
          <div className="composer-row">
            <div className="composer-tools">
              {/* The choice only means something once there is a video to
                  edit; before that the first prompt is always a new video,
                  so no dead-looking control is shown. */}
              {project && hasPriorWork && (
                <IntentMenu
                  value={intent}
                  disabled={running}
                  onChange={setIntent}
                />
              )}
              {project && (
                <button
                  type="button"
                  className="composer-tool"
                  onClick={() =>
                    billing.entitlements.licensedAssets
                      ? setAssetsOpen(true)
                      : onNotify(
                          "Licensed visual search is included with paid plans.",
                        )
                  }
                  disabled={running}
                >
                  <ImageSquare size={15} /> Add visual
                  {project.assets?.length ? ` · ${project.assets.length}` : ""}
                </button>
              )}
            </div>
            <div className="composer-submit">
              {running ? (
                <button
                  className="send-button stop-button"
                  onClick={onCancel}
                  aria-label="Stop generation"
                >
                  <Stop size={14} weight="fill" />
                </button>
              ) : (
                <button
                  className="send-button"
                  onClick={() => void submit()}
                  disabled={
                    !draft.trim() || sending || !auth.connected || !videoReady
                  }
                  aria-label="Send prompt"
                >
                  <ArrowUp size={15} weight="bold" />
                </button>
              )}
            </div>
          </div>
        </div>
        {sendError && <span className="form-error">{sendError}</span>}
        {intent !== "auto" && (
          <span className="composer-hint">
            {intent === "new"
              ? "Creates a separate project from the default style."
              : "Changes this video and preserves everything else."}
          </span>
        )}
      </div>
      {assetsOpen && project && (
        <AssetPicker project={project} onClose={() => setAssetsOpen(false)} />
      )}
    </section>
  );
}
