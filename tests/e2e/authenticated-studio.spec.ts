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

const projectDefaults = {
  ownerId: "user-1",
  favorite: false,
  renderer: "manim",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:05:00.000Z",
  versions: [],
  assets: [],
  reviewPreferences: { focus: "balanced", strictness: "normal" },
  designPreferences: { fontCategory: "serif", colorPalette: "paper" },
  narrationPreferences: { enabled: true, voice: "default-female" },
  generationPreferences: { effort: "balanced" },
  messages: [],
  actions: [],
};

const longActionLabel =
  "Step 3 of 5 - write the scene beats for the accumulation argument, keeping the running-total bar chart in sync with the narration script";

const runningProject = {
  ...projectDefaults,
  id: "project-running",
  title: "Accumulation, visually",
  prompt: "Why integration is accumulation",
  status: "running",
  stage: "authoring",
  threadId: "thread-1",
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Why integration is accumulation",
      createdAt: "2026-08-29T10:00:00.000Z",
    },
  ],
  actions: [
    {
      id: "a1",
      label: "Workspace ready - the agent is planning the lesson",
      status: "done",
      createdAt: "2026-08-29T10:00:10.000Z",
    },
    {
      id: "a2",
      label: "Step 2 of 5 - outline the lesson plan",
      status: "done",
      createdAt: "2026-08-29T10:01:20.000Z",
    },
    {
      id: "a3",
      label: longActionLabel,
      status: "done",
      createdAt: "2026-08-29T10:02:45.000Z",
    },
    {
      id: "a4",
      label: "Rendering the video with Manim",
      status: "done",
      createdAt: "2026-08-29T10:04:05.000Z",
    },
  ],
};

const completeProject = {
  ...projectDefaults,
  id: "project-complete",
  title: "Eigenvectors, geometrically",
  prompt: "Explain eigenvectors geometrically",
  status: "complete",
  stage: "complete",
  threadId: "thread-2",
  videoUrl: "/showcase/accumulation.mp4",
  posterUrl: "/showcase/accumulation.jpg",
  versions: [
    {
      id: "v1",
      number: 1,
      createdAt: "2026-08-29T09:00:00.000Z",
      prompt: "Explain eigenvectors geometrically",
      videoUrl: "/showcase/accumulation.mp4",
      posterUrl: "/showcase/accumulation.jpg",
      render: { renderer: "manim", duration: 12, width: 1920, height: 1080, fps: 30 },
    },
  ],
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Explain eigenvectors geometrically",
      createdAt: "2026-08-29T09:00:00.000Z",
    },
    {
      id: "m2",
      role: "assistant",
      text: "The lesson is rendered.",
      createdAt: "2026-08-29T09:05:00.000Z",
    },
  ],
};

async function mockStudio(page: Page, projects: unknown[]) {
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
  const snapshot = JSON.stringify({
    type: "snapshot",
    projects,
    auth: { connected: true },
    billing,
    runtime: { codex: true, manim: true, ffmpeg: true },
  });
  await page.route("**/api/events", (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `retry: 60000\ndata: ${snapshot}\n\n`,
  }));
}

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
  // The studio bootstraps from the event stream: the server sends a full
  // snapshot as the first SSE message on /api/events.
  await mockStudio(page, []);

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

test("a running generation shows a living, unclipped activity feed", async ({ page }, testInfo) => {
  await mockStudio(page, [runningProject]);
  await page.goto("/studio");

  if (testInfo.project.name !== "desktop")
    await page.locator(".mobile-tabs").getByRole("button", { name: "Chat" }).click();

  // Every action label renders in full - including the very long one - with
  // nothing hidden behind an ellipsis.
  const rows = page.locator(".action-row");
  await expect(rows).toHaveCount(4);
  await expect(page.getByText("Workspace ready - the agent is planning the lesson")).toBeVisible();
  await expect(page.getByText("Outline the lesson plan")).toBeVisible();
  await expect(page.getByText(/keeping the running-total bar chart in sync/)).toBeVisible();
  await expect(page.getByText("Rendering the video with Manim")).toBeVisible();
  const clipped = await page.locator(".action-label").evaluateAll((labels) =>
    labels.filter((label) => label.scrollWidth > label.clientWidth + 1).length,
  );
  expect(clipped).toBe(0);

  // The "Step N of M" prefix becomes a small chip and the newest row carries
  // the pulsing working indicator so the feed always looks alive.
  await expect(page.locator(".action-chip").first()).toHaveText(/Step 2\/5/);
  await expect(page.locator(".action-row[data-working] .working-dot")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    // The working block holds the center of the stage and the stage progress
    // reflects project.stage (authoring → "Draw" is the active step).
    const renderState = page.locator(".render-state");
    await expect(renderState).toBeVisible();
    await expect(page.locator(".progress-active")).toHaveText("Draw");
    const stage = await page.locator(".player-shell").boundingBox();
    const heading = await renderState.locator("h2").boundingBox();
    expect(stage && heading).toBeTruthy();
    if (stage && heading) {
      const stageCenter = stage.y + stage.height / 2;
      const headingCenter = heading.y + heading.height / 2;
      expect(Math.abs(stageCenter - headingCenter)).toBeLessThan(stage.height * 0.2);
    }
    await expectNoSeriousA11yViolations(page);
  }
});

test("the generation intent menu opens, explains, and applies a choice", async ({ page }, testInfo) => {
  await mockStudio(page, [completeProject]);
  await page.goto("/studio");

  if (testInfo.project.name !== "desktop")
    await page.locator(".mobile-tabs").getByRole("button", { name: "Chat" }).click();

  const trigger = page.getByRole("button", { name: /Next prompt: Smart choice/ });
  await expect(trigger).toBeEnabled();
  await trigger.click();

  const menu = page.getByRole("menu", { name: "How to apply the next prompt" });
  await expect(menu).toBeVisible();
  const editOption = page.getByRole("menuitemradio", { name: /Edit this video/ });
  await expect(editOption).toBeVisible();
  await expect(editOption).toContainText("Changes this video and preserves everything else.");
  if (testInfo.project.name === "desktop") await expectNoSeriousA11yViolations(page);

  await editOption.click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Next prompt: Edit this video/ })).toBeVisible();
  // The one-line description persists under the composer while not on auto.
  await expect(page.locator(".composer-hint")).toHaveText(
    "Changes this video and preserves everything else.",
  );
});

test("voice settings expose every supported performance", async ({ page }, testInfo) => {
  await mockStudio(page, [completeProject]);
  await page.goto("/studio");
  if (testInfo.project.name !== "desktop")
    await page.locator(".mobile-tabs").getByRole("button", { name: "Chat" }).click();
  await page.getByText("Creative controls", { exact: true }).click();

  const voice = page.getByLabel("AI voice");
  await expect(voice).toHaveValue("default-female");
  await expect(voice.locator("option")).toHaveText([
    "Default female",
    "Seductive female",
    "Seductive male",
    "Seductive female · accent",
    "Off · silent video",
  ]);
  await expect(page.getByText("Fast short-form delivery · long pauses reduced")).toBeVisible();
});
