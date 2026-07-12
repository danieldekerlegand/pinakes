import { describe, it, expect } from "vitest";
import {
  readUniqueLanguageRows,
  readWordsGlottocodes,
  curateGlottocodes,
  ENRICHMENT_COLUMNS,
} from "./acquire-language-glottocode";

/** A minimal languages.tsv with only the columns the acquire reads (order-independent). */
function languagesTsv(rows: string[][]): string {
  const header = ["id", "iso639_2", "wikidata_qid", "source_url"];
  return [header, ...rows].map((r) => r.join("\t")).join("\n") + "\n";
}

describe("acquire-language-glottocode (US-006)", () => {
  describe("readUniqueLanguageRows", () => {
    it("keeps unique ids and drops ambiguous ones (an id that recurs can't address one row)", () => {
      const content = languagesTsv([
        ["fin", "fin", "Q1412", "http://www.wikidata.org/entity/Q1412"],
        ["abe", "abe", "Q1301", ""], // duplicated id below → ambiguous
        ["abe", "aog", "", ""],
        ["cor", "cor", "", ""],
      ]);
      const { rows, ambiguousIds } = readUniqueLanguageRows(content);
      expect(rows.map((r) => r.id).sort()).toEqual(["cor", "fin"]);
      expect(ambiguousIds).toBe(2);
      const fin = rows.find((r) => r.id === "fin");
      expect(fin?.wikidataQid).toBe("Q1412");
      expect(fin?.hasProvenance).toBe(true);
      expect(rows.find((r) => r.id === "cor")?.hasProvenance).toBe(false);
    });
  });

  describe("readWordsGlottocodes", () => {
    it("joins Language_ID → Glottocode, dropping a code with conflicting glottocodes", () => {
      const words =
        "Language_ID\tGlottocode\tWord_Form\n" +
        "fin\tfinn1318\tsilmä\n" +
        "fin\tfinn1318\tkorva\n" + // consistent → kept
        "xxx\taaaa1234\tfoo\n" +
        "xxx\tbbbb5678\tbar\n" + // conflicting → dropped
        "\t\t\n";
      const map = readWordsGlottocodes(words);
      expect(map.get("fin")).toBe("finn1318");
      expect(map.has("xxx")).toBe(false);
    });
  });

  describe("curateGlottocodes", () => {
    const rows = readUniqueLanguageRows(
      languagesTsv([
        ["fin", "fin", "Q1412", "http://www.wikidata.org/entity/Q1412"], // Wikidata P1394
        ["cat", "cat", "", ""], // no QID → words.tsv fallback, gets Glottolog provenance
        ["zzz", "zzz", "", ""], // no QID, no words match → skipped
      ]),
    ).rows;
    const wikidata = new Map([["Q1412", "finn1318"]]);
    const words = new Map([
      ["cat", "stan1289"],
      ["fin", "otherxxxx"], // present, but Wikidata must win for the QID row
    ]);
    const built = curateGlottocodes(rows, wikidata, words, "2026-07-12T00:00:00.000Z");

    it("prefers Wikidata P1394 and inherits existing row provenance (glottocode only, no re-stamp)", () => {
      const fin = built.rows.find((r) => r.id === "fin");
      expect(fin?.glottocode).toBe("finn1318"); // Wikidata, not the words.tsv 'otherxxxx'
      expect(fin?.source_url).toBe("");
      expect(fin?.retrieved_at).toBe("");
      expect(fin?.confidence).toBe("");
      expect(fin?.sources).toBe("");
      expect(built.fromWikidata).toBe(1);
    });

    it("stamps Glottolog provenance on a words.tsv-only (no-QID) row", () => {
      const cat = built.rows.find((r) => r.id === "cat");
      expect(cat?.glottocode).toBe("stan1289");
      expect(cat?.source_url).toBe("https://glottolog.org/resource/languoid/id/stan1289");
      expect(cat?.retrieved_at).toBe("2026-07-12T00:00:00.000Z");
      expect(cat?.confidence).toBe("0.9");
      expect(cat?.sources).toContain("Glottolog");
      expect(built.fromWords).toBe(1);
    });

    it("skips a row with no glottocode from either source, and sorts by id", () => {
      expect(built.rows.map((r) => r.id)).toEqual(["cat", "fin"]); // no 'zzz'
    });

    it("emits exactly the write-back columns (id is the join key)", () => {
      expect(ENRICHMENT_COLUMNS).toEqual([
        "id",
        "glottocode",
        "source_url",
        "retrieved_at",
        "confidence",
        "sources",
      ]);
    });
  });
});
