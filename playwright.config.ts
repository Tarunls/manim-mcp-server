import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT || "4321";
const baseURL = `http://127.0.0.1:${port}`;
const temporaryDirectory =
  process.platform === "win32"
    ? process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp"
    : "/tmp";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: "npm run start",
    url: `${baseURL}/api/health`,
    env: {
      PORT: port,
      TMPDIR: temporaryDirectory,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
    },
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
