import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { Database } from "../server/database.js";
import { HostedBillingService } from "../server/hosted-billing-service.js";
import { ProjectRepository } from "../server/project-repository.js";
import type { StudioProject } from "../server/types.js";

const connectionString = process.env.TEST_DATABASE_URL;

function project(id: string, ownerId: string): StudioProject {
  const now = new Date().toISOString();
  return {
    id,
    ownerId,
    favorite: false,
    title: "Private lesson",
    prompt: "Explain limits",
    renderer: "composite",
    createdAt: now,
    updatedAt: now,
    status: "idle",
    stage: "ready",
    versions: [],
    reviews: [],
    assets: [],
    reviewPreferences: { focus: "balanced", strictness: "normal" },
    designPreferences: { fontCategory: "modern", colorPalette: "cinematic" },
    narrationPreferences: { enabled: false },
    generationPreferences: { effort: "quick", model: "gpt-5.6-terra", reasoningEffort: "medium" },
    messages: [],
    actions: [],
  };
}

test("hosted billing verifies webhooks, ignores replays, cancels access, and isolates projects", { skip: !connectionString }, async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = "rkcs_test_placeholder";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration_test";
  const db = new Database(connectionString);
  const ownerId = `test-${randomUUID()}`;
  const otherId = `test-${randomUUID()}`;
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    await db.migrate(path.join(root, "db", "migrations"));
    await db.query(
      "INSERT INTO app_users (id, email, email_verified) VALUES ($1, $2, true), ($3, $4, true)",
      [ownerId, `${ownerId}@example.test`, otherId, `${otherId}@example.test`],
    );

    const repository = new ProjectRepository(db);
    const projectId = randomUUID();
    await repository.save(project(projectId, ownerId), ownerId);
    assert.equal((await repository.list(ownerId)).length, 1);
    assert.equal((await repository.list(otherId)).length, 0);
    assert.equal(await repository.get(projectId, otherId), undefined);
    await assert.rejects(() => repository.save(project(projectId, otherId), otherId), /Project not found/);

    const billing = new HostedBillingService(db);
    assert.equal(billing.billingMode, "test");
    assert.equal((await billing.getState(ownerId)).plan, "free");
    await assert.rejects(() => billing.assertNarration(ownerId), /Creator and Pro/);

    const checkoutPayload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      api_version: "2026-06-30.basil",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          object: "checkout.session",
          client_reference_id: ownerId,
          customer: "cus_integration",
          subscription: "sub_integration",
          payment_status: "paid",
          metadata: { userId: ownerId, plan: "creator" },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: checkoutPayload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const checkoutEvent = billing.constructWebhook(Buffer.from(checkoutPayload), signature);
    await billing.handleWebhook(checkoutEvent);
    await billing.handleWebhook(checkoutEvent);
    const creator = await billing.getState(ownerId);
    assert.equal(creator.plan, "creator");
    assert.equal(creator.creditsRemaining, 10);
    assert.equal(creator.hasStripeCustomer, true);
    await billing.assertNarration(ownerId);
    const events = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM stripe_events WHERE event_id = $1", [checkoutEvent.id]);
    assert.equal(events.rows[0].count, "1");

    await billing.handleWebhook({
      id: `evt_${randomUUID()}`,
      object: "event",
      api_version: "2026-06-30.basil",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_integration",
          object: "subscription",
          customer: "cus_integration",
          status: "canceled",
          metadata: { userId: ownerId, plan: "creator" },
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event);
    const canceled = await billing.getState(ownerId);
    assert.equal(canceled.plan, "free");
    assert.equal(canceled.status, "free");
    await assert.rejects(() => billing.assertNarration(ownerId), /Creator and Pro/);
  } finally {
    await db.query("DELETE FROM app_users WHERE id = ANY($1::text[])", [[ownerId, otherId]]).catch(() => undefined);
    await db.close();
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  }
});
