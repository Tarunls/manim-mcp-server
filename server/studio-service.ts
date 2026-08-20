import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { CodexBridge } from "./codex-bridge.js";
import { ensureProjectBundle, readProjectBundle, snapshotProjectBundle, writeProjectBundle } from "./project-bundle.js";
import { validateVideoIR, type VideoProjectIR } from "../shared/video-ir.js";
import { routeProjectShots } from "../shared/renderers.js";
import { rendererCapabilities } from "./renderers/registry.js";
import { renderRemotionProject } from "./renderers/remotion-renderer.js";
import { AssetService } from "./assets/service.js";
import type { AssetCandidate } from "../shared/assets.js";
import { productionRequest } from "./planning.js";
import { JobStore } from "./jobs/job-store.js";
import { RenderCache, createProxy, renderIncrementally } from "./renderers/incremental-renderer.js";
import { createQualityReport } from "./quality/project-quality.js";
import type { QualityReport } from "../shared/quality.js";
import { GeneratedVideoRegistry } from "./generation/video-providers.js";
import { createDeliveryBundle, writeInterchange } from "./exports/interchange.js";
import type { AgentAction, AuthState, ProjectVersion, RenderInfo, RuntimeState, StudioEvent, StudioProject } from "./types.js";

const execFileAsync = promisify(execFile);

const AGENT_INSTRUCTIONS = `You are the production agent for an editable AI video studio.

Your job is to create or revise the structured project in the current working directory, then render and inspect it.

Requirements:
- Keep the source of truth in project.json. It contains the brief, storyboard, shots, tracks, clips, assets, design tokens, narration, and renderer routing.
- Plan before authoring. Every storyboard beat must state its purpose, narration, visual, duration, asset queries, and renderer. Run the project validator after planning and after timing changes.
- Route typography, footage, UI, captions, shapes, charts, and compositing to Remotion. Route only equations, graphs, and technical vector explanations to Manim. Use generated footage and Blender only when their configured capability is available.
- For a Manim timeline shot, put sceneFile and optional sceneClass in shot metadata. Keep every source inside the project directory and use the shared layout guards.
- For generated footage, put generationPrompt plus an optional provider and model in the shot metadata. The render worker archives the result locally and resumes provider jobs from .generations.
- For 3D, put a constrained blenderScene object in shot metadata. Use primitives, transforms, materials, lights, camera settings, and keyframes; never author or execute arbitrary Blender Python.
- Search online assets with: node --import tsx ../../../scripts/search_assets.ts "QUERY" [KIND] [PROVIDER]. Import only storyboard-selected results with the provided import script. Never use a raw web URL without license and provenance metadata in project.json.
- Write narration.json before animation. Run: node ../../../scripts/generate_narration.mjs . --prepare. Read narration-timing.json and make the shot timing fit the actual voice instead of an estimated word count.
- For a timeline render, run: node --import tsx ../../../scripts/render_project.ts .
- If the project contains a specialized Manim scene, keep scene.py and define exactly one renderable Scene subclass named GeneratedScene. A pure Manim project may render with: python3 ../../../scripts/render_scene.py . balanced
- Use only Manim CE APIs available in the local environment. Prefer shapes, Text, MarkupText, NumberPlane, Axes, graphs, and deterministic animations. Avoid MathTex unless you first verify LaTeX is installed.
- Import fit_inside, stack_in_panel, assert_inside, and assert_scene_safe from manim_layout. Keep important objects at least 0.32 Manim units from the frame edge.
- Build information panels as VGroups with explicit spacing. Use stack_in_panel or fit_inside with at least 0.30 units of padding. Call assert_inside and assert_scene_safe before animation.
- Use a restrained palette, readable type, consistent spacing, and purposeful motion. Target 8-20 seconds for a first draft unless the user asks otherwise.
- narration.json must be shaped as {"segments":[{"start":0.0,"text":"..."}]}. Passages must explain cause and effect, connect naturally, and use spoken mathematical pronunciation. Avoid fragments, filler, repeated "now", and fact lists.
- The narration helper uses Speechify simba-3.2 with warm delivery, measured timing, fades, and loudness normalization. Fallback voices are forbidden.
- Inspect metadata.json, poster.png, and contact-sheet.png. Check sampled frames for clipping, crowded layouts, spacing, contrast, overlaps, and continuity. Patch the smallest failing part and render again.
- output.mp4 must exist before finishing. Never return base64 or paste full source into chat.
- Revisions must preserve unrelated shots, clips, assets, prompts, and renderer outputs.
- Your final response is one or two short sentences describing what changed. Do not expose hidden reasoning or raw command logs.`;

