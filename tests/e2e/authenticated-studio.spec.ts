import { expect, test } from "@playwright/test";

const billing = {
  userId: "user-1",
  plan: "creator",
  planName: "Creator",
  status: "active",
  creditsUsed: 0,
  creditsRemaining: 10,
  periodEnd: "2099-01-01T00:00:00.000Z",
  email: "creator@example.test",
  isStaff: false,
  stripeConfigured: true,
  billingMode: "test",
  hasStripeCustomer: true,
  entitlements: {
    creditsPerMonth: 10,
    maxEffort: "balanced",
    narration: true,
    licensedAssets: false,
  },
};

test("authenticated users reach a hydrated studio without the auth gate", async ({ page }) => {
  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      configured: true,
      authenticated: true,
      user: { uid: "user-1", email: "creator@example.test", emailVerified: true, isStaff: false },
    }),
  }));
  await page.route("**/api/pricing", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ plans: [], checkoutEnabled: true }),
  }));
  await page.route("**/api/state", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      type: "snapshot",
      projects: [],
      auth: { connected: true, email: "creator@example.test", mode: "hosted" },
      billing,
      runtime: { codex: true, manim: true, remotion: true, ffmpeg: true },
    }),
  }));
  await page.route("**/api/events", (route) => route.fulfill({ status: 204 }));

  await page.goto("/studio");
  await expect(page.getByRole("button", { name: /New video/ })).toBeVisible();
  await expect(page.getByText("Creator").first()).toBeVisible();
  await expect(page.getByText("10 credits").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to your studio" })).toHaveCount(0);
});
