import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { spawnThroughShell } from "./platform.js";
import type { AgentModel, AgentReasoningEffort } from "./types.js";

// Keep the studio's quality/cost setting local to this app. The regular Codex
// desktop/CLI configuration can remain on Sol for other work.
const STUDIO_MODEL = "gpt-5.6-sol";
const STUDIO_REASONING_EFFORT = "high";

interface RpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class CodexBridge extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private startPromise?: Promise<void>;
  private readonly credentialHome: string;

  constructor(root: string) {
    super();
    // Keep the studio's API login isolated from a developer's regular Codex
    // profile. Cloud Run also has a writable /tmp directory, unlike the image.
    this.credentialHome = process.env.STUDIO_CODEX_CREDENTIAL_HOME?.trim()
      || path.join(os.tmpdir(), `lesson-studio-codex-${path.basename(root)}`);
  }

  get running() {
    return Boolean(this.process && !this.process.killed);
  }

  async start() {
    if (this.running) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal() {
    await this.loginWithApiKey();
    const child = spawn("codex", [
      "app-server",
      "-c", `model=\"${STUDIO_MODEL}\"`,
      "-c", `model_reasoning_effort=\"${STUDIO_REASONING_EFFORT}\"`,
      "-c", "forced_login_method=\"api\"",
      "-c", "cli_auth_credentials_store=\"file\"",
      "--listen", "stdio://",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.codexEnvironment(),
      // On Windows npm installs codex as a .cmd shim, which CreateProcess
      // cannot execute directly; without this the bridge dies with ENOENT
      // before the server finishes booting.
      shell: spawnThroughShell,
    });
    this.process = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit("diagnostic", message);
    });
    child.on("exit", (code, signal) => {
      this.process = undefined;
      const reason = new Error(`Codex App Server stopped (${code ?? signal ?? "unknown"}).`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(reason);
      }
      this.pending.clear();
      this.emit("exit", reason);
    });
    child.on("error", (error) => this.emit("error", error));

    await this.rpc("initialize", {
      clientInfo: {
        name: "manim_studio_mvp",
        title: "Manim Studio",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
    this.emit("ready");
  }

  private codexEnvironment() {
    return { ...process.env, CODEX_HOME: this.credentialHome };
  }

  private async loginWithApiKey() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured. Add it to .env locally or Secret Manager in deployment.");
    }
    fs.mkdirSync(this.credentialHome, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", [
        "login",
        "--with-api-key",
        "-c", "forced_login_method=\"api\"",
        "-c", "cli_auth_credentials_store=\"file\"",
      ], {
        stdio: ["pipe", "ignore", "pipe"],
        env: this.codexEnvironment(),
        shell: spawnThroughShell,
      });
      let diagnostic = "";
      child.stderr.on("data", (chunk) => {
        diagnostic = `${diagnostic}${String(chunk)}`.slice(-4_000);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(diagnostic.trim() || `Codex API-key login failed with exit code ${code ?? "unknown"}.`));
      });
      child.stdin.end(`${apiKey}\n`);
    });
  }

  private handleLine(line: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.emit("diagnostic", line);
      return;
    }

    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Codex request failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  private write(message: RpcMessage) {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: Record<string, unknown>) {
    this.write({ method, params });
  }

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async startThread(cwd: string, developerInstructions: string, model: AgentModel = STUDIO_MODEL) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      model,
      developerInstructions,
      personality: "friendly",
      serviceName: "manim_studio",
    }, 120_000);
  }

  async resumeThread(threadId: string, cwd: string) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/resume", { threadId, cwd }, 120_000);
  }

  async startTurn(
    threadId: string,
    cwd: string,
    text: string,
    localImagePaths: string[] = [],
    model: AgentModel = STUDIO_MODEL,
    reasoningEffort: AgentReasoningEffort = STUDIO_REASONING_EFFORT,
  ) {
    await this.start();
    return this.rpc<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd,
      model,
      effort: reasoningEffort,
      input: [
        { type: "text", text, text_elements: [] },
        ...localImagePaths.map((imagePath) => ({ type: "localImage", path: imagePath, detail: "high" })),
      ],
      approvalPolicy: "never",
      // Rendering invokes the selected narration provider from the project helper. Keep filesystem
      // access scoped to this project while allowing that API call to succeed.
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: true,
      },
    }, 120_000);
  }

  async interrupt(threadId: string, turnId: string) {
    await this.start();
    return this.rpc("turn/interrupt", { threadId, turnId });
  }

  stop() {
    this.process?.kill("SIGTERM");
  }
}
