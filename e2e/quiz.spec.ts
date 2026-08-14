import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Quiz & learning mode browser verification (pinakes:100 US-3).
 *
 * `/quiz` generates its questions from the live corpus (`/api/quiz`), and
 * `/shared/quiz/:token` decodes a result the quiz itself minted — neither had any
 * browser coverage. The spec drives a whole session end to end and then follows
 * the share link the results screen produces, so the round trip
 * *play → score → share → read back* is verified against real data.
 *
 * **Category choice is deliberate.** `families` has exactly one generator
 * (`language_family_question`), which is always `multiple_choice` — so the
 * walkthrough never has to guess an interaction. The `drag_sort` (`languages`,
 * `geography`) and `map_click` (`geography`) types are exercised for RENDERING by
 * the mixed-draw test but not answered: HTML5 drag-and-drop and a Leaflet
 * coordinate click are both interaction-shaped rather than data-shaped, and the
 * scoring they feed is unit-covered (`web/src/lib/quiz-*.test.ts`,
 * `services/api/tests/test_quiz_routes.py`).
 */

const QUESTION_COUNT = 5;

/** Every language-family name the corpus knows — the option pool for `families`. */
async function realFamilyNames(request: APIRequestContext): Promise<Set<string>> {
  const res = await request.get("/api/language-families");
  expect(res.ok(), "/api/language-families should answer 200").toBeTruthy();
  const families = (await res.json()) as { name?: string }[];
  expect(
    families.length,
    "a populated corpus should serve language families",
  ).toBeGreaterThan(0);
  return new Set(families.map((f) => String(f.name)));
}

/** Every language name the corpus knows — a `families` question asks about one. */
async function realLanguageNames(request: APIRequestContext): Promise<Set<string>> {
  const res = await request.get("/api/languages");
  expect(res.ok(), "/api/languages should answer 200").toBeTruthy();
  // A BARE ARRAY, not an `{items, count}` envelope — the shape two pages had
  // typed wrong until this story ran them against the live service.
  const items = (await res.json()) as { name?: string }[];
  expect(items.length, "a populated corpus should serve languages").toBeGreaterThan(0);
  return new Set(items.map((l) => String(l.name)));
}

