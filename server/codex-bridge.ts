import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

import { spawnThroughShell } from "./platform.js";

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
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
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

  async account() {
    await this.start();
    return this.rpc<{ account: null | { type: string; email?: string; planType?: string } }>(
      "account/read",
      { refreshToken: false },
    );
  }

  async login() {
    await this.start();
    return this.rpc<{ type: string; loginId: string; authUrl: string }>("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    });
  }

  async logout() {
    await this.start();
    return this.rpc("account/logout");
  }

  async startThread(cwd: string, developerInstructions: string) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      developerInstructions,
      personality: "friendly",
      serviceName: "manim_studio",
    }, 120_000);
  }

  async resumeThread(threadId: string, cwd: string) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/resume", { threadId, cwd }, 120_000);
  }

  async startTurn(threadId: string, cwd: string, text: string, localImagePaths: string[] = []) {
    await this.start();
    return this.rpc<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd,
      input: [
        { type: "text", text, text_elements: [] },
        ...localImagePaths.map((imagePath) => ({ type: "localImage", path: imagePath, detail: "high" })),
      ],
      approvalPolicy: "never",
      // Rendering invokes Speechify from the project helper. Keep filesystem
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
