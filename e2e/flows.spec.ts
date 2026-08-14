import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Flow-diagram browser verification — the Sankey surface (pinakes:100 US-3).
 *
 * The only flow diagram a user can actually reach is the **correlation
 * explorer's** Sankey (`/?panel=correlation`, `correlation-explorer-panel.tsx`),
 * which draws `/api/cross-domain/correlate` results as a two-column d3 flow. It
 * had no browser coverage; the spec re-derives the exact node/link join the
 * component builds from the real payload and asserts the drawn SVG matches.
 *
 * ## Deliberately NOT covered here, with reasons
 *
 * - **`SankeyDiagramVisualization` / `ChordDiagramVisualization`** are not
 *   mounted anywhere in the running app. Their only importers —
 *   `CulturalInfluencePanel.tsx`, `CuisineComparisonView.tsx` — are themselves
 *   unreferenced (nothing imports them, no route renders them), so there is no
 *   URL that puts either on screen. They stay unit-covered
 *   (`SankeyFlow.test.ts`, `shared/chord-diagram-utils.test.ts`); an e2e spec
 *   would have to mount the component itself, which is a unit test wearing a
 *   browser. Wiring them into a surface is a feature change, not verification.
 * - **A treemap** does not exist in this client. `VisualizationType` in
 *   `web/src/lib/data-explorer-registry.ts` has no `treemap` member and no
 *   component draws one, so there is nothing to browser-verify.
 * - **`/explore`'s Sankey/Chord tiles** render `PlaceholderRenderer` — an icon
 *   and a caption, not a diagram. Asserting on them would record placeholder
 *   text as flow-diagram coverage.
 */

type DomainType = string;

interface CorrelationEntity {
  id: string;
  name: string;
  domain: DomainType;
}
interface Correlation {
  entityA: CorrelationEntity;
  entityB: CorrelationEntity;
  score: number;
}
interface CorrelationResult {
  domainA: DomainType;
  correlations: Correlation[];
  summary: string;
}

interface CorrelationProbe {
  summary: string;
  correlationCount: number;
  correlations: Correlation[];
}

interface SankeyJoin {
  /** One `<rect>` each — the component's deduped node set. */
  nodeCount: number;
  /** One `<path>` each — deduped, self-links dropped. */
  linkCount: number;
  /** Node labels as the component prints them (truncated past 24 chars). */
  labels: string[];
}

/** Run the correlation the panel is about to run. Says nothing about emptiness. */
async function correlate(
  request: APIRequestContext,
  domainA: string,
  domainB: string,
  relationshipType: string,
): Promise<CorrelationProbe> {
  const res = await request.post("/api/cross-domain/correlate", {
    data: { domainA, domainB, relationshipType },
  });
  expect(res.ok(), "/api/cross-domain/correlate should answer 200").toBeTruthy();
  const result = (await res.json()) as CorrelationResult;
  return {
    summary: result.summary,
    correlationCount: result.correlations.length,
    correlations: result.correlations,
  };
}

/** Mirrors the `sankeyData` useMemo in correlation-explorer-panel.tsx. */
function sankeyJoin(probe: CorrelationProbe): SankeyJoin {
  const nodes = new Map<string, CorrelationEntity>();
  const links = new Set<string>();
  for (const c of probe.correlations.slice(0, 30)) {
    const a = `${c.entityA.domain}:${c.entityA.id}`;
    const b = `${c.entityB.domain}:${c.entityB.id}`;
    nodes.set(a, c.entityA);
    nodes.set(b, c.entityB);
    links.add(`${a}|${b}`);
  }
  const keys = [...nodes.keys()];
  // The component drops a link whose two ends resolve to the same node INDEX.
  const drawnLinks = [...links].filter((key) => {
    const [source, target] = key.split("|");
    return keys.indexOf(source) !== keys.indexOf(target);
  });
  return {
    nodeCount: nodes.size,
    linkCount: drawnLinks.length,
    labels: [...nodes.values()].map((n) =>
      n.name.length > 24 ? `${n.name.slice(0, 22)}…` : n.name,
    ),
  };
}