function now() {
  return new Date().toISOString();
}

function safeTitle(prompt: string) {
  const words = prompt.replace(/[^a-zA-Z0-9\s-]/g, " ").trim().split(/\s+/).slice(0, 5);
  return words.join(" ") || "Untitled video";
}

function commandLabel(command: string) {
  if (/render_scene\.py|\bmanim\b/i.test(command)) return "Rendering preview";
  if (/ffmpeg|ffprobe/i.test(command)) return "Inspecting frames";
  if (/scene\.py|apply_patch/i.test(command)) return "Writing animation";
  return "Working on project";
}

export class StudioService extends EventEmitter {
  readonly root: string;
  readonly projectRoot: string;
  readonly bridge = new CodexBridge();
  readonly assets = new AssetService();
  readonly generatedVideos = new GeneratedVideoRegistry();
  readonly jobs: JobStore;
  readonly renderCache: RenderCache;
  private projects = new Map<string, StudioProject>();
  private threadToProject = new Map<string, string>();
  private assistantMessageByItem = new Map<string, string>();
  private agentMessagePhaseByItem = new Map<string, string | null>();
  private authState: AuthState = { connected: false };
  private runtimeState: RuntimeState = { codex: false, manim: false, ffmpeg: false };

  constructor(root: string) {
    super();
    this.root = root;
    this.projectRoot = path.join(root, "studio", "projects");
    this.jobs = new JobStore(path.join(root, "studio", "jobs.json"));
    this.renderCache = new RenderCache(path.join(root, "studio", "cache"));
    this.jobs.on("job", (job) => this.emitEvent({ type: "job", job }));
    fs.mkdirSync(this.projectRoot, { recursive: true });
    this.loadProjects();
    this.bridge.on("notification", (message) => void this.onCodexNotification(message as { method: string; params: any }));
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
        project.versions ||= [];
        if (project.status === "running") {
          project.status = "idle";
          project.stage = "ready";
        }
        this.projects.set(project.id, project);
        const projectDir = path.join(this.projectRoot, project.id);
        try {
          project.timeline = ensureProjectBundle(projectDir, project.id, project.title, project.prompt);
        } catch {
          project.timeline = undefined;
        }
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
    const [codex, manim, ffmpeg] = await Promise.all([
      this.bridge.start().then(() => true).catch(() => false),
      fs.promises.access(path.join(this.root, ".venv", "bin", "manim")).then(() => true).catch(() => false),
      execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false),
    ]);
    this.runtimeState = { codex, manim, ffmpeg };
    if (codex) await this.refreshAuth();
    this.emitEvent({ type: "runtime", runtime: this.runtimeState });
    for (const job of this.jobs.list().filter((candidate) => candidate.type === "render" && candidate.status === "queued")) {
      void this.runRenderJob(job.id, job.projectId);
    }
  }

  listProjects() {
    return [...this.projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(id: string) {
    return this.projects.get(id);
  }

  getSnapshot(): Extract<StudioEvent, { type: "snapshot" }> {
    return {
      type: "snapshot",
      projects: this.listProjects(),
      auth: this.authState,
      runtime: this.runtimeState,
      jobs: this.jobs.list(),
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

    const assets = ["project.json", "scene.py", "output.mp4", "proxy.mp4", "poster.png", "contact-sheet.png", "metadata.json", "narration.json", "narration-timing.json", "narration.m4a", "quality-report.json", "provenance.json"];
    for (const asset of assets) {
      const source = path.join(projectDir, asset);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(versionDir, asset));
    }

    let render: RenderInfo | undefined;
    try {
      render = JSON.parse(fs.readFileSync(path.join(versionDir, "metadata.json"), "utf8")) as RenderInfo;
    } catch {
      render = undefined;
    }
    let quality: QualityReport | undefined;
    try {
      quality = JSON.parse(fs.readFileSync(path.join(versionDir, "quality-report.json"), "utf8")) as QualityReport;
    } catch {
      quality = undefined;
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
      proxyUrl: fs.existsSync(path.join(versionDir, "proxy.mp4"))
        ? `/media/${project.id}/versions/${id}/proxy.mp4`
        : undefined,
      render,
      quality,
    };
    project.versions.push(version);
    version.projectUrl = `/media/${project.id}/versions/${id}/project.json`;
    snapshotProjectBundle(projectDir, versionDir);
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

  private narrationValidationError(projectDir: string) {
    if (!fs.existsSync(path.join(projectDir, "narration.json"))) return undefined;
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(projectDir, "metadata.json"), "utf8")) as { narration?: RenderInfo["narration"] };
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
      return "Narration verification failed. The render was not added to version history.";
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

  createProject(prompt = "") {
    const id = randomUUID().slice(0, 8);
    const timestamp = now();
    const project: StudioProject = {
      id,
      title: prompt ? safeTitle(prompt) : "Untitled video",
      prompt,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "idle",
      stage: "ready",
      messages: [],
      actions: [],
      versions: [],
    };
    fs.mkdirSync(path.join(this.projectRoot, id), { recursive: true });
    project.timeline = ensureProjectBundle(path.join(this.projectRoot, id), id, project.title, prompt);
    this.updateProject(project);
    if (prompt) void this.sendMessage(id, prompt).catch(() => undefined);
    return project;
  }

  getTimeline(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const timeline = readProjectBundle(path.join(this.projectRoot, projectId));
    project.timeline = timeline;
    return timeline;
  }

  updateTimeline(projectId: string, value: unknown) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const validation = validateVideoIR(value);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const timeline = structuredClone(value as VideoProjectIR);
    if (timeline.id !== projectId) throw new Error("Timeline id must match the project id.");
    writeProjectBundle(path.join(this.projectRoot, projectId), timeline);
    project.timeline = timeline;
    project.title = timeline.title;
    this.updateProject(project);
    return timeline;
  }

  branchVersion(projectId: string, versionId: string) {
    const source = this.projects.get(projectId);
    if (!source) throw new Error("Project not found.");
    const version = source.versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new Error("Revision not found.");
    const sourceDir = path.join(this.projectRoot, projectId);
    const versionDir = path.join(sourceDir, "versions", versionId);
    const archived = readProjectBundle(versionDir);
    const branch = this.createProject();
    const branchDir = path.join(this.projectRoot, branch.id);
    const timeline = structuredClone(archived);
    timeline.id = branch.id;
    timeline.title = `${source.title} branch`;
    timeline.createdAt = now();
    timeline.metadata = { ...timeline.metadata, revision: 0, branchedFrom: { projectId, versionId, version: version.number } };
    writeProjectBundle(branchDir, timeline);
    const sourceAssets = path.join(sourceDir, "assets");
    if (fs.existsSync(sourceAssets)) fs.cpSync(sourceAssets, path.join(branchDir, "assets"), { recursive: true });
    branch.title = timeline.title;
    branch.prompt = version.prompt;
    branch.timeline = timeline;
    branch.messages = [{ id: randomUUID(), role: "assistant", text: `Branched from ${source.title}, revision ${version.number}.`, createdAt: now() }];
    this.updateProject(branch);
    return branch;
  }

  getRenderers() {
    return rendererCapabilities(this.root);
  }

  getGenerationProviders() {
    const available = new Set(this.generatedVideos.available());
    return this.generatedVideos.providers.map((provider) => ({ id: provider.id, available: available.has(provider.id) }));
  }

  async exportProject(projectId: string, format: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const projectDir = path.join(this.projectRoot, projectId);
    const timeline = this.getTimeline(projectId);
    const target = format === "bundle"
      ? await createDeliveryBundle(this.root, projectDir, timeline)
      : writeInterchange(projectDir, timeline, format as "otio" | "credits" | "srt");
    if (!target.startsWith(projectDir + path.sep)) throw new Error("Invalid export path.");
    return { format, filename: path.basename(target), url: `/media/${projectId}/${path.relative(projectDir, target).split(path.sep).map(encodeURIComponent).join("/")}` };
  }

  routeTimeline(projectId: string) {
    const routed = routeProjectShots(this.getTimeline(projectId));
    return this.updateTimeline(projectId, routed);
  }

  async runQuality(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const projectDir = path.join(this.projectRoot, projectId);
    const report = await createQualityReport(projectDir, this.getTimeline(projectId));
    project.quality = report;
    this.updateProject(project);
    return report;
  }

  renderTimeline(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("The project is already rendering.");
    const job = this.jobs.create(projectId, "render");
    void this.runRenderJob(job.id, projectId);
    return job;
  }

  private async runRenderJob(jobId: string, projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) {
      this.jobs.update(jobId, { status: "failed", stage: "Project missing", error: "Project not found.", completedAt: now() });
      return;
    }
    const projectDir = path.join(this.projectRoot, projectId);
    const timeline = this.getTimeline(projectId);
    project.status = "running";
    project.stage = "rendering";
    const action: AgentAction = { id: randomUUID(), label: "Rendering editable timeline", status: "running", createdAt: now() };
    project.actions.push(action);
    this.updateProject(project);
    this.jobs.update(jobId, { status: "running", stage: "Rendering shots", startedAt: now(), progress: 0.02 });
    try {
      const render = await renderIncrementally(this.root, projectDir, timeline, this.renderCache, (progress, stage, checkpoint) => {
        if (this.jobs.get(jobId)?.status === "cancelled") throw new Error("Render cancelled.");
        this.jobs.update(jobId, { progress, stage, checkpoint });
      });
      for (const shot of timeline.shots) {
        shot.cacheKey = render.shotKeys[shot.id];
        shot.status = "complete";
      }
      writeProjectBundle(projectDir, timeline);
      let narration: Record<string, unknown> = { status: "not_requested", enabled: false };
      if (fs.existsSync(path.join(projectDir, "narration.json"))) {
        const result = await execFileAsync("node", [path.join(this.root, "scripts", "generate_narration.mjs"), projectDir], { env: process.env });
        narration = JSON.parse(result.stdout.trim().split("\n").at(-1) || "{}");
      }
      await createProxy(path.join(projectDir, "output.mp4"), path.join(projectDir, "proxy.mp4"));
      await execFileAsync("ffmpeg", ["-y", "-ss", "0", "-i", path.join(projectDir, "output.mp4"), "-frames:v", "1", path.join(projectDir, "poster.png")]);
      const interval = Math.max(timeline.format.duration / 6, 0.25);
      await execFileAsync("ffmpeg", ["-y", "-i", path.join(projectDir, "output.mp4"), "-vf", `fps=1/${interval},scale=480:-2,tile=3x2:padding=8:margin=8:color=white`, "-frames:v", "1", path.join(projectDir, "contact-sheet.png")]);
      const metadata = {
        quality: "timeline",
        duration: timeline.format.duration,
        width: timeline.format.width,
        height: timeline.format.height,
        fps: timeline.format.fps,
        renderer: "remotion",
        renderedAt: now(),
        narration,
        cache: { hits: render.hits, misses: render.misses },
      };
      fs.writeFileSync(path.join(projectDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
      this.jobs.update(jobId, { progress: 0.98, stage: "Checking quality" });
      const quality = await createQualityReport(projectDir, timeline);
      project.quality = quality;
      if (!quality.passed) {
        const failures = quality.checks.filter((item) => item.severity === "error").slice(0, 3).map((item) => item.message).join(" ");
        throw new Error(`Quality gate failed. ${failures}`);
      }
      action.status = "done";
      project.status = "complete";
      project.stage = "complete";
      const version = this.archiveVersion(project);
      if (version) {
        project.videoUrl = version.videoUrl;
        project.proxyUrl = version.proxyUrl;
        project.posterUrl = version.posterUrl;
      }
      this.updateProject(project);
      this.jobs.update(jobId, { status: "complete", stage: "Complete", progress: 1, completedAt: now(), checkpoint: { versionId: version?.id, shotKeys: render.shotKeys } });
    } catch (error) {
      action.status = "failed";
      const cancelled = this.jobs.get(jobId)?.status === "cancelled";
      project.status = cancelled ? "cancelled" : "error";
      project.stage = "ready";
      project.error = error instanceof Error ? error.message : "Timeline render failed.";
      this.updateProject(project);
      if (!cancelled) this.jobs.update(jobId, { status: "failed", stage: "Failed", error: project.error, completedAt: now() });
    }
  }

  async importAsset(projectId: string, candidate: AssetCandidate) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    const projectDir = path.join(this.projectRoot, projectId);
    const asset = await this.assets.import(projectDir, candidate);
    const timeline = this.getTimeline(projectId);
    timeline.assets.push(asset);
    this.updateTimeline(projectId, timeline);
    return asset;
  }

  async sendMessage(projectId: string, text: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    if (project.status === "running") throw new Error("The agent is already working on this project.");
    if (!this.authState.connected) throw new Error("Connect Codex before generating a video.");
    if (!this.runtimeState.manim) throw new Error("Manim is not installed. Run npm run setup:manim first.");

    const projectDir = path.join(this.projectRoot, project.id);
    const isRevision = Boolean(project.threadId);
    project.messages.push({ id: randomUUID(), role: "user", text, createdAt: now() });
    project.prompt ||= text;
    if (project.title === "Untitled video") project.title = safeTitle(text);
    project.status = "running";
    project.stage = "brief";
    project.error = undefined;
    project.actions.push({ id: randomUUID(), label: isRevision ? "Reading current scene" : "Planning animation", status: "running", createdAt: now() });
    this.updateProject(project);

    try {
      if (!project.threadId) {
        const response = await this.bridge.startThread(projectDir, AGENT_INSTRUCTIONS);
        project.threadId = response.thread.id;
        this.threadToProject.set(project.threadId, project.id);
      } else {
        await this.bridge.resumeThread(project.threadId, projectDir);
      }

      const request = productionRequest(text, isRevision);
      const response = await this.bridge.startTurn(project.threadId, projectDir, request);
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

  private async onCodexNotification(message: { method: string; params: any }) {
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
      project.actions.push({ id: randomUUID(), label: "Writing animation", status: "running", createdAt: now() });
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
        const label = commandLabel(item.command || "");
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
      const narrationError = this.narrationValidationError(path.join(this.projectRoot, project.id));
      let qualityError: string | undefined;
      if (message.params.turn.status === "completed" && fs.existsSync(output) && !narrationError) {
        try {
          const timeline = ensureProjectBundle(path.join(this.projectRoot, project.id), project.id, project.title, project.prompt);
          project.quality = await createQualityReport(path.join(this.projectRoot, project.id), timeline);
          if (!project.quality.passed) {
            qualityError = project.quality.checks.filter((item) => item.severity === "error").slice(0, 3).map((item) => item.message).join(" ");
          }
        } catch (error) {
          qualityError = error instanceof Error ? error.message : "Quality inspection failed.";
        }
      }
      if (message.params.turn.status === "completed" && fs.existsSync(output) && !narrationError && !qualityError) {
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
        project.error = narrationError || qualityError || message.params.turn.error?.message || "The agent finished without a playable render.";
      }
      project.turnId = undefined;
      this.updateProject(project);
    }
  }
}
