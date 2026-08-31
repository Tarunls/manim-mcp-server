import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { CodexBridge } from "./codex-bridge.js";
import { fetchVerifiedCommonsImage } from "./hosted-media-service.js";
import { manimPath } from "./platform.js";
import { titleFromPrompt } from "./plan.js";
import type { AgentAction, AgentModel, AgentReasoningEffort, AuthState, BillingState, ColorPalette, FontCategory, FrameReview, GenerationEffort, GenerationIntent, ProjectAsset, ProjectVersion, RendererKind, RenderInfo, ReviewFocus, ReviewStrictness, RuntimeState, SendMessageResult, StudioEvent, StudioProject } from "./types.js";

const execFileAsync = promisify(execFile);
const RENDERER: RendererKind = "manim";
const DEFAULT_MODEL: AgentModel = "gpt-5.6-sol";
const DEFAULT_GENERATION_EFFORT: GenerationEffort = "balanced";
const GENERATION_EFFORTS: Record<GenerationEffort, { model: AgentModel; reasoningEffort: AgentReasoningEffort }> = {
  quick: { model: "gpt-5.6-terra", reasoningEffort: "medium" },
  balanced: { model: DEFAULT_MODEL, reasoningEffort: "high" },
  thorough: { model: DEFAULT_MODEL, reasoningEffort: "xhigh" },
};

export function generationPreferencesFor(effort: GenerationEffort): StudioProject["generationPreferences"] {
  return { effort, ...GENERATION_EFFORTS[effort] };
}

function normalizeGenerationPreferences(preferences?: Partial<StudioProject["generationPreferences"]>) {
  const effort = preferences?.effort === "quick" || preferences?.effort === "balanced" || preferences?.effort === "thorough"
    ? preferences.effort
    : preferences?.model === "gpt-5.6-terra" ? "quick" : DEFAULT_GENERATION_EFFORT;
  return generationPreferencesFor(effort);
}

export const DEFAULT_FONT_CATEGORY: FontCategory = "serif";
export const DEFAULT_COLOR_PALETTE: ColorPalette = "paper";

// The repository ships "Orune Serif"; the images install it as a system family.
// The alternates name faces that are guaranteed present in the render images so
// a generated scene never silently falls back to an unknown generic sans.
const FONT_PRESETS = {
  serif: { manim: "Orune Serif", css: '"Orune Serif", "Newsreader", Georgia, serif', character: "editorial book serif" },
  sans: { manim: "DejaVu Sans", css: '"Inter", "DejaVu Sans", sans-serif', character: "plain grotesque sans" },
  mono: { manim: "DejaVu Sans Mono", css: '"JetBrains Mono", "DejaVu Sans Mono", monospace', character: "precise monospaced" },
} as const;

// Every palette is grounded on paper. There is no dark background anywhere:
// `primary` is the single working colour for the mathematical object and
// `accent` is the payoff colour, used once per lesson.
const COLOR_PRESETS = {
  paper: { background: "#FBFAF7", surface: "#FFFFFF", text: "#1A1917", muted: "#8A857D", rule: "#D9D4CA", primary: "#2E5266", accent: "#B07548" },
  ochre: { background: "#FCF9F2", surface: "#FFFFFF", text: "#1B1813", muted: "#8C8474", rule: "#DED6C4", primary: "#7A5B23", accent: "#9B4722" },
  sage: { background: "#F8FAF6", surface: "#FFFFFF", text: "#171A16", muted: "#83887E", rule: "#D3D9CC", primary: "#3C5A45", accent: "#B0603C" },
  monochrome: { background: "#FAFAF9", surface: "#FFFFFF", text: "#141413", muted: "#8A8A85", rule: "#D6D6D2", primary: "#3A3A36", accent: "#0B0B0A" },
} as const;

export function fontCategoryOrDefault(value: unknown): FontCategory {
  return Object.hasOwn(FONT_PRESETS, String(value)) ? (value as FontCategory) : DEFAULT_FONT_CATEGORY;
}

// Projects saved before the paper house style name palettes that no longer
// exist ("cinematic", "ocean", ...). Those rows must still load, so an
// unrecognised name resolves to the default instead of throwing.
export function colorPaletteOrDefault(value: unknown): ColorPalette {
  return Object.hasOwn(COLOR_PRESETS, String(value)) ? (value as ColorPalette) : DEFAULT_COLOR_PALETTE;
}

