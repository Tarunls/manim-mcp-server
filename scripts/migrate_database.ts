import path from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "../server/database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = new Database();

try {
  await database.migrate(path.join(root, "db", "migrations"));
  console.log("Database migrations are current.");
} finally {
  await database.close();
}
