import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Narrative journeys ("Guided Stories") browser verification (pinakes:100 US-3).
 *
 * `/stories` (the list) and `/stories/:id` (the player) had no browser coverage.
 * Both read `/api/narratives`, so the spec probes that first and asserts the DOM
 * matches the corpus — the story titles, the per-story step counts, and the
 * step-1 text of a real narrative — rather than "a card rendered".
 */

interface NarrativeStep {
  text: string;
  timePoint: number;
  highlightedEntities: string[];
}
interface Narrative {
  id: string;
  title: string;
  description: string;
  steps: NarrativeStep[];
}

/** The narratives the corpus actually serves; empty is a failure, not a pass. */
async function realNarratives(request: APIRequestContext): Promise<Narrative[]> {
  const res = await request.get("/api/narratives");
  expect(res.ok(), "/api/narratives should answer 200").toBeTruthy();
  const narratives =
    ((await res.json()) as { narratives?: Narrative[] }).narratives ?? [];
  expect(
    narratives.length,
    "a populated corpus should serve at least one narrative",
  ).toBeGreaterThan(0);
  expect(
    narratives.every((n) => n.steps.length > 0),
    "every narrative should carry steps",
  ).toBeTruthy();
  return narratives;
}

/** `formatYear` in web/src/pages/stories.tsx. */
function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

test.describe("narrative journeys", () => {
  test("the story list renders every narrative the corpus serves", async ({
    page,
    request,
  }) => {
    const narratives = await realNarratives(request);
    await page.goto("/stories");
    await expect(page.getByRole("heading", { name: "Guided Stories" })).toBeVisible();

    for (const narrative of narratives) {
      const card = page.getByRole("link", { name: new RegExp(escapeRe(narrative.title)) });
      await expect(card).toBeVisible();
      // The step count is derived from the payload, so it tracks the corpus.
      await expect(card.getByText(`${narrative.steps.length} steps`)).toBeVisible();
    }
  });

  test("a real narrative plays through its steps", async ({ page, request }) => {
    const [narrative] = await realNarratives(request);
    const multiStep = narrative.steps.length > 1;

    await page.goto(`/stories/${narrative.id}`);
    await expect(page.getByRole("heading", { name: narrative.title })).toBeVisible();
    await expect(
      page.getByText(`Step 1 of ${narrative.steps.length}`),
    ).toBeVisible();

    // Step 1's REAL narrative text, time point, and highlighted entities.
    await expect(page.getByText(narrative.steps[0].text)).toBeVisible();
    await expect(
      page.getByText(formatYear(narrative.steps[0].timePoint), { exact: true }),
    ).toBeVisible();
    if (narrative.steps[0].highlightedEntities.length > 0) {
      await expect(
        page.getByText(narrative.steps[0].highlightedEntities.join(", "), {
          exact: true,
        }),
      ).toBeVisible();
    }

    // "Previous" is disabled on the first step; "Next" advances to the real
    // second step's text.
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    if (multiStep) {
      await page.getByRole("button", { name: "Next" }).click();
      await expect(
        page.getByText(`Step 2 of ${narrative.steps.length}`),
      ).toBeVisible();
      await expect(page.getByText(narrative.steps[1].text)).toBeVisible();
      await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
    }
  });

  test("an unknown story id degrades to a not-found notice", async ({ page }) => {
    await page.goto("/stories/zzzz-no-such-narrative");
    await expect(page.getByText("Narrative not found.")).toBeVisible();
    await page.getByRole("button", { name: "Back to Stories" }).click();
    await expect(page.getByRole("heading", { name: "Guided Stories" })).toBeVisible();
  });
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