// Documents written before the studio became Manim-only, and before the paper
// house style replaced the dark presets, are still in local and hosted storage.
// Normalizing them on read is what keeps those projects openable.
export function normalizeStoredProject<T extends StudioProject>(project: T): T {
  project.renderer = RENDERER;
  project.designPreferences = {
    fontCategory: fontCategoryOrDefault(project.designPreferences?.fontCategory),
    colorPalette: colorPaletteOrDefault(project.designPreferences?.colorPalette),
  };
  return project;
}

const COMMON_AGENT_INSTRUCTIONS = `You are the rendering agent for a programmatic educational-video studio. Every video is rendered with Manim Community Edition.

Turn the user's teaching goal into one coherent editable Manim video in the studio's paper house style.

House style — these rules are proven and are not open to reinterpretation:
- The ground is warm paper. There is no dark background, no gradient, no glow, no vignette, and no drop shadow anywhere in the video.
- Ink is used for primary text, a lighter muted tone for a small running head, and the rule colour for axes and rules. Exactly one working colour carries the mathematical object, and one payoff colour appears once in the whole lesson, at the moment the idea lands.
- No cards, no rounded boxes, no uppercase eyebrow tags, no chips, no badges, and no decorative rules. A beat is a small running head, one sentence of claim, and the mathematical object. Nothing else.
- Keep an editorial left margin: every beat's running head, claim, and visual align to the same left edge. Do not centre text.
- The claim is a full sentence in sentence case at about 40pt. The running head is about 19pt in the muted colour. Authority comes from size, tight leading, and space — never from bold weight and never from colour.
- Fills are pale, roughly 0.14-0.22 opacity, so the curve or edge stays readable on top of them.
- Never morph one sentence into another. ReplacementTransform between two Text mobjects smears the glyphs into an unreadable mess mid-tween: always FadeOut the old sentence and FadeIn the new one.
- Never Transform between two Riemann-rectangle groups (or any two grids) with different element counts; mid-tween the viewer sees two misaligned grids. Cross-fade instead with FadeOut(old) and FadeIn(new).
- Draw axes with include_tip=False and include_ticks=False, stroke_width about 1.6, in the rule colour. No arrowheads.
- Keep generous margins, one idea on screen at a time, and make each beat visibly transform the previous one.

Requirements:
- Start by writing a short beat plan for yourself: one teaching purpose, one dominant visual, and one narration passage per beat. Avoid adding a second panel when changing or replacing the current visual would teach the point more clearly.
- Before scene.py, read ../../references/SCENE_PLAN_CONTRACT.md and write scene-plan.json with version 1, the lessonGoal, and a beats array. Each beat needs id, purpose, dominantVisual, optional weight, and objects with stable id, role, and changePolicy (flexible or preserve). Reuse an object's id when it persists across beats.
- Pass those exact object ids as literal names=[...] values to every assert_inside, assert_scene_safe, assert_no_overlap, and watch_no_overlap call. The renderer uses them to produce targeted repair context; unnamed layout guards are rejected.
- Use the studio's production standard unless the user asks for a different format: about four beats and 35-45 seconds, one claim sentence plus one large focused visual, generous negative space, and a clear visual transformation from one beat to the next. This is a quality floor, not a template to copy literally.
- Each beat should have one memorable visual claim that can be understood from a paused frame. Do not fill the frame with interchangeable panels, decorative widgets, or simultaneous mini-explanations.
- Compose for a 16:9 frame with the configured palette, readable type, consistent spacing, and purposeful motion.
- Treat layout as a constraint problem, not a visual guess. Identify independent peer objects for every beat, give each a reserved region, and keep at least 3% of the frame width between unrelated objects.
- A bounding box intersecting another bounding box counts as a collision unless the overlap is intentional (for example, a curve drawn on top of its own pale fill). Group intentional composites and audit the composites against their peers.
- Check layout at the beginning, midpoint, and end of every transition—not only on the final frame. Text reflow, transforms, and entering/exiting objects can collide between key poses.
- Prefer replacing, transforming, or fading a visual before introducing more simultaneous objects. Keep no more than 5 independent visual groups on screen unless the lesson truly requires it.
- Read narration-config.json before planning. When enabled is false, make a silent video, do not depend on narration.json, and verify metadata.json reports narration.enabled false. When enabled is true, write narration.json before rendering as {"segments":[{"start":0.0,"text":"..."}]} with 3-5 chapter-length passages aligned to the visual beats.
- For enabled narration, each passage should be 18-45 words, explain cause and effect, and lead naturally into the next idea. Write mathematical pronunciation as natural speech, budget roughly 145 spoken words per minute plus breathing room, and target 24-45 seconds unless the user asks for a different duration.
- Enabled narration uses Speechify simba-3.2 with warm SSML delivery, timing guards, fades, and loudness normalization. Never create or substitute a fallback voice. After rendering, verify metadata.json reports provider speechify, model simba-3.2, and status ready.
- Inspect poster.png, contact-sheet.png, review-frames.json, and layout-audit.json. The contact sheet prioritizes stable beats and transition boundaries; map its cells to review-frames.json and check every one for clipping, crowded panels, uneven spacing, poor contrast, accidental occlusion, and objects crossing during transitions. If any issue exists, fix the source and render again.
- If review-config.json exists, read ../../skills/educational-video-reviewer/SKILL.md and follow it after rendering. Write review-report.json, validate it, and repair blocking issues once before finishing.
- Read design-config.json before authoring and use its chosen font category and palette consistently. Do not silently replace the selected visual system with your own defaults.
- Every Text and MarkupText must set font to the exact family named by design-config.json font.manim. Never hardcode a system font such as Arial, Helvetica, Segoe UI, or DejaVu Sans, and never leave the font argument off and accept Manim's silent generic fallback.
- Before authoring, write asset-decision.json with needsAuthenticImage and reason. Authentic imagery usually helps for a real person, place, artifact, organism, or historical context; skip it for abstract explanations that are clearer with native shapes.
- When imagery is useful, run node ../../../scripts/studio_asset.mjs . search "a precise context-rich query". Inspect at least three downloaded candidate previews and their descriptions. Never choose the top result merely because it is attractive; reject candidates that depict the wrong person, era, object, location, or causal context. Import the best verified match with node ../../../scripts/studio_asset.mjs . import <candidate-id>. If no result is genuinely relevant, use renderer-native visuals instead.
- If assets.json exists, use only assets listed there. Preserve credits and licenses. Load an asset's localPath with ImageMobject. Generated scene source must not make network requests.
- If the request cites a frame review, inspect both directly attached images before editing. Compare clean.png with annotated.png, identify the smallest exact object enclosed or touched by red markup, and map it to its stable id in scene-plan.json. Write reviews/<review-id>/interpretation.json with targetObjectId, visualEvidence, requestedPropertyChange, preserveObjectIds, and excludedNearbyObjects before changing source. Do not reproduce the markup in the video and do not generalize a local edit to sibling labels.
- output.mp4 must exist before you finish. Never return base64 or paste the full source into chat.
- Revisions must preserve unrelated source and must stay in the paper house style.
- Your final response is one or two short sentences describing what changed. Begin with "First draft ready:" or "Revision N ready:" using the target named in the turn request. For frame feedback, name the exact targeted object and a nearby object intentionally left unchanged. Do not expose hidden reasoning or raw command logs.`;

