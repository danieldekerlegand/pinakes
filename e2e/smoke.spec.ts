import { test, expect, type Page } from "@playwright/test";

/**
 * Core-flow e2e smoke (US-006).
 *
 * Exercises the three things the roadmap cares about surviving a refactor:
 *   1. the app boots and the dashboard shell renders,
 *   2. the Leaflet MAP view mounts,
 *   3. the UnifiedExplorer (adapter-driven dataset explorer) loads data,
 *   4. a GRAPH feature opens and degrades gracefully when the shared graph is
 *      down (the graph is optional — see playwright.config.ts).
 *
 * Selectors prefer stable `data-testid`s and accessible names over CSS so the
 * smoke tracks behavior, not styling.
 */

// The primary sidebar nav ("Visualizations"/"Data"/… buttons live here).
function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("core flows smoke", () => {
  test("dashboard shell loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("text-app-title")).toBeVisible();
    // The primary navigation is the app's backbone — if it renders, the React
    // tree mounted without a fatal error.
    await expect(primaryNav(page)).toBeVisible();
  });

  test("map view mounts a Leaflet canvas", async ({ page }) => {
    await page.goto("/");
    // Sidebar "Map" view button (exact, so it doesn't match "3D Map").
    await primaryNav(page).getByRole("button", { name: "Map", exact: true }).click();
    // The Leaflet container is added to the DOM even when tile requests fail
    // (e.g. no network in CI) — we assert the map mounted, not that tiles drew.
    await expect(page.locator(".leaflet-container")).toBeVisible();
  });

  test("UnifiedExplorer loads a dataset", async ({ page }) => {
    await page.goto("/");
    // "Explore" lives under the sidebar "Data" group and mounts UnifiedExplorer.
    await primaryNav(page).getByRole("button", { name: "Explore", exact: true }).click();
    // The explorer's free-text search input is always present once mounted.
    const search = page.getByPlaceholder(/^Search .*…$/);
    await expect(search).toBeVisible();
    // …and it renders a NON-ZERO item count once the dataset endpoint resolves,
    // proving the client → service → TSV corpus path works end to end. `\d+`
    // would also pass on an empty corpus, which is the failure this is for.
    await expect(page.getByText(/[1-9]\d* items/)).toBeVisible();
  });

  test("the graph affordance renders in whichever state the graph is in", async ({
    page,
  }) => {
    await page.goto("/advanced-tools");
    await expect(page.getByTestId("advanced-tools-page")).toBeVisible();
    // The console's query editors always render.
    await expect(page.getByTestId("console-editor-datalog")).toBeVisible();

    // The "Run" trigger is wrapped in a GraphFeatureGate(backend="sidecar").
    // With the graph up the button is live; with it down the gate renders a
    // disabled, tooltip-explained affordance. Either is a valid SMOKE outcome —
    // what matters here is only that the page opened without crashing and the
    // affordance is present in one of its two states. Which state it *should*
    // be in, and that the live control really answers, is asserted properly in
    // graph-ui.spec.ts, which branches on the probe in support/graph-state.ts.
    const runButton = page.getByTestId("console-run-datalog");
    const disabledGate = page.getByTestId("graph-feature-gate-disabled");
    await expect(runButton.or(disabledGate).first()).toBeVisible();
  });
});
