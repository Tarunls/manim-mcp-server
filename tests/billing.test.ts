import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingService } from "../server/billing-service.js";

function temporaryStudio() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lesson-studio-billing-"));
}

test("free credits are enforced and can be refunded after a failed start", () => {
  const root = temporaryStudio();
  try {
    const billing = new BillingService(root);
    assert.equal(billing.getState("user-1").creditsRemaining, 1);
    assert.equal(billing.reserveGeneration("user-1", "quick"), 1);
    assert.equal(billing.getState("user-1").creditsRemaining, 0);
    assert.throws(() => billing.reserveGeneration("user-1", "quick"), /generation credit/);
    billing.refundGeneration("user-1", 1);
    assert.equal(billing.getState("user-1").creditsRemaining, 1);
    assert.throws(() => billing.reserveGeneration("user-1", "balanced"), /higher plan/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("signed-event handling provisions and removes a paid plan", () => {
  const root = temporaryStudio();
  try {
    const billing = new BillingService(root);
    billing.handleWebhook({
      type: "checkout.session.completed",
      data: { object: { metadata: { userId: "user-2", plan: "creator" }, client_reference_id: "user-2", customer: "cus_test", subscription: "sub_test", customer_details: { email: "teacher@example.com" } } },
    } as never);
    assert.equal(billing.getState("user-2").plan, "creator");
    assert.equal(billing.getState("user-2").creditsRemaining, 10);

    billing.handleWebhook({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_test", customer: "cus_test", status: "canceled", metadata: { userId: "user-2", plan: "creator" }, items: { data: [] } } },
    } as never);
    assert.equal(billing.getState("user-2").plan, "free");
    assert.equal(billing.getState("user-2").creditsRemaining, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
