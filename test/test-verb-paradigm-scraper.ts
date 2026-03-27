/**
 * Test script for verb paradigm scraper (UniMorph + Wiktionary)
 * Run with: npx tsx test/test-verb-paradigm-scraper.ts
 */

import { VerbParadigmScraper } from "../server/services/verb-paradigm-scraper";

async function testVerbParadigmScraper() {
  console.log("=== Verb Paradigm Scraper Tests ===\n");

  const scraper = new VerbParadigmScraper();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.log(`  FAIL: ${message}`);
      failed++;
    }
  }

  // Test 1: UniMorph tag parsing via buildConjugationTable (via scrapeFromUniMorph)
  console.log("Test 1: Parse Wiktionary conjugation wikitext");
  {
    const sampleWikitext = `
==Spanish==

===Verb===
'''hablar'''

====Conjugation====
{{es-conj|habl|ar}}
|pres_1sg=hablo
|pres_2sg=hablas
|pres_3sg=habla
|pres_1pl=hablamos
|pres_2pl=habláis
|pres_3pl=hablan
|past_1sg=hablé
|past_2sg=hablaste
|past_3sg=habló
|fut_1sg=hablaré
|fut_2sg=hablarás
|fut_3sg=hablará
|subj_pres_1sg=hable
|subj_pres_2sg=hables
|subj_pres_3sg=hable
`;

    const result = scraper.parseWiktionaryConjugation(sampleWikitext, "es");
    assert(result !== null, "Parsed conjugation table from wikitext");
    if (result) {
      assert(result.present !== undefined, "Has present tense");
      assert(result.present?.["1sg"] === "hablo", `Present 1sg is 'hablo' (got '${result.present?.["1sg"]}')`);
      assert(result.present?.["3sg"] === "habla", `Present 3sg is 'habla' (got '${result.present?.["3sg"]}')`);
      assert(result.future !== undefined, "Has future tense");
      assert(result.future?.["1sg"] === "hablaré", `Future 1sg is 'hablaré' (got '${result.future?.["1sg"]}')`);
      assert(result.subjunctive_present !== undefined, "Has subjunctive present");
      assert(result.subjunctive_present?.["1sg"] === "hable", `Subj pres 1sg is 'hable' (got '${result.subjunctive_present?.["1sg"]}')`);

      const totalForms = Object.values(result).reduce(
        (sum, tense) => sum + Object.keys(tense).length, 0,
      );
      assert(totalForms > 0, `Has ${totalForms} total conjugated forms`);
    }
  }
  console.log();

  // Test 2: Wikitext with no conjugation section returns null
  console.log("Test 2: Handle missing conjugation section");
  {
    const noConjWikitext = `
==English==

===Noun===
'''table'''

# A piece of furniture
`;

    const result = scraper.parseWiktionaryConjugation(noConjWikitext, "en");
    assert(result === null, "Returns null when no conjugation section found");
  }
  console.log();

  // Test 3: Wikitext with wrong language section returns null
  console.log("Test 3: Handle wrong language section");
  {
    const wrongLangWikitext = `
==French==

===Verb===
'''parler'''

====Conjugation====
|pres_1sg=parle
`;

    const result = scraper.parseWiktionaryConjugation(wrongLangWikitext, "es");
    assert(result === null, "Returns null when language section doesn't match");
  }
  console.log();

  // Test 4: Scraper options validation
  console.log("Test 4: Scraper handles empty language list");
  {
    const results = await scraper.scrapeVerbParadigms({
      languageIds: [],
    });
    assert(results.length === 0, "Empty language list returns empty results");
  }
  console.log();

  // Test 5: UniMorph scrape returns null for unknown language
  console.log("Test 5: UniMorph returns null for unknown language");
  {
    const result = await scraper.scrapeFromUniMorph("zzz", "to be", "unknown");
    assert(result === null, "Returns null for unknown UniMorph language code");
  }
  console.log();

  // Test 6: UniMorph scrape returns null when no infinitive provided
  console.log("Test 6: UniMorph returns null without infinitive");
  {
    const result = await scraper.scrapeFromUniMorph("eng", "to be");
    assert(result === null, "Returns null when infinitive is undefined");
  }
  console.log();

  // Test 7: Wiktionary scrape returns null for unknown language
  console.log("Test 7: Wiktionary returns null for unknown language");
  {
    const result = await scraper.scrapeFromWiktionary("zzz", "to be", "unknown");
    assert(result === null, "Returns null for unknown Wiktionary language code");
  }
  console.log();

  // Test 8: Parse wikitext with wikilinks in values
  console.log("Test 8: Parse values with wikilinks");
  {
    const wikitext = `
==German==

===Verb===

====Conjugation====
|pres_1sg=[[gehe]]
|pres_2sg=[[gehst|gehst]]
|pres_3sg=[[geht]]
`;

    const result = scraper.parseWiktionaryConjugation(wikitext, "de");
    assert(result !== null, "Parsed conjugation with wikilinks");
    if (result) {
      assert(result.present?.["1sg"] === "gehe", `Resolved [[gehe]] to 'gehe' (got '${result.present?.["1sg"]}')`);
      assert(result.present?.["2sg"] === "gehst", `Resolved [[gehst|gehst]] to 'gehst' (got '${result.present?.["2sg"]}')`);
    }
  }
  console.log();

  // Test 9: Progress callback is called
  console.log("Test 9: Progress callback fires");
  {
    const progressMessages: string[] = [];
    await scraper.scrapeVerbParadigms({
      languageIds: ["zzz"],
      verbs: ["to be"],
      sources: ["unimorph"],
      progressCallback: (p) => progressMessages.push(p.message),
    });
    assert(progressMessages.length > 0, `Progress callback called ${progressMessages.length} time(s)`);
    assert(
      progressMessages.some((m) => m.includes("completed") || m.includes("Scraped")),
      "Received completion message",
    );
  }
  console.log();

  // Test 10: Write paradigms to TSV (using temp file)
  console.log("Test 10: Write paradigms to temp TSV");
  {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpFile = path.join(os.tmpdir(), `test-verb-paradigms-${Date.now()}.tsv`);

    try {
      const entries = [
        {
          id: "",
          languageId: "test",
          verbConcept: "to test",
          infinitiveForm: "tester",
          conjugationTable: { present: { "1sg": "teste", "2sg": "testes" } },
          irregular: false,
          complexityScore: 2,
          notes: "Test entry",
          source: "test",
        },
      ];

      const written = await scraper.writeParadigms(entries, tmpFile);
      assert(written === 1, `Wrote ${written} entry to TSV`);

      const content = fs.readFileSync(tmpFile, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      assert(lines.length === 2, `TSV has header + 1 data line (got ${lines.length})`);
      assert(lines[0].startsWith("id\t"), "First line is header");
      assert(lines[1].startsWith("vp001\t"), `First entry ID is vp001 (got '${lines[1].split("\t")[0]}')`);
      assert(lines[1].includes("tester"), "Contains infinitive form");
      assert(lines[1].includes('"1sg":"teste"'), "Contains conjugation JSON");

      // Write a second entry to test appending
      const entries2 = [
        {
          id: "",
          languageId: "test2",
          verbConcept: "to verify",
          infinitiveForm: "vérifier",
          conjugationTable: { present: { "1sg": "vérifie" } },
          irregular: false,
          complexityScore: 1,
          notes: "Test entry 2",
          source: "test",
        },
      ];

      const written2 = await scraper.writeParadigms(entries2, tmpFile);
      assert(written2 === 1, `Appended ${written2} entry`);

      const content2 = fs.readFileSync(tmpFile, "utf8");
      const lines2 = content2.split("\n").filter((l) => l.trim());
      assert(lines2.length === 3, `TSV now has header + 2 data lines (got ${lines2.length})`);
      assert(lines2[2].startsWith("vp002\t"), `Second entry ID is vp002 (got '${lines2[2].split("\t")[0]}')`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
  console.log();

  // Summary
  console.log("=================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=================================");

  if (failed > 0) {
    process.exit(1);
  }
}

testVerbParadigmScraper().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