const AGENT_INSTRUCTIONS = `${COMMON_AGENT_INSTRUCTIONS}

Manim requirements:
- Keep the source of truth in scene.py and define exactly one renderable Scene subclass named GeneratedScene. Use Manim Community Edition exclusively; do not create React, HTML, or CSS source.
- Set the scene background to the palette's background colour explicitly; never rely on Manim's default dark canvas.
- Use only Manim CE APIs available in the local environment. Prefer shapes, NumberPlane, Axes, graphs, and deterministic animations; text exists only through manim_paper. Avoid MathTex unless you first verify LaTeX is installed.
- Import fit_inside, stack_in_panel, assert_inside, assert_scene_safe, assert_no_overlap, and watch_no_overlap from manim_layout.
- Create ALL text through manim_paper: load_design() once, then running_head, claim, swap_claim, label, caption, expr, and text(design, body, role=...). Never call Text() directly and never hand-position text with fixed coordinates - the renderer rejects scenes that skip the manim_paper import, because freehand text is how frames end up with inconsistent size, alignment, and spacing.
- Place every primary visual with manim_paper.fit_stage(...) so it stays inside the stage band between the claim and the caption; the head band and caption band belong to text alone.
- A label names the thing it touches: create it with manim_paper.label so it sits adjacent to its object in that object's colour. Never draw a pointer line from a label to a distant object, and never leave a label floating over unrelated content.
- When labelling marks inside a grid or a subgroup inside a larger shape, the label goes OUTSIDE the whole group, aligned over the marks it names (see the paper-house-style exemplars). A label placed beside an interior mark lands on its neighbours. Include every label in assert_no_overlap; a collision there is a bug in the layout, not a check to relax with allow_pairs.
- Compose for a 16:9 frame. Keep all important objects at least 0.32 Manim units from the frame edge.
- Call assert_inside(panel, *panel_contents, padding=0.16) before animating each panel. Call assert_scene_safe on every major group before its first animation. Rendering intentionally fails when these checks detect overflow.
- Call assert_no_overlap on the independent peer objects in every stable key pose. Install watch_no_overlap for peer objects that move concurrently so every rendered animation frame is checked. Do not compare a container with its own contents; group those intentional composites first. Use allow_pairs only for named, deliberate overlaps and add a short source comment explaining each exception.
- Type sizes come only from manim_paper roles. Keep labels at least 0.18 units apart.
- Render by running: python3 ../../../scripts/render_scene.py . balanced
- Before finishing, confirm metadata.json reports renderer manim and ensure no warnings were bypassed by removing required layout assertions.`;

