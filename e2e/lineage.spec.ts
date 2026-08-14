import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Cultural-lineage explorer + DNA ancestry mapper browser verification
 * (pinakes:100 US-3).
 *
 * Two ancestry-shaped surfaces that had no browser coverage:
 *
 *  - **`CulturalLineageExplorer`** (`/?view=lineage`) — the d3 force graph of
 *    `cultural-lineages.tsv`. Everything asserted here is derived from
 *    `/api/cultural-lineages` first, so the counts track the corpus instead of
 *    pinning numbers a TSV edit moves.
 *  - **`/ancestry`** — the DNA-to-culture mapper. The raw file is parsed IN THE
 *    BROWSER (`web/src/lib/dna`) and only the haplogroup id reaches
 *    `/api/ancestry/map`, so the only way to verify the whole chain is to hand a
 *    real browser a real file. The synthetic file below carries the full R1b
 *    lineage; its rsids come from `Y_MARKERS` in
 *    `web/src/lib/dna/haplogroup-inference.ts` (a marker change is meant to
 *    break this).
 */

interface Lineage {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  relationshipType: string;
}

interface LineageProbe {
  nodeCount: number;
  linkCount: number;
  /** Relationship type → its count, i.e. what the legend must print. */
  counts: Record<string, number>;
  /** A culture id + name that really appear in the corpus. */
  sampleId: string;
  sampleName: string;
  /** How many nodes a search for `sampleName` should leave drawn. */
  sampleNodeCount: number;
  /** How many nodes selecting `sampleId` should highlight. */
  highlightCount: number;
}

/** `buildGraph` in web/src/components/visualizations/CulturalLineageExplorer.tsx. */
async function realLineages(request: APIRequestContext): Promise<LineageProbe> {
  const res = await request.get("/api/cultural-lineages");
  expect(res.ok(), "/api/cultural-lineages should answer 200").toBeTruthy();
  const lineages = (await res.json()) as Lineage[];
  expect(
    lineages.length,
    "a populated corpus should serve cultural lineages",
  ).toBeGreaterThan(0);

  const nodes = new Set<string>();
  const counts: Record<string, number> = {};
  for (const l of lineages) {
    nodes.add(l.sourceId);
    nodes.add(l.targetId);
    counts[l.relationshipType] = (counts[l.relationshipType] ?? 0) + 1;
  }

  // The most-connected source is the safest search term: its filtered subgraph
  // is non-trivial, so "the search narrowed the graph" is a real claim.
  const bySource = new Map<string, number>();
  for (const l of lineages) {
    bySource.set(l.sourceId, (bySource.get(l.sourceId) ?? 0) + 1);
  }
  const [busiestId] = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0];
  const sampleName = lineages.find((l) => l.sourceId === busiestId)!.sourceName;

  // Mirror the component's filter: links whose source OR target name matches,
  // plus every node either end of those links touches.
  const matching = new Set(
    [
      ...lineages.map((l) => ({ id: l.sourceId, name: l.sourceName })),
      ...lineages.map((l) => ({ id: l.targetId, name: l.targetName })),
    ]
      .filter((n) => n.name.toLowerCase().includes(sampleName.toLowerCase()))
      .map((n) => n.id),
  );
  const filteredLinks = lineages.filter(
    (l) => matching.has(l.sourceId) || matching.has(l.targetId),
  );
  for (const l of filteredLinks) {
    matching.add(l.sourceId);
    matching.add(l.targetId);
  }

  return {
    nodeCount: nodes.size,
    linkCount: lineages.length,
    counts,
    sampleId: busiestId,
    sampleName,
    sampleNodeCount: matching.size,
    // `highlightedIds` in the component: the selected node plus every endpoint of
    // its ancestor AND descendant lineages. Those two routes answer an envelope
    // (`{entityId, lineages, count}`), which the component used to iterate as a
    // bare array — the crash this test exists to keep fixed.
    highlightCount: await highlightedNodeCount(request, busiestId),
  };
}

