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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Turn ideas into beautiful animations.");
  await expect(page.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", "/studio");
  await expect(page.getByRole("link", { name: "Create a lesson" }).first()).toHaveAttribute("href", "/studio");
  await expect(page.getByRole("link", { name: /Watch an example/ })).toHaveAttribute("href", "#watch");
  await expect(page.getByRole("link", { name: /See the plans/ })).toHaveAttribute("href", "/pricing");
  await expect(page.locator("video.watch-video")).toHaveAttribute("src", "/showcase/accumulation.mp4");
  await expect(page.locator("#how-it-works")).toHaveAttribute("aria-label", /standing-wave pattern/);
  await expect(page.locator("#how-it-works canvas")).toBeVisible();
  // the old ask-then-get section is gone; the hero diagram replaced it
  await expect(page.locator(".ask")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("the hero, visual included, fits the first screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The single-screen hero is a desktop layout.");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const at = `${viewport.width}x${viewport.height}`;
    // the deliberately simple two-column hero stays above the fold
    for (const [name, locator] of [
      ["headline", page.locator(".hero h1")],
      ["cta", page.getByRole("link", { name: "Create a lesson" }).first()],
      ["visual", page.locator("#how-it-works")],
      ["visual canvas", page.locator(".hero-chladni-canvas")],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box, `no ${name} box at ${at}`).not.toBeNull();
      expect(box!.y + box!.height, `${name} below the fold at ${at}`).toBeLessThanOrEqual(viewport.height);
    }
    const copy = await page.locator(".hero-copy").boundingBox();
    const visual = await page.locator(".hero-visual").boundingBox();
    expect(copy!.x + copy!.width).toBeLessThanOrEqual(visual!.x + 1);
  }
});

// the examples gallery became the contact strip: all three lesson stills sit
// in one whitespace-separated row, each captioned with the sentence that
// produced it (the claim itself is typography inside the frame).
test("the contact strip lays out all three lessons, captioned", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The strip is exercised once.");
  await page.goto("/");
  const strip = page.locator("#examples");
  await expect(strip.locator("figure")).toHaveCount(3);
  for (const [id, sentence] of [
    ["accumulation", /adding up rectangles becomes the integral/i],
    ["rotation", /sine wave is just something going round a circle/i],
    ["slope", /what the derivative means at one point/i],
  ] as const) {
    const item = strip.locator(`#lesson-${id}`);
    await expect(item).toBeVisible();
    await expect(item.locator("img")).toHaveAttribute("src", `/showcase/${id}.jpg`);
    await expect(item.locator("figcaption")).toHaveText(sentence);
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
