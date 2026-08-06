import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright e2e smoke config (US-006).
 *
 * The smoke builds the client and boots the real Pinakes service (`npm run build`
 * then `npm start` — one Python process, TSV-backed, no external services
 * required) and drives it in a headless Chromium. The shared graph
 * (Neo4j + pinakes-engine sidecar) is treated as OPTIONAL: when it is down the
 * graph-dependent UI degrades via `GraphFeatureGate` and the smoke asserts that
 * degraded affordance instead of requiring a live graph. So the suite runs the
 * same locally and in CI with nothing but the app itself up.
 *
 * Run: `npm run test:e2e` (add `--headed`/`--ui` locally to watch it).
 */

// Keep in sync with `services/api/src/pinakes/__main__.py` (defaults to 3050). A
// separate port avoids colliding with a service the contributor already has up.
const PORT = Number(process.env.E2E_PORT ?? 3055);
const BASE_URL = `http://localhost:${PORT}`;

// This config lives in `web/` (20-repo-restructure US-2) while the specs and the
// artifact directories stay at the repo root, so every path here is
// `../`-relative. Playwright resolves them against the config's directory.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "../e2e",
  outputDir: "../test-results",
  // `*.spec.ts` here; vitest owns `*.test.ts` (vitest.config.ts include), so the
  // two runners never pick up each other's files.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : "list",
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
    // The service serves the BUILT client (`dist/public`), so the build is part
    // of booting it — there is no dev-middleware path any more (80-cutover US-2).
    command: "npm run build && npm start",
    // Defaults to the config's directory (`web/`); package.json is at the repo
    // root, and so is the `dist/public` the build writes.
    cwd: REPO_ROOT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