function now() {
  return new Date().toISOString();
}

function commandLabel(command: string, target: string) {
  if (/studio_asset\.mjs.*\bsearch\b/i.test(command)) return `Searching licensed assets · ${target}`;
  if (/studio_asset\.mjs.*\bimport\b/i.test(command)) return `Adding verified asset · ${target}`;
  if (/render_scene\.py|\bmanim\b/i.test(command)) return `Rendering ${target}`;
  if (/ffmpeg|ffprobe/i.test(command)) return `Inspecting ${target} frame by frame`;
  if (/scene\.py|apply_patch/i.test(command)) return `Building ${target}`;
  return `Working on ${target}`;
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
  agentRequest?: string;
  localImagePaths?: string[];
  requestKind?: string;
  chatAttachment?: { type: "frameReview"; imageUrl: string; label: string };
  intent?: GenerationIntent;
  requestedEffort?: GenerationEffort;
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
  readonly dataRoot: string;
  readonly projectRoot: string;
  readonly bridge: CodexBridge;
  private projects = new Map<string, StudioProject>();
  private threadToProject = new Map<string, string>();
  private assistantMessageByItem = new Map<string, string>();
  private agentMessagePhaseByItem = new Map<string, string | null>();
  private authState: AuthState = { connected: false };
  private runtimeState: RuntimeState = { codex: false, manim: false, ffmpeg: false };
  private readonly localPersistence: boolean;

  constructor(root: string, dataRoot = root) {
    super();
    this.root = root;
    this.dataRoot = dataRoot;
    this.projectRoot = path.join(dataRoot, "studio", "projects");
    this.localPersistence = process.env.EXECUTION_MODE !== "e2b";
    this.bridge = new CodexBridge(root);
    fs.mkdirSync(this.projectRoot, { recursive: true });
    if (this.localPersistence) this.loadProjects();
    this.bridge.on("notification", (message) => this.onCodexNotification(message as { method: string; params: any }));
    this.bridge.on("ready", () => {
      this.runtimeState.codex = true;
      this.emitEvent({ type: "runtime", runtime: this.runtimeState });
    });
    this.bridge.on("exit", () => {
      this.runtimeState.codex = false;
      for (const project of this.projects.values()) {
        if (project.status !== "running") continue;
        project.status = "error";
        project.stage = "ready";
        project.error = "The generation agent stopped unexpectedly. Send the request again.";
        project.turnId = undefined;
        for (const action of project.actions) if (action.status === "running") action.status = "failed";
        this.updateProject(project);
      }
      this.emitEvent({ type: "runtime", runtime: this.runtimeState });
    });
    this.bridge.on("diagnostic", (message) => {
      if (process.env.DEBUG_CODEX) console.error(`[codex] ${message}`);
    });
  }

  private get storePath() {
    return path.join(this.dataRoot, "studio", "projects.json");
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
        normalizeStoredProject(project);
        project.ownerId ||= "__legacy__";
        project.favorite = project.favorite === true;
        project.versions ||= [];
        project.reviews ||= [];
        project.assets ||= [];
        project.reviewPreferences ||= { focus: "balanced", strictness: "normal" };
        project.narrationPreferences = { enabled: project.narrationPreferences?.enabled !== false };
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
    if (!this.localPersistence) return;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.listProjects(), null, 2));
  }

  async initialize() {
    const [codex, manim, ffmpeg] = await Promise.all([
      this.bridge.start().then(() => true).catch(() => false),
      fs.promises.access(manimPath(this.root)).then(() => true).catch(() => false),
      execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false),
    ]);
    this.runtimeState = { codex, manim, ffmpeg };
    if (codex) await this.refreshAuth();
    this.emitEvent({ type: "runtime", runtime: this.runtimeState });
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

  private writeDesignConfig(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    // A project restored from storage can still name a retired preset, so
    // resolve both through the legacy-tolerant lookups before indexing.
    const fontCategory = fontCategoryOrDefault(project.designPreferences?.fontCategory);
    const colorPalette = colorPaletteOrDefault(project.designPreferences?.colorPalette);
    fs.writeFileSync(path.join(projectDir, "design-config.json"), JSON.stringify({
      fontCategory,
      font: FONT_PRESETS[fontCategory],
      colorPalette,
      colors: COLOR_PRESETS[colorPalette],
      productionStyle: {
        reference: "paper editorial math explainer",
        ground: "warm paper; never a dark background, gradient, glow, vignette, or drop shadow",
        pacing: "about four beats over 35-45 seconds unless the user asks otherwise",
        composition: "a small running head, one sentence of claim, and one mathematical object, all on a shared left margin",
        typography: "claim about 40pt sentence case, running head about 19pt in the muted colour; authority from size and space, never bold weight or colour",
        forbidden: "cards, rounded boxes, uppercase eyebrow tags, chips, badges, decorative rules, centred text",
        colorUse: "primary carries the mathematical object; accent appears exactly once, when the idea lands",
        motion: "replace or transform the dominant visual between beats; cross-fade text and mismatched groups instead of morphing them",
      },
    }, null, 2));
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

  updateNarrationPreferences(projectId: string, enabled: boolean) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.narrationPreferences = { enabled };
    this.writeNarrationConfig(project);
    const narrationOnlyFailure = !enabled
      && project.status === "error"
      && /narration was rejected|speechify/i.test(project.error || "");
    if (narrationOnlyFailure) {
      const projectDir = path.join(this.projectRoot, project.id);
      const validationError = this.renderValidationError(projectDir, false);
      if (!validationError && this.currentRenderNeedsArchive(project)) {
        const version = this.archiveVersion(project);
        if (version) {
          project.status = "complete";
          project.stage = "complete";
          project.error = undefined;
          project.videoUrl = version.videoUrl;
          project.posterUrl = version.posterUrl;
          project.actions.push({ id: randomUUID(), label: "Accepted finished video without AI voice", status: "done", createdAt: now() });
        }
      }
    }
    this.updateProject(project);
    return project;
  }

  updateGenerationPreferences(projectId: string, effort: GenerationEffort) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("Wait for the current generation to finish.");
    project.generationPreferences = generationPreferencesFor(effort);
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

