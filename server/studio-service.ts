import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fetchVerifiedCommonsImage } from "./hosted-media-service.js";
import { narrationVoiceOrDefault } from "./narration.js";
import { manimPath } from "./platform.js";
import { completionMessage, titleFromPrompt } from "./plan.js";
import { authorLesson, resolveModels } from "../scripts/lesson_pipeline.mjs";
import type { Storyboard } from "../scripts/lesson_pipeline.mjs";
import type { AuthState, BillingState, ColorPalette, FontCategory, FrameReview, GenerationEffort, GenerationIntent, NarrationVoice, ProjectAsset, ProjectVersion, RendererKind, RenderInfo, ReviewFocus, ReviewStrictness, RuntimeState, SendMessageResult, StudioEvent, StudioProject, VideoFormat } from "./types.js";

const execFileAsync = promisify(execFile);
const RENDERER: RendererKind = "manim";
const DEFAULT_GENERATION_EFFORT: GenerationEffort = "balanced";

export function generationPreferencesFor(
  effort: GenerationEffort,
  format: VideoFormat = "landscape",
): StudioProject["generationPreferences"] {
  const models = resolveModels(effort);
  return { effort, format, model: models.code.model, reasoningEffort: models.code.reasoning };
}

function normalizeGenerationPreferences(preferences?: Partial<StudioProject["generationPreferences"]>) {
  const effort = preferences?.effort === "quick" || preferences?.effort === "balanced" || preferences?.effort === "thorough"
    ? preferences.effort
    : DEFAULT_GENERATION_EFFORT;
  return generationPreferencesFor(
    effort,
    preferences?.format === "vertical" ? "vertical" : "landscape",
  );
}

export const DEFAULT_FONT_CATEGORY: FontCategory = "serif";
export const DEFAULT_COLOR_PALETTE: ColorPalette = "paper";

// The repository ships "Orune Serif"; the images install it as a system family.
// The alternates name faces that are guaranteed present in the render images.
const FONT_PRESETS = {
  serif: { manim: "Orune Serif", css: '"Orune Serif", "Newsreader", Georgia, serif', character: "editorial book serif" },
  sans: { manim: "DejaVu Sans", css: '"Inter", "DejaVu Sans", sans-serif', character: "plain grotesque sans" },
  mono: { manim: "DejaVu Sans Mono", css: '"JetBrains Mono", "DejaVu Sans Mono", monospace', character: "precise monospaced" },
} as const;

// Palettes are offered to the model as defaults; nothing enforces them.
const COLOR_PRESETS = {
  paper: { background: "#FBFAF7", surface: "#FFFFFF", text: "#1A1917", muted: "#8A857D", rule: "#D9D4CA", primary: "#2E5266", accent: "#B07548" },
  ochre: { background: "#FCF9F2", surface: "#FFFFFF", text: "#1B1813", muted: "#8C8474", rule: "#DED6C4", primary: "#7A5B23", accent: "#9B4722" },
  sage: { background: "#F8FAF6", surface: "#FFFFFF", text: "#171A16", muted: "#83887E", rule: "#D3D9CC", primary: "#3C5A45", accent: "#B0603C" },
  monochrome: { background: "#FAFAF9", surface: "#FFFFFF", text: "#141413", muted: "#8A8A85", rule: "#D6D6D2", primary: "#3A3A36", accent: "#0B0B0A" },
} as const;

export function fontCategoryOrDefault(value: unknown): FontCategory {
  return Object.hasOwn(FONT_PRESETS, String(value)) ? (value as FontCategory) : DEFAULT_FONT_CATEGORY;
}

// Projects saved before the current palettes existed still have to load, so an
// unrecognised name resolves to the default instead of throwing.
export function colorPaletteOrDefault(value: unknown): ColorPalette {
  return Object.hasOwn(COLOR_PRESETS, String(value)) ? (value as ColorPalette) : DEFAULT_COLOR_PALETTE;
}

// Documents written by earlier versions of the studio are still in local and
// hosted storage. Normalizing them on read is what keeps them openable.
export function normalizeStoredProject<T extends StudioProject>(project: T): T {
  project.renderer = RENDERER;
  project.designPreferences = {
    fontCategory: fontCategoryOrDefault(project.designPreferences?.fontCategory),
    colorPalette: colorPaletteOrDefault(project.designPreferences?.colorPalette),
  };
  project.narrationPreferences = {
    enabled: project.narrationPreferences?.enabled !== false,
    voice: narrationVoiceOrDefault(project.narrationPreferences?.voice),
  };
  return project;
}

