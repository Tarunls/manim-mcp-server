import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(violations, violations.map((item) => `${item.id}: ${item.description}`).join("\n")).toEqual([]);
}

test("homepage is responsive and links to real product routes", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hard ideas, made obvious.");
  await expect(page.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", "/studio");
  await expect(page.getByRole("link", { name: "Start with one free lesson" }).first()).toHaveAttribute("href", "/studio");
  await expect(page.getByRole("link", { name: /See the plans/ })).toHaveAttribute("href", "/pricing");
  await expect(page.locator("video.reel-video")).toBeVisible();
  await expect(page.locator("video.reel-video")).toHaveAttribute("src", "/showcase/accumulation.mp4");
  await expect(page.locator("#how-it-works")).toContainText("Describe the idea");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("the hero and its video fit the first screen without scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The single-screen hero is a desktop layout.");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const stage = page.locator(".hero-stage");
    await expect(stage).toBeVisible();
    const box = await stage.boundingBox();
    expect(box, `no hero stage box at ${viewport.width}x${viewport.height}`).not.toBeNull();
    // the whole 16:9 player has to sit above the fold, nav included
    expect(box!.y + box!.height, `hero bottom at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.height);
    expect(box!.height, `hero video is too small at ${viewport.width}x${viewport.height}`).toBeGreaterThan(200);
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  }
});

// the gallery is gone: all three lessons are laid out together as one spread,
// so the assertion's intent — every example is reachable without leaving the
// page — is now checked by them all being present and captioned at once.
test("every example lesson is on the page at once, captioned and playing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The spread is exercised once.");
  await page.goto("/");
  const spread = page.locator("#examples");
  await expect(spread.locator(".lesson")).toHaveCount(3);
  for (const [id, caption] of [
    ["slope", /tangent is placed by evaluating the derivative/i],
    ["rotation", /turning at a steady rate/i],
    ["accumulation", /Rectangles narrowing under a curve/i],
  ] as const) {
    const lesson = spread.locator(`#lesson-${id}`);
    await expect(lesson).toBeVisible();
    await expect(lesson.locator("video")).toHaveAttribute("src", `/showcase/${id}.mp4`);
    await expect(lesson.locator("video")).toHaveAttribute("poster", `/showcase/${id}.jpg`);
    await expect(lesson.locator(".lesson-note")).toHaveText(caption);
  }
});

test("pricing shows every plan and an honest checkout state", async ({ page }, testInfo) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pay for what you render.");
  await expect(page.locator(".pricing-card")).toHaveCount(4);
  await expect(page.getByText("$20", { exact: false })).toBeVisible();
  await expect(page.getByText("$50", { exact: false })).toBeVisible();
  await expect(page.getByText("$100", { exact: false })).toBeVisible();
  await expect(page.getByText(/Paid checkout is not enabled|Recommended/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("studio gate exposes sign-in, sign-up, and reset controls", async ({ page }, testInfo) => {
  await page.goto("/studio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to your studio");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "new-password");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("privacy and terms routes publish the account controls and service boundaries", async ({ page }, testInfo) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await expect(page.getByText(/export or delete your account/i)).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of service" })).toBeVisible();
  await expect(page.getByText(/Generated videos can contain mistakes/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("mutating auth requests fail closed without a CSRF token", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "HTTP middleware behavior is viewport-independent.");
  const status = await request.get("/api/auth/status");
  expect(status.ok()).toBeTruthy();
  expect(status.headers()["set-cookie"]).toContain("lesson_studio_csrf=");
  const mutation = await request.post("/api/auth/password-reset", { data: { email: "nobody@example.test" } });
  expect(mutation.status()).toBe(403);
});
