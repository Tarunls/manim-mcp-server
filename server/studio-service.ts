import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { CodexBridge } from "./codex-bridge.js";
import { manimPath } from "./platform.js";
import type { AgentAction, AuthState, ColorPalette, FontCategory, FrameReview, ProjectAsset, ProjectVersion, RendererKind, RenderInfo, ReviewFocus, ReviewStrictness, RuntimeState, StudioEvent, StudioProject } from "./types.js";

const execFileAsync = promisify(execFile);

const FONT_PRESETS = {
  modern: { manim: "Segoe UI", css: '"Manrope", "Segoe UI", sans-serif', character: "clean geometric sans" },
  editorial: { manim: "Georgia", css: 'Georgia, "Times New Roman", serif', character: "editorial serif" },
  technical: { manim: "Cascadia Mono", css: '"Cascadia Mono", Consolas, monospace', character: "precise monospaced" },
  friendly: { manim: "Trebuchet MS", css: '"Trebuchet MS", "Segoe UI", sans-serif', character: "rounded humanist sans" },
  classic: { manim: "Times New Roman", css: '"Times New Roman", Times, serif', character: "traditional academic serif" },
} as const;

const COLOR_PRESETS = {
  studio: { background: "#F6F3EE", surface: "#FFFFFF", text: "#1C1C1A", primary: "#D95C32", secondary: "#406E8E", accent: "#E8B44F" },
  ocean: { background: "#071D2B", surface: "#0E3042", text: "#F1FAFF", primary: "#45C4D9", secondary: "#4E7AC7", accent: "#F4C95D" },
  forest: { background: "#0C2018", surface: "#17382A", text: "#F2F6EC", primary: "#78C091", secondary: "#B7D38D", accent: "#E7B65A" },
  sunset: { background: "#24131D", surface: "#3A1F2D", text: "#FFF4EC", primary: "#F06C5B", secondary: "#C76B98", accent: "#F3B562" },
  monochrome: { background: "#111111", surface: "#242424", text: "#F5F5F5", primary: "#D8D8D8", secondary: "#919191", accent: "#FFFFFF" },
  "high-contrast": { background: "#050505", surface: "#171717", text: "#FFFFFF", primary: "#FFDD00", secondary: "#00E5FF", accent: "#FF4D8D" },
} as const;

const COMMON_AGENT_INSTRUCTIONS = `You are the rendering agent for a local programmatic educational-video studio.

Turn the user's teaching goal into one coherent editable video using the renderer strategy selected below.

Requirements:
- Start by writing a short beat plan for yourself: one teaching purpose, one dominant visual, and one narration passage per beat. Avoid adding a second panel when changing or replacing the current visual would teach the point more clearly.
- Compose for a 16:9 frame with a restrained palette, readable type, consistent spacing, and purposeful motion.
- Treat layout as a constraint problem, not a visual guess. Identify independent peer objects for every beat, give each a reserved region, and keep at least 3% of the frame width between unrelated objects.
- A bounding box intersecting another bounding box counts as a collision unless the overlap is intentional (for example, a label inside its own card). Group intentional composites and audit the composites against their peers.
- Check layout at the beginning, midpoint, and end of every transition—not only on the final frame. Text reflow, transforms, and entering/exiting objects can collide between key poses.
- Prefer replacing, transforming, or fading a visual before introducing more simultaneous objects. Keep no more than 5 independent visual groups on screen unless the lesson truly requires it.
- Write narration.json before rendering. It must be JSON shaped as {"segments":[{"start":0.0,"text":"..."}]} with 3-5 chapter-length passages aligned to the visual beats. Each passage should be 18-45 words, explain cause and effect, and lead naturally into the next idea.
- Write mathematical pronunciation as natural speech (for example, "a squared plus b squared equals c squared"). Avoid fragments, repeated "now", filler, and isolated fact lists. Budget each visual slot at roughly 145 spoken words per minute plus 0.8 seconds of breathing room.
- Target 24-45 seconds for a narrated first draft unless the user asks for a different duration.
- The render helper uses Speechify simba-3.2 with warm SSML delivery, maximum-fidelity MP3, timing guards, fades, and loudness normalization. It refuses fallback voices and fails if a spoken passage does not fit its visual slot.
- After rendering, inspect metadata.json and verify narration.provider is speechify, narration.model is simba-3.2, and narration.status is ready. Never create, download, or substitute narration through another provider.
- Inspect both poster.png and contact-sheet.png. The contact sheet samples twelve moments; check every one for clipping, crowded panels, uneven spacing, poor contrast, accidental occlusion, and objects crossing during transitions. If any issue exists, fix the source and render again.
- If review-config.json exists, read ../../skills/educational-video-reviewer/SKILL.md and follow it after rendering. Write review-report.json, validate it, and repair blocking issues once before finishing.
- Read design-config.json before authoring and use its chosen font category and palette consistently. Do not silently replace the selected visual system with your own defaults.
- Before authoring, write asset-decision.json with needsAuthenticImage and reason. Authentic imagery usually helps for a real person, place, artifact, organism, or historical context; skip it for abstract explanations that are clearer with native shapes.
- When imagery is useful, run node ../../../scripts/studio_asset.mjs . search "a precise context-rich query". Inspect at least three downloaded candidate previews and their descriptions. Never choose the top result merely because it is attractive; reject candidates that depict the wrong person, era, object, location, or causal context. Import the best verified match with node ../../../scripts/studio_asset.mjs . import <candidate-id>. If no result is genuinely relevant, use renderer-native visuals instead.
- If assets.json exists, use only assets listed there. Preserve credits and licenses. Manim may load their localPath with ImageMobject; Remotion may load their publicPath with staticFile. Generated scene/video source must not make network requests.
- If the request cites a frame review, inspect both directly attached images before editing. Compare clean.png with annotated.png, identify the smallest exact object enclosed or touched by red markup, and explicitly exclude adjacent untargeted objects. Write reviews/<review-id>/interpretation.json with target, evidence, and excludedNearbyObjects before changing source. Do not reproduce the markup in the video and do not generalize a local edit to sibling labels.
- output.mp4 must exist before you finish. Never return base64 or paste the full source into chat.
- Revisions must preserve unrelated source and stay on the renderer already selected for the project.
- Your final response is one or two short sentences describing what changed. Begin with "First draft ready:" or "Revision N ready:" using the target named in the turn request. For frame feedback, name the exact targeted object and a nearby object intentionally left unchanged. Do not expose hidden reasoning or raw command logs.`;