First read scene-plan.json and write ${relative}/interpretation.json containing: targetObjectId (the stable id for the smallest exact object enclosed or touched by red markup), visualEvidence, requestedPropertyChange, preserveObjectIds, and excludedNearbyObjects. Red marks are spatial pointers only and must not appear in the video. Apply the requested property change only to targetObjectId. Nearby labels, siblings, repeated styles, and every preserveObjectId must remain unchanged unless also explicitly marked. After rerendering, inspect the same timestamp and confirm the target changed while every preserved nearby object stayed unchanged.`;
    await this.sendMessage(project.id, visibleText, {
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
    project.actions = project.actions.slice(-5);
    this.projects.set(project.id, project);
    this.persist();
    this.emitEvent({ type: "project", project });
  }

  private planningSatisfied(project: StudioProject) {
    const projectDir = path.join(this.projectRoot, project.id);
    const requestPath = path.join(projectDir, "generation-request.json");
    if (!fs.existsSync(requestPath)) return true;
    try {
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8")) as { mode?: string; startedAt?: string };
      if (request.mode !== "first-draft") return true;
      const startedAt = Date.parse(request.startedAt || "");
      const planPath = path.join(projectDir, "beat-plan.md");
      return Number.isFinite(startedAt)
        && fs.existsSync(planPath)
        && fs.statSync(planPath).size >= 180
        && fs.statSync(planPath).mtimeMs >= startedAt - 1_000;
    } catch {
      return false;
    }
  }

  private advanceFromPlanning(project: StudioProject) {
    if (project.stage !== "brief" || !this.planningSatisfied(project)) return false;
    for (const action of project.actions) if (action.status === "running") action.status = "done";
    project.stage = "authoring";
    project.actions.push({ id: randomUUID(), label: `Building ${generationTarget(project)}`, status: "running", createdAt: now() });
    return true;
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

    const assets = ["scene.py", "scene-plan.json", "generation-request.json", "assets.json", "asset-decision.json", "review-config.json", "review-report.json", "review-frames.json", "layout-audit.json", "repair-context.json", "design-config.json", "narration-config.json", "output.mp4", "poster.png", "contact-sheet.png", "metadata.json", "narration.json", "narration.m4a"];
    for (const asset of assets) {
      const source = path.join(projectDir, asset);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(versionDir, asset));
    }
    const publicAssets = path.join(projectDir, "public", "assets");
    if (fs.existsSync(publicAssets)) fs.cpSync(publicAssets, path.join(versionDir, "public", "assets"), { recursive: true });

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

  private renderValidationError(projectDir: string, narrationEnabled: boolean) {
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(projectDir, "metadata.json"), "utf8")) as RenderInfo;
      if (metadata.renderer !== RENDERER) {
        return `Render metadata reported ${metadata.renderer || "no renderer"}; every video is rendered with ${RENDERER}.`;
      }
      const narration = metadata.narration;
      if (!narrationEnabled) {
        if (narration?.enabled === true) return "Voice is disabled, but the render still contains generated narration.";
        return undefined;
      }
      if (!fs.existsSync(path.join(projectDir, "narration.json"))) return "Voice is enabled, but narration.json was not created.";
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
    // The bridge logs in with the server's API key at startup; a running
    // bridge is the only account state there is.
    try {
      await this.bridge.start();
      this.authState = { connected: true, plan: "usage-based", mode: "api" };
    } catch {
      this.authState = { connected: false };
    }
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
      // Persisted so stored documents keep a stable shape; there is only one
      // renderer now, so nothing chooses it.
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
    if (project.status === "running") throw new Error("The agent is already working on this project.");
    if (!this.authState.connected) throw new Error("The generation service is not configured. Add OPENAI_API_KEY on the server.");
    const hasPriorWork = Boolean(project.threadId || project.messages.length || project.versions.length);
    const shouldStartFresh = hasPriorWork && !options.agentRequest && (
      options.intent === "new"
      || (options.intent !== "revise" && (project.versions.length === 0 || looksLikeIndependentVideoRequest(text, project)))
    );
    if (shouldStartFresh) {
      const freshProject = this.createProject("", {
        reviewPreferences: project.reviewPreferences,
        designPreferences: project.designPreferences,
        narrationPreferences: project.narrationPreferences,
        generationPreferences: options.requestedEffort
          ? generationPreferencesFor(options.requestedEffort)
          : project.generationPreferences,
      }, project.ownerId);
      const result = await this.sendMessage(freshProject.id, text, { ...options, intent: "auto" });
      return { ...result, startedFresh: true };
    }
    if (options.requestedEffort) project.generationPreferences = generationPreferencesFor(options.requestedEffort);
    if (!this.runtimeState.manim) throw new Error("Manim is not installed. Run npm run setup:manim first.");

    const projectDir = path.join(this.projectRoot, project.id);
    const isRevision = Boolean(project.threadId && project.versions.length);
    const targetVersion = project.versions.length + 1;
    project.messages.push({ id: randomUUID(), role: "user", text, createdAt: now(), attachment: options?.chatAttachment });
    project.prompt ||= text;
    if (project.title === "Untitled video") project.title = titleFromPrompt(text);
    project.status = "running";
    project.stage = "brief";
    project.error = undefined;
    project.actions.push({ id: randomUUID(), label: isRevision ? `Preparing revision ${targetVersion}${options?.requestKind ? ` · ${options.requestKind}` : ""}` : "Planning first draft", status: "running", createdAt: now() });
    fs.writeFileSync(path.join(projectDir, "generation-request.json"), JSON.stringify({
      id: randomUUID(),
      mode: isRevision ? "revision" : "first-draft",
      prompt: text,
      startedAt: now(),
      renderer: project.renderer,
      requirements: isRevision
        ? ["Preserve unrelated successful work", "Update scene-plan.json", "Produce a fresh validated render"]
        : ["Write a fresh beat-plan.md", "Write scene-plan.json", "Create scene.py after this request"],
      engineContract: 1,
    }, null, 2));
    this.updateProject(project);

    try {
      if (!project.threadId) {
        const response = await this.bridge.startThread(projectDir, AGENT_INSTRUCTIONS, project.generationPreferences.model);
        project.threadId = response.thread.id;
        this.threadToProject.set(project.threadId, project.id);
      } else {
        await this.bridge.resumeThread(project.threadId, projectDir);
      }

      const productionContext = isRevision
        ? "This is a genuine revision of the current video's content. Preserve unrelated successful work and make the requested change deliberately."
        : "This is a brand-new independent production in a clean project and thread. Plan the teaching content from scratch even if the user has submitted a similar prompt before. Do not inspect or copy another project's plan or narration. Read generation-request.json, then read ../../references/DEFAULT_VISUAL_LANGUAGE.md and follow its paper house style exactly, then write a new beat-plan.md before authoring scene.py. Rendering is intentionally blocked until the request-specific plan and fresh source exist.";
      const requestBody = options.agentRequest || (isRevision
        ? `Create revision ${targetVersion} of the existing animation with this request: ${text}`
        : `Create the first editable Manim video for this prompt: ${text}`);
      const request = `Current project workflow for this turn:
