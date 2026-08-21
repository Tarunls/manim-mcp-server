import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import type { Sandbox, CommandHandle } from "e2b";
import type { AgentModel, AgentReasoningEffort } from "./types.js";
import type { ManagedSandbox, SandboxManager } from "./e2b-sandbox-manager.js";

interface RpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

const STUDIO_MODEL = process.env.STUDIO_MODEL || "gpt-5.6-sol";
const STUDIO_REASONING_EFFORT = process.env.STUDIO_REASONING_EFFORT || "high";

// Directories that are pure render output; never uploaded before a turn.
const UPLOAD_SKIP = new Set(["versions", "reviews"]);
const OUTPUT_FILES = new Set([
  "output.mp4", "poster.png", "contact-sheet.png", "metadata.json",
]);

/**
 * Runs `codex app-server` inside an E2B sandbox and bridges its JSON-RPC
 * stdio over the E2B command channel. Mirrors the local CodexBridge surface
 * used by StudioService so callers cannot tell the difference.
 */
export class E2BCodexBridge extends EventEmitter {
  private handle?: CommandHandle;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  private startPromise?: Promise<void>;
  private stopped = false;

  constructor(
    private manager: SandboxManager,
    private entry: ManagedSandbox,
    private projectDir: string,
    existingThreadId?: string,
  ) {
    super();
    void existingThreadId;
  }

  get sandboxId() {
    return this.entry.sandboxId;
  }

