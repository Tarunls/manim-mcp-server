import { normalizeStoredProject } from "./studio-service.js";
import type { StudioProject } from "./types.js";
import type { Database, SqlClient } from "./database.js";

type ProjectRow = { document: StudioProject; revision: string };

export class ProjectRevisionConflictError extends Error {
  constructor() {
    super("The project was modified concurrently.");
  }
}

function projectFromRow(row: ProjectRow, ownerId: string) {
  // Stored documents predate the Manim-only, paper-styled studio, so they are
  // migrated in memory on every read.
  const project = normalizeStoredProject({ ...row.document, ownerId } as StudioProject & { storageRevision: number });
  Object.defineProperty(project, "storageRevision", { value: Number(row.revision), enumerable: false });
  return project;
}

function storageRevision(project: StudioProject) {
  const revision = (project as StudioProject & { storageRevision?: number }).storageRevision;
  return Number.isFinite(revision) ? Number(revision) : undefined;
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async list(ownerId: string) {
    const result = await this.db.query<ProjectRow>(
      `SELECT document, revision::text
         FROM projects
        WHERE owner_id = $1 AND deleted_at IS NULL
        ORDER BY updated_at DESC`,
      [ownerId],
    );
    return result.rows.map((row) => projectFromRow(row, ownerId));
  }

  async get(id: string, ownerId: string, client?: SqlClient) {
    const text =
      `SELECT document, revision::text
         FROM projects
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`;
    const result = client
      ? await client.query<ProjectRow>(text, [id, ownerId])
      : await this.db.query<ProjectRow>(text, [id, ownerId]);
    const row = result.rows[0];
    return row ? projectFromRow(row, ownerId) : undefined;
  }

  async save(project: StudioProject, ownerId: string, client?: SqlClient) {
    if (project.ownerId !== ownerId) throw new Error("Project ownership does not match the authenticated user.");
    // A project loaded through this repository carries the revision it was read
    // at; the update only lands if nobody else wrote in between.
    const expected = storageRevision(project);
    const text =
      `INSERT INTO projects (id, owner_id, document, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE
         SET document = EXCLUDED.document,
             revision = projects.revision + 1,
             updated_at = EXCLUDED.updated_at
       WHERE projects.owner_id = EXCLUDED.owner_id AND projects.deleted_at IS NULL
         AND ($6::bigint IS NULL OR projects.revision = $6)
       RETURNING document, revision::text`;
    const values = [project.id, ownerId, JSON.stringify(project), project.createdAt, project.updatedAt, expected ?? null];
    const result = client
      ? await client.query<ProjectRow>(text, values)
      : await this.db.query<ProjectRow>(text, values);
    if (!result.rowCount) {
      if (expected !== undefined && (await this.get(project.id, ownerId, client))) throw new ProjectRevisionConflictError();
      throw new Error("Project not found.");
    }
    return projectFromRow(result.rows[0], ownerId);
  }

  async update(id: string, ownerId: string, mutator: (project: StudioProject) => void | StudioProject) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const project = await this.get(id, ownerId);
      if (!project) throw new Error("Project not found.");
      const mutated = mutator(project) || project;
      mutated.updatedAt = new Date().toISOString();
      try {
        return await this.save(mutated, ownerId);
      } catch (error) {
        if (!(error instanceof ProjectRevisionConflictError)) throw error;
      }
    }
    throw new Error("The project is being updated by another request. Try again.");
  }

  async delete(id: string, ownerId: string) {
    await this.db.query(
      "UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
      [id, ownerId],
    );
  }
}
