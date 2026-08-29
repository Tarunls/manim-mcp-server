import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type SqlClient = Pick<PoolClient, "query">;

export class Database {
  readonly configured: boolean;
  private readonly pool?: Pool;

  constructor(connectionString = process.env.DATABASE_URL?.trim()) {
    this.configured = Boolean(connectionString);
    if (!connectionString) {
      if (process.env.REQUIRE_DATABASE === "true") throw new Error("DATABASE_URL is required in this deployment.");
      return;
    }
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30_000),
      application_name: "lesson-studio-api",
      ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
    });
    this.pool.on("error", (error) => console.error("Database pool error", { message: error.message }));
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    if (!this.pool) throw new Error("The database is not configured.");
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>, options: { isolation?: "serializable" | "repeatable read" | "read committed" } = {}) {
    if (!this.pool) throw new Error("The database is not configured.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (options.isolation) await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation.toUpperCase()}`);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthcheck() {
    if (!this.pool) return { configured: false, ready: process.env.REQUIRE_DATABASE !== "true" };
    await this.pool.query("SELECT 1");
    return { configured: true, ready: true };
  }

  async migrate(migrationsDirectory: string) {
    if (!this.pool) throw new Error("DATABASE_URL is required to run migrations.");
    // Deterministic lexicographic order over full filenames. Two applied files
    // share the 0005_ prefix and are recorded by name, so never rename applied
    // migrations; new migrations must start at 0006.
    const files = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(7812394102891)");
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
      const names = new Set(applied.rows.map((row) => row.name));
      for (const file of files) {
        if (names.has(file)) continue;
        await client.query(fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      }
    });
  }

  async close() {
    await this.pool?.end();
  }
}

export const database = new Database();
