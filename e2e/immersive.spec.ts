import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Immersive globe & virtual museum browser verification (pinakes:100 US-3).
 *
 * `/immersive` is the one surface whose behaviour is decided by **the browser
 * itself**: `useImmersiveSupport` probes for a real WebGL2 context and for
 * WebXR, and `selectSceneMode` degrades a requested-but-unavailable mode. No
 * unit test can answer what a real headless Chromium supports, so the spec reads
 * the capability badge the page renders and branches on it — exactly the
 * discipline `support/graph-state.ts` uses for the graph, and for the same
 * reason: "the globe rendered" and "the globe degraded to the flat map" are
 * mutually exclusive claims about the same DOM.
 *
 * **WebXR is excluded, deliberately.** Entering an `immersive-vr` session needs a
 * headset (or a WebXR emulator extension); headless Chromium exposes no
 * `navigator.xr`, so `hasImmersiveVr` is false here and the "Headset ready"
 * affordance is unreachable. Its decision logic is unit-covered against an
 * injected environment (`web/src/lib/immersive/scenes.test.ts` —
 * `detectImmersiveSupport`), which is the right level for it.
 */

/** The three states `useImmersiveSupport` can put the header badge in. */
type Capability = "VR-capable" | "On-screen 3D" | "Flat map only";

async function capability(page: Page): Promise<Capability> {
  for (const badge of ["VR-capable", "On-screen 3D", "Flat map only"] as const) {
    if (await page.getByText(badge, { exact: true }).count()) return badge;
  }
  throw new Error("the immersive page rendered no capability badge");
}

/** `true` when the browser can draw the 3D scenes (globe + museum). */
function canRender3d(badge: Capability): boolean {
  return badge !== "Flat map only";
}

interface MaterialItem {
  id: string;
  name: string;
  originCoordinates?: [number, number];
  modelUrl?: string | null;
  modelLicense?: string | null;
}

interface MuseumProbe {
  /** Every artifact the gallery counter should report. */
  total: number;
  /** The first 24 the grid draws, in the component's sort order. */
  shown: string[];
  renderableModels: number;
}

/** Mirrors `selectMuseumArtifacts` + the page's coordinate filter and `slice(0, 24)`. */
async function realMuseum(request: APIRequestContext): Promise<MuseumProbe> {
  const res = await request.get("/api/material-culture");
  expect(res.ok(), "/api/material-culture should answer 200").toBeTruthy();
  const items = ((await res.json()) as { items?: MaterialItem[] }).items ?? [];
  expect(
    items.length,
    "a populated corpus should serve material culture",
  ).toBeGreaterThan(0);

  const artifacts = items
    .filter((it) => typeof it.id === "string" && typeof it.name === "string")
    .map((it) => ({
      id: it.id,
      name: it.name,
      hasModel: Boolean(it.modelUrl) && isPublicDomain(it.modelLicense),
      hasCoordinates:
        Array.isArray(it.originCoordinates) &&
        typeof it.originCoordinates[0] === "number" &&
        typeof it.originCoordinates[1] === "number",
    }))
    .sort((a, b) => {
      if (a.hasModel !== b.hasModel) return a.hasModel ? -1 : 1;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    })
    .slice(0, 48) // DEFAULT_MAX_ARTIFACTS
    .filter((a) => a.hasCoordinates);

  expect(
    artifacts.length,
    "the museum should have artifacts to place",
  ).toBeGreaterThan(0);
  return {
    total: artifacts.length,
    shown: artifacts.slice(0, 24).map((a) => a.name),
    renderableModels: artifacts.filter((a) => a.hasModel).length,
  };
}

/** `isPublicDomainLicense` in web/src/lib/immersive/scenes.ts. */
function isPublicDomain(license: string | null | undefined): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  if (/\bnc\b|non-?commercial|no-?deriv|\bnd\b|all rights reserved|copyright/.test(l)) {
    return false;
  }
  return (
    /\bcc0\b/.test(l) ||
    /public[\s-]?domain/.test(l) ||
    /\bpd\b/.test(l) ||
    /cc[\s-]?by(?![\s-]?(nc|nd))/.test(l)
  );
}

/** Names of the migration routes a fly-through can follow. */
async function realRouteNames(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/map/routes");
  expect(res.ok(), "/api/map/routes should answer 200").toBeTruthy();
  const features = ((await res.json()) as {
    features?: {
      geometry?: { type?: string; coordinates?: unknown[] };
      properties?: { name?: string };
    }[];
  }).features ?? [];
  const names = features
    .filter(
      (f) =>
        f.geometry?.type === "LineString" && (f.geometry.coordinates?.length ?? 0) >= 2,
    )
    .map((f) => f.properties?.name)
    .filter((n): n is string => typeof n === "string");
  expect(
    names.length,
    "a populated corpus should serve migration routes for the fly-through",
  ).toBeGreaterThan(0);
  return names;
}

