import { test, expect, type Page } from "@playwright/test";

/**
 * Data-population pilot verification e2e (US-005).
 *
 * Confirms the expanded civilizations corpus (89 → 170, incl. the 81
 * Wikidata-acquired write-back rows) is actually usable in the running app:
 *
 *   1. MAP — the civilizations layer loads the full corpus from
 *      `/api/map/civilizations` and mounts on the Leaflet map.
 *   2. EXPLORER — the new `civilizations` DatasetAdapter projects the corpus in
 *      the UnifiedExplorer (a live item count + a known acquired civ visible).
 *   3. DETAIL + PROVENANCE — selecting an acquired civ opens the detail panel
 *      with a `<ProvenanceList>` showing its Wikidata source URL + confidence.
 *   4. EMPTY STATE — a no-match search still behaves (0 items, no crash).
 *
 * All of this is TSV-backed (`lexicons/civilizations.tsv`) and needs no shared
 * graph — it runs the same locally and in CI against `npm run dev`.
 *
 * Selectors prefer stable `data-testid`s + accessible names over CSS.
 */

const SHOTS = "test-results/civilizations";

// A civilization added by the US-003 Wikidata write-back — it carries the full
// provenance quartet (qid / source_url / retrieved_at / confidence).
const ACQUIRED_CIV = "Ancient Crete";
const ACQUIRED_QID = "Q4752820";

/** Open the UnifiedExplorer on the civilizations dataset in Table mode. */
async function openCivilizationsExplorer(page: Page) {
  // `panel=explore` mounts UnifiedExplorer; `ds=civilizations` selects the new
  // adapter; `viz=explorer` picks the Table visualization (clickable rows).
  await page.goto("/?panel=explore&ds=civilizations&viz=explorer");
  // The dataset resolved once a non-zero item count renders (client → Express →
  // TSV path worked end to end).
  await expect(page.getByText(/\d+ items/)).toBeVisible();
}

test.describe("expanded civilizations render in the running app", () => {
  test("the civilizations layer loads the full corpus onto the map", async ({
    page,
  }) => {
    // `layers=civilizations` presets the (otherwise off-by-default) civilizations
    // layer visible on load, so its `/api/map/civilizations` query fires.
    const civResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/map/civilizations") && r.status() === 200,
    );
    await page.goto("/?view=map&layers=civilizations");

    // The Leaflet container mounts even when tiles fail (no network in CI).
    await expect(page.locator(".leaflet-container")).toBeVisible();

    const res = await civResponse;
    const body = await res.json();
    const features = body.features ?? [];
    // The expanded corpus (target 150+, live 170) came back, and the
    // Wikidata-acquired rows carry provenance.
    expect(features.length).toBeGreaterThanOrEqual(150);
    const withProvenance = features.filter(
      (f: { properties?: { wikidataQid?: string } }) =>
        f.properties?.wikidataQid,
    );
    expect(withProvenance.length).toBeGreaterThan(0);

    await page.screenshot({ path: `${SHOTS}/map-civilizations.png` });
  });

  test("the UnifiedExplorer projects the civilizations dataset", async ({
    page,
  }) => {
    await openCivilizationsExplorer(page);
    // Narrow to the acquired civ via the dataset search box so it's on screen
    // regardless of default sort order.
    await page.getByPlaceholder(/^Search civilizations…$/).fill(ACQUIRED_CIV);
    await expect(page.getByText("1 items")).toBeVisible();
    await expect(page.getByText(ACQUIRED_CIV, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/explorer-civilizations.png` });
  });

  test("an acquired civilization's detail panel shows Wikidata provenance", async ({
    page,
  }) => {
    await openCivilizationsExplorer(page);
    await page.getByPlaceholder(/^Search civilizations…$/).fill(ACQUIRED_CIV);
    // Dispatch the click straight to the row's onSelect handler — the row sits
    // in the table's own scroll container and can be overlaid by the sticky
    // filter toolbar, which defeats a coordinate-based click.
    const row = page.getByRole("row", { name: new RegExp(ACQUIRED_CIV) });
    await expect(row).toBeAttached();
    await row.dispatchEvent("click");

    // The detail panel renders the provenance breakdown for a sourced fact.
    const provenance = page.getByTestId("provenance-list");
    await expect(provenance).toBeVisible();
    const kind = page.getByTestId("provenance-kind").first();
    await expect(kind).toHaveAttribute("data-kind", "sourced");
    // The source link points at the canonical Wikidata entity URL.
    const link = page.getByTestId("provenance-source-link");
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`wikidata\\.org/entity/${ACQUIRED_QID}`),
    );
    // The Wikidata QID is surfaced as a detail field too.
    await expect(page.getByText(ACQUIRED_QID).first()).toBeVisible();

    // Artifact for the record. The provenance is asserted above via the DOM
    // (visible list + Wikidata source link + QID field) — the source of truth;
    // the screenshot is a supporting snapshot of the civ-selected explorer.
    await page.screenshot({ path: `${SHOTS}/detail-provenance.png` });
  });

  test("a no-match search degrades to an empty explorer, not a crash", async ({
    page,
  }) => {
    await openCivilizationsExplorer(page);
    await page
      .getByPlaceholder(/^Search civilizations…$/)
      .fill("zzz-no-such-civilization");
    await expect(page.getByText("0 items")).toBeVisible();
    // The Table visualization renders its empty affordance (present in the DOM)
    // rather than erroring — the search box stays usable, no crash.
    await expect(page.getByText(/no rows to render/i)).toBeAttached();
    await expect(
      page.getByPlaceholder(/^Search civilizations…$/),
    ).toBeVisible();
  });
});