function now() {
  return new Date().toISOString();
}

function normalizedPrompt(prompt: string) {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function looksLikeIndependentVideoRequest(text: string, project: StudioProject) {
  const normalized = normalizedPrompt(text);
  if (normalized && normalized === normalizedPrompt(project.prompt)) return true;
  if (/\b(new video|new lesson|new animation|different (?:video|lesson|topic)|start (?:again|over)|from scratch|fresh draft)\b/i.test(text)) return true;
  if (/^\s*(?:create|generate|produce|design|build|make|give me)\b[\s\S]{0,100}\b(?:video|lesson|animation|explainer)\b/i.test(text)) return true;
  if (/^\s*(?:explain|teach|animate|show how)\b/i.test(text) && !/\b(?:this|current|existing|again|more|less|instead|change|fix|replace|remove)\b/i.test(text)) return true;
  return false;
}

interface ProjectSeedPreferences {
  reviewPreferences?: StudioProject["reviewPreferences"];
  designPreferences?: StudioProject["designPreferences"];
  narrationPreferences?: StudioProject["narrationPreferences"];
  generationPreferences?: StudioProject["generationPreferences"];
}

interface SendMessageOptions {
  /** A revision request that differs from the chat text, e.g. a frame review. */
  revisionRequest?: string;
  images?: Array<{ path: string; label?: string }>;
  requestKind?: string;
  chatAttachment?: { type: "frameReview"; imageUrl: string; label: string };
  intent?: GenerationIntent;
  requestedEffort?: GenerationEffort;
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

function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export class StudioService extends EventEmitter {
  readonly root: string;
  readonly dataRoot: string;
  readonly projectRoot: string;
  private projects = new Map<string, StudioProject>();
  private running = new Map<string, AbortController>();
  private authState: AuthState = { connected: false };
  private runtimeState: RuntimeState = { model: false, manim: false, ffmpeg: false };
  private readonly localPersistence: boolean;

  constructor(root: string, dataRoot = root) {
    super();
    this.root = root;
    this.dataRoot = dataRoot;
    this.projectRoot = path.join(dataRoot, "studio", "projects");
    this.localPersistence = process.env.EXECUTION_MODE !== "e2b";
    fs.mkdirSync(this.projectRoot, { recursive: true });
    if (this.localPersistence) this.loadProjects();
  }

  private get storePath() {
    return path.join(this.dataRoot, "studio", "projects.json");
  }

  private get modelConfigured() {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  private loadProjects() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as StudioProject[];
      for (const project of stored) {
        const migrated = project as StudioProject & { timeline?: unknown; quality?: unknown; proxyUrl?: unknown };
        delete migrated.timeline;
        delete migrated.quality;
        delete migrated.proxyUrl;
        project.threadId = undefined;
        project.turnId = undefined;
        normalizeStoredProject(project);
        project.ownerId ||= "__legacy__";
        project.favorite = project.favorite === true;
        project.versions ||= [];
        project.reviews ||= [];
        project.assets ||= [];
        project.reviewPreferences ||= { focus: "balanced", strictness: "normal" };
        project.generationPreferences = normalizeGenerationPreferences(project.generationPreferences);
        fs.mkdirSync(path.join(this.projectRoot, project.id), { recursive: true });
        this.writeReviewConfig(project);
        this.writeDesignConfig(project);
        this.writeNarrationConfig(project);
        if (project.status === "running") {
          project.status = "idle";
          project.stage = "ready";
        }
        this.projects.set(project.id, project);
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
    if (!this.localPersistence) return;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.listProjects(), null, 2));
  }

  async initialize() {
    const [manim, ffmpeg] = await Promise.all([
      fs.promises.access(manimPath(this.root)).then(() => true).catch(() => false),
      execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false),
    ]);
    this.runtimeState = { model: this.modelConfigured, manim, ffmpeg };
    await this.refreshAuth();
    this.emitEvent({ type: "runtime", runtime: this.runtimeState });
  }

  stop() {
    for (const controller of this.running.values()) controller.abort();
  }

  listProjects(ownerId?: string) {
    return [...this.projects.values()]
      .filter((project) => !ownerId || project.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(id: string, ownerId?: string) {
    const project = this.projects.get(id);
    return project && (!ownerId || project.ownerId === ownerId) ? project : undefined;
  }

  restoreProject(project: StudioProject) {
    // Hosted projects live in Postgres; caching them in the process-lifetime
    // Map (and writing per-project config files) on every read would leak.
    if (!this.localPersistence) return project;
    this.projects.set(project.id, project);
    fs.mkdirSync(path.join(this.projectRoot, project.id), { recursive: true });
    this.writeReviewConfig(project);
    this.writeDesignConfig(project);
    this.writeNarrationConfig(project);
    return project;
  }

  updateFavorite(projectId: string, ownerId: string, favorite: boolean) {
    const project = this.getProject(projectId, ownerId);
    if (!project) throw new Error("Project not found.");
    project.favorite = favorite;
    this.updateProject(project);
    return project;
  }

  private writeReviewConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    fs.writeFileSync(path.join(projectDir, "review-config.json"), JSON.stringify(project.reviewPreferences, null, 2));
  }

  private designConfig(project: StudioProject) {
    const fontCategory = fontCategoryOrDefault(project.designPreferences?.fontCategory);
    const colorPalette = colorPaletteOrDefault(project.designPreferences?.colorPalette);
    return { fontCategory, font: FONT_PRESETS[fontCategory], colorPalette, colors: COLOR_PRESETS[colorPalette] };
  }

  private writeDesignConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    fs.writeFileSync(path.join(projectDir, "design-config.json"), JSON.stringify(this.designConfig(project), null, 2));
  }

  private writeNarrationConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    fs.writeFileSync(path.join(projectDir, "narration-config.json"), JSON.stringify(project.narrationPreferences, null, 2));
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
      fontCategory: fontCategoryOrDefault(changes.fontCategory ?? project.designPreferences.fontCategory),
      colorPalette: colorPaletteOrDefault(changes.colorPalette ?? project.designPreferences.colorPalette),
    };
    this.writeDesignConfig(project);
    this.updateProject(project);
    return project;
  }

  updateNarrationPreferences(projectId: string, enabled: boolean, voice?: NarrationVoice) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.narrationPreferences = {
      enabled,
      voice: narrationVoiceOrDefault(voice ?? project.narrationPreferences?.voice),
    };
    this.writeNarrationConfig(project);
    this.updateProject(project);
    return project;
  }

  updateGenerationPreferences(projectId: string, effort: GenerationEffort, format?: VideoFormat) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.generationPreferences = generationPreferencesFor(
      effort,
      format || project.generationPreferences?.format || "landscape",
    );
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
    if (!this.authState.connected) throw new Error("The generation service is not configured. Add OPENAI_API_KEY on the server.");
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
    const visibleText = `Frame review · ${input.versionId} · ${review.time.toFixed(2)}s\n${review.note}`;
    const revisionRequest = `Frame review of ${input.versionId} at ${review.time.toFixed(2)} seconds (frame ${review.frame}). The first attached image is the clean rendered frame; the second is the same frame with the reviewer's red markup showing what to change. Change only what the markup and note ask for and keep the rest of the video as it is.

Requested change: ${review.note}`;
    await this.sendMessage(projectId, visibleText, {
      revisionRequest,
      images: [
        { path: path.join(reviewDir, "clean.png"), label: "Clean rendered frame" },
        { path: path.join(reviewDir, "annotated.png"), label: "Reviewer-annotated frame" },
      ],
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
    const response = await fetch(url, {
      headers: { "User-Agent": "LessonStudio/0.1 educational-video-asset-picker" },
      signal: AbortSignal.timeout(15_000),
    });
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
    const { contents: bytes, extension, source } = await fetchVerifiedCommonsImage(candidate || {});
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

  getSnapshot(ownerId: string, billing: BillingState): Extract<StudioEvent, { type: "snapshot" }> {
    return {
      type: "snapshot",
      projects: this.listProjects(ownerId),
      auth: this.authState,
      runtime: this.runtimeState,
      billing,
    };
  }

  private emitEvent(event: StudioEvent) {
    this.emit("event", event);
  }

  private updateProject(project: StudioProject) {
    project.updatedAt = now();
    project.actions = project.actions.slice(-8);
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

    const assets = ["scene.py", "storyboard.json", "generation-request.json", "assets.json", "review-config.json", "design-config.json", "narration-config.json", "output.mp4", "poster.png", "contact-sheet.png", "metadata.json", "narration.json", "narration.m4a"];
    for (const asset of assets) {
      const source = path.join(projectDir, asset);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(versionDir, asset));
    }
    const publicAssets = path.join(projectDir, "public", "assets");
    if (fs.existsSync(publicAssets)) fs.cpSync(publicAssets, path.join(versionDir, "public", "assets"), { recursive: true });

    const render = readJsonFile<RenderInfo>(path.join(versionDir, "metadata.json"));
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

  /** The only things checked after a render: it is a Manim render, and a
   * narrated lesson with spoken lines actually carries an audio track. */
  private renderValidationError(projectDir: string, narrationEnabled: boolean) {
    try {
      const metadata = readJsonFile<RenderInfo>(path.join(projectDir, "metadata.json"));
      if (!metadata) return "The render finished without metadata.";
      if (metadata.renderer !== RENDERER) {
        return `Render metadata reported ${metadata.renderer || "no renderer"}; every video is rendered with ${RENDERER}.`;
      }
      if (!narrationEnabled) return undefined;
      const narration = readJsonFile<{ segments?: unknown[] }>(path.join(projectDir, "narration.json"));
      if (!narration?.segments?.length) return undefined;
      if (metadata.narration?.status !== "ready") return "The narration could not be attached to the video.";
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
    this.authState = this.modelConfigured
      ? { connected: true, plan: "usage-based", mode: "api" }
      : { connected: false };
    this.runtimeState.model = this.modelConfigured;
    this.emitEvent({ type: "auth", auth: this.authState });
    return this.authState;
  }

  createProject(prompt = "", seed: ProjectSeedPreferences = {}, ownerId = "__legacy__") {
    const id = randomUUID().slice(0, 8);
    const timestamp = now();
    const project: StudioProject = {
      id,
      ownerId,
      favorite: false,
      title: prompt ? titleFromPrompt(prompt) : "Untitled video",
      prompt,
      renderer: RENDERER,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "idle",
      stage: "ready",
      messages: [],
      actions: [],
      versions: [],
      reviews: [],
      assets: [],
      reviewPreferences: { ...(seed.reviewPreferences || { focus: "balanced", strictness: "normal" }) },
      designPreferences: {
        fontCategory: fontCategoryOrDefault(seed.designPreferences?.fontCategory),
        colorPalette: colorPaletteOrDefault(seed.designPreferences?.colorPalette),
      },
      narrationPreferences: { ...(seed.narrationPreferences || { enabled: true }) },
      generationPreferences: normalizeGenerationPreferences(seed.generationPreferences),
    };
    fs.mkdirSync(path.join(this.projectRoot, id), { recursive: true });
    this.writeReviewConfig(project);
    this.writeDesignConfig(project);
    this.writeNarrationConfig(project);
    this.updateProject(project);
    if (prompt) void this.sendMessage(id, prompt).catch(() => undefined);
    return project;
  }

  async sendMessage(projectId: string, text: string, options: SendMessageOptions = {}): Promise<SendMessageResult> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("The studio is already working on this project.");
    if (!this.authState.connected) throw new Error("The generation service is not configured. Add OPENAI_API_KEY on the server.");
    const hasPriorWork = Boolean(project.messages.length || project.versions.length);
    const shouldStartFresh = hasPriorWork && !options.revisionRequest && (
      options.intent === "new"
      || (options.intent !== "revise" && (project.versions.length === 0 || looksLikeIndependentVideoRequest(text, project)))
    );
    if (shouldStartFresh) {
      const freshProject = this.createProject("", {
        reviewPreferences: project.reviewPreferences,
        designPreferences: project.designPreferences,
        narrationPreferences: project.narrationPreferences,
        generationPreferences: options.requestedEffort
          ? generationPreferencesFor(options.requestedEffort, project.generationPreferences?.format)
          : project.generationPreferences,
      }, project.ownerId);
      const result = await this.sendMessage(freshProject.id, text, { ...options, intent: "auto" });
      return { ...result, startedFresh: true };
    }
    if (options.requestedEffort)
      project.generationPreferences = generationPreferencesFor(options.requestedEffort, project.generationPreferences?.format);
    if (!this.runtimeState.manim) throw new Error("Manim is not installed. Run npm run setup:manim first.");

    const projectDir = path.join(this.projectRoot, project.id);
    const isRevision = project.versions.length > 0
      && fs.existsSync(path.join(projectDir, "storyboard.json"))
      && fs.existsSync(path.join(projectDir, "scene.py"));
    const targetVersion = project.versions.length + 1;
    project.messages.push({ id: randomUUID(), role: "user", text, createdAt: now(), attachment: options?.chatAttachment });
    project.prompt ||= text;
    if (project.title === "Untitled video") project.title = titleFromPrompt(text);
    project.status = "running";
    project.stage = "brief";
    project.error = undefined;
    project.actions = [];
    project.actions.push({
      id: randomUUID(),
      label: isRevision ? `Preparing revision ${targetVersion}${options?.requestKind ? ` · ${options.requestKind}` : ""}` : "Writing the script",
      status: "running",
      createdAt: now(),
    });
    fs.writeFileSync(path.join(projectDir, "generation-request.json"), JSON.stringify({
      id: randomUUID(),
      mode: isRevision ? "revision" : "first-draft",
      prompt: text,
      startedAt: now(),
      renderer: project.renderer,
    }, null, 2));
    this.writeDesignConfig(project);
    this.writeNarrationConfig(project);
    this.updateProject(project);

    void this.runGeneration(project, {
      isRevision,
      request: options.revisionRequest || text,
      images: options.images || [],
    });
    return { project, startedFresh: false, mode: isRevision ? "revision" : "first-draft" };
  }

  private async runGeneration(project: StudioProject, input: { isRevision: boolean; request: string; images: Array<{ path: string; label?: string }> }) {
    const projectDir = path.join(this.projectRoot, project.id);
    const controller = new AbortController();
    this.running.set(project.id, controller);
    const previousStoryboard = input.isRevision ? readJsonFile<Storyboard>(path.join(projectDir, "storyboard.json")) : undefined;
    const previousScene = input.isRevision ? fs.readFileSync(path.join(projectDir, "scene.py"), "utf8") : undefined;
    try {
      await authorLesson({
        root: this.root,
        projectDir,
        brief: input.isRevision && previousStoryboard?.brief ? previousStoryboard.brief : input.request,
        format: project.generationPreferences.format,
        effort: project.generationPreferences.effort,
        narration: project.narrationPreferences,
        design: this.designConfig(project),
        assets: project.assets.map((asset) => ({ localPath: asset.localPath, title: asset.title })),
        revision: input.isRevision && previousStoryboard && previousScene
          ? { request: input.request, storyboard: previousStoryboard, scene: previousScene, attachments: input.images }
          : undefined,
        openai: {
          baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
          apiKey: process.env.OPENAI_API_KEY?.trim() || "",
        },
        onProgress: ({ stage, label }) => {
          const current = this.projects.get(project.id);
          if (!current || current.status !== "running") return;
          current.stage = stage;
          for (const action of current.actions) if (action.status === "running") action.status = "done";
          current.actions.push({ id: randomUUID(), label, status: "running", createdAt: now() });
          this.updateProject(current);
        },
        signal: controller.signal,
        log: (line) => {
          if (process.env.DEBUG_PIPELINE) console.error(`[pipeline ${project.id}] ${line}`);
        },
      });
      const current = this.projects.get(project.id);
      if (!current || current.status !== "running") return;
      for (const action of current.actions) if (action.status === "running") action.status = "done";
      const renderError = this.renderValidationError(projectDir, current.narrationPreferences.enabled);
      if (renderError || !this.currentRenderNeedsArchive(current)) {
        current.status = "error";
        current.stage = "ready";
        current.error = renderError || "The pipeline finished without a new playable render.";
        this.updateProject(current);
        return;
      }
      const version = this.archiveVersion(current);
      current.status = "complete";
      current.stage = "complete";
      if (version) {
        current.videoUrl = version.videoUrl;
        current.posterUrl = version.posterUrl;
        current.messages.push({ id: randomUUID(), role: "assistant", text: completionMessage(version.number, version.render), createdAt: now() });
      }
      this.updateProject(current);
    } catch (error) {
      const current = this.projects.get(project.id);
      if (!current) return;
      if (current.status === "running") {
        current.status = controller.signal.aborted ? "cancelled" : "error";
        current.stage = "ready";
        current.error = controller.signal.aborted ? undefined : (error instanceof Error ? error.message : "The video could not be generated.");
        for (const action of current.actions) if (action.status === "running") action.status = "failed";
        this.updateProject(current);
      }
    } finally {
      this.running.delete(project.id);
    }
  }

  async cancel(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) return;
    this.running.get(projectId)?.abort();
    project.status = "cancelled";
    project.stage = "ready";
    project.turnId = undefined;
    for (const action of project.actions) if (action.status === "running") action.status = "failed";
    this.updateProject(project);
  }
}