test.describe("immersive globe & virtual museum", () => {
  test("the scene offers exactly the modes this browser can draw", async ({ page }) => {
    await page.goto("/immersive");
    await expect(page.getByTestId("immersive-page")).toBeVisible();
    const badge = await capability(page);

    // The flat map is always offered — it is the degradation target.
    await expect(page.getByTestId("mode-flat")).toBeEnabled();

    if (canRender3d(badge)) {
      await expect(page.getByTestId("mode-globe")).toBeEnabled();
      await expect(page.getByTestId("mode-museum")).toBeEnabled();
      // The page opens on the globe when it can.
      await expect(page.getByTestId("mode-globe")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(/needs a 3D-capable/)).toHaveCount(0);
    } else {
      // Without WebGL2 the two 3D modes are disabled AND the requested globe is
      // degraded to the flat map, with the reason on screen.
      await expect(page.getByTestId("mode-globe")).toBeDisabled();
      await expect(page.getByTestId("mode-museum")).toBeDisabled();
      await expect(page.getByTestId("mode-flat")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(/needs a 3D-capable \(WebGL2\) browser/)).toBeVisible();
    }
  });

  test("the gallery lists the corpus' real artifacts", async ({ page, request }) => {
    const probe = await realMuseum(request);
    await page.goto("/immersive");
    const badge = await capability(page);
    test.skip(!canRender3d(badge), "the museum needs WebGL2; this browser has none");

    await page.getByTestId("mode-museum").click();
    await expect(page.getByTestId("artifact-grid")).toBeVisible();

    // The counter is the FULL selection; the grid draws the first 24 of it.
    await expect(
      page.getByText(`${probe.total} artifact${probe.total === 1 ? "" : "s"} ·`),
    ).toBeVisible();
    await expect(
      page.getByText(
        probe.renderableModels > 0
          ? `${probe.renderableModels} with public-domain 3D models`
          : "no public-domain 3D models yet — showing placeholder pedestals",
      ),
    ).toBeVisible();

    const tiles = page.getByTestId("artifact-grid").getByRole("button");
    await expect(tiles).toHaveCount(probe.shown.length);
    for (const name of probe.shown.slice(0, 6)) {
      await expect(
        page.getByTestId("artifact-grid").getByText(name, { exact: true }),
      ).toBeVisible();
    }

    // Selecting one opens its provenance card — a real artifact, named.
    const first = probe.shown[0];
    await page.getByTestId("artifact-grid").getByText(first, { exact: true }).click();
    const detail = page.locator("div.rounded-md.border").filter({ hasText: first }).first();
    await expect(detail).toBeVisible();
    // Every artifact declares whether it is a real model or a pedestal.
    await expect(detail.getByText(/^(3D model|placeholder)$/)).toBeVisible();
  });

  test("the globe flies through real migration routes", async ({ page, request }) => {
    const routeNames = await realRouteNames(request);
    await page.goto("/immersive");
    const badge = await capability(page);
    test.skip(!canRender3d(badge), "the fly-through needs WebGL2; this browser has none");

    await page.getByTestId("mode-globe").click();
    const flyThrough = page.getByTestId("flythrough-toggle");
    // The control only exists when `buildFlyThroughPath` found keyframes, i.e.
    // when the corpus really has traversable LineString routes.
    await expect(flyThrough).toBeVisible();
    await expect(flyThrough).toHaveText(/Fly through migrations/);

    await flyThrough.click();
    await expect(flyThrough).toHaveText(/Pause fly-through/);

    // The overlay labels the keyframe with the route it is following — which has
    // to be one of the corpus' own migration routes.
    const overlay = page.locator("div.absolute.bottom-3.left-3");
    await expect(overlay).toBeVisible();
    const label = ((await overlay.textContent()) ?? "").trim();
    expect(
      routeNames.some((name) => label.startsWith(name)),
      `fly-through label "${label}" should name a corpus migration route`,
    ).toBeTruthy();

    await flyThrough.click();
    await expect(flyThrough).toHaveText(/Fly through migrations/);
  });

  test("switching to the flat map keeps the scene mounted", async ({ page }) => {
    await page.goto("/immersive");
    const badge = await capability(page);
    test.skip(!canRender3d(badge), "there is nothing to switch away FROM without WebGL2");

    await page.getByTestId("mode-flat").click();
    await expect(page.getByTestId("mode-flat")).toHaveAttribute("aria-selected", "true");
    // No degrade notice: the flat map was chosen, not fallen back to.
    await expect(page.getByText(/needs a 3D-capable/)).toHaveCount(0);
    await expect(page.getByTestId("flythrough-toggle")).toHaveCount(0);
    await expect(page.getByTestId("artifact-grid")).toHaveCount(0);
  });
});