- ${productionContext}
- Read design-config.json and preserve its selected font category and palette.
- Read narration-config.json. Voice is ${project.narrationPreferences.enabled ? "enabled; create and verify Speechify narration" : "disabled; render and validate a silent video without calling Speechify"}.
- Read review-config.json and apply ../../skills/educational-video-reviewer/SKILL.md after rendering.
- Create or update scene-plan.json before scene.py. Use its stable object ids as literal names=[...] in every layout guard so a failed render can identify the smallest repair target.
- If this request introduces a real person, place, artifact, organism, or historical context, reconsider asset-decision.json and use the licensed candidate search workflow. Inspect at least three candidate previews before importing. For a localized revision, preserve existing assets unless the user asks to change them.
- The target output is ${generationTarget(project)}.
- Begin the final response with "${project.versions.length ? `Revision ${targetVersion} ready:` : "First draft ready:"}" so the user always knows which generation completed.

${requestBody}`;
      const response = await this.bridge.startTurn(
        project.threadId,
        projectDir,
        request,
        options.localImagePaths || [],
        project.generationPreferences.model,
        project.generationPreferences.reasoningEffort,
      );
      project.turnId = response.turn.id;
      this.updateProject(project);
      return { project, startedFresh: false, mode: isRevision ? "revision" : "first-draft" };
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
    if (!project) return;
    // Interrupt when a turn is live, but always leave the project stopped: a
    // project stuck "running" without a turn id would otherwise be
    // uncancellable.
    if (project.threadId && project.turnId) await this.bridge.interrupt(project.threadId, project.turnId);
    project.status = "cancelled";
    project.stage = "ready";
    project.turnId = undefined;
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
      this.advanceFromPlanning(project);
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
        if (!this.planningSatisfied(project)) {
          this.updateProject(project);
          return;
        }
        this.advanceFromPlanning(project);
        for (const action of project.actions) if (action.status === "running") action.status = "done";
        const label = commandLabel(item.command || "", generationTarget(project));
        project.stage = label.includes("Render") ? "rendering" : label.includes("Inspect") ? "inspecting" : "authoring";
        project.actions.push({ id: item.id, label, status: "running", createdAt: now() });
        this.updateProject(project);
      } else if (item?.type === "fileChange") {
        this.advanceFromPlanning(project);
        if (project.stage !== "brief") project.stage = "authoring";
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
      if (!action && this.advanceFromPlanning(project)) this.updateProject(project);
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
      const renderError = this.renderValidationError(path.join(this.projectRoot, project.id), project.narrationPreferences.enabled);
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
