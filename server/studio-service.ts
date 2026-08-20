import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { CodexBridge } from "./codex-bridge.js";
import type { AgentAction, AuthState, ProjectVersion, RenderInfo, RuntimeState, StudioEvent, StudioProject } from "./types.js";

const execFileAsync = promisify(execFile);

const AGENT_INSTRUCTIONS = `You are the rendering agent for Manim Studio, a local prompt-to-video MVP.

Your only job is to create or revise the editable Manim Community Edition project in the current working directory.

Requirements:
- Keep the source of truth in scene.py and define exactly one renderable Scene subclass named GeneratedScene.
- Use only Manim CE APIs available in the local environment. Prefer shapes, Text, MarkupText, NumberPlane, Axes, graphs, and deterministic animations. Avoid MathTex unless you first verify LaTeX is installed.
- Import fit_inside, stack_in_panel, assert_inside, and assert_scene_safe from manim_layout.
- Compose for a 16:9 frame. Keep all important objects at least 0.32 Manim units from the frame edge.
- Build every information panel as one VGroup arranged with explicit spacing. Use stack_in_panel or fit_inside with at least 0.30 units of inner padding. Never position panel text independently with fixed coordinates.
- Call assert_inside(panel, *panel_contents, padding=0.16) before animating each panel. Call assert_scene_safe on every major group before its first animation. Rendering intentionally fails when these checks detect overflow.
- Use no more than two type sizes inside a panel. Keep labels at least 0.18 units apart and align related captions to the equation terms above them.
- Use a restrained palette, readable type, consistent spacing, and purposeful motion.
- Target 8-15 seconds for a first draft unless the user asks otherwise.
- Render by running: python3 ../../../scripts/render_scene.py . balanced
- Write narration.json before rendering. It must be JSON shaped as {"segments":[{"start":0.0,"text":"..."}]} with 3-5 chapter-length passages timed to the visual beats. Each passage should be 18-45 words, explain cause and effect instead of merely naming objects, and lead naturally into the next idea.
- Write mathematical pronunciation as natural speech (for example, "a squared plus b squared equals c squared"). Avoid fragments, repeated "now", filler, and isolated fact lists. Budget each visual slot at roughly 145 spoken words per minute plus 0.8 seconds of breathing room.
- The render helper uses Speechify simba-3.2 with warm SSML delivery, maximum-fidelity MP3, timing guards, fades, and loudness normalization. It refuses fallback voices and fails if a spoken passage does not fit its visual slot.
- After rendering, inspect metadata.json and verify narration.provider is speechify, narration.model is simba-3.2, and narration.status is ready. Never create, download, or substitute narration through another provider.
- Inspect both poster.png and contact-sheet.png. Check all six sampled frames for clipping, crowded panels, uneven spacing, poor contrast, and unintended overlaps. If any issue exists, patch scene.py and render once more.
- output.mp4 must exist before you finish. Never return base64 or paste the full source into chat.
- Revisions must preserve unrelated parts of scene.py.
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
          // fresh thread so it receives the restored Manim-only instructions.
          project.threadId = undefined;
          project.turnId = undefined;
          delete migrated.timeline;
          delete migrated.quality;
          delete migrated.proxyUrl;
        }
        project.versions ||= [];
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
    const [codex, manim, ffmpeg] = await Promise.all([
      this.bridge.start().then(() => true).catch(() => false),
      fs.promises.access(path.join(this.root, ".venv", "bin", "manim")).then(() => true).catch(() => false),
      execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false),
    ]);
    this.runtimeState = { codex, manim, ffmpeg };
    if (codex) await this.refreshAuth();
    this.emitEvent({ type: "runtime", runtime: this.runtimeState });
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

    const assets = ["scene.py", "output.mp4", "poster.png", "contact-sheet.png", "metadata.json", "narration.json", "narration.m4a"];
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
    this.updateProject(project);
    if (prompt) void this.sendMessage(id, prompt).catch(() => undefined);
    return project;
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

      const request = isRevision
        ? `Revise the existing animation with this request: ${text}`
        : `Create the first editable Manim video for this prompt: ${text}`;
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
      if (message.params.turn.status === "completed" && fs.existsSync(output) && !narrationError) {
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
        project.error = narrationError || message.params.turn.error?.message || "The agent finished without a playable render.";
      }
      project.turnId = undefined;
      this.updateProject(project);
    }
  }
}