/** How many nodes the explorer should light up when `csid` is selected. */
async function highlightedNodeCount(
  request: APIRequestContext,
  entityId: string,
): Promise<number> {
  const ids = new Set<string>([entityId]);
  for (const direction of ["ancestors", "descendants"]) {
    const res = await request.get(
      `/api/cultural-lineages/${direction}/${encodeURIComponent(entityId)}`,
    );
    expect(res.ok(), `${direction}/${entityId} should answer 200`).toBeTruthy();
    const body = (await res.json()) as { lineages?: Lineage[] };
    for (const lineage of body.lineages ?? []) {
      ids.add(lineage.sourceId);
      ids.add(lineage.targetId);
    }
  }
  expect(
    ids.size,
    `${entityId} should have related lineages to highlight`,
  ).toBeGreaterThan(1);
  return ids.size;
}

/** Human labels the legend prints, keyed by relationship type (component copy). */
const RELATIONSHIP_LABELS: Record<string, string> = {
  "split-from": "Split From",
  "evolved-into": "Evolved Into",
  "gave-rise-to": "Gave Rise To",
  influenced: "Influenced",
  "associated-with": "Associated With",
  "possibly-associated": "Possibly Associated",
  "preceded-by": "Preceded By",
};

function lineageSvg(page: Page) {
  return page.getByTestId("cultural-lineage-svg");
}

