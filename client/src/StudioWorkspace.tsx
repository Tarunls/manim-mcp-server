import {
  ArrowsOut,
  CaretDown,
  CaretUp,
  CheckCircle,
  ClockCounterClockwise,
  DownloadSimple,
  FilmStrip,
  GitBranch,
  Images,
  MagnifyingGlass,
  MonitorPlay,
  Play,
  Plus,
  SlidersHorizontal,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Player } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetCandidate, AssetSearchResponse } from "../../shared/assets";
import type { VideoClip, VideoProjectIR, VideoShot } from "../../shared/video-ir";
import { VideoComposition } from "../../remotion/VideoComposition";
import type { ProjectVersion, RuntimeState, StudioProject } from "./types";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}

function versionLabel(version: ProjectVersion) {
  return `v${version.number}`;
}

function findClip(project: VideoProjectIR | undefined, shotId: string | undefined, clipId: string | undefined) {
  const shot = project?.shots.find((candidate) => candidate.id === shotId);
  const clip = shot?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
  return { shot, clip };
}

function QualityBadge({ project }: { project: StudioProject }) {
  const quality = project.quality || project.versions.at(-1)?.quality;
  if (!quality) return <span className="quality-pill quality-pending"><WarningCircle size={16} /> Not checked</span>;
  return quality.passed
    ? <span className="quality-pill quality-good" title={`Score ${quality.score}`}><CheckCircle size={16} weight="fill" /> {quality.score}</span>
    : <span className="quality-pill quality-bad" title={`${quality.summary.errors} errors`}><WarningCircle size={16} weight="fill" /> {quality.summary.errors}</span>;
}

