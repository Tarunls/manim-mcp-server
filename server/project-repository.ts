import type { StudioProject } from "./types.js";
import type { Database, SqlClient } from "./database.js";

type ProjectRow = { document: StudioProject; revision: string };

function projectFromRow(row: ProjectRow, ownerId: string) {
  const project = { ...row.document, ownerId } as StudioProject & { storageRevision: number };
  Object.defineProperty(project, "storageRevision", { value: Number(row.revision), enumerable: false });
  return project;
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
    const text =
      `INSERT INTO projects (id, owner_id, document, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE
         SET document = EXCLUDED.document,
             revision = projects.revision + 1,
             updated_at = EXCLUDED.updated_at
       WHERE projects.owner_id = EXCLUDED.owner_id AND projects.deleted_at IS NULL
       RETURNING document, revision::text`;
    const values = [project.id, ownerId, JSON.stringify(project), project.createdAt, project.updatedAt];
    const result = client
      ? await client.query<ProjectRow>(text, values)
      : await this.db.query<ProjectRow>(text, values);
    if (!result.rowCount) throw new Error("Project not found.");
    return projectFromRow(result.rows[0], ownerId);
  }
}
