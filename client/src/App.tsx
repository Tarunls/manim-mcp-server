import {
  ArrowDown,
  ArrowRight,
  ArrowsLeftRight,
  ArrowsOut,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  Code,
  DownloadSimple,
  FilmSlate,
  GearSix,
  List,
  MagicWand,
  MagnifyingGlass,
  MonitorPlay,
  ImageSquare,
  PencilSimple,
  Rectangle,
  ArrowUpRight,
  Circle,
  Trash,
  PaperPlaneRight,
  Play,
  Plus,
  PushPin,
  Sparkle,
  SlidersHorizontal,
  SpeakerHigh,
  SignOut,
  Star,
  Stop,
  UserCircle,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as CanvasPointerEvent,
} from "react";
import type {
  AuthState,
  BillingPlanId,
  BillingState,
  ColorPalette,
  FontCategory,
  GenerationEffort,
  GenerationIntent,
  PricingPlan,
  ProjectVersion,
  RendererKind,
  ReviewFocus,
  ReviewStrictness,
  RuntimeState,
  SendMessageResult,
  StudioEvent,
  StudioProject,
} from "./types";

const EMPTY_AUTH: AuthState = { connected: false };
const EMPTY_RUNTIME: RuntimeState = {
  codex: false,
  manim: false,
  remotion: false,
  ffmpeg: false,
};
const EMPTY_BILLING: BillingState = {
  userId: "",
  plan: "free",
  planName: "Free",
  status: "free",
  creditsUsed: 0,
  creditsRemaining: 1,
  periodEnd: "",
  stripeConfigured: false,
  hasStripeCustomer: false,
  isStaff: false,
  billingMode: "unconfigured",
  entitlements: {
    creditsPerMonth: 1,
    maxEffort: "quick",
    narration: false,
    licensedAssets: false,
  },
};
type ChatMode = "docked" | "floating";
type ChatSide = "left" | "right";
type FloatingPosition = { x: number; y: number };
type AccountUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  isStaff: boolean;
};
type AccountState = {
  checked: boolean;
  configured: boolean;
  authenticated: boolean;
  user?: AccountUser;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const csrfToken = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("lesson_studio_csrf="))
    ?.slice("lesson_studio_csrf=".length);
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...(method === "POST" &&
      /\/api\/projects\/[^/]+\/(?:messages|reviews)$/.test(url)
        ? { "Idempotency-Key": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Something went wrong.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function mergeProject(projects: StudioProject[], project: StudioProject) {
  const next = projects.filter((item) => item.id !== project.id);
  return [project, ...next].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function shortDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function videoEngineIsReady(runtime: RuntimeState) {
  return runtime.manim && runtime.remotion;
}

function rendererLabel(renderer?: RendererKind) {
  return renderer === "remotion"
    ? "Remotion"
    : renderer === "composite"
      ? "Composite"
      : "Manim";
}

function rendererIsReady(renderer: RendererKind, runtime: RuntimeState) {
  return renderer === "manim"
    ? runtime.manim
    : renderer === "remotion"
      ? runtime.remotion
      : videoEngineIsReady(runtime);
}

const THINKING_OPTIONS: Array<{ value: GenerationEffort; label: string }> = [
  { value: "quick", label: "Faster" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Try harder" },
];

function clampEffort(value: GenerationEffort, max: GenerationEffort) {
  const valueIndex = THINKING_OPTIONS.findIndex(
    (option) => option.value === value,
  );
  const maxIndex = THINKING_OPTIONS.findIndex((option) => option.value === max);
  return THINKING_OPTIONS[Math.min(valueIndex, maxIndex)].value;
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

function generationLabel(project: StudioProject) {
  return project.versions.length
    ? `Revision ${project.versions.length + 1}`
    : "First draft";
}

function Sidebar({
  projects,
  activeId,
  billing,
  account,
  open,
  collapsed,
  onClose,
  onToggle,
  onNew,
  onSelect,
  onFavorite,
  onBilling,
  onAccount,
  onLogout,
}: {
  projects: StudioProject[];
  activeId?: string;
  billing: BillingState;
  account: AccountUser;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onFavorite: (project: StudioProject) => void;
  onBilling: () => void;
  onAccount: () => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className={`sidebar ${open ? "sidebar-open" : ""} ${collapsed ? "sidebar-is-collapsed" : ""}`}
      aria-label="Projects"
    >
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <FilmSlate size={18} weight="fill" />
        </div>
        <span className="collapsible-copy">Lesson Studio</span>
        <button
          className="icon-button sidebar-toggle desktop-only"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <CaretRight size={18} /> : <CaretLeft size={18} />}
        </button>
        <button
          className="icon-button mobile-only"
          onClick={onClose}
          aria-label="Close projects"
        >
          <X size={18} />
        </button>
      </div>

      <button className="new-button" onClick={onNew}>
        <Plus size={16} />
        <span className="collapsible-copy">New video</span>
      </button>

      <nav className="project-list" aria-label="Recent projects">
        {projects.map((project) => (
          <button
            className={`project-item ${activeId === project.id ? "project-item-active" : ""}`}
            key={project.id}
            onClick={() => onSelect(project.id)}
          >
            <span className="project-icon">
              <Play size={12} weight="fill" />
            </span>
            <span className="project-copy collapsible-copy">
              <span className="project-title">{project.title}</span>
              <span className="project-time">
                {project.status === "running"
                  ? `Creating v${project.versions.length + 1}`
                  : shortDate(project.updatedAt)}
              </span>
            </span>
            <span
              className={`favorite-button collapsible-copy ${project.favorite ? "favorite-active" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${project.favorite ? "Remove" : "Add"} ${project.title} ${project.favorite ? "from" : "to"} favorites`}
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(project);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onFavorite(project);
                }
              }}
            >
              <Star size={15} weight={project.favorite ? "fill" : "regular"} />
            </span>
          </button>
        ))}
      </nav>

      <div className="account-area">
        <div className="account-card">
          <UserCircle size={23} weight="fill" />
          <div className="account-copy collapsible-copy">
            <span title={account.email}>
              {account.isStaff ? "Studio team" : account.email}
            </span>
            <button className="billing-summary" onClick={onBilling}>
              {billing.planName} · {billing.creditsRemaining} credits
            </button>
          </div>
          <button
            className="account-logout collapsible-copy"
            onClick={onAccount}
            aria-label="Account settings"
            title="Account settings"
          >
            <GearSix size={17} />
          </button>
          <button
            className="account-logout collapsible-copy"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOut size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function AgentActivity({ project }: { project: StudioProject }) {
  if (project.status !== "running") return null;
  return (
    <div className="agent-activity" aria-live="polite">
      <div className="agent-heading">
        <span className="agent-orb">
          <Sparkle size={14} weight="fill" />
        </span>
        <strong>{generationLabel(project)}</strong>
        <span>
          {project.stage === "brief"
            ? "Planning"
            : project.stage === "rendering"
              ? "Rendering"
              : project.stage === "inspecting"
                ? "Checking every frame"
                : "Building"}
        </span>
      </div>
      <div className="action-list">
        {project.actions.slice(-3).map((action) => (
          <div className="action-row" key={action.id}>
            {action.status === "running" ? (
              <CircleNotch className="spin" size={14} />
            ) : action.status === "failed" ? (
              <Warning size={14} />
            ) : (
              <Check size={14} />
            )}
            <span>{action.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegacyChatPanel({
  project,
  auth,
  runtime,
  onSend,
  onCancel,
  onReviewPreferences,
  onDesignPreferences,
  onNarrationPreferences,
  onGenerationPreferences,
}: {
  project?: StudioProject;
  auth: AuthState;
  runtime: RuntimeState;
  onSend: (
    text: string,
    renderer: RendererKind,
    intent: GenerationIntent,
    effort: GenerationEffort,
  ) => Promise<void>;
  onCancel: () => Promise<void>;
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
}) {
  const [text, setText] = useState("");
  const [renderer, setRenderer] = useState<RendererKind>(
    project?.renderer || "composite",
  );
  const [intent, setIntent] = useState<GenerationIntent>("auto");
  const [generationEffort, setGenerationEffort] = useState<GenerationEffort>(
    project?.generationPreferences?.effort || "balanced",
  );
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const running = project?.status === "running";
  const hasPriorWork = Boolean(
    project?.threadId || project?.messages.length || project?.versions.length,
  );
  const rendererLocked = (hasPriorWork && intent !== "new") || running;
  const rendererReady = rendererIsReady(renderer, runtime);
  const suggestions = [
    "Animate the Pythagorean theorem",
    "Explain gradient descent visually",
    "Show how a Fourier series builds a square wave",
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [project?.messages.length, project?.actions.length]);

  useEffect(() => {
    setRenderer(project?.renderer || "composite");
    setGenerationEffort(project?.generationPreferences?.effort || "balanced");
    setIntent("auto");
  }, [project?.id, project?.renderer]);

  async function submit() {
    const value = text.trim();
    if (!value || running) return;
    setError("");
    try {
      await onSend(value, renderer, intent, generationEffort);
      setText("");
      setIntent("auto");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not send the prompt.",
      );
    }
  }

  return (
    <section className="chat-panel" aria-label="Video chat">
      <header className="panel-header">
        <div>
          <span className="panel-kicker">Create</span>
          <h1>{project?.title || "New video"}</h1>
        </div>
      </header>

      <div className="messages">
        {!project?.messages.length && (
          <div className="chat-empty">
            <span className="empty-chat-icon">
              <MagicWand size={21} />
            </span>
            <h2>What should move?</h2>
            <p>
              Describe the idea, then choose the renderer that best matches the
              lesson.
            </p>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>
                  {suggestion}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        {project?.messages.map((message) => (
          <div className={`message message-${message.role}`} key={message.id}>
            {message.role === "assistant" && (
              <span className="message-avatar">
                <Sparkle size={13} weight="fill" />
              </span>
            )}
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
        ))}

        {project && <AgentActivity project={project} />}

        {project?.error && (
          <div className="inline-error">
            <Warning size={16} />
            <span>{project.error}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {!auth.connected && (
          <div className="runtime-callout">
            <Warning size={15} /> Generation service needs an API key
          </div>
        )}
        {!rendererReady && (
          <div className="runtime-callout">
            <Code size={15} />{" "}
            {renderer === "composite"
              ? "Manim and Remotion setup required"
              : `${rendererLabel(renderer)} setup required`}
          </div>
        )}
        <fieldset className="renderer-picker" disabled={rendererLocked}>
          <legend>Renderer</legend>
          <button
            type="button"
            className={renderer === "manim" ? "active" : ""}
            onClick={() => setRenderer("manim")}
          >
            <strong>Manim</strong>
            <span>Equations, graphs, geometric transformations</span>
          </button>
          <button
            type="button"
            className={renderer === "remotion" ? "active" : ""}
            onClick={() => setRenderer("remotion")}
          >
            <strong>Remotion</strong>
            <span>Typography, UI, diagrams, editorial motion</span>
          </button>
          <button
            type="button"
            className={renderer === "composite" ? "active" : ""}
            onClick={() => setRenderer("composite")}
          >
            <strong>Composite</strong>
            <span>Manim visuals inside a Remotion-directed video</span>
          </button>
        </fieldset>
        {project && (
          <div className="generation-settings" aria-label="Generation settings">
            <label>
              Request
              <select
                value={intent}
                disabled={running || !hasPriorWork}
                onChange={(event) =>
                  setIntent(event.target.value as GenerationIntent)
                }
              >
                <option value="auto">Smart choice</option>
                <option value="revise">Edit this video</option>
                <option value="new">Create a separate video</option>
              </select>
            </label>
            <ThinkingControl
              value={generationEffort}
              disabled={running}
              onChange={(effort) => {
                setGenerationEffort(effort);
                void onGenerationPreferences(effort);
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
                  )
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
                  )
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
          <div className="design-settings" aria-label="Video style settings">
            <label>
              Font
              <select
                value={project.designPreferences?.fontCategory || "modern"}
                disabled={running}
                onChange={(event) =>
                  void onDesignPreferences({
                    fontCategory: event.target.value as FontCategory,
                  })
                }
              >
                <option value="modern">Modern</option>
                <option value="editorial">Editorial</option>
                <option value="technical">Technical</option>
                <option value="friendly">Friendly</option>
                <option value="classic">Classic</option>
              </select>
            </label>
            <label>
              Colors
              <select
                value={project.designPreferences?.colorPalette || "studio"}
                disabled={running}
                onChange={(event) =>
                  void onDesignPreferences({
                    colorPalette: event.target.value as ColorPalette,
                  })
                }
              >
                <option value="cinematic">Cinematic · Default</option>
                <option value="studio">Studio warm</option>
                <option value="ocean">Ocean</option>
                <option value="forest">Forest</option>
                <option value="sunset">Sunset</option>
                <option value="monochrome">Monochrome</option>
                <option value="high-contrast">High contrast</option>
              </select>
            </label>
          </div>
        )}
        {project && (
          <div className="narration-settings" aria-label="Narration settings">
            <label>
              AI voice
              <select
                value={
                  project.narrationPreferences?.enabled === false ? "off" : "on"
                }
                disabled={running}
                onChange={(event) =>
                  void onNarrationPreferences(event.target.value === "on")
                }
              >
                <option value="on">Speechify narration</option>
                <option value="off">Off · silent video</option>
              </select>
            </label>
            <span>
              {project.narrationPreferences?.enabled === false
                ? "No voice generation or Speechify usage"
                : "Narration is generated during the final render"}
            </span>
          </div>
        )}
        <label className="sr-only" htmlFor="prompt">
          Video prompt
        </label>
        <div className={`composer ${error ? "composer-error" : ""}`}>
          <textarea
            id="prompt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              intent === "new"
                ? "Describe a new video built with the default cinematic style..."
                : project?.videoUrl
                  ? "Ask for a change, or describe a new video..."
                  : "Describe a video..."
            }
            rows={2}
            disabled={running}
          />
          {running ? (
            <button
              className="send-button stop-button"
              onClick={() => void onCancel()}
              aria-label="Stop generation"
            >
              <Stop size={15} weight="fill" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => void submit()}
              disabled={!text.trim() || !auth.connected || !rendererReady}
              aria-label="Send prompt"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
        {error && <span className="form-error">{error}</span>}
        <span className="composer-hint">
          {intent === "new"
            ? "Creates a separate project"
            : rendererLocked
              ? `${rendererLabel(project?.renderer)} project · Smart choice handles edits and new ideas`
              : "Cinematic Composite is the default · Enter to send"}
        </span>
      </div>
    </section>
  );
}

function ChatPanel({
  project,
  auth,
  billing,
  runtime,
  onSend,
  onCancel,
  onReviewPreferences,
  onDesignPreferences,
  onNarrationPreferences,
  onGenerationPreferences,
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
  onSend: (
    text: string,
    renderer: RendererKind,
    intent: GenerationIntent,
    effort: GenerationEffort,
  ) => Promise<void>;
  onCancel: () => Promise<void>;
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
  mode: ChatMode;
  side: ChatSide;
  floatingPosition: FloatingPosition;
  onToggleMode: () => void;
  onToggleSide: () => void;
  onClose: () => void;
  onFloatingPosition: (position: FloatingPosition) => void;
}) {
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<GenerationIntent>("auto");
  const [generationEffort, setGenerationEffort] = useState<GenerationEffort>(
    project?.generationPreferences?.effort || "balanced",
  );
  const [error, setError] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const running = project?.status === "running";
  const hasPriorWork = Boolean(
    project?.threadId || project?.messages.length || project?.versions.length,
  );
  const videoReady = videoEngineIsReady(runtime);
  const suggestions = [
    "Animate why the Pythagorean theorem works",
    "Make gradient descent feel intuitive",
    "Show how sound becomes a frequency spectrum",
  ];

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    if (!project?.messages.length) {
      messages.scrollTo({ top: 0 });
      return;
    }
    messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  }, [project?.messages.length, project?.actions.length]);

  useEffect(() => {
    setGenerationEffort(
      clampEffort(
        project?.generationPreferences?.effort || "balanced",
        billing.entitlements.maxEffort,
      ),
    );
    setIntent("auto");
    setAssetsOpen(false);
  }, [project?.id, billing.entitlements.maxEffort]);

  async function submit() {
    const value = text.trim();
    if (!value || running) return;
    setError("");
    try {
      await onSend(value, "composite", intent, generationEffort);
      setText("");
      setIntent("auto");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not send the prompt.",
      );
    }
  }

  function beginChatDrag(event: CanvasPointerEvent<HTMLElement>) {
    if (
      mode !== "floating" ||
      (event.target as HTMLElement).closest("button, select, textarea, input")
    )
      return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = floatingPosition;
    const bounds = panelRef.current?.getBoundingClientRect();
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <section
      ref={panelRef}
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
          <span className="panel-kicker">
            <Sparkle size={11} weight="fill" /> Creative copilot
          </span>
          <h1>{project?.title || "New video"}</h1>
        </div>
        <div className="chat-window-controls">
          {mode === "docked" && (
            <button
              className="icon-button"
              onClick={onToggleSide}
              aria-label={`Move chat to the ${side === "left" ? "right" : "left"}`}
              title={`Move chat to the ${side === "left" ? "right" : "left"}`}
            >
              <ArrowsLeftRight size={17} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={onToggleMode}
            aria-label={mode === "floating" ? "Dock chat" : "Float chat"}
            title={mode === "floating" ? "Dock chat" : "Float chat"}
          >
            {mode === "floating" ? (
              <PushPin size={17} />
            ) : (
              <ArrowUpRight size={17} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Hide chat"
            title="Hide chat"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="messages" ref={messagesRef}>
        {!project?.messages.length && (
          <div className="chat-empty">
            <span className="empty-chat-icon">
              <MagicWand size={21} />
            </span>
            <h2>Turn an idea into motion.</h2>
            <p>
              Describe what you want to teach. The studio will plan, animate,
              render, and review it.
            </p>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>
                  {suggestion}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        {project?.messages.map((message) => (
          <div className={`message message-${message.role}`} key={message.id}>
            {message.role === "assistant" && (
              <span className="message-avatar">
                <Sparkle size={13} weight="fill" />
              </span>
            )}
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
        ))}

        {project && <AgentActivity project={project} />}
        {project?.error && (
          <div className="inline-error">
            <Warning size={16} />
            <span>{project.error}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {!auth.connected && (
          <div className="runtime-callout">
            <Warning size={15} /> Generation service needs configuration
          </div>
        )}
        {!videoReady && (
          <div className="runtime-callout">
            <Code size={15} /> Video engine needs setup
          </div>
        )}

        <div className="composer-toolbar">
          {project && (
            <label className="action-select">
              Action
              <select
                value={intent}
                disabled={running || !hasPriorWork}
                onChange={(event) =>
                  setIntent(event.target.value as GenerationIntent)
                }
              >
                <option value="auto">Smart choice</option>
                <option value="revise">Edit this video</option>
                <option value="new">Create a separate video</option>
              </select>
            </label>
          )}
          {project && (
            <button
              type="button"
              className="composer-tool"
              onClick={() =>
                billing.entitlements.licensedAssets
                  ? setAssetsOpen(true)
                  : window.alert(
                      "Licensed visual search is included with paid plans.",
                    )
              }
              disabled={running}
            >
              <ImageSquare size={16} /> Add visual
              {project.assets?.length ? ` · ${project.assets.length}` : ""}
            </button>
          )}
        </div>

        <details className="creative-controls">
          <summary>
            <span>
              <SlidersHorizontal size={16} /> Creative controls
            </span>
            <small>Style, motion, voice & review</small>
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
                    setGenerationEffort(effort);
                    void onGenerationPreferences(effort);
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
                      )
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
                      )
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
                    value={project.designPreferences?.fontCategory || "modern"}
                    disabled={running}
                    onChange={(event) =>
                      void onDesignPreferences({
                        fontCategory: event.target.value as FontCategory,
                      })
                    }
                  >
                    <option value="modern">Modern</option>
                    <option value="editorial">Editorial</option>
                    <option value="technical">Technical</option>
                    <option value="friendly">Friendly</option>
                    <option value="classic">Classic</option>
                  </select>
                </label>
                <label>
                  Colors
                  <select
                    value={project.designPreferences?.colorPalette || "studio"}
                    disabled={running}
                    onChange={(event) =>
                      void onDesignPreferences({
                        colorPalette: event.target.value as ColorPalette,
                      })
                    }
                  >
                    <option value="cinematic">Cinematic · Default</option>
                    <option value="studio">Studio warm</option>
                    <option value="ocean">Ocean</option>
                    <option value="forest">Forest</option>
                    <option value="sunset">Sunset</option>
                    <option value="monochrome">Monochrome</option>
                    <option value="high-contrast">High contrast</option>
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
                      void onNarrationPreferences(event.target.value === "on")
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
        <div className={`composer ${error ? "composer-error" : ""}`}>
          <textarea
            id="prompt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              intent === "new"
                ? "Describe the separate video you want to create..."
                : project?.videoUrl
                  ? "Describe an edit, or ask for a completely new video..."
                  : "Describe the lesson you want to bring to life..."
            }
            rows={2}
            disabled={running}
          />
          {running ? (
            <button
              className="send-button stop-button"
              onClick={() => void onCancel()}
              aria-label="Stop generation"
            >
              <Stop size={15} weight="fill" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => void submit()}
              disabled={!text.trim() || !auth.connected || !videoReady}
              aria-label="Send prompt"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
        {error && <span className="form-error">{error}</span>}
        <span className="composer-hint">
          {intent === "new"
            ? "Creates a separate project with the cinematic baseline"
            : intent === "revise"
              ? "Changes this video and preserves everything else"
              : "Smart choice understands whether you mean an edit or a new video"}
        </span>
      </div>
      {assetsOpen && project && (
        <AssetPicker project={project} onClose={() => setAssetsOpen(false)} />
      )}
    </section>
  );
}

function ArrowUpIcon() {
  return (
    <ArrowDown
      size={16}
      weight="bold"
      style={{ transform: "rotate(180deg)" }}
    />
  );
}

const STAGES = [
  { key: "brief", icon: MagicWand, label: "Plan" },
  { key: "authoring", icon: Code, label: "Draw" },
  { key: "rendering", icon: MonitorPlay, label: "Render" },
  { key: "inspecting", icon: Sparkle, label: "Review" },
] as const;

function ProgressVisual({ project }: { project: StudioProject }) {
  const activeIndex = Math.max(
    0,
    STAGES.findIndex((stage) => stage.key === project.stage),
  );
  return (
    <div className="progress-block">
      <strong>{generationLabel(project)}</strong>
      <span>
        {project.stage === "brief"
          ? "1 of 4 · Planning the lesson"
          : project.stage === "authoring"
            ? "2 of 4 · Building the visuals"
            : project.stage === "rendering"
              ? "3 of 4 · Rendering the video"
              : "4 of 4 · Inspecting the result"}
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
                {state === "done" ? <Check size={18} /> : <Icon size={19} />}
              </span>
              <small>{stage.label}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type AnnotationTool = "pen" | "circle" | "rectangle" | "arrow";
type Point = { x: number; y: number };
type Annotation = { tool: AnnotationTool; points: Point[] };

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  scale: number,
) {
  const [start, end = start] = annotation.points;
  if (!start) return;
  context.strokeStyle = "#ff334f";
  context.fillStyle = "#ff334f";
  context.lineWidth = Math.max(5, scale * 7);
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.tool === "pen") {
    context.beginPath();
    annotation.points.forEach((point, index) =>
      index
        ? context.lineTo(point.x, point.y)
        : context.moveTo(point.x, point.y),
    );
    context.stroke();
  } else if (annotation.tool === "circle") {
    context.beginPath();
    context.ellipse(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2,
      Math.abs(end.y - start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else if (annotation.tool === "rectangle") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(22, scale * 28);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fill();
  }
}

function FrameReviewDialog({
  project,
  version,
  time,
  onClose,
}: {
  project: StudioProject;
  version: ProjectVersion;
  time: number;
  onClose: () => void;
}) {
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [current, setCurrent] = useState<Annotation>();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const currentRef = useRef<Annotation | undefined>(undefined);
  const fps = version.render?.fps || 30;
  const frame = Math.max(0, Math.round(time * fps));
  const frameUrl = `/api/projects/${project.id}/frames?version=${encodeURIComponent(version.id)}&time=${(frame / fps).toFixed(6)}`;

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setLoaded(true);
    };
    image.onerror = () => setError("Could not load this frame.");
    image.src = frameUrl;
  }, [frameUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !loaded) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const annotation of annotations)
      drawAnnotation(context, annotation, canvas.width / 1920);
    if (current) drawAnnotation(context, current, canvas.width / 1920);
  }, [annotations, current, loaded]);

  function point(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.min(
        canvas.width,
        Math.max(
          0,
          ((event.clientX - bounds.left) * canvas.width) / bounds.width,
        ),
      ),
      y: Math.min(
        canvas.height,
        Math.max(
          0,
          ((event.clientY - bounds.top) * canvas.height) / bounds.height,
        ),
      ),
    };
  }

  function pointerDown(event: CanvasPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const annotation = { tool, points: [point(event)] };
    currentRef.current = annotation;
    setCurrent(annotation);
  }

  function pointerMove(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = currentRef.current;
    if (!active) return;
    const next = point(event);
    const updated = {
      ...active,
      points:
        active.tool === "pen"
          ? [...active.points, next]
          : [active.points[0], next],
    };
    currentRef.current = updated;
    setCurrent(updated);
  }

  function pointerUp(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = currentRef.current;
    if (!active) return;
    const next = point(event);
    const completed = {
      ...active,
      points:
        active.tool === "pen"
          ? [...active.points, next]
          : [active.points[0], next],
    };
    setAnnotations((items) => [...items, completed]);
    currentRef.current = undefined;
    setCurrent(undefined);
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !note.trim() || !annotations.length) {
      setError("Mark the frame and add a short note.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await request(`/api/projects/${project.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          versionId: version.id,
          time: frame / fps,
          note: note.trim(),
          annotatedImageData: canvas.toDataURL("image/png"),
        }),
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not send frame feedback.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Annotate video frame"
      >
        <header>
          <div>
            <span className="panel-kicker">Frame feedback</span>
            <h2>Mark what should change</h2>
            <p>
              {version.id} · frame {frame} · {(frame / fps).toFixed(2)}s
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="annotation-toolbar" aria-label="Annotation tools">
          <button
            className={tool === "pen" ? "active" : ""}
            onClick={() => setTool("pen")}
            title="Draw"
          >
            <PencilSimple size={18} />
          </button>
          <button
            className={tool === "circle" ? "active" : ""}
            onClick={() => setTool("circle")}
            title="Circle"
          >
            <Circle size={18} />
          </button>
          <button
            className={tool === "rectangle" ? "active" : ""}
            onClick={() => setTool("rectangle")}
            title="Rectangle"
          >
            <Rectangle size={18} />
          </button>
          <button
            className={tool === "arrow" ? "active" : ""}
            onClick={() => setTool("arrow")}
            title="Arrow"
          >
            <ArrowUpRight size={18} />
          </button>
          <span />
          <button
            onClick={() => setAnnotations((items) => items.slice(0, -1))}
            disabled={!annotations.length}
          >
            Undo
          </button>
          <button
            onClick={() => setAnnotations([])}
            disabled={!annotations.length}
            title="Clear"
          >
            <Trash size={18} />
          </button>
        </div>
        <div className="annotation-canvas-wrap">
          {!loaded && <CircleNotch className="spin" size={24} />}
          <canvas
            ref={canvasRef}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
          />
        </div>
        <label className="review-note">
          What should change?
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: Move this label above the curve and keep it clear during the transition."
          />
        </label>
        {error && <span className="form-error">{error}</span>}
        <footer>
          <button className="footer-action" onClick={onClose}>
            Cancel
          </button>
          <button
            className="download-link"
            disabled={sending || !loaded}
            onClick={() => void submit()}
          >
            {sending ? (
              <CircleNotch className="spin" size={17} />
            ) : (
              <PaperPlaneRight size={17} />
            )}{" "}
            Send to model
          </button>
        </footer>
      </section>
    </div>
  );
}

type AssetCandidate = {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  downloadUrl: string;
  sourceUrl: string;
  creator?: string;
  license: string;
  licenseUrl?: string;
  provider: "Wikimedia Commons";
};

function AssetPicker({
  project,
  onClose,
}: {
  project: StudioProject;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const body = await request<{ results: AssetCandidate[] }>(
        `/api/assets/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(body.results);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function importCandidate(candidate: AssetCandidate) {
    setImporting(candidate.id);
    setError("");
    try {
      await request(`/api/projects/${project.id}/assets`, {
        method: "POST",
        body: JSON.stringify(candidate),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed.");
    } finally {
      setImporting(undefined);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="asset-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a visual"
      >
        <header>
          <div>
            <span className="panel-kicker">Visual search</span>
            <h2>Add the right visual</h2>
            <p>
              Search reusable images with source and creator details kept
              automatically.
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <form
          className="asset-search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <MagnifyingGlass size={19} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search diagrams, places, people…"
          />
          <button disabled={loading || query.trim().length < 2}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
        {error && <span className="form-error">{error}</span>}
        <div className="asset-grid">
          {results.map((candidate) => {
            const imported = project.assets?.some(
              (asset) => asset.sourceUrl === candidate.sourceUrl,
            );
            return (
              <article className="asset-card" key={candidate.id}>
                <img src={candidate.thumbnailUrl} alt="" />
                <div>
                  <strong>{candidate.title.replace(/^File:/, "")}</strong>
                  <small title={candidate.description}>
                    {candidate.description ||
                      candidate.creator ||
                      candidate.provider}
                  </small>
                  <small>
                    {candidate.creator
                      ? `${candidate.creator} · ${candidate.license}`
                      : candidate.license}
                  </small>
                </div>
                <button
                  disabled={imported || Boolean(importing)}
                  onClick={() => void importCandidate(candidate)}
                >
                  {imported
                    ? "Added"
                    : importing === candidate.id
                      ? "Adding…"
                      : "Add to project"}
                </button>
              </article>
            );
          })}
        </div>
        {!results.length && !loading && (
          <div className="asset-empty">
            <ImageSquare size={28} />
            <p>
              Search results will appear here with their creator and license.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function VideoWorkspace({
  project,
  runtime,
}: {
  project?: StudioProject;
  runtime: RuntimeState;
}) {
  const [hasStarted, setHasStarted] = useState(false);
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

  useEffect(() => {
    setHasStarted(false);
    setCurrentTime(0);
    setDuration(0);
  }, [videoUrl]);

  useEffect(() => {
    setSelectedVersionId(project?.versions?.at(-1)?.id);
  }, [project?.id, project?.versions?.length]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  return (
    <section className="workspace" aria-label="Video preview">
      <div className="workspace-stage">
        {versions.length > 0 && (
          <div className="revision-bar" aria-label="Video versions">
            <span className="revision-label">
              <ClockCounterClockwise size={18} /> Revisions
            </span>
            <div className="revision-list">
              {[...versions].reverse().map((version) => (
                <button
                  key={version.id}
                  className={selectedVersion?.id === version.id ? "active" : ""}
                  onClick={() => setSelectedVersionId(version.id)}
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
              <CircleNotch className="spin" size={16} />
              <div>
                <strong>
                  Creating {generationLabel(project).toLowerCase()}
                </strong>
                <span>
                  {project.stage === "brief"
                    ? "Planning"
                    : project.stage === "authoring"
                      ? "Building visuals"
                      : project.stage === "rendering"
                        ? "Rendering video"
                        : "Inspecting frames"}{" "}
                  · previewing v{versions.length}
                </span>
              </div>
            </div>
          )}
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                poster={posterUrl}
                controls
                playsInline
                preload="metadata"
                onPlay={() => setHasStarted(true)}
                onTimeUpdate={(event) =>
                  setCurrentTime(event.currentTarget.currentTime)
                }
                onLoadedMetadata={(event) =>
                  setDuration(event.currentTarget.duration)
                }
              />
              {!hasStarted && (
                <button
                  className="center-play initial-play"
                  onClick={togglePlayback}
                  aria-label="Play video"
                >
                  <Play size={26} weight="fill" />
                </button>
              )}
            </>
          ) : project?.status === "running" ? (
            <div className="render-state">
              <ProgressVisual project={project} />
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
            </div>
          ) : (
            <div className="canvas-empty">
              <div className="orbit-visual" aria-hidden="true">
                <span className="orbit-ring orbit-ring-one" />
                <span className="orbit-ring orbit-ring-two" />
                <span className="orbit-node">
                  <Play size={18} weight="fill" />
                </span>
              </div>
              <h2>Prompt to preview</h2>
              <p>
                {rendererReady
                  ? "Your video will appear here."
                  : "The video engine needs setup before it can render a preview."}
              </p>
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
                <span>{time.toFixed(1)}s</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-footer">
        <span className="canvas-meta">
          <span>16:9</span>
          <span>Editable video</span>
          {selectedVersion?.render?.width && (
            <span>
              {selectedVersion.render.width}×{selectedVersion.render.height} ·{" "}
              {selectedVersion.render.fps} fps
            </span>
          )}
          {selectedVersion?.render?.narration?.enabled && (
            <span
              className="ai-voice"
              title={`${selectedVersion.render.narration.model || "Speechify"}, ${selectedVersion.render.narration.voice || "configured voice"}`}
            >
              <SpeakerHigh size={15} /> Speechify AI voice
            </span>
          )}
          {selectedVersion?.render?.narration?.status === "setup_required" && (
            <span>Speechify setup needed</span>
          )}
        </span>
        {videoUrl ? (
          <div className="video-actions">
            {project && selectedVersion && (
              <button
                className="footer-action review-frame-button"
                onClick={() => {
                  videoRef.current?.pause();
                  setCurrentTime(videoRef.current?.currentTime || currentTime);
                  setReviewOpen(true);
                }}
              >
                <PencilSimple size={18} /> Review frame
              </button>
            )}
            <button
              className="footer-action fullscreen-button"
              onClick={() => void playerRef.current?.requestFullscreen()}
            >
              <ArrowsOut size={18} /> Fullscreen
            </button>
            <a
              className="download-link"
              href={videoUrl}
              download={`${project?.title || "video"}.mp4`}
            >
              <DownloadSimple size={18} /> Download
            </a>
          </div>
        ) : (
          <span className="muted-action">
            <DownloadSimple size={17} /> Download
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

const CONTACT_EMAIL = "tarun.l.sankar@gmail.com";

function PricingCards({
  plans,
  currentPlan,
  checkoutEnabled = true,
  onChoose,
}: {
  plans: PricingPlan[];
  currentPlan?: BillingPlanId;
  checkoutEnabled?: boolean;
  onChoose: (plan: BillingPlanId) => void;
}) {
  return (
    <div className="pricing-grid">
      {plans.map((plan) => (
        <article
          className={`pricing-card ${plan.id === "creator" ? "pricing-featured" : ""}`}
          key={plan.id}
        >
          {plan.id === "creator" && (
            <span className="pricing-ribbon">Recommended</span>
          )}
          <div className="pricing-card-head">
            <span>{plan.name}</span>
            <strong>
              {plan.monthlyPrice ? `$${plan.monthlyPrice}` : "$0"}
              <small>/month</small>
            </strong>
          </div>
          <p>{plan.description}</p>
          <ul>
            {plan.features.map((feature) => (
              <li key={feature}>
                <Check size={16} weight="bold" /> {feature}
              </li>
            ))}
          </ul>
          <button
            className={plan.id === "creator" ? "primary-cta" : "secondary-cta"}
            disabled={currentPlan === plan.id}
            onClick={() => onChoose(plan.id)}
          >
            {currentPlan === plan.id
              ? "Current plan"
              : plan.id === "free"
                ? "Open studio"
                : !checkoutEnabled
                  ? "Coming soon"
                  : `Choose ${plan.name}`}
          </button>
        </article>
      ))}
    </div>
  );
}

function FormatHero() {
  const [timeline, setTimeline] = useState({
    style: 0,
    step: 0,
    glitching: true,
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const startedAt = performance.now();
    const equationStarts = [
      0,
      (70 / 30) * 1000,
      (162 / 30) * 1000,
      (258 / 30) * 1000,
      (340 / 30) * 1000,
      (410 / 30) * 1000,
    ];
    let frame = 0;
    let previousKey = "";

    const tick = () => {
      const elapsed = (performance.now() - startedAt) % 16_000;
      const style = Math.min(3, Math.floor(elapsed / 4_000));
      const step = equationStarts.reduce(
        (active, start, index) => (elapsed >= start ? index : active),
        0,
      );
      const withinStyle = elapsed % 4_000;
      const glitching = withinStyle < 190 || withinStyle > 3_810;
      const key = `${style}-${step}-${glitching}`;

      if (key !== previousKey) {
        previousKey = key;
        setTimeline({ style, step, glitching });
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const equations = [
    "∫ x²eˣ dx",
    "x²eˣ − 2∫ xeˣ dx",
    "x²eˣ − 2xeˣ + 2∫ eˣ dx",
    "eˣ(x² − 2x + 2) + C",
    "d/dx [ eˣ(x² − 2x + 2) ] = x²eˣ",
    "∫ x²eˣ dx",
  ];

  return (
    <section
      className={`format-hero live-integral-hero live-integral-style-${timeline.style} ${timeline.glitching ? "is-glitching" : ""}`}
      aria-labelledby="format-hero-title"
    >
      <h1 className="sr-only" id="format-hero-title">
        Learn whatever way you want.
      </h1>
      <div className="live-integral-atmosphere" aria-hidden="true" />
      <div className="live-integral-layout" aria-hidden="true">
        <p className="live-integral-headline">
          Learn <em>whatever way</em> you want.
        </p>
        <div className="live-integral-work">
          <span key={timeline.step} className="live-integral-equation">
            {equations[timeline.step]}
          </span>
          <i className="live-integral-proof-line" />
        </div>
      </div>
      <div className="live-integral-glitch" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="integral-reel-controls live-integral-controls">
        <div className="format-actions">
          <a className="format-primary" href="/studio">
            Create your first lesson <ArrowRight size={18} />
          </a>
          <a href="#how-it-works">See how it works</a>
        </div>
      </div>
      <a className="format-scroll" href="#how-it-works">
        <span>Keep scrolling</span>
        <ArrowDown size={18} />
      </a>
    </section>
  );
}

function MarketingSite() {
  return (
    <main className="marketing-shell marketing-arrived landing-format-shell">
      <header className="marketing-nav">
        <a className="marketing-brand" href="/">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>{" "}
          Lesson Studio
        </a>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a className="nav-studio" href="/studio">
            Open studio <ArrowRight size={15} />
          </a>
        </nav>
      </header>

      <FormatHero />

      <section className="how-section" id="how-it-works">
        <div>
          <span>01</span>
          <strong>Say what you mean</strong>
          <p>
            Describe the idea, the audience, and the feeling you want the lesson
            to have.
          </p>
        </div>
        <div>
          <span>02</span>
          <strong>See it take shape</strong>
          <p>
            Watch one thought become a visual explanation built around how you
            understand.
          </p>
        </div>
        <div>
          <span>03</span>
          <strong>Make it yours</strong>
          <p>
            Pause any frame, draw directly on it, and ask for the exact change
            you imagined.
          </p>
        </div>
      </section>

      <section className="home-close-section">
        <span className="chalk-kicker">Understanding is personal.</span>
        <h2>So the explanation should be too.</h2>
        <p>
          Start with an idea. Build it in the visual language that finally makes
          it click.
        </p>
        <div className="hero-actions">
          <a className="primary-cta" href="/studio">
            Create your first lesson <ArrowRight size={17} />
          </a>
          <a className="secondary-cta" href="/pricing">
            Compare plans
          </a>
        </div>
      </section>
      <footer className="marketing-footer">
        <span>Lesson Studio</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
      </footer>
    </main>
  );
}

function PricingSite() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);

  useEffect(() => {
    void request<{
      plans: PricingPlan[];
      billingMode: BillingState["billingMode"];
      checkoutEnabled: boolean;
    }>("/api/pricing").then((result) => {
      setPlans(result.plans);
      setCheckoutEnabled(result.checkoutEnabled);
    });
  }, []);

  function choose(plan: BillingPlanId) {
    if (plan === "free") {
      window.location.href = "/studio";
      return;
    }
    if (!checkoutEnabled) {
      window.alert(
        "Paid plans are opening soon. You can create a free account and use the studio now.",
      );
      return;
    }
    window.location.href = `/studio?plan=${encodeURIComponent(plan)}`;
  }

  return (
    <main className="marketing-shell pricing-page-shell marketing-arrived">
      <header className="marketing-nav">
        <a className="marketing-brand" href="/">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>{" "}
          Lesson Studio
        </a>
        <nav>
          <a href="/">Home</a>
          <a className="nav-studio" href="/studio">
            Open studio <ArrowRight size={15} />
          </a>
        </nav>
      </header>
      <section className="pricing-page-hero">
        <span className="hero-eyebrow">Pricing</span>
        <h1>Simple plans for real output.</h1>
        <p>Pay for the amount of generation and reasoning you use.</p>
      </section>
      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <span>Monthly credits</span>
          <h2>Choose your pace.</h2>
          <p>Faster uses 1 credit, Balanced uses 2, and Try harder uses 4.</p>
        </div>
        {!checkoutEnabled && (
          <div className="billing-launch-note">
            <strong>Free is available now.</strong>
            <span>Paid checkout is not enabled in this environment.</span>
          </div>
        )}
        <PricingCards
          plans={plans}
          checkoutEnabled={checkoutEnabled}
          onChoose={choose}
        />
      </section>
      <footer className="marketing-footer">
        <span>Lesson Studio</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>Support</a>
      </footer>
    </main>
  );
}

function BillingDialog({
  billing,
  plans,
  checkoutEnabled,
  onClose,
  onCheckout,
  onPortal,
}: {
  billing: BillingState;
  plans: PricingPlan[];
  checkoutEnabled: boolean;
  onClose: () => void;
  onCheckout: (plan: BillingPlanId) => void;
  onPortal: () => void;
}) {
  return (
    <div
      className="dialog-backdrop billing-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="billing-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Plan and billing"
      >
        <header>
          <div>
            <span className="panel-kicker">Plan & billing</span>
            <h2>{billing.planName} plan</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close billing"
          >
            <X size={18} />
          </button>
        </header>
        <div className="credit-meter">
          <div>
            <strong>{billing.creditsRemaining}</strong>
            <span>of {billing.entitlements.creditsPerMonth} credits left</span>
          </div>
          <span className="credit-track">
            <i
              style={{
                width: `${Math.max(0, Math.min(100, billing.entitlements.creditsPerMonth ? (billing.creditsRemaining / billing.entitlements.creditsPerMonth) * 100 : 0))}%`,
              }}
            />
          </span>
          <small>
            Renews{" "}
            {billing.periodEnd
              ? new Date(billing.periodEnd).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })
              : "monthly"}
          </small>
        </div>
        <PricingCards
          plans={plans}
          currentPlan={billing.plan}
          checkoutEnabled={checkoutEnabled}
          onChoose={(plan) => (plan === "free" ? undefined : onCheckout(plan))}
        />
        <div className="billing-dialog-footer">
          {billing.hasStripeCustomer && (
            <button className="secondary-cta" onClick={onPortal}>
              Manage or cancel in Stripe
            </button>
          )}
          <a href={`mailto:${CONTACT_EMAIL}`}>Questions? Contact us</a>
        </div>
      </section>
    </div>
  );
}

function AccountDialog({
  account,
  onClose,
}: {
  account: AccountUser;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setDeleting(true);
    setError("");
    try {
      await request("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ email: confirmation }),
      });
      window.location.href = "/";
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the account.",
      );
      setDeleting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <header>
          <div>
            <span className="panel-kicker">Account</span>
            <h2>Data and access</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close account settings"
          >
            <X size={18} />
          </button>
        </header>
        <div className="account-dialog-section">
          <strong>Your data</strong>
          <p>
            Download your account, projects, generation history, billing state,
            and recorded model usage.
          </p>
          <a className="secondary-cta" href="/api/account/export" download>
            Download JSON export
          </a>
        </div>
        <div className="account-dialog-section danger-zone">
          <strong>Delete account</strong>
          <p>
            This cancels an active subscription and permanently removes your
            projects and generated files. Cancel any running generation first.
          </p>
          <label>
            <span>Enter {account.email} to confirm</span>
            <input
              type="email"
              autoComplete="email"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && <p className="access-error">{error}</p>}
          <button
            className="danger-button"
            disabled={
              deleting || confirmation.trim().toLowerCase() !== account.email
            }
            onClick={() => void deleteAccount()}
          >
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
        <footer>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Support</a>
        </footer>
      </section>
    </div>
  );
}

function PolicySite({ kind }: { kind: "privacy" | "terms" }) {
  const privacy = kind === "privacy";
  return (
    <main className="marketing-shell policy-shell">
      <header className="marketing-nav">
        <a className="marketing-brand" href="/">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>{" "}
          Lesson Studio
        </a>
        <nav>
          <a href={privacy ? "/terms" : "/privacy"}>
            {privacy ? "Terms" : "Privacy"}
          </a>
          <a className="nav-studio" href="/studio">
            Open studio <ArrowRight size={15} />
          </a>
        </nav>
      </header>
      <article className="policy-document">
        <span className="hero-eyebrow">Last updated August 24, 2026</span>
        <h1>{privacy ? "Privacy policy" : "Terms of service"}</h1>
        {privacy ? (
          <>
            <section>
              <h2>What we collect</h2>
              <p>
                We store your email, account and subscription state, prompts,
                project settings, generated media, review notes, usage records,
                and security audit events. Stripe processes payment details;
                Lesson Studio does not store full card numbers.
              </p>
            </section>
            <section>
              <h2>How data is used</h2>
              <p>
                We use this information to authenticate you, generate and
                deliver videos, enforce plan limits, process billing, prevent
                abuse, support the service, and improve reliability.
              </p>
            </section>
            <section>
              <h2>Service providers</h2>
              <p>
                Processing may involve Google Cloud and Identity Platform, E2B,
                OpenAI, Speechify, Stripe, and licensed-media sources selected
                in the product. We do not sell personal information.
              </p>
            </section>
            <section>
              <h2>Retention and control</h2>
              <p>
                Account data and current project artifacts are retained while
                your account is active. Operational logs, deleted object
                versions, and backups may remain for a limited security or
                recovery period. You can export or delete your account from
                account settings.
              </p>
            </section>
            <section>
              <h2>Contact</h2>
              <p>
                Privacy and deletion questions can be sent to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2>Using the service</h2>
              <p>
                You must provide accurate account information, protect your
                login, and use Lesson Studio lawfully. Do not generate abusive
                or infringing material, attack the service, evade plan limits,
                or attempt to obtain another user's data.
              </p>
            </section>
            <section>
              <h2>AI-generated output</h2>
              <p>
                Generated videos can contain mistakes. You are responsible for
                reviewing factual accuracy, rights, suitability, and required
                disclosures before publishing or relying on an output.
              </p>
            </section>
            <section>
              <h2>Plans and billing</h2>
              <p>
                Paid plans renew monthly through Stripe until cancelled.
                Generation credits reset each billing period, are not
                transferable, and have no cash value. Applicable refund
                decisions and subscription changes are handled through support
                and Stripe's billing portal.
              </p>
            </section>
            <section>
              <h2>Your content</h2>
              <p>
                You retain rights you hold in submitted material and generated
                output. You grant us the limited permission required to process,
                store, render, and deliver that material through our service
                providers.
              </p>
            </section>
            <section>
              <h2>Availability</h2>
              <p>
                The service is provided without a guarantee that every
                generation will complete or be error-free. Failed or cancelled
                generations are designed to refund reserved credits. Liability
                is limited to the extent permitted by applicable law.
              </p>
            </section>
            <section>
              <h2>Contact</h2>
              <p>
                Questions, refund requests, and abuse reports can be sent to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </section>
          </>
        )}
      </article>
      <footer className="marketing-footer">
        <span>Lesson Studio</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>Support</a>
      </footer>
    </main>
  );
}

function AccessGate({
  configured,
  onAuthorized,
}: {
  configured: boolean;
  onAuthorized: (user: AccountUser) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{
        authenticated: boolean;
        user: AccountUser;
        verificationRequired?: boolean;
      }>(mode === "signin" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.authenticated) {
        onAuthorized(result.user);
      } else {
        setMode("signin");
        setPassword("");
        setNotice("Check your email to verify the account, then sign in.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await request("/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNotice(
        "If an account exists for that email, a reset link is on its way.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not send the reset email.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-page">
      <aside className="access-preview">
        <a className="access-brand" href="/">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>
          <strong>Lesson Studio</strong>
        </a>
        <div className="access-preview-copy">
          <span>Visual lesson workspace</span>
          <h2>From idea to clear motion.</h2>
        </div>
        <img
          src="/intro-integral.png"
          alt="Generated integral lesson preview"
        />
      </aside>
      <section className="access-card" aria-labelledby="access-title">
        <a className="access-brand access-brand-mobile" href="/">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>
          <strong>Lesson Studio</strong>
        </a>
        <span className="access-kicker">
          {mode === "signin" ? "Welcome back" : "Start free"}
        </span>
        <h1 id="access-title">
          {mode === "signin" ? "Sign in to your studio" : "Create your account"}
        </h1>
        <p>
          {mode === "signin"
            ? "Continue where you left off."
            : "One generation credit. No card required."}
        </p>
        {!configured && (
          <div className="access-error" role="alert">
            <Warning size={15} /> Account sign-in is being configured. Please
            try again shortly.
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              minLength={10}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <div className="access-error" role="alert">
              <Warning size={15} /> {error}
            </div>
          )}
          {notice && (
            <div className="access-notice" role="status">
              <Check size={15} /> {notice}
            </div>
          )}
          <button
            type="submit"
            disabled={
              !configured || submitting || !email || password.length < 10
            }
          >
            {submitting ? (
              <CircleNotch className="spin" size={17} />
            ) : (
              <>
                {mode === "signin" ? "Sign in" : "Create account"}{" "}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="access-switch">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in instead"}
          </button>
          {mode === "signin" && (
            <button type="button" onClick={() => void resetPassword()}>
              Forgot password?
            </button>
          )}
        </div>
        <a className="access-home-link" href="/">
          Back home
        </a>
      </section>
    </main>
  );
}

export function App() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [auth, setAuth] = useState<AuthState>(EMPTY_AUTH);
  const [billing, setBilling] = useState<BillingState>(EMPTY_BILLING);
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
  const [pricingCheckoutEnabled, setPricingCheckoutEnabled] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>(EMPTY_RUNTIME);
  const [loaded, setLoaded] = useState(false);
  const [access, setAccess] = useState<AccountState>({
    checked: false,
    configured: false,
    authenticated: false,
  });
  const checkoutStarted = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("docked");
  const [chatSide, setChatSide] = useState<ChatSide>("left");
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    x: Math.max(24, window.innerWidth - 520),
    y: 88,
  });
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");
  const studioRoute = window.location.pathname.startsWith("/studio");
  const pricingRoute = window.location.pathname.startsWith("/pricing");
  const privacyRoute = window.location.pathname.startsWith("/privacy");
  const termsRoute = window.location.pathname.startsWith("/terms");

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeId),
    [projects, activeId],
  );

  useEffect(() => {
    void request<{
      configured: boolean;
      authenticated: boolean;
      user?: AccountUser;
    }>("/api/auth/status")
      .then((status) => setAccess({ checked: true, ...status }))
      .catch(() =>
        setAccess({ checked: true, configured: false, authenticated: false }),
      );
    void request<{ plans: PricingPlan[]; checkoutEnabled: boolean }>(
      "/api/pricing",
    ).then((result) => {
      setPricingPlans(result.plans);
      setPricingCheckoutEnabled(result.checkoutEnabled);
    });
  }, []);

  useEffect(() => {
    if (!access.authenticated) return;
    const applyEvent = (event: StudioEvent) => {
      if (event.type === "snapshot") {
        setProjects(event.projects);
        setAuth(event.auth);
        setBilling(event.billing);
        setRuntime(event.runtime);
        setActiveId((current) => current || event.projects[0]?.id);
        setLoaded(true);
      } else if (event.type === "project") {
        setProjects((current) => mergeProject(current, event.project));
      } else if (event.type === "assistant_delta") {
        setProjects((current) =>
          current.map((project) => {
            if (project.id !== event.projectId) return project;
            const messages = [...project.messages];
            const index = messages.findIndex(
              (item) => item.id === event.messageId,
            );
            if (index >= 0)
              messages[index] = {
                ...messages[index],
                text: messages[index].text + event.delta,
                streaming: true,
              };
            else
              messages.push({
                id: event.messageId,
                role: "assistant",
                text: event.delta,
                createdAt: new Date().toISOString(),
                streaming: true,
              });
            return { ...project, messages };
          }),
        );
      } else if (event.type === "auth") {
        setAuth(event.auth);
      } else if (event.type === "runtime") {
        setRuntime(event.runtime);
      }
    };

    setLoaded(false);
    void fetch("/api/state")
      .then((response) => response.json())
      .then((event: StudioEvent) => applyEvent(event));
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as StudioEvent;
      applyEvent(event);
    };
    return () => events.close();
  }, [access.authenticated]);

  useEffect(() => {
    if (
      !studioRoute ||
      new URLSearchParams(window.location.search).get("checkout") !== "success"
    )
      return;
    let attempts = 0;
    const refresh = async () => {
      const next = await request<BillingState>("/api/billing");
      setBilling(next);
      attempts += 1;
      if (next.plan === "free" && attempts < 5)
        window.setTimeout(() => void refresh(), 1_000);
    };
    void refresh();
  }, [studioRoute]);

  useEffect(() => {
    if (
      !studioRoute ||
      !access.authenticated ||
      !loaded ||
      checkoutStarted.current
    )
      return;
    const requestedPlan = new URLSearchParams(window.location.search).get(
      "plan",
    );
    if (
      requestedPlan !== "creator" &&
      requestedPlan !== "pro" &&
      requestedPlan !== "studio"
    )
      return;
    checkoutStarted.current = true;
    void startCheckout(requestedPlan);
  }, [studioRoute, access.authenticated, loaded]);

  async function createProject() {
    const project = await request<StudioProject>("/api/projects", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setProjects((current) => mergeProject(current, project));
    setActiveId(project.id);
    setSidebarOpen(false);
    setMobilePane("chat");
  }

  async function toggleFavorite(project: StudioProject) {
    const updated = await request<StudioProject>(
      `/api/projects/${project.id}/favorite`,
      {
        method: "PATCH",
        body: JSON.stringify({ favorite: !project.favorite }),
      },
    );
    setProjects((current) => mergeProject(current, updated));
  }

  async function startCheckout(plan: BillingPlanId, email?: string) {
    try {
      const result = await request<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan, email }),
      });
      window.location.href = result.url;
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not open checkout.",
      );
    }
  }

  async function openBillingPortal() {
    try {
      const result = await request<{ url: string }>("/api/billing/portal", {
        method: "POST",
      });
      window.location.href = result.url;
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not open billing.",
      );
    }
  }

  async function ensureProject() {
    if (activeProject) return activeProject;
    const project = await request<StudioProject>("/api/projects", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setProjects((current) => mergeProject(current, project));
    setActiveId(project.id);
    return project;
  }

  async function sendMessage(
    text: string,
    renderer: RendererKind,
    intent: GenerationIntent,
    effort: GenerationEffort,
  ) {
    const project = await ensureProject();
    const result = await request<SendMessageResult>(
      `/api/projects/${project.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ text, renderer, intent, effort }),
      },
    );
    setProjects((current) => mergeProject(current, result.project));
    setActiveId(result.project.id);
    setMobilePane("preview");
    setBilling(await request<BillingState>("/api/billing"));
  }

  async function cancel() {
    if (!activeProject) return;
    await request(`/api/projects/${activeProject.id}/cancel`, {
      method: "POST",
    });
  }

  async function updateReviewPreferences(
    focus: ReviewFocus,
    strictness: ReviewStrictness,
  ) {
    if (!activeProject) return;
    const project = await request<StudioProject>(
      `/api/projects/${activeProject.id}/review-preferences`,
      { method: "PATCH", body: JSON.stringify({ focus, strictness }) },
    );
    setProjects((current) => mergeProject(current, project));
  }

  async function updateDesignPreferences(changes: {
    fontCategory?: FontCategory;
    colorPalette?: ColorPalette;
  }) {
    if (!activeProject) return;
    const project = await request<StudioProject>(
      `/api/projects/${activeProject.id}/design-preferences`,
      { method: "PATCH", body: JSON.stringify(changes) },
    );
    setProjects((current) => mergeProject(current, project));
  }

  async function updateNarrationPreferences(enabled: boolean) {
    if (!activeProject) return;
    const project = await request<StudioProject>(
      `/api/projects/${activeProject.id}/narration-preferences`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    );
    setProjects((current) => mergeProject(current, project));
  }

  async function updateGenerationPreferences(effort: GenerationEffort) {
    if (!activeProject) return;
    const project = await request<StudioProject>(
      `/api/projects/${activeProject.id}/generation-preferences`,
      { method: "PATCH", body: JSON.stringify({ effort }) },
    );
    setProjects((current) => mergeProject(current, project));
  }

  if (privacyRoute) return <PolicySite kind="privacy" />;
  if (termsRoute) return <PolicySite kind="terms" />;
  if (pricingRoute) return <PricingSite />;
  if (!studioRoute) return <MarketingSite />;

  if (access.checked && !access.authenticated) {
    return (
      <AccessGate
        configured={access.configured}
        onAuthorized={(user) =>
          setAccess((current) => ({ ...current, authenticated: true, user }))
        }
      />
    );
  }

  if (!access.checked || !loaded) {
    return (
      <main className="app-loading" aria-label="Loading Lesson Studio">
        <div className="loading-brand">
          <span className="brand-mark">
            <FilmSlate size={18} weight="fill" />
          </span>
          <strong>Lesson Studio</strong>
        </div>
        <div className="loading-line">
          <span />
        </div>
      </main>
    );
  }

  return (
    <main
      className={`app-shell mobile-${mobilePane} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <Sidebar
        projects={projects}
        activeId={activeId}
        billing={billing}
        account={access.user!}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNew={() => void createProject()}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onFavorite={(project) => void toggleFavorite(project)}
        onBilling={() => setBillingOpen(true)}
        onAccount={() => setAccountOpen(true)}
        onLogout={() =>
          void request("/api/auth/logout", { method: "POST" }).finally(() => {
            window.location.href = "/";
          })
        }
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim mobile-only"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close projects"
        />
      )}

      <div className="studio-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-only"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open projects"
            >
              <List size={20} />
            </button>
            <span className="topbar-title">
              {activeProject?.title || "Untitled video"}
            </span>
            {activeProject?.status === "running" && (
              <span className="status-badge">
                <CircleNotch className="spin" size={12} />{" "}
                {generationLabel(activeProject)}
              </span>
            )}
            {activeProject?.status === "complete" && (
              <span className="status-badge status-complete">
                <Check size={12} /> Ready · v{activeProject.versions.length}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {activeProject && (
              <button
                className={`theme-toggle project-favorite-top ${activeProject.favorite ? "favorite-active" : ""}`}
                onClick={() => void toggleFavorite(activeProject)}
                aria-label={
                  activeProject.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                title={
                  activeProject.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
              >
                <Star
                  size={17}
                  weight={activeProject.favorite ? "fill" : "regular"}
                />
              </button>
            )}
            <button className="plan-pill" onClick={() => setBillingOpen(true)}>
              <span>{billing.planName}</span>
              <strong>{billing.creditsRemaining} credits</strong>
            </button>
            <button
              className={`view-toggle ${chatCollapsed ? "active" : ""}`}
              onClick={() => {
                setChatCollapsed((value) => !value);
                setPreviewCollapsed(false);
              }}
              aria-label={chatCollapsed ? "Show chat" : "Collapse chat"}
              title={chatCollapsed ? "Show chat" : "Collapse chat"}
            >
              <MagicWand size={18} />
              <span>{chatCollapsed ? "Show chat" : "Chat"}</span>
            </button>
            <button
              className={`view-toggle ${previewCollapsed ? "active" : ""}`}
              onClick={() => {
                setPreviewCollapsed((value) => !value);
                setChatCollapsed(false);
              }}
              aria-label={previewCollapsed ? "Show video" : "Collapse video"}
              title={previewCollapsed ? "Show video" : "Collapse video"}
            >
              <MonitorPlay size={18} />
              <span>{previewCollapsed ? "Show video" : "Focus"}</span>
            </button>
          </div>
        </header>

        <div
          className={`studio-grid chat-side-${chatSide} ${chatMode === "floating" ? "chat-is-floating" : ""} ${chatCollapsed ? "chat-is-collapsed" : ""} ${previewCollapsed ? "preview-is-collapsed" : ""}`}
        >
          <ChatPanel
            project={activeProject}
            auth={auth}
            billing={billing}
            runtime={runtime}
            onSend={sendMessage}
            onCancel={cancel}
            onReviewPreferences={updateReviewPreferences}
            onDesignPreferences={updateDesignPreferences}
            onNarrationPreferences={updateNarrationPreferences}
            onGenerationPreferences={updateGenerationPreferences}
            mode={chatMode}
            side={chatSide}
            floatingPosition={floatingPosition}
            onToggleMode={() => {
              setChatCollapsed(false);
              setPreviewCollapsed(false);
              setChatMode((value) =>
                value === "docked" ? "floating" : "docked",
              );
              if (chatMode === "docked")
                setFloatingPosition({
                  x: Math.max(20, window.innerWidth - 520),
                  y: 88,
                });
            }}
            onToggleSide={() =>
              setChatSide((value) => (value === "left" ? "right" : "left"))
            }
            onClose={() => setChatCollapsed(true)}
            onFloatingPosition={setFloatingPosition}
          />
          <VideoWorkspace project={activeProject} runtime={runtime} />
        </div>

        <nav className="mobile-tabs mobile-only" aria-label="Workspace view">
          <button
            className={mobilePane === "chat" ? "active" : ""}
            onClick={() => setMobilePane("chat")}
          >
            <MagicWand size={18} /> Chat
          </button>
          <button
            className={mobilePane === "preview" ? "active" : ""}
            onClick={() => setMobilePane("preview")}
          >
            <MonitorPlay size={18} /> Preview
          </button>
        </nav>
      </div>
      {billingOpen && (
        <BillingDialog
          billing={billing}
          plans={pricingPlans}
          checkoutEnabled={pricingCheckoutEnabled}
          onClose={() => setBillingOpen(false)}
          onCheckout={(plan) => void startCheckout(plan, billing.email)}
          onPortal={() => void openBillingPortal()}
        />
      )}
      {accountOpen && (
        <AccountDialog
          account={access.user!}
          onClose={() => setAccountOpen(false)}
        />
      )}
    </main>
  );
}