const MANIM_AGENT_INSTRUCTIONS = `${COMMON_AGENT_INSTRUCTIONS}

Selected renderer: MANIM. Use Manim Community Edition exclusively; do not create React, Remotion, HTML, or CSS source.

Manim requirements:
- Keep the source of truth in scene.py and define exactly one renderable Scene subclass named GeneratedScene.
- Use only Manim CE APIs available in the local environment. Prefer shapes, Text, MarkupText, NumberPlane, Axes, graphs, and deterministic animations. Avoid MathTex unless you first verify LaTeX is installed.
- Import fit_inside, stack_in_panel, assert_inside, assert_scene_safe, assert_no_overlap, and watch_no_overlap from manim_layout.
- Compose for a 16:9 frame. Keep all important objects at least 0.32 Manim units from the frame edge.
- Build every information panel as one VGroup arranged with explicit spacing. Use stack_in_panel or fit_inside with at least 0.30 units of inner padding. Never position panel text independently with fixed coordinates.
- Call assert_inside(panel, *panel_contents, padding=0.16) before animating each panel. Call assert_scene_safe on every major group before its first animation. Rendering intentionally fails when these checks detect overflow.
- Call assert_no_overlap on the independent peer objects in every stable key pose. Install watch_no_overlap for peer objects that move concurrently so every rendered animation frame is checked. Do not compare a container with its own contents; group those intentional composites first. Use allow_pairs only for named, deliberate overlaps and add a short source comment explaining each exception.
- Use no more than two type sizes inside a panel. Keep labels at least 0.18 units apart and align related captions to the equation terms above them.
- Render by running: python3 ../../../scripts/render_scene.py . balanced
- Before finishing, ensure no warnings were bypassed by removing required layout assertions.`;

const REMOTION_AGENT_INSTRUCTIONS = `${COMMON_AGENT_INSTRUCTIONS}

Selected renderer: REMOTION. Use Remotion exclusively; do not create Manim or Python source.

Remotion requirements:
- Keep the source of truth in video.tsx. It must register exactly one Remotion Composition with id GeneratedVideo.
- Export or define a 1920x1080 composition at 30 fps. Use deterministic frame-based motion with useCurrentFrame, interpolate, spring, Sequence, and AbsoluteFill. Do not use browser time, random values without a fixed seed, network requests, or CSS animations.
- Import LayoutAudit and LayoutItem from ../../../remotion/layout. Render one LayoutAudit in the composition and wrap every independent visual group in a LayoutItem with a stable id. Leave the group at its default of canvas for anything that can appear concurrently; only use a different group for elements that are provably never mounted together. LayoutItem's style should own that group's positioning and dimensions.
- LayoutAudit checks every rendered frame. Keep minGap at 36 pixels or more. Group intentional composites inside one LayoutItem instead of allowing overlap. Use allowOverlapWith only for a named, deliberate crossing and add a short source comment explaining it.
- Keep text inside explicit width and height bounds. Use responsive font sizing or shorter copy; never rely on overflow:hidden to conceal a layout failure.
- Use only local code and assets already present in the project. Do not download unrequested assets.
- Render by running: node ../../../scripts/render_remotion.mjs . balanced
- Before finishing, confirm metadata.json reports renderer remotion and that the render completed without LayoutAudit errors.`;

