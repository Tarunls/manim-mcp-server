import {
  ArrowDown,
  ArrowRight,
  ArrowsOut,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  Code,
  DownloadSimple,
  FilmSlate,
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
  SignOut,
  Sparkle,
  SpeakerHigh,
  Stop,
  UserCircle,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as CanvasPointerEvent } from "react";
import type { AuthState, ColorPalette, FontCategory, ProjectVersion, RendererKind, ReviewFocus, ReviewStrictness, RuntimeState, StudioEvent, StudioProject } from "./types";

const EMPTY_AUTH: AuthState = { connected: false };
const EMPTY_RUNTIME: RuntimeState = { codex: false, manim: false, remotion: false, ffmpeg: false };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Something went wrong.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function mergeProject(projects: StudioProject[], project: StudioProject) {
  const next = projects.filter((item) => item.id !== project.id);
  return [project, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function shortDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function rendererLabel(renderer?: RendererKind) {
  return renderer === "remotion" ? "Remotion" : renderer === "composite" ? "Composite" : "Manim";
}

function rendererIsReady(renderer: RendererKind, runtime: RuntimeState) {
  return renderer === "manim" ? runtime.manim : renderer === "remotion" ? runtime.remotion : runtime.manim && runtime.remotion;
}

function generationLabel(project: StudioProject) {
  return project.versions.length ? `Revision ${project.versions.length + 1}` : "First draft";
}

function Sidebar({
  projects,
  activeId,
  auth,
  open,
  collapsed,
  onClose,
  onToggle,
  onNew,
  onSelect,
  onConnect,
  onLogout,
}: {
  projects: StudioProject[];
  activeId?: string;
  auth: AuthState;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onConnect: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className={`sidebar ${open ? "sidebar-open" : ""} ${collapsed ? "sidebar-is-collapsed" : ""}`} aria-label="Projects">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><FilmSlate size={18} weight="fill" /></div>
        <span className="collapsible-copy">Lesson Studio</span>
        <button className="icon-button sidebar-toggle desktop-only" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <CaretRight size={18} /> : <CaretLeft size={18} />}
        </button>
        <button className="icon-button mobile-only" onClick={onClose} aria-label="Close projects"><X size={18} /></button>
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
            <span className="project-icon"><Play size={12} weight="fill" /></span>
            <span className="project-copy collapsible-copy">
              <span className="project-title">{project.title}</span>
              <span className="project-time">{project.status === "running" ? `Creating v${project.versions.length + 1}` : shortDate(project.updatedAt)} · {rendererLabel(project.renderer)}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="account-area">
        {auth.connected ? (
          <div className="account-card">
            <UserCircle size={23} weight="fill" />
            <div className="account-copy collapsible-copy">
              <span>{auth.email || "Codex connected"}</span>
              <small>{auth.plan || "ChatGPT"}</small>
            </div>
            <button className="icon-button collapsible-copy" onClick={onLogout} aria-label="Disconnect Codex"><SignOut size={17} /></button>
          </div>
        ) : (
          <button className="connect-button" onClick={onConnect}>
            <Sparkle size={16} weight="fill" />
            <span className="collapsible-copy">Connect Codex</span>
          </button>
        )}
      </div>
    </aside>
  );
}

function AgentActivity({ project }: { project: StudioProject }) {
  if (project.status !== "running") return null;
  return (
    <div className="agent-activity" aria-live="polite">
      <div className="agent-heading">
        <span className="agent-orb"><Sparkle size={14} weight="fill" /></span>
        <strong>{generationLabel(project)}</strong>
        <span>{project.stage === "brief" ? "Planning" : project.stage === "rendering" ? "Rendering" : project.stage === "inspecting" ? "Checking every frame" : "Building"}</span>
      </div>
      <div className="action-list">
        {project.actions.slice(-3).map((action) => (
          <div className="action-row" key={action.id}>
            {action.status === "running" ? <CircleNotch className="spin" size={14} /> : action.status === "failed" ? <Warning size={14} /> : <Check size={14} />}
            <span>{action.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatPanel({
  project,
  auth,
  runtime,
  onSend,
  onCancel,
  onConnect,
  onReviewPreferences,
  onDesignPreferences,
}: {
  project?: StudioProject;
  auth: AuthState;
  runtime: RuntimeState;
  onSend: (text: string, renderer: RendererKind) => Promise<void>;
  onCancel: () => Promise<void>;
  onConnect: () => void;
  onReviewPreferences: (focus: ReviewFocus, strictness: ReviewStrictness) => Promise<void>;
  onDesignPreferences: (changes: { fontCategory?: FontCategory; colorPalette?: ColorPalette }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [renderer, setRenderer] = useState<RendererKind>(project?.renderer || "manim");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const running = project?.status === "running";
  const rendererLocked = Boolean(project?.threadId || project?.messages.length || project?.versions.length) || running;
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
    setRenderer(project?.renderer || "manim");
  }, [project?.id, project?.renderer]);

  async function submit() {
    const value = text.trim();
    if (!value || running) return;
    setError("");
    try {
      await onSend(value, renderer);
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the prompt.");
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
            <span className="empty-chat-icon"><MagicWand size={21} /></span>
            <h2>What should move?</h2>
            <p>Describe the idea, then choose the renderer that best matches the lesson.</p>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>{suggestion}<ArrowRight size={14} /></button>
              ))}
            </div>
          </div>
        )}

        {project?.messages.map((message) => (
          <div className={`message message-${message.role}`} key={message.id}>
            {message.role === "assistant" && <span className="message-avatar"><Sparkle size={13} weight="fill" /></span>}
            <div className="message-bubble">
              {message.attachment?.type === "frameReview" && <div className="message-frame"><img src={message.attachment.imageUrl} alt={`Annotated frame ${message.attachment.label}`} /><span>{message.attachment.label}</span></div>}
              {message.text || (message.streaming ? <span className="typing"><i /><i /><i /></span> : "")}
            </div>
          </div>
        ))}

        {project && <AgentActivity project={project} />}

        {project?.error && (
          <div className="inline-error"><Warning size={16} /><span>{project.error}</span></div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {!auth.connected && (
          <button className="auth-callout" onClick={onConnect}><Sparkle size={15} weight="fill" /> Connect Codex to generate</button>
        )}
        {!rendererReady && (
          <div className="runtime-callout"><Code size={15} /> {renderer === "composite" ? "Manim and Remotion setup required" : `${rendererLabel(renderer)} setup required`}</div>
        )}
        <fieldset className="renderer-picker" disabled={rendererLocked}>
          <legend>Renderer</legend>
          <button type="button" className={renderer === "manim" ? "active" : ""} onClick={() => setRenderer("manim")}>
            <strong>Manim</strong><span>Equations, graphs, geometric transformations</span>
          </button>
          <button type="button" className={renderer === "remotion" ? "active" : ""} onClick={() => setRenderer("remotion")}>
            <strong>Remotion</strong><span>Typography, UI, diagrams, editorial motion</span>
          </button>
          <button type="button" className={renderer === "composite" ? "active" : ""} onClick={() => setRenderer("composite")}>
            <strong>Composite</strong><span>Manim visuals inside a Remotion-directed video</span>
          </button>
        </fieldset>
        {project && (
          <div className="review-settings" aria-label="Automatic review settings">
            <label>Review
              <select value={project.reviewPreferences?.focus || "balanced"} disabled={running} onChange={(event) => void onReviewPreferences(event.target.value as ReviewFocus, project.reviewPreferences?.strictness || "normal")}>
                <option value="balanced">Balanced</option><option value="layout">Layout</option><option value="motion">Motion</option><option value="pedagogy">Teaching</option><option value="accessibility">Accessibility</option><option value="polish">Polish</option>
              </select>
            </label>
            <label>Depth
              <select value={project.reviewPreferences?.strictness || "normal"} disabled={running} onChange={(event) => void onReviewPreferences(project.reviewPreferences?.focus || "balanced", event.target.value as ReviewStrictness)}>
                <option value="quick">Quick</option><option value="normal">Normal</option><option value="obsessive">Frame-heavy</option>
              </select>
            </label>
          </div>
        )}
        {project && (
          <div className="design-settings" aria-label="Video style settings">
            <label>Font
              <select value={project.designPreferences?.fontCategory || "modern"} disabled={running} onChange={(event) => void onDesignPreferences({ fontCategory: event.target.value as FontCategory })}>
                <option value="modern">Modern</option><option value="editorial">Editorial</option><option value="technical">Technical</option><option value="friendly">Friendly</option><option value="classic">Classic</option>
              </select>
            </label>
            <label>Colors
              <select value={project.designPreferences?.colorPalette || "studio"} disabled={running} onChange={(event) => void onDesignPreferences({ colorPalette: event.target.value as ColorPalette })}>
                <option value="studio">Studio warm</option><option value="ocean">Ocean</option><option value="forest">Forest</option><option value="sunset">Sunset</option><option value="monochrome">Monochrome</option><option value="high-contrast">High contrast</option>
              </select>
            </label>
          </div>
        )}
        <label className="sr-only" htmlFor="prompt">Video prompt</label>
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
            placeholder={project?.videoUrl ? "Ask for a change..." : "Describe a video..."}
            rows={2}
            disabled={running}
          />
          {running ? (
            <button className="send-button stop-button" onClick={() => void onCancel()} aria-label="Stop generation"><Stop size={15} weight="fill" /></button>
          ) : (
            <button className="send-button" onClick={() => void submit()} disabled={!text.trim() || !auth.connected || !rendererReady} aria-label="Send prompt"><ArrowUpIcon /></button>
          )}
        </div>
        {error && <span className="form-error">{error}</span>}
        <span className="composer-hint">{rendererLocked ? `${rendererLabel(project?.renderer)} project` : "Choose once · Enter to send"}</span>
      </div>
    </section>
  );
}

function ArrowUpIcon() {
  return <ArrowDown size={16} weight="bold" style={{ transform: "rotate(180deg)" }} />;
}

const STAGES = [
  { key: "brief", icon: MagicWand, label: "Plan" },
  { key: "authoring", icon: Code, label: "Draw" },
  { key: "rendering", icon: MonitorPlay, label: "Render" },
  { key: "inspecting", icon: Sparkle, label: "Review" },
] as const;

function ProgressVisual({ project }: { project: StudioProject }) {
  const activeIndex = Math.max(0, STAGES.findIndex((stage) => stage.key === project.stage));
  return (
    <div className="progress-block">
      <strong>{generationLabel(project)}</strong>
      <span>{project.stage === "brief" ? "1 of 4 · Planning the lesson" : project.stage === "authoring" ? "2 of 4 · Building the visuals" : project.stage === "rendering" ? "3 of 4 · Rendering the video" : "4 of 4 · Inspecting the result"}</span>
      <div className="progress-visual">
        <div className="progress-track" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.08, activeIndex / 3)})` }} /></div>
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
          return (
            <div className={`progress-step progress-${state}`} key={stage.key}>
              <span>{state === "done" ? <Check size={18} /> : <Icon size={19} />}</span>
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

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation, scale: number) {
  const [start, end = start] = annotation.points;
  if (!start) return;
  context.strokeStyle = "#ff334f";
  context.fillStyle = "#ff334f";
  context.lineWidth = Math.max(5, scale * 7);
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.tool === "pen") {
    context.beginPath();
    annotation.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.stroke();
  } else if (annotation.tool === "circle") {
    context.beginPath();
    context.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
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
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }
}

function FrameReviewDialog({ project, version, time, onClose }: { project: StudioProject; version: ProjectVersion; time: number; onClose: () => void }) {
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
    image.onload = () => { imageRef.current = image; setLoaded(true); };
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
    for (const annotation of annotations) drawAnnotation(context, annotation, canvas.width / 1920);
    if (current) drawAnnotation(context, current, canvas.width / 1920);
  }, [annotations, current, loaded]);

  function point(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.min(canvas.width, Math.max(0, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.min(canvas.height, Math.max(0, (event.clientY - bounds.top) * canvas.height / bounds.height)),
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
    const updated = { ...active, points: active.tool === "pen" ? [...active.points, next] : [active.points[0], next] };
    currentRef.current = updated;
    setCurrent(updated);
  }

  function pointerUp(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = currentRef.current;
    if (!active) return;
    const next = point(event);
    const completed = { ...active, points: active.tool === "pen" ? [...active.points, next] : [active.points[0], next] };
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
      await request(`/api/projects/${project.id}/reviews`, { method: "POST", body: JSON.stringify({ versionId: version.id, time: frame / fps, note: note.trim(), annotatedImageData: canvas.toDataURL("image/png") }) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send frame feedback.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="review-dialog" role="dialog" aria-modal="true" aria-label="Annotate video frame">
        <header><div><span className="panel-kicker">Frame feedback</span><h2>Mark what should change</h2><p>{version.id} · frame {frame} · {(frame / fps).toFixed(2)}s</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <div className="annotation-toolbar" aria-label="Annotation tools">
          <button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")} title="Draw"><PencilSimple size={18} /></button>
          <button className={tool === "circle" ? "active" : ""} onClick={() => setTool("circle")} title="Circle"><Circle size={18} /></button>
          <button className={tool === "rectangle" ? "active" : ""} onClick={() => setTool("rectangle")} title="Rectangle"><Rectangle size={18} /></button>
          <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} title="Arrow"><ArrowUpRight size={18} /></button>
          <span />
          <button onClick={() => setAnnotations((items) => items.slice(0, -1))} disabled={!annotations.length}>Undo</button>
          <button onClick={() => setAnnotations([])} disabled={!annotations.length} title="Clear"><Trash size={18} /></button>
        </div>
        <div className="annotation-canvas-wrap">{!loaded && <CircleNotch className="spin" size={24} />}<canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} /></div>
        <label className="review-note">What should change?<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="For example: Move this label above the curve and keep it clear during the transition." /></label>
        {error && <span className="form-error">{error}</span>}
        <footer><button className="footer-action" onClick={onClose}>Cancel</button><button className="download-link" disabled={sending || !loaded} onClick={() => void submit()}>{sending ? <CircleNotch className="spin" size={17} /> : <PaperPlaneRight size={17} />} Send to model</button></footer>
      </section>
    </div>
  );
}

type AssetCandidate = { id: string; title: string; description?: string; thumbnailUrl: string; downloadUrl: string; sourceUrl: string; creator?: string; license: string; licenseUrl?: string; provider: "Wikimedia Commons" };

function AssetPicker({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true); setError("");
    try {
      const body = await request<{ results: AssetCandidate[] }>(`/api/assets/search?q=${encodeURIComponent(query.trim())}`);
      setResults(body.results);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed."); }
    finally { setLoading(false); }
  }

  async function importCandidate(candidate: AssetCandidate) {
    setImporting(candidate.id); setError("");
    try { await request(`/api/projects/${project.id}/assets`, { method: "POST", body: JSON.stringify(candidate) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); }
    finally { setImporting(undefined); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="asset-dialog" role="dialog" aria-modal="true" aria-label="Find licensed visual assets">
        <header><div><span className="panel-kicker">Licensed assets</span><h2>Find a visual</h2><p>Search Wikimedia Commons, then copy the chosen file and its provenance into this project.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <form className="asset-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><MagnifyingGlass size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search diagrams, places, people…" /><button disabled={loading || query.trim().length < 2}>{loading ? "Searching…" : "Search"}</button></form>
        {error && <span className="form-error">{error}</span>}
        <div className="asset-grid">
          {results.map((candidate) => {
            const imported = project.assets?.some((asset) => asset.sourceUrl === candidate.sourceUrl);
            return <article className="asset-card" key={candidate.id}><img src={candidate.thumbnailUrl} alt="" /><div><strong>{candidate.title.replace(/^File:/, "")}</strong><small title={candidate.description}>{candidate.description || candidate.creator || candidate.provider}</small><small>{candidate.creator ? `${candidate.creator} · ${candidate.license}` : candidate.license}</small></div><button disabled={imported || Boolean(importing)} onClick={() => void importCandidate(candidate)}>{imported ? "Added" : importing === candidate.id ? "Adding…" : "Add to project"}</button></article>;
          })}
        </div>
        {!results.length && !loading && <div className="asset-empty"><ImageSquare size={28} /><p>Search results will appear here with their creator and license.</p></div>}
      </section>
    </div>
  );
}

function VideoWorkspace({ project, runtime }: { project?: StudioProject; runtime: RuntimeState }) {
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  const versions = project?.versions || [];
  const selectedVersion: ProjectVersion | undefined = versions.find((version) => version.id === selectedVersionId) || versions.at(-1);
  const videoUrl = selectedVersion?.videoUrl || project?.videoUrl;
  const posterUrl = selectedVersion?.posterUrl || project?.posterUrl;
  const rendererReady = project ? rendererIsReady(project.renderer, runtime) : runtime.manim || runtime.remotion;
  const effectiveDuration = selectedVersion?.render?.duration || duration;
  const filmstripTimes = effectiveDuration > 0 ? Array.from({ length: 7 }, (_, index) => effectiveDuration * index / 6) : [];

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
    if (video.paused) void video.play(); else video.pause();
  }

  return (
    <section className="workspace" aria-label="Video preview">
      <div className="workspace-stage">
        {versions.length > 0 && (
          <div className="revision-bar" aria-label="Video versions">
            <span className="revision-label"><ClockCounterClockwise size={18} /> Revisions</span>
            <div className="revision-list">
              {[...versions].reverse().map((version) => (
                <button
                  key={version.id}
                  className={selectedVersion?.id === version.id ? "active" : ""}
                  onClick={() => setSelectedVersionId(version.id)}
                  title={version.prompt}
                >
                  v{version.number}
                  {version.render?.width && <small>{version.render.width === 1920 ? "HD" : `${version.render.width}p`}</small>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={playerRef} className={`player-shell ${videoUrl ? "has-video" : ""}`}>
          {project?.status === "running" && videoUrl && (
            <div className="generation-overlay" aria-live="polite">
              <CircleNotch className="spin" size={16} />
              <div><strong>Creating {generationLabel(project).toLowerCase()}</strong><span>{project.stage === "brief" ? "Planning" : project.stage === "authoring" ? "Building visuals" : project.stage === "rendering" ? "Rendering video" : "Inspecting frames"} · previewing v{versions.length}</span></div>
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
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              />
              {!hasStarted && (
                <button className="center-play initial-play" onClick={togglePlayback} aria-label="Play video">
                  <Play size={26} weight="fill" />
                </button>
              )}
            </>
          ) : project?.status === "running" ? (
            <div className="render-state">
              <ProgressVisual project={project} />
              <h2>{project.stage === "rendering" ? `Rendering ${generationLabel(project).toLowerCase()}` : project.stage === "inspecting" ? `Checking ${generationLabel(project).toLowerCase()}` : `Building ${generationLabel(project).toLowerCase()}`}</h2>
              <p>Earlier revisions stay available above while this one is created.</p>
            </div>
          ) : (
            <div className="canvas-empty">
              <div className="orbit-visual" aria-hidden="true">
                <span className="orbit-ring orbit-ring-one" />
                <span className="orbit-ring orbit-ring-two" />
                <span className="orbit-node"><Play size={18} weight="fill" /></span>
              </div>
              <h2>Prompt to preview</h2>
              <p>{rendererReady ? "Your video will appear here." : project?.renderer === "composite" ? "Install Manim and Remotion to render a preview." : `Install ${rendererLabel(project?.renderer)} to render a preview.`}</p>
            </div>
          )}
        </div>
        {project && selectedVersion && filmstripTimes.length > 0 && (
          <div className="filmstrip" aria-label="Video frames">
            {filmstripTimes.map((time, index) => (
              <button key={index} className={Math.abs(currentTime - time) < Math.max(effectiveDuration / 12, .35) ? "active" : ""} onClick={() => { if (videoRef.current) { videoRef.current.currentTime = time; videoRef.current.pause(); setCurrentTime(time); } }} title={`Go to ${time.toFixed(1)} seconds`}>
                <img src={`/api/projects/${project.id}/frames?version=${encodeURIComponent(selectedVersion.id)}&time=${time.toFixed(4)}`} alt={`Frame at ${time.toFixed(1)} seconds`} />
                <span>{time.toFixed(1)}s</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-footer">
        <span className="canvas-meta">
          <span>16:9</span>
          <span>{rendererLabel(project?.renderer)}</span>
          {selectedVersion?.render?.width && <span>{selectedVersion.render.width}×{selectedVersion.render.height} · {selectedVersion.render.fps} fps</span>}
          {selectedVersion?.render?.narration?.enabled && (
            <span
              className="ai-voice"
              title={`${selectedVersion.render.narration.model || "Speechify"}, ${selectedVersion.render.narration.voice || "configured voice"}`}
            >
              <SpeakerHigh size={15} /> Speechify AI voice
            </span>
          )}
          {selectedVersion?.render?.narration?.status === "setup_required" && <span>Speechify setup needed</span>}
        </span>
        {videoUrl ? (
          <div className="video-actions">
            {project && <button className="footer-action" onClick={() => setAssetsOpen(true)}><ImageSquare size={18} /> Assets{project.assets?.length ? ` (${project.assets.length})` : ""}</button>}
            {project && selectedVersion && <button className="footer-action review-frame-button" onClick={() => { videoRef.current?.pause(); setCurrentTime(videoRef.current?.currentTime || currentTime); setReviewOpen(true); }}><PencilSimple size={18} /> Review frame</button>}
            <button className="footer-action fullscreen-button" onClick={() => void playerRef.current?.requestFullscreen()}><ArrowsOut size={18} /> Fullscreen</button>
            <a className="download-link" href={videoUrl} download={`${project?.title || "video"}.mp4`}><DownloadSimple size={18} /> Download</a>
          </div>
        ) : (
          project ? <button className="footer-action" onClick={() => setAssetsOpen(true)}><ImageSquare size={18} /> Add licensed asset{project.assets?.length ? ` (${project.assets.length})` : ""}</button> : <span className="muted-action"><DownloadSimple size={17} /> Download</span>
        )}
      </div>
      {reviewOpen && project && selectedVersion && <FrameReviewDialog project={project} version={selectedVersion} time={currentTime} onClose={() => setReviewOpen(false)} />}
      {assetsOpen && project && <AssetPicker project={project} onClose={() => setAssetsOpen(false)} />}
    </section>
  );
}

export function App() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [auth, setAuth] = useState<AuthState>(EMPTY_AUTH);
  const [runtime, setRuntime] = useState<RuntimeState>(EMPTY_RUNTIME);
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");

  const activeProject = useMemo(() => projects.find((project) => project.id === activeId), [projects, activeId]);

  useEffect(() => {
    const applyEvent = (event: StudioEvent) => {
      if (event.type === "snapshot") {
        setProjects(event.projects);
        setAuth(event.auth);
        setRuntime(event.runtime);
        setActiveId((current) => current || event.projects[0]?.id);
        setLoaded(true);
      } else if (event.type === "project") {
        setProjects((current) => mergeProject(current, event.project));
      } else if (event.type === "assistant_delta") {
        setProjects((current) => current.map((project) => {
          if (project.id !== event.projectId) return project;
          const messages = [...project.messages];
          const index = messages.findIndex((item) => item.id === event.messageId);
          if (index >= 0) messages[index] = { ...messages[index], text: messages[index].text + event.delta, streaming: true };
          else messages.push({ id: event.messageId, role: "assistant", text: event.delta, createdAt: new Date().toISOString(), streaming: true });
          return { ...project, messages };
        }));
      } else if (event.type === "auth") {
        setAuth(event.auth);
      } else if (event.type === "runtime") {
        setRuntime(event.runtime);
      }
    };

    void fetch("/api/state").then((response) => response.json()).then((event: StudioEvent) => applyEvent(event));
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as StudioEvent;
      applyEvent(event);
    };
    return () => events.close();
  }, []);

  async function createProject() {
    const project = await request<StudioProject>("/api/projects", { method: "POST", body: JSON.stringify({}) });
    setProjects((current) => mergeProject(current, project));
    setActiveId(project.id);
    setSidebarOpen(false);
    setMobilePane("chat");
  }

  async function ensureProject() {
    if (activeProject) return activeProject;
    const project = await request<StudioProject>("/api/projects", { method: "POST", body: JSON.stringify({}) });
    setProjects((current) => mergeProject(current, project));
    setActiveId(project.id);
    return project;
  }

  async function sendMessage(text: string, renderer: RendererKind) {
    const project = await ensureProject();
    await request(`/api/projects/${project.id}/messages`, { method: "POST", body: JSON.stringify({ text, renderer }) });
    setMobilePane("preview");
  }

  async function cancel() {
    if (!activeProject) return;
    await request(`/api/projects/${activeProject.id}/cancel`, { method: "POST" });
  }

  async function updateReviewPreferences(focus: ReviewFocus, strictness: ReviewStrictness) {
    if (!activeProject) return;
    const project = await request<StudioProject>(`/api/projects/${activeProject.id}/review-preferences`, { method: "PATCH", body: JSON.stringify({ focus, strictness }) });
    setProjects((current) => mergeProject(current, project));
  }

  async function updateDesignPreferences(changes: { fontCategory?: FontCategory; colorPalette?: ColorPalette }) {
    if (!activeProject) return;
    const project = await request<StudioProject>(`/api/projects/${activeProject.id}/design-preferences`, { method: "PATCH", body: JSON.stringify(changes) });
    setProjects((current) => mergeProject(current, project));
  }

  async function connect() {
    const popup = window.open("about:blank", "codex-login", "width=560,height=720");
    try {
      const result = await request<{ authUrl: string }>("/api/auth/login", { method: "POST" });
      if (popup) popup.location.href = result.authUrl;
      else window.location.href = result.authUrl;
    } catch (error) {
      popup?.close();
      window.alert(error instanceof Error ? error.message : "Could not connect Codex.");
    }
  }

  async function logout() {
    await request("/api/auth/logout", { method: "POST" });
  }

  if (!loaded) {
    return (
      <main className="app-loading" aria-label="Loading Lesson Studio">
        <div className="loading-brand"><span className="brand-mark"><FilmSlate size={18} weight="fill" /></span><strong>Lesson Studio</strong></div>
        <div className="loading-line"><span /></div>
      </main>
    );
  }

  return (
    <main className={`app-shell mobile-${mobilePane} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        projects={projects}
        activeId={activeId}
        auth={auth}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNew={() => void createProject()}
        onSelect={(id) => { setActiveId(id); setSidebarOpen(false); }}
        onConnect={() => void connect()}
        onLogout={() => void logout()}
      />
      {sidebarOpen && <button className="sidebar-scrim mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close projects" />}

      <div className="studio-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open projects"><List size={20} /></button>
            <span className="topbar-title">{activeProject?.title || "Untitled video"}</span>
            {activeProject?.status === "running" && <span className="status-badge"><CircleNotch className="spin" size={12} /> {generationLabel(activeProject)}</span>}
            {activeProject?.status === "complete" && <span className="status-badge status-complete"><Check size={12} /> Ready · v{activeProject.versions.length}</span>}
          </div>
          <div className="topbar-actions">
            <button
              className={`view-toggle ${chatCollapsed ? "active" : ""}`}
              onClick={() => { setChatCollapsed((value) => !value); setPreviewCollapsed(false); }}
              aria-label={chatCollapsed ? "Show chat" : "Collapse chat"}
              title={chatCollapsed ? "Show chat" : "Collapse chat"}
            ><MagicWand size={18} /><span>Chat</span></button>
            <button
              className={`view-toggle ${previewCollapsed ? "active" : ""}`}
              onClick={() => { setPreviewCollapsed((value) => !value); setChatCollapsed(false); }}
              aria-label={previewCollapsed ? "Show video" : "Collapse video"}
              title={previewCollapsed ? "Show video" : "Collapse video"}
            ><MonitorPlay size={18} /><span>Video</span></button>
            <span className="runtime-status" title="Local rendering status">
              <span className={runtime.codex && runtime.ffmpeg && (runtime.manim || runtime.remotion) ? "runtime-good" : "runtime-warn"} />
              {runtime.codex && runtime.ffmpeg && (runtime.manim || runtime.remotion) ? "Local" : "Setup"}
            </span>
          </div>
        </header>

        <div className={`studio-grid ${chatCollapsed ? "chat-is-collapsed" : ""} ${previewCollapsed ? "preview-is-collapsed" : ""}`}>
          <ChatPanel
            project={activeProject}
            auth={auth}
            runtime={runtime}
            onSend={sendMessage}
            onCancel={cancel}
            onConnect={() => void connect()}
            onReviewPreferences={updateReviewPreferences}
            onDesignPreferences={updateDesignPreferences}
          />
          <VideoWorkspace project={activeProject} runtime={runtime} />
        </div>

        <nav className="mobile-tabs mobile-only" aria-label="Workspace view">
          <button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}><MagicWand size={18} /> Chat</button>
          <button className={mobilePane === "preview" ? "active" : ""} onClick={() => setMobilePane("preview")}><MonitorPlay size={18} /> Preview</button>
        </nav>
      </div>
    </main>
  );
}
