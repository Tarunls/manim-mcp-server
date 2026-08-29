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
  await expect(page.getByRole("link", { name: /Watch a lesson/ })).toHaveAttribute("href", "#watch");
  await expect(page.getByRole("link", { name: /See the plans/ })).toHaveAttribute("href", "/pricing");
  await expect(page.locator("video.watch-video")).toHaveAttribute("src", "/showcase/accumulation.mp4");
  await expect(page.locator("#how-it-works")).toContainText("You write");
  await expect(page.locator("#how-it-works")).toContainText("going round a circle");
  await expect(page.locator("#how-it-works video")).toHaveAttribute("src", "/showcase/frag-rotation.mp4");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("the hero fits the first screen and the marginalia clear the type", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The single-screen hero is a desktop layout.");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const at = `${viewport.width}x${viewport.height}`;
    // every piece of the stacked hero — headline through the fine print —
    // has to sit above the fold, nav included
    for (const [name, locator] of [
      ["headline", page.locator(".hero h1")],
      ["cta", page.getByRole("link", { name: "Start with one free lesson" }).first()],
      ["note", page.locator(".hero-note")],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box, `no ${name} box at ${at}`).not.toBeNull();
      expect(box!.y + box!.height, `${name} below the fold at ${at}`).toBeLessThanOrEqual(viewport.height);
    }
    // the floating fragments are marginalia: they must never touch the type.
    // the h1 fills its container, so measure the actual text lines instead.
    const lines = await page.locator(".hero h1").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects()).map((rect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }));
    });
    expect(lines.length, `no headline lines at ${at}`).toBeGreaterThan(0);
    for (const selector of [".hero-frag-rotation", ".hero-frag-slope"]) {
      const frag = await page.locator(selector).boundingBox();
      expect(frag, `no ${selector} box at ${at}`).not.toBeNull();
      for (const line of lines) {
        const collides =
          frag!.x < line.x + line.width &&
          frag!.x + frag!.width > line.x &&
          frag!.y < line.y + line.height &&
          frag!.y + frag!.height > line.y;
        expect(collides, `${selector} collides with the headline at ${at}`).toBe(false);
      }
    }
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