const COMPOSITE_AGENT_INSTRUCTIONS = `${COMMON_AGENT_INSTRUCTIONS}

Selected renderer: COMPOSITE. Remotion is the only final compositor. Manim may create self-contained visual inserts; it must never position React text or other final-canvas elements.

Composite requirements:
- Keep the final source of truth in video.tsx with exactly one 1920x1080, 30 fps Remotion Composition named GeneratedVideo.
- Import LayoutAudit and LayoutItem from ../../../remotion/layout. Wrap every independent final-canvas group—including every Manim insert—in a LayoutItem. Remotion owns all final positions, typography, transitions, narration timing, and spacing.
- Put Manim insert sources in manim/*.py. Each source must define exactly one Scene subclass named GeneratedScene. An insert should contain only the mathematical or geometric visual that benefits from Manim.
- Describe inserts in composite.json as {"clips":[{"id":"graph","source":"manim/graph.py","scene":"GeneratedScene","transparent":true}]}. Clip ids must be unique safe filenames.
- Import ManimSequence from ../../../remotion/layout and import clip metadata from ./composite-metadata.json. Render an insert as <ManimSequence clipId="<id>" frameCount={clip.frames} /> inside its LayoutItem and Sequence. The helper uses transparent PNG frames so alpha works consistently on every platform.
- Use deterministic frame motion. Do not use browser time, unseeded randomness, network requests, or CSS animations.
- Keep LayoutAudit at minGap 36 or higher. Group only genuine composites; document any allowOverlapWith exception.
- Render by running: node ../../../scripts/render_composite.mjs . balanced
- Before finishing, confirm metadata.json reports renderer composite and composite-metadata.json lists every rendered insert.`;

function now() {
  return new Date().toISOString();
}

function safeTitle(prompt: string) {
  const words = prompt.replace(/[^a-zA-Z0-9\s-]/g, " ").trim().split(/\s+/).slice(0, 5);
  return words.join(" ") || "Untitled video";
}

function commandLabel(command: string, target: string) {
  if (/studio_asset\.mjs.*\bsearch\b/i.test(command)) return `Searching licensed assets · ${target}`;
  if (/studio_asset\.mjs.*\bimport\b/i.test(command)) return `Adding verified asset · ${target}`;
  if (/render_scene\.py|render_remotion\.mjs|render_composite\.mjs|\bmanim\b|\bremotion\b/i.test(command)) return `Rendering ${target}`;
  if (/ffmpeg|ffprobe/i.test(command)) return `Inspecting ${target} frame by frame`;
  if (/scene\.py|video\.tsx|apply_patch/i.test(command)) return `Building ${target}`;
  return `Working on ${target}`;
}

function generationTarget(project: StudioProject) {
  return project.versions.length ? `revision ${project.versions.length + 1}` : "first draft";
}

function plainMetadata(value: unknown) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFileStem(value: string) {
  return value.replace(/^File:/i, "").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "asset";
}

export class StudioService extends EventEmitter {
  readonly root: string;
  readonly projectRoot: string;
  readonly bridge = new CodexBridge();
  private projects = new Map<string, StudioProject>();
  private threadToProject = new Map<string, string>();
  private assistantMessageByItem = new Map<string, string>();
  private agentMessagePhaseByItem = new Map<string, string | null>();
  private authState: AuthState = { connected: false };
  private runtimeState: RuntimeState = { codex: false, manim: false, remotion: false, ffmpeg: false };

  constructor(root: string) {
    super();
    this.root = root;
    this.projectRoot = path.join(root, "studio", "projects");
    fs.mkdirSync(this.projectRoot, { recursive: true });
    this.loadProjects();
    this.bridge.on("notification", (message) => this.onCodexNotification(message as { method: string; params: any }));
    this.bridge.on("ready", () => {
      this.runtimeState.codex = true;
      this.emitEvent({ type: "runtime", runtime: this.runtimeState });
    });
    this.bridge.on("exit", () => {
      this.runtimeState.codex = false;
      this.emitEvent({ type: "runtime", runtime: this.runtimeState });
    });
    this.bridge.on("diagnostic", (message) => {
      if (process.env.DEBUG_CODEX) console.error(`[codex] ${message}`);
    });
  }

  private get storePath() {
    return path.join(this.root, "studio", "projects.json");
  }

