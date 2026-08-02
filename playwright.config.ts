import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e smoke config (US-006).
 *
 * The smoke boots the real dev server (`npm run dev`, TSV-backed, no external
 * services required) and drives the app in a headless Chromium. The shared graph
 * (Neo4j + pinakes-engine sidecar) is treated as OPTIONAL: when it is down the
 * graph-dependent UI degrades via `GraphFeatureGate` and the smoke asserts that
 * degraded affordance instead of requiring a live graph. So the suite runs the
 * same locally and in CI with nothing but the app itself up.
 *
 * Run: `npm run test:e2e` (add `--headed`/`--ui` locally to watch it).
 */

// Keep in sync with server/index.ts (defaults to 3050). A separate port avoids
// colliding with a dev server the contributor may already have running.
const PORT = Number(process.env.E2E_PORT ?? 3055);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // `*.spec.ts` here; vitest owns `*.test.ts` (vitest.config.ts include), so the
  // two runners never pick up each other's files.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "development",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
