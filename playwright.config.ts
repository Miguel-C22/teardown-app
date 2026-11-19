import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5444);
const baseURL = `https://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
    // An empty DATABASE_URL keeps e2e runs on local SQLite even when .env.local points at Neon
    env: { PORT: String(port), VISION_MODE: "mock", DATABASE_URL: "" },
  },
});
