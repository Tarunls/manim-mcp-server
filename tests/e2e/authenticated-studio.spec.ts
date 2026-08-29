import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    violations,
    violations.map((item) => `${item.id}: ${item.description}`).join("\n"),
  ).toEqual([]);
}

test("authenticated users reach a hydrated studio without the auth gate", async ({ page }, testInfo) => {
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
  // The studio bootstraps from the event stream: the server sends a full
  // snapshot as the first SSE message on /api/events.
  const snapshot = JSON.stringify({
    type: "snapshot",
    projects: [],
    auth: { connected: true },
    billing,
    runtime: { codex: true, manim: true, ffmpeg: true },
  });
  await page.route("**/api/events", (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `retry: 60000\ndata: ${snapshot}\n\n`,
  }));

  await page.goto("/studio");
  await expect(page.getByRole("button", { name: /New video/ })).toBeVisible();
  await expect(page.getByText("Creator").first()).toBeVisible();
  await expect(page.getByText("10 credits").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to your studio" })).toHaveCount(0);

  // The empty state is the first thing a new user sees: an invitation plus
  // example prompts that fill the composer. Narrow viewports open on the
  // preview pane, so switch to the chat tab first.
  if (testInfo.project.name !== "desktop")
    await page.locator(".mobile-tabs").getByRole("button", { name: "Chat" }).click();
  const suggestion = page.getByRole("button", { name: "Explain eigenvectors geometrically" });
  await expect(page.getByRole("heading", { name: "Turn an idea into motion." })).toBeVisible();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByLabel("Video prompt")).toHaveValue("Explain eigenvectors geometrically");

  if (testInfo.project.name === "desktop") await expectNoSeriousA11yViolations(page);
});