function RevisionRail({
  project,
  selected,
  onSelect,
  onBranch,
}: {
  project: StudioProject;
  selected: string;
  onSelect: (id: string) => void;
  onBranch: (version: ProjectVersion) => void;
}) {
  return (
    <div className="revision-rail" aria-label="Revision history">
      <span className="rail-label"><ClockCounterClockwise size={18} /> History</span>
      {project.timeline?.shots.length ? <button className={selected === "live" ? "active" : ""} onClick={() => onSelect("live")}>Live</button> : null}
      {[...project.versions].reverse().map((version) => (
        <div className="revision-option" key={version.id}>
          <button className={selected === version.id ? "active" : ""} onClick={() => onSelect(version.id)} title={version.prompt}>
            {versionLabel(version)}
          </button>
          {selected === version.id && (
            <button className="revision-branch" onClick={() => onBranch(version)} aria-label={`Branch ${versionLabel(version)}`} title="Edit from this revision">
              <GitBranch size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ClipInspector({
  project,
  shot,
  clip,
  onClose,
  onUpdate,
}: {
  project: VideoProjectIR;
  shot?: VideoShot;
  clip?: VideoClip;
  onClose: () => void;
  onUpdate: (update: (draft: VideoProjectIR) => void) => Promise<void>;
}) {
  const target = clip || shot;
  if (!target) {
    return (
      <aside className="inspector-panel">
        <div className="inspector-header"><strong>Inspector</strong><button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={18} /></button></div>
        <div className="inspector-empty"><SlidersHorizontal size={26} /><span>Select a shot or clip</span></div>
      </aside>
    );
  }

  const updateClip = (property: string, value: string | number) => onUpdate((draft) => {
    const found = findClip(draft, shot?.id, clip?.id).clip;
    if (!found) return;
    if (property === "text") found.text = String(value);
    else if (property in found.transform) (found.transform as unknown as Record<string, string | number>)[property] = Number(value);
    else found.style[property] = typeof value === "number" ? value : value;
  });

  const updateShot = (property: "name" | "intent", value: string) => onUpdate((draft) => {
    const found = draft.shots.find((candidate) => candidate.id === shot?.id);
    if (found) found[property] = value;
  });

  return (
    <aside className="inspector-panel">
      <div className="inspector-header">
        <div><span>{clip ? clip.kind : "shot"}</span><strong>{target.name}</strong></div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={18} /></button>
      </div>
      <div className="inspector-scroll" key={target.id}>
        {!clip && shot && (
          <>
            <label>Name<input defaultValue={shot.name} onBlur={(event) => void updateShot("name", event.target.value)} /></label>
            <label>Purpose<textarea defaultValue={shot.intent} onBlur={(event) => void updateShot("intent", event.target.value)} /></label>
            <div className="field-pair"><label>Start<input value={`${shot.start.toFixed(2)}s`} readOnly /></label><label>Length<input value={`${shot.duration.toFixed(2)}s`} readOnly /></label></div>
            <label>Renderer<input value={shot.renderer} readOnly /></label>
          </>
        )}
        {clip && (
          <>
            {["text", "caption"].includes(clip.kind) && <label>Text<textarea defaultValue={clip.text} onBlur={(event) => void updateClip("text", event.target.value)} /></label>}
            <div className="inspector-section-title">Frame</div>
            <div className="field-pair">
              {(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key.toUpperCase()}<input type="number" defaultValue={clip.transform[key]} onBlur={(event) => void updateClip(key, Number(event.target.value))} /></label>)}
            </div>
            <div className="inspector-section-title">Type</div>
            <div className="field-pair">
              <label>Size<input type="number" defaultValue={Number(clip.style.fontSize || 64)} onBlur={(event) => void updateClip("fontSize", Number(event.target.value))} /></label>
              <label>Weight<input type="number" defaultValue={Number(clip.style.fontWeight || 650)} onBlur={(event) => void updateClip("fontWeight", Number(event.target.value))} /></label>
            </div>
            <label>Color<input type="color" defaultValue={String(clip.style.color || project.design.colors.text)} onBlur={(event) => void updateClip("color", event.target.value)} /></label>
          </>
        )}
      </div>
    </aside>
  );
}

function AssetDrawer({ project, onClose, onImported }: { project: StudioProject; onClose: () => void; onImported: (project: StudioProject) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetCandidate[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "importing">("idle");
  const [error, setError] = useState("");

  async function search() {
    if (!query.trim()) return;
    setStatus("searching");
    setError("");
    try {
      const response = await api<AssetSearchResponse>(`/api/assets/search?query=${encodeURIComponent(query)}&limit=18`);
      setResults(response.results);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed.");
    } finally {
      setStatus("idle");
    }
  }

  async function importAsset(candidate: AssetCandidate) {
    setStatus("importing");
    setError("");
    try {
      await api(`/api/projects/${project.id}/assets/import`, { method: "POST", body: JSON.stringify(candidate) });
      const timeline = await api<VideoProjectIR>(`/api/projects/${project.id}/timeline`);
      onImported({ ...project, timeline });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <aside className="asset-drawer">
      <div className="inspector-header"><div><span>Licensed media</span><strong>Assets</strong></div><button className="icon-button" onClick={onClose} aria-label="Close assets"><X size={18} /></button></div>
      <form className="asset-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <MagnifyingGlass size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search icons, footage, images" />
        <button disabled={!query.trim() || status !== "idle"} aria-label="Search assets">{status === "searching" ? <SpinnerGap className="spin" size={17} /> : <MagnifyingGlass size={17} />}</button>
      </form>
      {error && <div className="drawer-error"><WarningCircle size={17} />{error}</div>}
      <div className="asset-results">
        {!results.length && <div className="asset-empty"><Images size={28} /><span>Search the licensed library</span></div>}
        {results.map((asset) => (
          <article className="asset-card" key={`${asset.provider}-${asset.id}`}>
            <div className="asset-preview">{asset.previewUrl ? <img src={asset.previewUrl} alt="" /> : <FilmStrip size={28} />}</div>
            <div><strong>{asset.name}</strong><span>{asset.provider} · {asset.license.name}</span></div>
            <button onClick={() => void importAsset(asset)} disabled={status === "importing"} aria-label={`Import ${asset.name}`}><Plus size={17} /></button>
          </article>
        ))}
      </div>
    </aside>
  );
}

function Timeline({
  project,
  selectedShotId,
  selectedClipId,
  collapsed,
  onToggle,
  onSelectShot,
  onSelectClip,
}: {
  project: VideoProjectIR;
  selectedShotId?: string;
  selectedClipId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onSelectShot: (id: string) => void;
  onSelectClip: (shotId: string, clipId: string) => void;
}) {
  const duration = Math.max(project.format.duration, 0.1);
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) || project.shots[0];
  return (
    <section className={`timeline-panel ${collapsed ? "timeline-collapsed" : ""}`}>
      <button className="timeline-heading" onClick={onToggle} aria-expanded={!collapsed}>
        <span><FilmStrip size={18} /> Timeline</span><small>{project.shots.length} shots · {duration.toFixed(1)}s</small>{collapsed ? <CaretUp size={17} /> : <CaretDown size={17} />}
      </button>
      {!collapsed && (
        <div className="timeline-body">
          <div className="time-ruler"><span>0s</span><span>{(duration / 2).toFixed(1)}s</span><span>{duration.toFixed(1)}s</span></div>
          <div className="shot-row">
            <span className="track-label">Shots</span>
            <div className="track-lane">
              {project.shots.map((shot) => <button key={shot.id} className={`shot-block ${selectedShot?.id === shot.id ? "selected" : ""}`} style={{ left: `${shot.start / duration * 100}%`, width: `${shot.duration / duration * 100}%` }} onClick={() => onSelectShot(shot.id)}><span>{shot.name}</span><small>{shot.renderer}</small></button>)}
            </div>
          </div>
          {selectedShot?.tracks.map((track) => (
            <div className="clip-row" key={track.id}>
              <span className="track-label">{track.name}</span>
              <div className="track-lane">
                {track.clips.map((clip) => <button key={clip.id} className={`clip-block clip-${clip.kind} ${selectedClipId === clip.id ? "selected" : ""}`} style={{ left: `${clip.start / selectedShot.duration * 100}%`, width: `${clip.duration / selectedShot.duration * 100}%` }} onClick={() => onSelectClip(selectedShot.id, clip.id)}>{clip.name}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StudioWorkspace({
  project,
  runtime,
  onProject,
  onBranch,
}: {
  project?: StudioProject;
  runtime: RuntimeState;
  onProject: (project: StudioProject) => void;
  onBranch: (project: StudioProject) => void;
}) {
  const [selectedRevision, setSelectedRevision] = useState("live");
  const [selectedShotId, setSelectedShotId] = useState<string>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const playerShell = useRef<HTMLDivElement>(null);
  const timeline = project?.timeline;
  const selectedVersion = project?.versions.find((version) => version.id === selectedRevision);
  const selected = findClip(timeline, selectedShotId, selectedClipId);
  const assetUrls = useMemo(() => Object.fromEntries((timeline?.assets || []).filter((asset) => asset.localPath).map((asset) => [asset.id, encodeURI(`/media/${project?.id}/${asset.localPath}`)])), [timeline, project?.id]);

  useEffect(() => {
    setSelectedRevision(project?.timeline?.shots.length ? "live" : project?.versions.at(-1)?.id || "live");
    setSelectedShotId(project?.timeline?.shots[0]?.id);
    setSelectedClipId(undefined);
    setError("");
  }, [project?.id]);

  async function updateTimeline(mutator: (draft: VideoProjectIR) => void) {
    if (!project?.timeline) return;
    const draft = structuredClone(project.timeline);
    mutator(draft);
    setBusy("Saving");
    setError("");
    try {
      const saved = await api<VideoProjectIR>(`/api/projects/${project.id}/timeline`, { method: "PUT", body: JSON.stringify(draft) });
      onProject({ ...project, timeline: saved });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
    } finally {
      setBusy("");
    }
  }

  async function render() {
    if (!project) return;
    setBusy("Rendering");
    setError("");
    try {
      await api(`/api/projects/${project.id}/render`, { method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not render.");
    } finally {
      setBusy("");
    }
  }

  async function branch(version: ProjectVersion) {
    if (!project) return;
    setBusy("Branching");
    setError("");
    try {
      onBranch(await api<StudioProject>(`/api/projects/${project.id}/versions/${version.id}/branch`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not branch revision.");
    } finally {
      setBusy("");
    }
  }

  if (!project) {
    return <section className="workspace studio-workspace"><div className="studio-empty"><MonitorPlay size={34} /><h2>Prompt to preview</h2><p>{runtime.manim ? "Your editable video will appear here." : "Install Manim to render a preview."}</p></div></section>;
  }

  const showLive = selectedRevision === "live" && Boolean(timeline?.shots.length);
  const videoUrl = selectedVersion?.proxyUrl || selectedVersion?.videoUrl || project.proxyUrl || project.videoUrl;

  return (
    <section className="workspace studio-workspace" aria-label="Video editor">
      <div className="editor-toolbar">
        <RevisionRail project={project} selected={selectedRevision} onSelect={setSelectedRevision} onBranch={(version) => void branch(version)} />
        <div className="editor-actions">
          {busy && <span className="save-state"><SpinnerGap className="spin" size={16} />{busy}</span>}
          <QualityBadge project={project} />
          <button className={assetsOpen ? "active" : ""} onClick={() => setAssetsOpen((value) => !value)}><Images size={18} /><span>Assets</span></button>
          <button className={inspectorOpen ? "active" : ""} onClick={() => setInspectorOpen((value) => !value)}><SlidersHorizontal size={18} /><span>Inspect</span></button>
          <button className="render-button" onClick={() => void render()} disabled={!timeline?.shots.length || project.status === "running"}><Play size={16} weight="fill" /> Render</button>
        </div>
      </div>
      {error && <div className="editor-error"><WarningCircle size={17} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
      <div className={`editor-canvas-row ${inspectorOpen ? "with-inspector" : ""}`}>
        <div className="stage-wrap">
          <div className="player-shell editor-player" ref={playerShell}>
            {showLive && timeline ? (
              <Player
                component={VideoComposition}
                inputProps={{ project: timeline, assetUrls }}
                durationInFrames={Math.max(1, Math.round(timeline.format.duration * timeline.format.fps))}
                compositionWidth={timeline.format.width}
                compositionHeight={timeline.format.height}
                fps={timeline.format.fps}
                controls
                clickToPlay
                style={{ width: "100%", height: "100%" }}
              />
            ) : videoUrl ? (
              <video key={videoUrl} src={videoUrl} poster={selectedVersion?.posterUrl || project.posterUrl} controls playsInline preload="metadata" />
            ) : project.status === "running" ? (
              <div className="render-state"><SpinnerGap className="spin" size={34} /><h2>Building the cut</h2><p>The first preview will appear here.</p></div>
            ) : (
              <div className="studio-empty"><MonitorPlay size={34} /><h2>No preview yet</h2><p>Use chat to build the first cut.</p></div>
            )}
          </div>
          <div className="stage-meta">
            <span>{timeline ? `${timeline.format.width} × ${timeline.format.height} · ${timeline.format.fps} fps` : "16:9"}</span>
            <div>
              <button onClick={() => void playerShell.current?.requestFullscreen()}><ArrowsOut size={17} /> Fullscreen</button>
              {videoUrl && <a href={videoUrl} download={`${project.title}.mp4`}><DownloadSimple size={17} /> Download</a>}
            </div>
          </div>
        </div>
        {inspectorOpen && timeline && <ClipInspector project={timeline} shot={selected.shot} clip={selected.clip} onClose={() => setInspectorOpen(false)} onUpdate={updateTimeline} />}
        {assetsOpen && <AssetDrawer project={project} onClose={() => setAssetsOpen(false)} onImported={onProject} />}
      </div>
      {timeline && <Timeline project={timeline} selectedShotId={selectedShotId} selectedClipId={selectedClipId} collapsed={timelineCollapsed} onToggle={() => setTimelineCollapsed((value) => !value)} onSelectShot={(id) => { setSelectedShotId(id); setSelectedClipId(undefined); setInspectorOpen(true); }} onSelectClip={(shotId, clipId) => { setSelectedShotId(shotId); setSelectedClipId(clipId); setInspectorOpen(true); }} />}
    </section>
  );
}
