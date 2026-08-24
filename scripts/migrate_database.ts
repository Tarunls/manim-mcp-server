import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Database } from "../server/database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = new Database();
const maxAttempts = 8;

try {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await database.migrate(path.join(root, "db", "migrations"));
      break;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const waitMs = Math.min(attempt * 5_000, 30_000);
      console.warn(
        `Database migration connection attempt ${attempt}/${maxAttempts} failed; retrying in ${waitMs / 1_000}s.`,
      );
      await delay(waitMs);
    }
  }
  console.log("Database migrations are current.");
} finally {
  await database.close();
}
