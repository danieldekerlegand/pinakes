/**
 * Test script for literary traditions and works TSV loaders
 * Run with: npx tsx test/test-literary-traditions.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testLiteraryTraditions() {
  console.log("=== Testing Literary Traditions & Works ===\n");

  const storage = new TsvStorage();
  let passed = 0;
  let failed = 0;

  function assert(label: string, condition: boolean) {
    if (condition) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.log(`  FAIL: ${label}`);
      failed++;
    }
  }

  // Test: Load all literary traditions
  console.log("--- Literary Traditions ---");
  const traditions = await storage.getLiteraryTraditions();
  assert("Loaded traditions", traditions.length > 0);
  assert("Has at least 10 traditions", traditions.length >= 10);

  // Test: Tradition structure
  const firstTrad = traditions[0];
  assert("Has id", typeof firstTrad.id === "string" && firstTrad.id.length > 0);
  assert("Has name", typeof firstTrad.name === "string" && firstTrad.name.length > 0);
  assert("Has region", typeof firstTrad.region === "string" && firstTrad.region.length > 0);
  assert("Has originDate (number)", typeof firstTrad.originDate === "number");
  assert("Has originCoordinates", typeof firstTrad.originCoordinates.lat === "number" && typeof firstTrad.originCoordinates.lng === "number");
  assert("Has associatedLanguageIds (array)", Array.isArray(firstTrad.associatedLanguageIds));
  assert("Has genreFocus (array)", Array.isArray(firstTrad.genreFocus));
  assert("Has keyThemes (array)", Array.isArray(firstTrad.keyThemes));
  assert("Has notableAuthors (array)", Array.isArray(firstTrad.notableAuthors));
  assert("Has description", typeof firstTrad.description === "string" && firstTrad.description.length > 0);

  // Test: Get by ID
  const sanskrit = await storage.getLiteraryTraditionById("lit-trad-001");
  assert("Get by ID returns tradition", sanskrit !== null);
  assert("Sanskrit tradition name correct", sanskrit?.name === "Classical Sanskrit Literature");

  // Test: Get non-existent ID
  const nonExistent = await storage.getLiteraryTraditionById("non-existent-id");
  assert("Non-existent ID returns null", nonExistent === null);

  // Test: Filter by region
  const southAsian = await storage.getLiteraryTraditions({ region: "South Asia" });
  assert("Filter by region works", southAsian.length > 0);
  assert("All filtered are South Asia", southAsian.every(t => t.region === "South Asia"));

  // Test: Filter by genre
  const epics = await storage.getLiteraryTraditions({ genre: "epic" });
  assert("Filter by genre works", epics.length > 0);
  assert("All filtered have epic genre", epics.every(t => t.genreFocus.includes("epic")));

  // Test: Load all literary works
  console.log("\n--- Literary Works ---");
  const works = await storage.getLiteraryWorks();
  assert("Loaded works", works.length > 0);
  assert("Has at least 20 works", works.length >= 20);

  // Test: Work structure
  const firstWork = works[0];
  assert("Has id", typeof firstWork.id === "string" && firstWork.id.length > 0);
  assert("Has title", typeof firstWork.title === "string" && firstWork.title.length > 0);
  assert("Has author", typeof firstWork.author === "string" && firstWork.author.length > 0);
  assert("Has traditionId", typeof firstWork.traditionId === "string" && firstWork.traditionId.length > 0);
  assert("Has languageId", typeof firstWork.languageId === "string" && firstWork.languageId.length > 0);
  assert("Has dateComposed (number)", typeof firstWork.dateComposed === "number");
  assert("Has genre", typeof firstWork.genre === "string" && firstWork.genre.length > 0);
  assert("Has form", typeof firstWork.form === "string" && firstWork.form.length > 0);
  assert("Has description", typeof firstWork.description === "string" && firstWork.description.length > 0);
  assert("Has significance", typeof firstWork.significance === "string" && firstWork.significance.length > 0);
  assert("Has coordinates", typeof firstWork.coordinates.lat === "number" && typeof firstWork.coordinates.lng === "number");

  // Test: Get work by ID
  const iliad = await storage.getLiteraryWorkById("lw-003");
  assert("Get work by ID returns work", iliad !== null);
  assert("Iliad title correct", iliad?.title === "Iliad");
  assert("Iliad author correct", iliad?.author === "Homer");

  // Test: Filter works by tradition
  const greekWorks = await storage.getLiteraryWorks({ traditionId: "lit-trad-002" });
  assert("Filter works by tradition works", greekWorks.length > 0);
  assert("All filtered works are Greek tradition", greekWorks.every(w => w.traditionId === "lit-trad-002"));

  // Test: Filter works by genre
  const epicWorks = await storage.getLiteraryWorks({ genre: "epic" });
  assert("Filter works by genre works", epicWorks.length > 0);
  assert("All filtered works are epic genre", epicWorks.every(w => w.genre === "epic"));

  // Test: Tradition with works
  const greekTraditionWithWorks = await storage.getLiteraryTraditionWithWorks("lit-trad-002");
  assert("Get tradition with works returns result", greekTraditionWithWorks !== null);
  assert("Tradition name correct", greekTraditionWithWorks?.tradition.name === "Classical Greek Literature");
  assert("Works included", (greekTraditionWithWorks?.works.length ?? 0) > 0);

  // Test: Non-existent tradition with works
  const noTradition = await storage.getLiteraryTraditionWithWorks("non-existent");
  assert("Non-existent tradition with works returns null", noTradition === null);

  // Test: Null end dates handled
  const westAfrican = await storage.getLiteraryTraditionById("lit-trad-012");
  assert("Null end_date handled correctly", westAfrican?.endDate === null);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  if (failed > 0) process.exit(1);
}

testLiteraryTraditions().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