  private loadProjects() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as StudioProject[];
      for (const project of stored) {
        const migrated = project as StudioProject & {
          timeline?: unknown;
          quality?: unknown;
          proxyUrl?: unknown;
        };
        const cameFromTimelineStudio = Object.hasOwn(migrated, "timeline");
        if (cameFromTimelineStudio) {
          // Keep chat and rendered revisions, but start the next request in a
          // fresh thread so it receives the current renderer-specific instructions.
          project.threadId = undefined;
          project.turnId = undefined;
          delete migrated.timeline;
          delete migrated.quality;
          delete migrated.proxyUrl;
        }
        project.renderer ||= "manim";
        project.versions ||= [];
        project.reviews ||= [];
        project.assets ||= [];
        project.reviewPreferences ||= { focus: "balanced", strictness: "normal" };
        project.designPreferences = {
          fontCategory: project.designPreferences?.fontCategory || "modern",
          colorPalette: project.designPreferences?.colorPalette || "studio",
        };
        fs.mkdirSync(path.join(this.projectRoot, project.id), { recursive: true });
        this.writeReviewConfig(project);
        this.writeDesignConfig(project);
        if (project.status === "running") {
          project.status = "idle";
          project.stage = "ready";
        }
        this.projects.set(project.id, project);
        if (project.threadId) this.threadToProject.set(project.threadId, project.id);
        if (project.status === "complete" && this.currentRenderNeedsArchive(project)) {
          const archived = this.archiveVersion(project);
          if (archived) {
            project.videoUrl = archived.videoUrl;
            project.posterUrl = archived.posterUrl;
          }
        }
      }
      this.persist();
    } catch {
      // First run has no project store.
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.listProjects(), null, 2));
  }

  async initialize() {
    const [codex, manim, remotion, ffmpeg] = await Promise.all([
      this.bridge.start().then(() => true).catch(() => false),
      fs.promises.access(manimPath(this.root)).then(() => true).catch(() => false),
      fs.promises.access(path.join(this.root, "node_modules", "@remotion", "renderer", "package.json")).then(() => true).catch(() => false),
      execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false),
    ]);
    this.runtimeState = { codex, manim, remotion, ffmpeg };
    if (codex) await this.refreshAuth();
    this.emitEvent({ type: "runtime", runtime: this.runtimeState });
  }

  listProjects() {
    return [...this.projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(id: string) {
    return this.projects.get(id);
  }

  private writeReviewConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    fs.writeFileSync(path.join(projectDir, "review-config.json"), JSON.stringify(project.reviewPreferences, null, 2));
  }

  private writeDesignConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    const fontCategory = project.designPreferences.fontCategory;
    const colorPalette = project.designPreferences.colorPalette;
    fs.writeFileSync(path.join(projectDir, "design-config.json"), JSON.stringify({
      fontCategory,
      font: FONT_PRESETS[fontCategory],
      colorPalette,
      colors: COLOR_PRESETS[colorPalette],
    }, null, 2));
  }

  updateReviewPreferences(projectId: string, focus: ReviewFocus, strictness: ReviewStrictness) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.reviewPreferences = { focus, strictness };
    this.writeReviewConfig(project);
    this.updateProject(project);
    return project;
  }

  updateDesignPreferences(projectId: string, changes: { fontCategory?: FontCategory; colorPalette?: ColorPalette }) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.designPreferences = {
      fontCategory: changes.fontCategory ?? project.designPreferences.fontCategory,
      colorPalette: changes.colorPalette ?? project.designPreferences.colorPalette,
    };
    this.writeDesignConfig(project);
    this.updateProject(project);
    return project;
  }

  private versionVideo(project: StudioProject, versionId: string) {
    const version = project.versions.find((item) => item.id === versionId);
    if (!version) throw new Error("Video version not found.");
    const video = path.join(this.projectRoot, project.id, "versions", version.id, "output.mp4");
    if (!fs.existsSync(video)) throw new Error("That video version is unavailable.");
    return { version, video };
  }

  async extractFrame(projectId: string, versionId: string, requestedTime: number) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const { version, video } = this.versionVideo(project, versionId);
    const fps = Math.max(1, Number(version.render?.fps || 30));
    const duration = Math.max(0, Number(version.render?.duration || 0));
    const time = Math.min(Math.max(Number.isFinite(requestedTime) ? requestedTime : 0, 0), Math.max(duration - 1 / fps, 0));
    const frame = Math.max(0, Math.round(time * fps));
    const frameDir = path.join(this.projectRoot, project.id, "reviews", "frames", version.id);
    const output = path.join(frameDir, `frame-${String(frame).padStart(6, "0")}.png`);
    if (!fs.existsSync(output)) {
      fs.mkdirSync(frameDir, { recursive: true });
      await execFileAsync("ffmpeg", ["-y", "-ss", (frame / fps).toFixed(6), "-i", video, "-frames:v", "1", output], { timeout: 60_000 });
    }
    return { path: output, frame, time: frame / fps, fps };
  }

  async createFrameReview(projectId: string, input: { versionId: string; time: number; note: string; annotatedImageData: string }) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current revision to finish before sending frame feedback.");
    if (!this.authState.connected) throw new Error("Connect Codex before sending frame feedback.");
    if (!input.note.trim()) throw new Error("Add a short note explaining the change.");
    const match = input.annotatedImageData.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("The annotated frame must be a PNG image.");
    const annotated = Buffer.from(match[1], "base64");
    if (!annotated.length || annotated.length > 12 * 1024 * 1024) throw new Error("The annotated frame is too large.");
    const extracted = await this.extractFrame(projectId, input.versionId, input.time);
    const id = `review-${Date.now()}-${randomUUID().slice(0, 5)}`;
    const reviewDir = path.join(this.projectRoot, project.id, "reviews", id);
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.copyFileSync(extracted.path, path.join(reviewDir, "clean.png"));
    fs.writeFileSync(path.join(reviewDir, "annotated.png"), annotated);
    const review: FrameReview = {
      id,
      versionId: input.versionId,
      time: extracted.time,
      frame: extracted.frame,
      note: input.note.trim(),
      createdAt: now(),
      cleanFrameUrl: `/media/${project.id}/reviews/${id}/clean.png`,
      annotatedFrameUrl: `/media/${project.id}/reviews/${id}/annotated.png`,
    };
    fs.writeFileSync(path.join(reviewDir, "review.json"), JSON.stringify(review, null, 2));
    project.reviews.push(review);
    this.updateProject(project);
    const relative = `reviews/${id}`;
    const visibleText = `Frame review · ${input.versionId} · ${review.time.toFixed(2)}s\n${review.note}`;
    const agentRequest = `Revise the existing animation from this frame-specific visual review.

You have two directly attached images in this order: (1) the clean rendered frame and (2) the same frame with red reviewer markup. You MUST visually compare both before opening or editing source.

Review id: ${id}
Version: ${input.versionId}
Frame: ${review.frame}
Time: ${review.time.toFixed(3)} seconds
Files: ${relative}/clean.png and ${relative}/annotated.png
User note: ${review.note}

First write ${relative}/interpretation.json containing: target (the smallest exact object enclosed or touched by red markup), visualEvidence, requestedPropertyChange, and excludedNearbyObjects. Red marks are spatial pointers only and must not appear in the video. Apply the requested property change only to the identified target. Nearby labels, siblings, and repeated styles must remain unchanged unless they are also explicitly marked. After rerendering, inspect the same timestamp and confirm the target changed while every excluded nearby object stayed unchanged.`;
    await this.sendMessage(project.id, visibleText, undefined, {
      agentRequest,
      localImagePaths: [path.join(reviewDir, "clean.png"), path.join(reviewDir, "annotated.png")],
      requestKind: "frame review",
      chatAttachment: { type: "frameReview", imageUrl: review.annotatedFrameUrl, label: `${input.versionId} · ${review.time.toFixed(2)}s` },
    });
    return review;
  }

  async searchAssets(query: string) {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query", format: "json", origin: "*", generator: "search",
      gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "18",
      prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "420",
    }).toString();
    const response = await fetch(url, { headers: { "User-Agent": "LessonStudio/0.1 educational-video-asset-picker" } });
    if (!response.ok) throw new Error("Wikimedia Commons search is unavailable.");
    const data = await response.json() as any;
    return Object.values(data.query?.pages || {}).map((page: any) => {
      const info = page.imageinfo?.[0] || {};
      const meta = info.extmetadata || {};
      return {
        id: String(page.pageid),
        title: plainMetadata(page.title),
        thumbnailUrl: info.thumburl || info.url,
        downloadUrl: info.url,
        sourceUrl: info.descriptionurl,
        width: info.width,
        height: info.height,
        creator: plainMetadata(meta.Artist?.value || meta.Credit?.value),
        description: plainMetadata(meta.ImageDescription?.value || meta.ObjectName?.value || page.title),
        license: plainMetadata(meta.LicenseShortName?.value || meta.UsageTerms?.value || "See source"),
        licenseUrl: meta.LicenseUrl?.value || undefined,
        provider: "Wikimedia Commons" as const,
      };
    }).filter((item: any) => item.downloadUrl && item.sourceUrl);
  }

  async importAsset(projectId: string, candidate: any) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const download = new URL(String(candidate.downloadUrl || ""));
    const source = new URL(String(candidate.sourceUrl || ""));
    if (download.protocol !== "https:" || download.hostname !== "upload.wikimedia.org" || source.hostname !== "commons.wikimedia.org") {
      throw new Error("Only Wikimedia Commons assets from the search picker can be imported.");
    }
    const response = await fetch(download, { headers: { "User-Agent": "LessonStudio/0.1 educational-video-asset-import" } });
    if (!response.ok) throw new Error("The selected asset could not be downloaded.");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new Error("The selected file is not an image.");
    const sourceExtension = path.extname(download.pathname).toLowerCase();
    const extension = /^\.(png|jpe?g|webp|gif|svg)$/.test(sourceExtension) ? sourceExtension : ".png";
    const id = randomUUID().slice(0, 8);
    const filename = `${safeFileStem(String(candidate.title || "asset"))}-${id}${extension}`;
    const assetDir = path.join(this.projectRoot, project.id, "public", "assets");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, filename), bytes);
    const asset: ProjectAsset = {
      id,
      title: plainMetadata(candidate.title || filename),
      description: plainMetadata(candidate.description) || undefined,
      provider: "Wikimedia Commons",
      sourceUrl: source.toString(),
      license: plainMetadata(candidate.license || "See source"),
      licenseUrl: candidate.licenseUrl ? String(candidate.licenseUrl) : undefined,
      creator: plainMetadata(candidate.creator) || undefined,
      localPath: `public/assets/${filename}`,
      mediaUrl: `/media/${project.id}/public/assets/${filename}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      importedAt: now(),
    };
    project.assets.push(asset);
    fs.writeFileSync(path.join(this.projectRoot, project.id, "assets.json"), JSON.stringify({ assets: project.assets.map((item) => ({ ...item, publicPath: item.localPath.replace(/^public\//, "") })) }, null, 2));
    this.updateProject(project);
    return asset;
  }

  getSnapshot(): Extract<StudioEvent, { type: "snapshot" }> {
    return {
      type: "snapshot",
      projects: this.listProjects(),
      auth: this.authState,
      runtime: this.runtimeState,
    };
  }

  private emitEvent(event: StudioEvent) {
    this.emit("event", event);
  }

  private updateProject(project: StudioProject) {
    project.updatedAt = now();
    project.actions = project.actions.slice(-5);
    this.projects.set(project.id, project);
    this.persist();
    this.emitEvent({ type: "project", project });
  }

  private archiveVersion(project: StudioProject): ProjectVersion | undefined {
    const projectDir = path.join(this.projectRoot, project.id);
    const output = path.join(projectDir, "output.mp4");
    if (!fs.existsSync(output)) return undefined;

    project.versions ||= [];
    const number = Math.max(0, ...project.versions.map((version) => version.number)) + 1;
    const id = `v${String(number).padStart(3, "0")}`;
    const versionDir = path.join(projectDir, "versions", id);
    fs.mkdirSync(versionDir, { recursive: true });

    const assets = ["scene.py", "video.tsx", "composite.json", "composite-metadata.json", "assets.json", "asset-decision.json", "review-config.json", "review-report.json", "design-config.json", "output.mp4", "poster.png", "contact-sheet.png", "metadata.json", "narration.json", "narration.m4a"];
    for (const asset of assets) {
      const source = path.join(projectDir, asset);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(versionDir, asset));
    }
    for (const directory of ["manim", path.join("public", "assets")]) {
      const source = path.join(projectDir, directory);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(versionDir, directory), { recursive: true });
    }

    let render: RenderInfo | undefined;
    try {
      render = JSON.parse(fs.readFileSync(path.join(versionDir, "metadata.json"), "utf8")) as RenderInfo;
    } catch {
      render = undefined;
    }
    const createdAt = now();
    const latestPrompt = [...project.messages].reverse().find((message) => message.role === "user")?.text || project.prompt;
    const version: ProjectVersion = {
      id,
      number,
      createdAt,
      prompt: latestPrompt,
      videoUrl: `/media/${project.id}/versions/${id}/output.mp4`,
      posterUrl: fs.existsSync(path.join(versionDir, "poster.png"))
        ? `/media/${project.id}/versions/${id}/poster.png`
        : undefined,
      render,
    };
    project.versions.push(version);
    return version;
  }

  private currentRenderNeedsArchive(project: StudioProject) {
    const current = path.join(this.projectRoot, project.id, "output.mp4");
    if (!fs.existsSync(current)) return false;
    const latest = project.versions?.at(-1);
    if (!latest) return true;
    const archived = path.join(this.projectRoot, project.id, "versions", latest.id, "output.mp4");
    if (!fs.existsSync(archived)) return true;
    const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return digest(current) !== digest(archived);
  }

  private renderValidationError(projectDir: string, expectedRenderer: RendererKind) {
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(projectDir, "metadata.json"), "utf8")) as RenderInfo;
      if (metadata.renderer !== expectedRenderer) {
        return `Render metadata reported ${metadata.renderer || "no renderer"}; this project is locked to ${expectedRenderer}.`;
      }
      if (!fs.existsSync(path.join(projectDir, "narration.json"))) return undefined;
      const narration = metadata.narration;
      if (
        narration?.status !== "ready"
        || narration.enabled !== true
        || narration.provider !== "speechify"
        || narration.model !== "simba-3.2"
      ) {
        return "Narration was rejected because it was not generated by Speechify simba-3.2.";
      }
      const audioCodec = execFileSync("ffprobe", [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1",
        path.join(projectDir, "output.mp4"),
      ], { encoding: "utf8", timeout: 30_000 }).trim();
      if (!audioCodec) return "Narration metadata exists, but the video has no playable audio track.";
      return undefined;
    } catch {
      return "Render verification failed. The result was not added to version history.";
    }
  }

  async refreshAuth() {
    try {
      const result = await this.bridge.account();
      const account = result.account;
      this.authState = account
        ? { connected: true, email: account.email, plan: account.planType, mode: account.type }
        : { connected: false };
    } catch {
      this.authState = { connected: false };
    }
    this.emitEvent({ type: "auth", auth: this.authState });
    return this.authState;
  }

  async login() {
    const result = await this.bridge.login();
    return { authUrl: result.authUrl, loginId: result.loginId };
  }

  async logout() {
    await this.bridge.logout();
    await this.refreshAuth();
  }

  createProject(prompt = "", renderer: RendererKind = "manim") {
    const id = randomUUID().slice(0, 8);
    const timestamp = now();
    const project: StudioProject = {
      id,
      title: prompt ? safeTitle(prompt) : "Untitled video",
      prompt,
      renderer,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "idle",
      stage: "ready",
      messages: [],
      actions: [],
      versions: [],
      reviews: [],
      assets: [],
      reviewPreferences: { focus: "balanced", strictness: "normal" },
      designPreferences: { fontCategory: "modern", colorPalette: "studio" },
    };
    fs.mkdirSync(path.join(this.projectRoot, id), { recursive: true });
    this.writeReviewConfig(project);
    this.writeDesignConfig(project);
    this.updateProject(project);
    if (prompt) void this.sendMessage(id, prompt, renderer).catch(() => undefined);
    return project;
  }

  async sendMessage(projectId: string, text: string, requestedRenderer?: RendererKind, options?: { agentRequest?: string; localImagePaths?: string[]; requestKind?: string; chatAttachment?: { type: "frameReview"; imageUrl: string; label: string } }) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("The agent is already working on this project.");
    if (!this.authState.connected) throw new Error("Connect Codex before generating a video.");
    const rendererLocked = Boolean(project.threadId || project.messages.length || project.versions.length);
    if (!rendererLocked && requestedRenderer) project.renderer = requestedRenderer;
    if (rendererLocked && requestedRenderer && requestedRenderer !== project.renderer) {
      throw new Error("A project's renderer is fixed after generation starts. Create a new video to switch renderers.");
    }
    if ((project.renderer === "manim" || project.renderer === "composite") && !this.runtimeState.manim) throw new Error("Manim is not installed. Run npm run setup:manim first.");
    if ((project.renderer === "remotion" || project.renderer === "composite") && !this.runtimeState.remotion) throw new Error("Remotion is not installed. Run npm install first.");

    const projectDir = path.join(this.projectRoot, project.id);
    const isRevision = Boolean(project.threadId);
    const targetVersion = project.versions.length + 1;
    project.messages.push({ id: randomUUID(), role: "user", text, createdAt: now(), attachment: options?.chatAttachment });
    project.prompt ||= text;
    if (project.title === "Untitled video") project.title = safeTitle(text);
    project.status = "running";
    project.stage = "brief";
    project.error = undefined;
    project.actions.push({ id: randomUUID(), label: isRevision ? `Preparing revision ${targetVersion}${options?.requestKind ? ` · ${options.requestKind}` : ""}` : "Planning first draft", status: "running", createdAt: now() });
    this.updateProject(project);

    try {
      if (!project.threadId) {
        const instructions = project.renderer === "remotion"
          ? REMOTION_AGENT_INSTRUCTIONS
          : project.renderer === "composite"
            ? COMPOSITE_AGENT_INSTRUCTIONS
            : MANIM_AGENT_INSTRUCTIONS;
        const response = await this.bridge.startThread(projectDir, instructions);
        project.threadId = response.thread.id;
        this.threadToProject.set(project.threadId, project.id);
      } else {
        await this.bridge.resumeThread(project.threadId, projectDir);
      }

      const requestBody = options?.agentRequest || (isRevision
        ? `Create revision ${targetVersion} of the existing animation with this request: ${text}`
        : `Create the first editable ${project.renderer === "manim" ? "Manim" : project.renderer === "remotion" ? "Remotion" : "Remotion-composited Manim + React"} video for this prompt: ${text}`);
      const request = `Current project workflow for this turn:
- Read design-config.json and preserve its selected font category and palette.
- Read review-config.json and apply ../../skills/educational-video-reviewer/SKILL.md after rendering.
- If this request introduces a real person, place, artifact, organism, or historical context, reconsider asset-decision.json and use the licensed candidate search workflow. Inspect at least three candidate previews before importing. For a localized revision, preserve existing assets unless the user asks to change them.
- Keep the renderer locked to ${project.renderer}. The target output is ${generationTarget(project)}.
- Begin the final response with "${project.versions.length ? `Revision ${targetVersion} ready:` : "First draft ready:"}" so the user always knows which generation completed.

${requestBody}`;
      const response = await this.bridge.startTurn(project.threadId, projectDir, request, options?.localImagePaths || []);
      project.turnId = response.turn.id;
      this.updateProject(project);
    } catch (error) {
      project.status = "error";
      project.stage = "ready";
      project.error = error instanceof Error ? error.message : "Could not start the agent.";
      const active = project.actions.at(-1);
      if (active) active.status = "failed";
      this.updateProject(project);
      throw error;
    }
  }

  async cancel(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project?.threadId || !project.turnId) return;
    await this.bridge.interrupt(project.threadId, project.turnId);
    project.status = "cancelled";
    project.stage = "ready";
    for (const action of project.actions) if (action.status === "running") action.status = "failed";
    this.updateProject(project);
  }

  private onCodexNotification(message: { method: string; params: any }) {
    if (message.method === "account/updated" || message.method === "account/login/completed") {
      void this.refreshAuth();
      return;
    }

    const threadId = message.params?.threadId as string | undefined;
    if (!threadId) return;
    const projectId = this.threadToProject.get(threadId);
    if (!projectId) return;
    const project = this.projects.get(projectId);
    if (!project) return;

    if (message.method === "turn/started") {
      project.turnId = message.params.turn.id;
      project.stage = "authoring";
      const action = project.actions.at(-1);
      if (action) action.status = "done";
      project.actions.push({ id: randomUUID(), label: `Building ${generationTarget(project)}`, status: "running", createdAt: now() });
      this.updateProject(project);
      return;
    }

    if (message.method === "item/started") {
      const item = message.params.item;
      if (item?.type === "agentMessage") {
        this.agentMessagePhaseByItem.set(item.id, item.phase || null);
        return;
      }
      if (item?.type === "commandExecution") {
        for (const action of project.actions) if (action.status === "running") action.status = "done";
        const label = commandLabel(item.command || "", generationTarget(project));
        project.stage = label.includes("Render") ? "rendering" : label.includes("Inspect") ? "inspecting" : "authoring";
        project.actions.push({ id: item.id, label, status: "running", createdAt: now() });
        this.updateProject(project);
      } else if (item?.type === "fileChange") {
        project.stage = "authoring";
        this.updateProject(project);
      }
      return;
    }

    if (message.method === "item/completed") {
      const item = message.params.item;
      const action = project.actions.find((candidate) => candidate.id === item?.id);
      if (action) {
        action.status = item.status === "failed" ? "failed" : "done";
        this.updateProject(project);
      }
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const itemId = message.params.itemId as string;
      if (this.agentMessagePhaseByItem.get(itemId) === "commentary") return;
      let messageId = this.assistantMessageByItem.get(itemId);
      if (!messageId) {
        messageId = randomUUID();
        this.assistantMessageByItem.set(itemId, messageId);
        project.messages.push({ id: messageId, role: "assistant", text: "", createdAt: now(), streaming: true });
      }
      const chatMessage = project.messages.find((candidate) => candidate.id === messageId);
      if (chatMessage) chatMessage.text += message.params.delta;
      this.emitEvent({ type: "assistant_delta", projectId, messageId, delta: message.params.delta });
      return;
    }

    if (message.method === "turn/completed") {
      for (const chatMessage of project.messages) chatMessage.streaming = false;
      for (const item of message.params.turn.items || []) {
        this.assistantMessageByItem.delete(item.id);
        this.agentMessagePhaseByItem.delete(item.id);
      }
      for (const action of project.actions) if (action.status === "running") action.status = "done";

      const output = path.join(this.projectRoot, project.id, "output.mp4");
      const poster = path.join(this.projectRoot, project.id, "poster.png");
      const renderError = this.renderValidationError(path.join(this.projectRoot, project.id), project.renderer);
      const hasFreshRender = this.currentRenderNeedsArchive(project);
      if (message.params.turn.status === "completed" && fs.existsSync(output) && hasFreshRender && !renderError) {
        const version = this.archiveVersion(project);
        project.status = "complete";
        project.stage = "complete";
        if (version) {
          project.videoUrl = version.videoUrl;
          project.posterUrl = version.posterUrl;
        } else {
          const cacheKey = fs.statSync(output).mtimeMs.toFixed(0);
          project.videoUrl = `/media/${project.id}/output.mp4?v=${cacheKey}`;
          if (fs.existsSync(poster)) project.posterUrl = `/media/${project.id}/poster.png?v=${cacheKey}`;
        }
      } else {
        project.status = "error";
        project.stage = "ready";
        project.error = renderError || message.params.turn.error?.message || "The agent finished without a new playable render.";
      }
      project.turnId = undefined;
      this.updateProject(project);
    }
  }
}