  async start() {
    if (this.handle || this.stopped) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal() {
    const sandbox = this.manager.sandboxFor(this.entry);
    if (!sandbox) throw new Error("Sandbox is no longer available.");

    await sandbox.commands.run(`mkdir -p ${shellQuote(this.remoteProjectDir())}`, { timeoutMs: 15_000 });
    await this.syncUp();

    const envs: Record<string, string> = {};
    if (process.env.OPENAI_API_KEY) envs.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (process.env.SPEECHIFY_API_KEY) envs.SPEECHIFY_API_KEY = process.env.SPEECHIFY_API_KEY;

    const handle = await sandbox.commands.run(
      'codex app-server '
      + `-c model=\\"${STUDIO_MODEL}\\" `
      + `-c model_reasoning_effort=\\"${STUDIO_REASONING_EFFORT}\\" `
      + '-c forced_login_method=\\"api\\" '
      + '-c cli_auth_credentials_store=\\"file\\" '
      + '--listen stdio://',
      {
        background: true,
        stdin: true,
        cwd: this.remoteProjectDir(),
        envs,
        timeoutMs: 0,
        onStdout: (chunk) => this.consumeStdout(chunk),
        onStderr: (chunk) => {
          const message = chunk.trim();
          if (message) this.emit("diagnostic", message);
        },
      },
    );
    this.handle = handle;
    this.entry.codexPid = handle.pid;

    // API-key login for the isolated CODEX_HOME inside the sandbox.
    if (process.env.OPENAI_API_KEY) {
      await sandbox.commands.run(
        `mkdir -p $HOME/.lesson-studio-codex && printf '%s' "$KEY" | codex login --with-api-key -c forced_login_method=\\"api\\" -c cli_auth_credentials_store=\\"file\\"`,
        {
          envs: { ...envs, KEY: process.env.OPENAI_API_KEY, CODEX_HOME: "$HOME/.lesson-studio-codex" },
          timeoutMs: 60_000,
        },
      );
    }

    await this.rpc("initialize", {
      clientInfo: { name: "manim_studio_mvp", title: "Manim Studio", version: "0.1.0" },
    }, 60_000);
    this.notify("initialized", {});
    this.emit("ready");
  }

  private remoteProjectDir() {
    return `/home/user/studio-projects/${path.basename(this.projectDir)}`;
  }

  /** Push project sources into the sandbox before a turn. */
  async syncUp() {
    const sandbox = this.manager.sandboxFor(this.entry);
    if (!sandbox) return;
    await uploadTree(sandbox, this.projectDir, this.remoteProjectDir());
  }

  /** Pull rendered artifacts back to the orchestrator after a turn. */
  async syncDown() {
    const sandbox = this.manager.sandboxFor(this.entry);
    if (!sandbox) return;
    await downloadTree(sandbox, this.remoteProjectDir(), this.projectDir);
    this.manager.touch(this.entry.key);
  }

  private consumeStdout(chunk: string) {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim()) this.handleLine(line);
    }
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
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "turn/completed") {
      // Persist artifacts before the caller reacts to completion.
      void this.syncDown().catch((error) =>
        this.emit("diagnostic", `syncDown failed: ${String(error)}`));
    }
    if (message.method) this.emit("notification", message);
  }

  private write(message: RpcMessage) {
    if (!this.handle) throw new Error("Codex App Server is not running in the sandbox.");
    void this.handle.sendStdin?.(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: Record<string, unknown>) {
    try {
      this.write({ method, params });
    } catch {
      // sandbox may already be gone
    }
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
        reject(error as Error);
      }
    });
  }

  async account() {
    await this.start();
    return { account: { type: "api", planType: "usage-based" } };
  }

  async startThread(cwd: string, developerInstructions: string, model: AgentModel = STUDIO_MODEL as AgentModel) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/start", {
      cwd: this.remoteProjectDir(),
      approvalPolicy: "never",
      sandbox: "workspace-write",
      model,
      developerInstructions,
      personality: "friendly",
      serviceName: "manim_studio",
    }, 120_000);
  }

  async resumeThread(threadId: string, _cwd: string) {
    await this.start();
    return this.rpc<{ thread: { id: string } }>("thread/resume", {
      threadId,
      cwd: this.remoteProjectDir(),
    }, 120_000);
  }

  async startTurn(
    threadId: string,
    _cwd: string,
    text: string,
    localImagePaths: string[] = [],
    model: AgentModel = STUDIO_MODEL as AgentModel,
    reasoningEffort: AgentReasoningEffort = STUDIO_REASONING_EFFORT as AgentReasoningEffort,
  ) {
    await this.start();
    this.manager.touch(this.entry.key);

    // Upload any newly attached review images.
    const remoteImages: string[] = [];
    const sandbox = this.manager.sandboxFor(this.entry);
    if (sandbox) {
      for (const imagePath of localImagePaths) {
        const remotePath = path.posix.join(this.remoteProjectDir(), ".attachments", path.basename(imagePath));
        try {
          await writeRemoteFile(sandbox, fs.readFileSync(imagePath), remotePath);
          remoteImages.push(remotePath);
        } catch {
          this.emit("diagnostic", `failed to upload image ${imagePath}`);
        }
      }
    }

    return this.rpc<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd: this.remoteProjectDir(),
      model,
      effort: reasoningEffort,
      input: [
        { type: "text", text, text_elements: [] },
        ...remoteImages.map((imagePath) => ({ type: "localImage", path: imagePath, detail: "high" })),
      ],
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [this.remoteProjectDir()],
        networkAccess: true,
      },
    }, 120_000).then(async (result) => {
      this.entry.lastActivityAt = Date.now();
      return result;
    });
  }

  async interrupt(threadId: string, turnId: string) {
    await this.start();
    return this.rpc("turn/interrupt", { threadId, turnId });
  }

  async stop() {
    this.stopped = true;
    try {
      await this.handle?.kill();
    } catch {
      // already dead
    }
    this.handle = undefined;
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// The installed e2b SDK ships type declarations whose Blob/ArrayBuffer
// references clash with the project's DOM lib. Route writes through this
// small adapter to keep binary uploads type-safe at the call sites.
async function writeRemoteFile(sandbox: Sandbox, data: Buffer, remotePath: string) {
  const payload = new Uint8Array(data);
  const write = sandbox.files.write as unknown as (
    path: string,
    data: unknown,
  ) => Promise<unknown>;
  await write(remotePath, payload);
}

const IGNORED_NAMES = new Set([".DS_Store"]);

async function uploadTree(sandbox: Sandbox, localDir: string, remoteDir: string) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  await sandbox.commands.run(`mkdir -p ${shellQuote(remoteDir)}`, { timeoutMs: 15_000 });
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const localPath = path.join(localDir, entry.name);
    const remotePath = path.posix.join(remoteDir, entry.name);
    if (entry.isDirectory()) {
      if (UPLOAD_SKIP.has(entry.name)) continue;
      await uploadTree(sandbox, localPath, remotePath);
    } else if (!OUTPUT_FILES.has(entry.name)) {
      await writeRemoteFile(sandbox, fs.readFileSync(localPath), remotePath);
    }
  }
}

async function downloadTree(sandbox: Sandbox, remoteDir: string, localDir: string) {
  const listing = await sandbox.commands.run(`find ${shellQuote(remoteDir)} -type f`, { timeoutMs: 30_000 });
  const files = listing.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  fs.mkdirSync(localDir, { recursive: true });
  for (const remoteFile of files) {
    const relative = path.posix.relative(remoteDir, remoteFile);
    if (!relative || relative.startsWith("..")) continue;
    const top = relative.split("/")[0];
    if (UPLOAD_SKIP.has(top)) continue;
    const localFile = path.join(localDir, relative);
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    const content = await sandbox.files.read(remoteFile, { format: "blob" });
    fs.writeFileSync(localFile, Buffer.from(await content.arrayBuffer()));
  }
}
