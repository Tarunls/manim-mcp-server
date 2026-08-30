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
  // the how-it-works diagram lives in the hero now: sentence, arrow, render
  await expect(page.locator("#how-it-works")).toContainText("you write");
  await expect(page.locator("#how-it-works")).toContainText("going round a circle");
  await expect(page.locator("#how-it-works")).toContainText(/Orune renders it/);
  await expect(page.locator("#how-it-works video")).toHaveAttribute("src", "/showcase/epicycles.mp4");
  // the old ask-then-get section is gone; the hero diagram replaced it
  await expect(page.locator(".ask")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("the hero, diagram included, fits the first screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The single-screen hero is a desktop layout.");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const at = `${viewport.width}x${viewport.height}`;
    // every piece of the hero — headline through the product diagram —
    // has to sit above the fold, nav included
    for (const [name, locator] of [
      ["headline", page.locator(".hero h1")],
      ["cta", page.getByRole("link", { name: "Start with one free lesson" }).first()],
      ["note", page.locator(".hero-note")],
      ["diagram quote", page.locator(".hero-diagram-quote")],
      ["diagram arrow", page.locator(".hero-diagram-arrow")],
      ["diagram video", page.locator(".hero-diagram-video")],
      ["diagram", page.locator("#how-it-works")],
      ["diagram caption", page.locator(".hero-diagram-render .hero-diagram-caption")],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box, `no ${name} box at ${at}`).not.toBeNull();
      expect(box!.y + box!.height, `${name} below the fold at ${at}`).toBeLessThanOrEqual(viewport.height);
    }
    // the diagram reads left to right: sentence, then arrow, then render
    const quote = await page.locator(".hero-diagram-quote").boundingBox();
    const arrow = await page.locator(".hero-diagram-arrow").boundingBox();
    const video = await page.locator(".hero-diagram-video").boundingBox();
    expect(quote!.x + quote!.width).toBeLessThanOrEqual(arrow!.x + 1);
    expect(arrow!.x + arrow!.width).toBeLessThanOrEqual(video!.x + 1);
  }
});

// the pen swoosh sits beneath "obvious." and must never enter the words
// around it — measured against the tight per-line rects of the word "made"
test("the pen stroke never touches the word ‘made’", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The pen underline is sized by the desktop headline.");
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 1080 });
    await page.goto("/");
    const at = `${width}px`;
    const pen = await page.locator(".hero .pen-swoosh").boundingBox();
    expect(pen, `no pen box at ${at}`).not.toBeNull();
    const madeRects = await page.locator(".hero h1").evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent?.indexOf("made") ?? -1;
        if (index === -1) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + "made".length);
        return Array.from(range.getClientRects()).map((rect) => ({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }));
      }
      return [];
    });
    expect(madeRects.length, `no rects for "made" at ${at}`).toBeGreaterThan(0);
    for (const rect of madeRects) {
      const intersects =
        pen!.x < rect.x + rect.width &&
        pen!.x + pen!.width > rect.x &&
        pen!.y < rect.y + rect.height &&
        pen!.y + pen!.height > rect.y;
      expect(intersects, `the pen stroke enters "made" at ${at}`).toBe(false);
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
