import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Database } from "../server/database.js";
import { HostedBillingService } from "../server/hosted-billing-service.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim())
    throw new Error("DATABASE_URL is required for the Stripe smoke test.");
  if (!process.env.STRIPE_SECRET_KEY?.trim())
    throw new Error("STRIPE_SECRET_KEY is required for the Stripe smoke test.");
  if (process.env.ALLOW_TEST_CHECKOUT !== "true")
    throw new Error(
      "ALLOW_TEST_CHECKOUT=true is required for this sandbox-only smoke test.",
    );

  const db = new Database(process.env.DATABASE_URL);
  const userId = `smoke-${randomUUID()}`;
  try {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    await db.migrate(path.join(root, "db", "migrations"));
    await db.query(
      "INSERT INTO app_users (id, email, email_verified) VALUES ($1, $2, true)",
      [userId, `${userId}@example.test`],
    );
    const billing = new HostedBillingService(db);
    assert.equal(billing.billingMode, "test");
    const checkoutUrl = await billing.createCheckout(
      userId,
      "creator",
      `${userId}@example.test`,
      "https://studio.example.test",
    );
    const url = new URL(checkoutUrl);
    assert.equal(url.protocol, "https:");
    assert.match(url.hostname, /(^|\.)stripe\.com$/);
    assert.equal(
      (await billing.getState(userId)).plan,
      "free",
      "Checkout creation must not grant access before a signed webhook.",
    );
    console.log(
      "Stripe sandbox price lookup and hosted Checkout session creation passed.",
    );
  } finally {
    await db
      .query("DELETE FROM app_users WHERE id = $1", [userId])
      .catch(() => undefined);
    await db.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.split("\n", 1)[0]
      : "Unknown provider error";
  console.error(`Stripe smoke failed: ${message.slice(0, 500)}`);
  process.exitCode = 1;
});