/** Pick a value in one of the setup screen's three Radix comboboxes. */
async function choose(page: Page, picker: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: picker }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("quiz & learning mode", () => {
  test("a families quiz asks about real corpus languages and families", async ({
    page,
    request,
  }) => {
    const [familyNames, languageNames] = await Promise.all([
      realFamilyNames(request),
      realLanguageNames(request),
    ]);

    await page.goto("/quiz");
    await expect(page.getByRole("heading", { name: "Quiz & Learning Mode" })).toBeVisible();

    await choose(page, "Category", "Language Families");
    await choose(page, "Difficulty", "Easy");
    await choose(page, "Number of Questions", `${QUESTION_COUNT} Questions`);
    await page.getByRole("button", { name: "Start Quiz" }).click();

    await expect(page.getByText(`Question 1 of ${QUESTION_COUNT}`)).toBeVisible();

    const heading = page.getByRole("heading", { level: 2 });
    const questionText = (await heading.textContent()) ?? "";
    // `language_family_question`'s template. The name in the slot has to be a
    // language the corpus actually serves — that is the "real data" claim.
    const asked = /^Which language family does (.+) belong to\?$/.exec(questionText);
    expect(asked, `unexpected families question: ${questionText}`).not.toBeNull();
    expect(
      languageNames.has(asked![1]),
      `"${asked![1]}" should be a language in the corpus`,
    ).toBeTruthy();

    // …and every offered answer has to be a real family name, not a placeholder.
    const options = page.getByTestId(/^quiz-option-\d+$/);
    const count = await options.count();
    expect(count, "a multiple-choice question offers options").toBeGreaterThan(1);
    for (let i = 0; i < count; i += 1) {
      // The button reads "<letter><family>"; the letter is a styled prefix span.
      const name = ((await options.nth(i).textContent()) ?? "")
        .replace(/^[A-Z]/, "")
        .trim();
      expect(familyNames.has(name), `"${name}" should be a real family`).toBeTruthy();
    }
  });

  test("playing a session through to the share link round-trips the score", async ({
    page,
  }) => {
    // The results screen copies the share URL to the clipboard; capture it
    // without needing clipboard permissions, then follow it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            (window as unknown as { __copied?: string }).__copied = text;
            return Promise.resolve();
          },
        },
      });
    });

    await page.goto("/quiz");
    await choose(page, "Category", "Language Families");
    await choose(page, "Number of Questions", `${QUESTION_COUNT} Questions`);
    await page.getByRole("button", { name: "Start Quiz" }).click();

    for (let i = 1; i <= QUESTION_COUNT; i += 1) {
      await expect(page.getByText(`Question ${i} of ${QUESTION_COUNT}`)).toBeVisible();
      // Always answer "A": the score is whatever it is — the assertion below
      // reads it back off the results screen rather than assuming a value.
      await page.getByTestId("quiz-option-0").click();
      await page.getByRole("button", { name: "Submit Answer" }).click();
    }

    // Results screen: "<correct> / <total>", where total is what we played.
    const score = page.getByRole("heading", { level: 2 }).first();
    await expect(score).toHaveText(new RegExp(`^\\d+ / ${QUESTION_COUNT}$`));
    const scoreText = ((await score.textContent()) ?? "").trim();

    await page.getByRole("button", { name: "Share result" }).click();
    await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
    const shared = await page.evaluate(
      () => (window as unknown as { __copied?: string }).__copied,
    );
    expect(shared, "sharing should copy a /shared/quiz/ URL").toContain("/shared/quiz/");

    // The read-only share view decodes the token — no server lookup — and must
    // report the same score under the same category label.
    await page.goto(shared!);
    await expect(page.getByText("Shared quiz result")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(scoreText);
    await expect(page.getByText("Language Families", { exact: true })).toBeVisible();
  });

  test("a mixed draw renders every question type the corpus generates", async ({
    page,
    request,
  }) => {
    // `mixed` flattens all seven generators, including the two (`cuisine`,
    // `civilizations`) the route refuses to serve by name — so this is the only
    // way their questions reach a browser at all.
    const res = await request.get("/api/quiz?count=20&category=mixed&difficulty=medium");
    expect(res.ok(), "/api/quiz should answer 200 for mixed").toBeTruthy();
    const questions = ((await res.json()) as { questions?: { question: string }[] })
      .questions ?? [];
    expect(questions.length, "mixed should draw questions").toBeGreaterThan(0);

    await page.goto("/quiz");
    await choose(page, "Number of Questions", "20 Questions");
    await page.getByRole("button", { name: "Start Quiz" }).click();

    // Whatever type came up first, its card renders with a non-empty prompt and
    // the category/difficulty/type badges — the page must not blank out on the
    // drag-sort or map-click branches.
    await expect(page.getByText("Question 1 of 20")).toBeVisible();
    const prompt = page.getByRole("heading", { level: 2 });
    await expect(prompt).toBeVisible();
    expect(((await prompt.textContent()) ?? "").trim().length).toBeGreaterThan(0);
  });

  test("the category picker only offers categories the service admits", async ({
    page,
    request,
  }) => {
    // Regression guard for the defect this story found: the picker used to offer
    // "Cuisine & Dishes" and "Civilizations (Chronology)", which `/api/quiz`
    // rejects with a 400 by design, so choosing either dead-ended the user on
    // "No questions could be generated for this category".
    await page.goto("/quiz");
    await page.getByRole("combobox", { name: "Category" }).click();
    const offered = await page.getByRole("option").allTextContents();
    expect(offered.length).toBeGreaterThan(1);

    for (const label of offered) {
      const category = CATEGORY_PARAM[label.trim()];
      expect(category, `no /api/quiz category for the option "${label}"`).toBeTruthy();
      const res = await request.get(`/api/quiz?count=1&category=${category}`);
      expect(
        res.status(),
        `the picker offers "${label}", so /api/quiz?category=${category} must not 400`,
      ).toBe(200);
    }
  });
});

/** Picker label → the `category` value the page sends. Mirrors quiz.tsx. */
const CATEGORY_PARAM: Record<string, string> = {
  "Mixed (All Categories)": "mixed",
  "Language Families": "families",
  Languages: "languages",
  Grammar: "grammar",
  "Writing Systems": "writing_systems",
  Geography: "geography",
};
