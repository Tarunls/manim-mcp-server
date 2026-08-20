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
  MonitorPlay,
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
import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthState, ProjectVersion, RuntimeState, StudioEvent, StudioProject } from "./types";
import { StudioWorkspace } from "./StudioWorkspace";

const EMPTY_AUTH: AuthState = { connected: false };
const EMPTY_RUNTIME: RuntimeState = { codex: false, manim: false, ffmpeg: false };

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
        <span className="collapsible-copy">Manim Studio</span>
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
              <span className="project-time">{project.status === "running" ? "Generating" : shortDate(project.updatedAt)}</span>
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
        <strong>Agent</strong>
        <span>{project.stage === "rendering" ? "Rendering" : project.stage === "inspecting" ? "Reviewing" : "Building"}</span>
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
}: {
  project?: StudioProject;
  auth: AuthState;
  runtime: RuntimeState;
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onConnect: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const running = project?.status === "running";
  const suggestions = [
    "Animate the Pythagorean theorem",
    "Explain gradient descent visually",
    "Show how a Fourier series builds a square wave",
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [project?.messages.length, project?.actions.length]);

  async function submit() {
    const value = text.trim();
    if (!value || running) return;
    setError("");
    try {
      await onSend(value);
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
            <p>Describe the idea. The agent writes and renders the Manim scene.</p>
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
        {!runtime.manim && (
          <div className="runtime-callout"><Code size={15} /> Manim setup required</div>
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
            <button className="send-button" onClick={() => void submit()} disabled={!text.trim() || !auth.connected || !runtime.manim} aria-label="Send prompt"><ArrowUpIcon /></button>
          )}
        </div>
        {error && <span className="form-error">{error}</span>}
        <span className="composer-hint">Enter to send</span>
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
  );
}

function VideoWorkspace({ project, runtime }: { project?: StudioProject; runtime: RuntimeState }) {
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  const versions = project?.versions || [];
  const selectedVersion: ProjectVersion | undefined = versions.find((version) => version.id === selectedVersionId) || versions.at(-1);
  const videoUrl = selectedVersion?.videoUrl || project?.videoUrl;
  const posterUrl = selectedVersion?.posterUrl || project?.posterUrl;

  useEffect(() => {
    setHasStarted(false);
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
              <h2>{project.stage === "rendering" ? "Rendering preview" : project.stage === "inspecting" ? "Checking the result" : "Building your scene"}</h2>
              <p>The preview will appear here.</p>
            </div>
          ) : (
            <div className="canvas-empty">
              <div className="orbit-visual" aria-hidden="true">
                <span className="orbit-ring orbit-ring-one" />
                <span className="orbit-ring orbit-ring-two" />
                <span className="orbit-node"><Play size={18} weight="fill" /></span>
              </div>
              <h2>Prompt to preview</h2>
              <p>{runtime.manim ? "Your video will appear here." : "Install Manim to render a preview."}</p>
            </div>
          )}
        </div>
      </div>

      <div className="workspace-footer">
        <span className="canvas-meta">
          <span>16:9</span>
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
            <button className="footer-action" onClick={() => void playerRef.current?.requestFullscreen()}><ArrowsOut size={18} /> Fullscreen</button>
            <a className="download-link" href={videoUrl} download={`${project?.title || "video"}.mp4`}><DownloadSimple size={18} /> Download</a>
          </div>
        ) : (
          <span className="muted-action"><DownloadSimple size={17} /> Download</span>
        )}
      </div>
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

  async function sendMessage(text: string) {
    const project = await ensureProject();
    await request(`/api/projects/${project.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    setMobilePane("preview");
  }

  async function cancel() {
    if (!activeProject) return;
    await request(`/api/projects/${activeProject.id}/cancel`, { method: "POST" });
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
      <main className="app-loading" aria-label="Loading Manim Studio">
        <div className="loading-brand"><span className="brand-mark"><FilmSlate size={18} weight="fill" /></span><strong>Manim Studio</strong></div>
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
            {activeProject?.status === "running" && <span className="status-badge"><CircleNotch className="spin" size={12} /> Live</span>}
            {activeProject?.status === "complete" && <span className="status-badge status-complete"><Check size={12} /> Ready</span>}
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
              <span className={runtime.codex && runtime.manim && runtime.ffmpeg ? "runtime-good" : "runtime-warn"} />
              {runtime.codex && runtime.manim && runtime.ffmpeg ? "Local" : "Setup"}
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
          />
          <StudioWorkspace
            project={activeProject}
            runtime={runtime}
            onProject={(project) => setProjects((current) => mergeProject(current, project))}
            onBranch={(project) => {
              setProjects((current) => mergeProject(current, project));
              setActiveId(project.id);
            }}
          />
        </div>

        <nav className="mobile-tabs mobile-only" aria-label="Workspace view">
          <button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}><MagicWand size={18} /> Chat</button>
          <button className={mobilePane === "preview" ? "active" : ""} onClick={() => setMobilePane("preview")}><MonitorPlay size={18} /> Preview</button>
        </nav>
      </div>
    </main>
  );
}
