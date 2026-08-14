import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Etymology analyzer browser verification (pinakes:100 US-3).
 *
 * `/word-etymology` had **zero** browser coverage: the unit suites feed
 * `EtymologyTreeVisualization` a node directly, so nothing exercised the page's
 * own fetch → state → d3 path against the real `/api/etymology-relations/trace`
 * response. That gap hid a defect the very first run caught — the route answers
 * the parity envelope `{tree, word, language, direction}` and the page stored the
 * whole envelope as the tree node, so `children` was always undefined and EVERY
 * trace rendered "No etymology relations found for this word".
 *
 * The probe reads the corpus first and picks a word that genuinely has relations,
 * so the assertion tracks the TSV rather than pinning "modor".
 */

interface EtymologyTreeNode {
  word: string;
  language: string;
  relation?: string;
  children?: EtymologyTreeNode[];
}

interface TraceProbe {
  /** The word we traced — a real `etymology-relations.tsv` source word. */
  word: string;
  /** Its immediate related words, i.e. what the tree must draw beside the root. */
  childWords: string[];
  childLanguages: string[];
}

/**
 * Find a word the corpus can actually trace, and return what the tree should
 * draw for it. Fails the test when NO word in the corpus traces to anything —
 * a "the tree rendered" assertion against an empty corpus is no assertion.
 */
async function traceableWord(request: APIRequestContext): Promise<TraceProbe> {
  const list = await request.get("/api/etymology-relations");
  expect(list.ok(), "/api/etymology-relations should answer 200").toBeTruthy();
  const relations = ((await list.json()) as {
    relations?: { sourceWord?: string }[];
  }).relations ?? [];
  expect(
    relations.length,
    "the corpus should hold etymology relations",
  ).toBeGreaterThan(0);

  const candidates = [
    ...new Set(relations.map((r) => r.sourceWord).filter(Boolean) as string[]),
  ].slice(0, 20);

  for (const word of candidates) {
    const res = await request.get(
      `/api/etymology-relations/trace/${encodeURIComponent(word)}`,
    );
    if (!res.ok()) continue;
    // The ENVELOPE, not the node — the distinction this spec exists to pin.
    const tree = ((await res.json()) as { tree?: EtymologyTreeNode }).tree;
    const children = tree?.children ?? [];
    if (children.length > 0) {
      return {
        word,
        childWords: children.map((c) => c.word),
        childLanguages: [...new Set(children.map((c) => c.language))],
      };
    }
  }
  throw new Error(
    `no word among ${candidates.length} corpus source words traced to any ` +
      "relation — the etymology corpus is empty or the trace route is broken",
  );
}

test.describe("etymology analyzer", () => {
  test("a real corpus word renders its etymology tree", async ({ page, request }) => {
    const probe = await traceableWord(request);

    // `?word=` auto-traces on mount (the deep-link the text analyzer hands off to).
    await page.goto(`/word-etymology?word=${encodeURIComponent(probe.word)}`);

    await expect(
      page.getByRole("heading", { name: `Etymology of "${probe.word}"` }),
    ).toBeVisible();

    // The defect this catches: with the envelope stored as the node, this notice
    // was ALWAYS shown and the tree drew a lone root.
    await expect(
      page.getByText("No etymology relations found for this word"),
    ).toHaveCount(0);

    // d3 draws one `<text>` per node with the word, and a second with its
    // language code — assert the REAL related word from the corpus is drawn.
    for (const child of probe.childWords) {
      await expect(page.locator("svg text").getByText(child, { exact: true }).first())
        .toBeVisible();
    }
    for (const language of probe.childLanguages) {
      await expect(
        page.locator("svg text").getByText(language, { exact: true }).first(),
      ).toBeVisible();
    }
  });

  test("a word with no relations still renders, and says so", async ({ page }) => {
    // The other half of the same code path: a real 200 whose tree has no
    // children must reach the explanatory notice, not an error.
    await page.goto("/word-etymology?word=zzzznosuchword");
    await expect(
      page.getByRole("heading", { name: 'Etymology of "zzzznosuchword"' }),
    ).toBeVisible();
    await expect(
      page.getByText("No etymology relations found for this word"),
    ).toBeVisible();
  });

  test("typing a word traces it", async ({ page, request }) => {
    const probe = await traceableWord(request);
    await page.goto("/word-etymology");
    await expect(page.getByText("Enter a word above to trace its etymology")).toBeVisible();
    await page.getByPlaceholder("Enter a word to trace...").fill(probe.word);
    await page.getByRole("button", { name: "Trace" }).click();
    await expect(
      page.getByRole("heading", { name: `Etymology of "${probe.word}"` }),
    ).toBeVisible();
    await expect(
      page.locator("svg text").getByText(probe.childWords[0], { exact: true }).first(),
    ).toBeVisible();
  });
});
