import { EventEmitter } from "node:events";

// e2b is ESM-only; load it through native dynamic import so CommonJS
// runtimes (serverless bundles) never fall back to require().
type Sandbox = import("e2b").Sandbox;
let e2bModule: typeof import("e2b") | undefined;
export async function loadE2B(): Promise<typeof import("e2b")> {
  if (!e2bModule) e2bModule = await import("e2b");
  return e2bModule;
}

export interface ManagedSandbox {
  sandboxId: string;
  key: string;
  codexPid?: number;
  createdAt: number;
  lastActivityAt: number;
  ttlMs: number;
  idleTimeoutMs: number;
}

const DEFAULT_TTL_MS = parseDuration(process.env.E2B_SANDBOX_TTL, "45m");
const DEFAULT_IDLE_MS = parseDuration(process.env.E2B_SANDBOX_IDLE_TIMEOUT, "5m");
const HEARTBEAT_MS = 15_000;
const TEMPLATE_ID = process.env.E2B_TEMPLATE_ID || "lesson-studio-agent";

function parseDuration(value: string | undefined, fallback: string): number {
  const raw = value?.trim() || fallback;
  const match = /^(\d+)(ms|s|m|h)$/.exec(raw);
  if (!match) return 45 * 60_000;
  const amount = Number(match[1]);
  switch (match[2]) {
    case "ms": return amount;
    case "s": return amount * 1000;
    case "m": return amount * 60_000;
    case "h": return amount * 3_600_000;
    default: return 45 * 60_000;
  }
}

export function e2bConfigured() {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

/**
 * Owns every running sandbox. Guarantees:
 * - one sandbox per session key (userId:projectId)
 * - hard TTL + idle timeout; nothing runs forever
 * - reconnect by sandboxId after orchestrator or transport restart
 * - kill always syncs artifacts first via the onBeforeKill hook
 */
export class SandboxManager extends EventEmitter {
  private entries = new Map<string, ManagedSandbox>();
  private sandboxes = new Map<string, Sandbox>();
  private locks = new Map<string, Promise<ManagedSandbox>>();
  private heartbeatTimer?: NodeJS.Timeout;
  private maxConcurrent = Number(process.env.E2B_MAX_CONCURRENT || 20);

  constructor(private onBeforeKill?: (entry: ManagedSandbox) => Promise<void>) {
    super();
    this.startHeartbeat();
  }

  get size() {
    return this.entries.size;
  }

  list(): ManagedSandbox[] {
    return [...this.entries.values()];
  }

  /**
   * Get or create the sandbox for a session key. Reattaches to a live
   * sandbox after an orchestrator restart when `existingSandboxId` is given.
   */
  async acquire(key: string, existingSandboxId?: string): Promise<ManagedSandbox> {
    const existing = this.entries.get(key);
    if (existing && this.sandboxes.has(existing.sandboxId)) {
      existing.lastActivityAt = Date.now();
      return existing;
    }
    if (this.locks.has(key)) return this.locks.get(key)!;

    const lock = (async (): Promise<ManagedSandbox> => {
      if (this.entries.size >= this.maxConcurrent) {
        throw new Error(
          `All ${this.maxConcurrent} generation slots are busy right now. Please try again in a moment.`,
        );
      }

      const { Sandbox } = await loadE2B();
      let sandbox: Sandbox;
      let codexPid: number | undefined;
      if (existingSandboxId) {
        try {
          sandbox = await Sandbox.connect(existingSandboxId, { timeoutMs: 0 });
          const processes = await sandbox.commands.list();
          codexPid = processes.find((p) => p.cmd === "codex")?.pid;
        } catch {
          sandbox = await this.createSandbox();
        }
      } else {
        sandbox = await this.createSandbox();
      }

      const entry: ManagedSandbox = {
        sandboxId: sandbox.sandboxId,
        key,
        codexPid,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        ttlMs: DEFAULT_TTL_MS,
        idleTimeoutMs: DEFAULT_IDLE_MS,
      };
      this.entries.set(key, entry);
      this.sandboxes.set(sandbox.sandboxId, sandbox);
      this.emit("acquired", entry);
      return entry;
    })().finally(() => this.locks.delete(key));

    this.locks.set(key, lock);
    return lock;
  }

  sandboxFor(entry: ManagedSandbox): Sandbox | undefined {
    return this.sandboxes.get(entry.sandboxId);
  }

  touch(key: string) {
    const entry = this.entries.get(key);
    if (entry) entry.lastActivityAt = Date.now();
  }

  async release(key: string, reason: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    const sandbox = this.sandboxes.get(entry.sandboxId);
    this.sandboxes.delete(entry.sandboxId);
    try {
      await this.onBeforeKill?.(entry);
    } catch (error) {
      this.emit("diagnostic", `artifact sync before kill failed: ${String(error)}`);
    }
    try {
      await sandbox?.kill();
    } catch {
      // already gone; nothing to clean up
    }
    this.emit("released", { ...entry, reason });
  }

  /** Reconcile on orchestrator startup: kill sandboxes we no longer track. */
  async reconcile(liveKeys: Set<string>) {
    for (const [key, entry] of [...this.entries]) {
      if (!liveKeys.has(key)) await this.release(key, "reconcile-orphaned");
      else void entry;
    }
  }

  private async createSandbox(): Promise<Sandbox> {
    const { Sandbox } = await loadE2B();
    return Sandbox.create(TEMPLATE_ID, {
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 0,
      metadata: { service: "lesson-studio" },
    });
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => void this.sweep(), HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  private async sweep() {
    const now = Date.now();
    for (const [key, entry] of [...this.entries]) {
      const age = now - entry.createdAt;
      const idle = now - entry.lastActivityAt;
      if (age > entry.ttlMs) {
        this.emit("diagnostic", `[sandbox] TTL exceeded for ${key}; killing`);
        await this.release(key, "ttl-exceeded").catch(() => {});
      } else if (idle > entry.idleTimeoutMs) {
        this.emit("diagnostic", `[sandbox] idle timeout for ${key}; killing`);
        await this.release(key, "idle-timeout").catch(() => {});
      } else {
        const sandbox = this.sandboxes.get(entry.sandboxId);
        if (!sandbox) continue;
        try {
          await sandbox.commands.run("true", { timeoutMs: 10_000 });
        } catch {
          this.emit("diagnostic", `[sandbox] heartbeat failed for ${key}; releasing`);
          await this.release(key, "heartbeat-failed").catch(() => {});
        }
      }
    }
  }

  async stopAll() {
    for (const key of [...this.entries.keys()]) {
      await this.release(key, "shutdown").catch(() => {});
    }
  }
}
