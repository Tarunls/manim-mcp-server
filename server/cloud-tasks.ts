import { CloudTasksClient } from "@google-cloud/tasks";
import type { Database } from "./database.js";

type OutboxRow = { id: string; aggregate_id: string; payload: { jobId: string } };

export class GenerationQueue {
  private readonly client = new CloudTasksClient();

  constructor(private readonly db: Database) {}

  get configured() {
    return Boolean(
      this.db.configured
      && process.env.GCP_PROJECT
      && process.env.GCP_REGION
      && process.env.GENERATION_QUEUE
      && process.env.GENERATION_DISPATCH_URL
      && process.env.GENERATION_DISPATCH_SERVICE_ACCOUNT,
    );
  }

  private settings() {
    const project = process.env.GCP_PROJECT?.trim();
    const location = process.env.GCP_REGION?.trim();
    const queue = process.env.GENERATION_QUEUE?.trim();
    const url = process.env.GENERATION_DISPATCH_URL?.trim();
    const serviceAccountEmail = process.env.GENERATION_DISPATCH_SERVICE_ACCOUNT?.trim();
    if (!project || !location || !queue || !url || !serviceAccountEmail) {
      throw new Error("Cloud Tasks generation dispatch is not fully configured.");
    }
    return { project, location, queue, url, serviceAccountEmail };
  }

  async flush(limit = 25) {
    if (!this.configured) return { published: 0 };
    const rows = await this.db.query<OutboxRow>(
      `SELECT id, aggregate_id, payload
         FROM outbox_events
        WHERE topic = 'generation.dispatch' AND published_at IS NULL
        ORDER BY created_at
        LIMIT $1`,
      [limit],
    );
    let published = 0;
    for (const event of rows.rows) {
      try {
        await this.publish(event);
        await this.db.query(
          `UPDATE outbox_events SET published_at = now(), attempt = attempt + 1, last_error = NULL
            WHERE id = $1 AND published_at IS NULL`,
          [event.id],
        );
        published += 1;
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
        if (code === 6) {
          await this.db.query(
            `UPDATE outbox_events SET published_at = now(), attempt = attempt + 1, last_error = NULL
              WHERE id = $1 AND published_at IS NULL`,
            [event.id],
          );
          published += 1;
          continue;
        }
        await this.db.query(
          `UPDATE outbox_events SET attempt = attempt + 1, last_error = $2 WHERE id = $1`,
          [event.id, error instanceof Error ? error.message.slice(0, 1000) : "Cloud Tasks publish failed"],
        );
      }
    }
    return { published };
  }

  private async publish(event: OutboxRow) {
    const settings = this.settings();
    const parent = this.client.queuePath(settings.project, settings.location, settings.queue);
    const name = this.client.taskPath(settings.project, settings.location, settings.queue, `generation-${event.aggregate_id}`);
    await this.client.createTask({
      parent,
      task: {
        name,
        httpRequest: {
          httpMethod: "POST",
          url: settings.url,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(event.payload)).toString("base64"),
          oidcToken: {
            serviceAccountEmail: settings.serviceAccountEmail,
            audience: settings.url,
          },
        },
      },
    });
  }
}