/** A correlation that MUST be non-empty, plus the join the SVG should draw. */
async function realSankey(
  request: APIRequestContext,
  domainA: string,
  domainB: string,
  relationshipType: string,
): Promise<CorrelationProbe & SankeyJoin> {
  const probe = await correlate(request, domainA, domainB, relationshipType);
  expect(
    probe.correlationCount,
    `${domainA}×${domainB} should correlate to something in a populated corpus`,
  ).toBeGreaterThan(0);
  return { ...probe, ...sankeyJoin(probe) };
}

test.describe("correlation flow diagram", () => {
  test("draws a Sankey of the corpus' real cross-domain correlations", async ({
    page,
    request,
  }) => {
    // The panel's defaults, so "Analyze" runs exactly this query.
    const probe = await realSankey(request, "language", "civilization", "co-occurrence");

    await page.goto("/?panel=correlation");
    await expect(page.getByRole("heading", { name: "Query Builder" })).toBeVisible();
    await page.getByRole("button", { name: "Analyze", exact: true }).click();

    // The service's own summary sentence, rendered verbatim.
    await expect(page.getByText(probe.summary)).toBeVisible();
    await expect(
      page.getByText(`Top Correlations (${probe.correlationCount})`),
    ).toBeVisible();

    // The d3 join: one rect per entity, one path per surviving link.
    const sankey = page.getByTestId("correlation-sankey-svg");
    await expect(sankey).toBeVisible();
    await expect(sankey.locator("rect")).toHaveCount(probe.nodeCount);
    await expect(sankey.locator("path")).toHaveCount(probe.linkCount);

    // …labelled with the real entity names the correlation returned.
    for (const label of probe.labels.slice(0, 8)) {
      await expect(sankey.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("the scatter view is the same result, drawn differently", async ({
    page,
    request,
  }) => {
    const probe = await realSankey(request, "language", "civilization", "co-occurrence");
    await page.goto("/?panel=correlation");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.getByTestId("correlation-sankey-svg")).toBeVisible();

    await page.getByRole("button", { name: "Scatter" }).click();
    await expect(page.getByTestId("correlation-scatter-svg")).toBeVisible();
    await expect(page.getByTestId("correlation-sankey-svg")).toHaveCount(0);
    // The underlying result is unchanged — the list below still holds it.
    await expect(
      page.getByText(`Top Correlations (${probe.correlationCount})`),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sankey" }).click();
    await expect(page.getByTestId("correlation-sankey-svg")).toBeVisible();
    await expect(page.getByTestId("correlation-scatter-svg")).toHaveCount(0);
  });

  test("a pre-built query runs its own correlation and narrative", async ({
    page,
    request,
  }) => {
    const listed = await request.get("/api/cross-domain/prebuilt-queries");
    expect(listed.ok(), "/api/cross-domain/prebuilt-queries should answer 200").toBeTruthy();
    const queries = ((await listed.json()) as {
      queries?: {
        id: string;
        name: string;
        request: { domainA: string; domainB: string; relationshipType: string };
      }[];
    }).queries ?? [];
    expect(queries.length, "the corpus should serve pre-built queries").toBeGreaterThan(0);

    const query = queries[0];
    const probe = await correlate(
      request,
      query.request.domainA,
      query.request.domainB,
      query.request.relationshipType,
    );

    await page.goto("/?panel=correlation");
    await page.getByText(query.name).click();

    // Its curated scholarly note and the service's own summary always render.
    await expect(page.getByRole("heading", { name: "Scholarly Context" })).toBeVisible();
    await expect(page.getByText(probe.summary)).toBeVisible();

    if (probe.correlationCount > 0) {
      const sankey = page.getByTestId("correlation-sankey-svg");
      await expect(sankey.locator("rect")).toHaveCount(sankeyJoin(probe).nodeCount);
    } else {
      // BRANCH, don't `.or()` — see e2e/CLAUDE.md. Today all four curated queries
      // pair a domain couple with a relationship type the corpus cannot satisfy
      // (`ie-r1b` asks language×haplogroup CO-OCCURRENCE, which yields 0, while
      // the same pair under geographic-overlap yields 50), so every one of them
      // lands on this empty state. That is a CURATION finding (recorded under
      // "Known gaps" in e2e/CLAUDE.md), not something a verification spec gets to
      // fix: the catalog is a frozen parity payload pinned by
      // services/api/tests/test_correlation.py. When it is re-curated this branch
      // stops running and the diagram assertion above takes over.
      await expect(
        page.getByText("No correlations found for this combination"),
      ).toBeVisible();
    }
  });
});