test.describe("cultural lineage explorer", () => {
  test("draws the whole corpus lineage graph", async ({ page, request }) => {
    const probe = await realLineages(request);

    // `?view=lineage` is read by VisualizationContext's initial state — the
    // documented way to preset a view without driving the sidebar.
    await page.goto("/?view=lineage");

    // The header count is computed from the payload the component fetched.
    await expect(page.getByTestId("lineage-summary")).toHaveText(
      `${probe.nodeCount} entities, ${probe.linkCount} connections`,
    );

    // One <g> per node and one <line> per link — the d3 join, drawn.
    await expect(lineageSvg(page).locator("g.nodes > g")).toHaveCount(probe.nodeCount);
    await expect(lineageSvg(page).locator("g.links line")).toHaveCount(probe.linkCount);

    // Every relationship type present in the corpus is legended with its count.
    for (const [type, count] of Object.entries(probe.counts)) {
      const label = RELATIONSHIP_LABELS[type] ?? type;
      await expect(page.getByText(`${label} (${count})`)).toBeVisible();
    }
  });

  test("a named culture from the corpus is drawn and searchable", async ({
    page,
    request,
  }) => {
    const probe = await realLineages(request);
    await page.goto("/?view=lineage");
    await expect(lineageSvg(page).locator("g.nodes > g")).toHaveCount(probe.nodeCount);

    // The node label is a real culture name out of cultural-lineages.tsv.
    await expect(
      lineageSvg(page).locator("text").getByText(probe.sampleName, { exact: true }).first(),
    ).toBeVisible();

    await page.getByPlaceholder("Search cultures...").fill(probe.sampleName);
    // The filtered subgraph is exactly the one the component's filter derives.
    await expect(lineageSvg(page).locator("g.nodes > g")).toHaveCount(
      probe.sampleNodeCount,
    );
    await expect(
      lineageSvg(page).locator("text").getByText(probe.sampleName, { exact: true }).first(),
    ).toBeVisible();
  });

  test("selecting a node opens its ancestry highlight", async ({ page, request }) => {
    const probe = await realLineages(request);
    await page.goto("/?view=lineage");
    await expect(lineageSvg(page).locator("g.nodes > g")).toHaveCount(probe.nodeCount);

    // Clicking a node fires /api/cultural-lineages/{ancestors,descendants}/:id
    // and puts the explorer into its selected state. `dispatchEvent`, not
    // `.click()`: the handler is on the wrapper <g>, which has no fill of its
    // own, so a centre-of-bounding-box click lands in the gap between the circle
    // and its label and hits nothing — and the force simulation is still moving
    // the node while Playwright aims.
    await lineageSvg(page)
      .locator("g.nodes > g")
      .filter({ hasText: probe.sampleName })
      .first()
      .dispatchEvent("click");
    await expect(page.getByRole("button", { name: "Clear selection" })).toBeVisible();

    // The selection dims everything it does not highlight (opacity 0.3), so the
    // fully-opaque circles ARE the ancestor/descendant set the two routes
    // answered. Before the envelope fix this never rendered at all: the render
    // threw and React unmounted the explorer, leaving "Clear selection" to flash
    // once and vanish.
    await expect(
      lineageSvg(page).locator('g.nodes > g circle[opacity="1"]'),
    ).toHaveCount(probe.highlightCount);
    await expect(page.getByTestId("lineage-summary")).toBeVisible();

    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("button", { name: "Clear selection" })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// DNA ancestry mapper
// ---------------------------------------------------------------------------

/**
 * The full R1b lineage (CT → F → K → P → R → R1b) as a 23andMe export. rsids +
 * derived alleles mirror `Y_MARKERS`; a full path scores confidence 1.
 */
const R1B_CALLS: [string, string][] = [
  ["rs2032658", "TT"], // CT / M168
  ["rs2032652", "TT"], // F  / M89
  ["rs3900", "CC"], //    K  / M9
  ["rs2032631", "AA"], // P  / M45
  ["rs2032658b", "GG"], // R / M207
  ["rs9786153", "CC"], // R1b / M269
];

function raw23andMe(calls: [string, string][]): string {
  const rows = ["# rsid\tchromosome\tposition\tgenotype"];
  calls.forEach(([rsid, genotype], i) => {
    rows.push(`${rsid}\tY\t${1000 + i}\t${genotype}`);
  });
  return rows.join("\n");
}

test.describe("DNA ancestry mapper", () => {
  test("an R1b profile maps to the corpus' real associations", async ({
    page,
    request,
  }) => {
    // What the server will answer for the haplogroup the browser is about to
    // infer — read first, so the DOM assertions track the corpus.
    const res = await request.post("/api/ancestry/map", {
      data: { haplogroupIds: ["r1b"] },
    });
    expect(res.ok(), "/api/ancestry/map should answer 200").toBeTruthy();
    const mapping = (await res.json()) as {
      matchedHaplogroups: { name: string }[];
      spoke: { familyName: string; sampleLanguages: string[] }[];
      caveats: string[];
    };
    expect(
      mapping.matchedHaplogroups.length,
      "r1b should match a corpus haplogroup",
    ).toBeGreaterThan(0);
    expect(
      mapping.spoke.length,
      "r1b should associate with at least one language family",
    ).toBeGreaterThan(0);

    await page.goto("/ancestry");
    await expect(page.getByTestId("ancestry-page")).toBeVisible();

    await page.getByTestId("ancestry-file-input").setInputFiles({
      name: "genome.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(raw23andMe(R1B_CALLS), "utf8"),
    });

    // Parsed in-browser: the format detection and the SNP count are local work.
    await expect(page.getByTestId("ancestry-file-meta")).toContainText("23andme");
    await expect(page.getByTestId("ancestry-file-meta")).toContainText(
      `${R1B_CALLS.length} SNPs read in-browser`,
    );

    // The inferred haplogroup — full lineage derived ⇒ 100% confidence.
    const haplogroup = page.getByTestId("ancestry-haplogroup");
    await expect(haplogroup).toContainText("Inferred Y-DNA haplogroup:");
    await expect(haplogroup).toContainText("R1b");
    await expect(haplogroup).toContainText("100% confidence");

    // …and the server enrichment, asserted against what the API really returned.
    const results = page.getByTestId("ancestry-results");
    await expect(results).toBeVisible();
    for (const spoke of mapping.spoke) {
      await expect(results.getByText(spoke.familyName, { exact: true })).toBeVisible();
    }
    const [firstFamily] = mapping.spoke;
    if (firstFamily.sampleLanguages.length > 0) {
      await expect(
        results.getByText(`e.g. ${firstFamily.sampleLanguages.join(", ")}`),
      ).toBeVisible();
    }

    // Speculative results always ship their caveats.
    const caveats = page.getByTestId("ancestry-caveats");
    await expect(caveats.locator("li")).toHaveCount(mapping.caveats.length);
    await expect(caveats).toContainText("never uploaded or stored");
  });

  test("a file with no Y calls explains itself instead of failing", async ({ page }) => {
    await page.goto("/ancestry");
    await page.getByTestId("ancestry-file-input").setInputFiles({
      name: "autosomal-only.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        ["# rsid\tchromosome\tposition\tgenotype", "rs4477212\t1\t82154\tAA"].join("\n"),
        "utf8",
      ),
    });
    await expect(page.getByText("No Y-chromosome data was found in this file")).toBeVisible();
    await expect(page.getByTestId("ancestry-results")).toHaveCount(0);
  });
});
