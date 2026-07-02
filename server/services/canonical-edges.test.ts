import { describe, it, expect } from "vitest";
import {
  extractEdgesFromLexicon,
  extractAllCanonicalEdges,
  edgeBearingFiles,
  DEFAULT_EDGE_CONFIDENCE,
  type CanonicalEdge,
} from "./canonical-edges";
import { edgeTypeByName } from "@shared/canonical-schema";

/** Find the single edge matching a start→end pair (fails the test if absent). */
function edge(edges: CanonicalEdge[], startId: string, endId: string): CanonicalEdge {
  const match = edges.filter((e) => e.startId === startId && e.endId === endId);
  expect(match, `edge ${startId}->${endId}`).toHaveLength(1);
  return match[0];
}

describe("canonical edge extraction (US-003)", () => {
  describe("edge tables", () => {
    it("extracts cultural-lineages with type translation, time range, provenance", () => {
      const headers = [
        "id", "source_id", "source_name", "target_id", "target_name",
        "relationship_type", "time_start", "time_end", "confidence",
        "evidence_types", "description", "sources",
      ];
      const rows = [
        // split-from → SPLIT_FROM, 0–100 confidence normalised, JSON sources joined
        ["cl-001", "proto_indo_european", "PIE", "proto_anatolian", "Anatolian",
          "split-from", "-4500", "-3500", "80", '["linguistic"]', "desc",
          '["Anthony 2007","Ringe 2006"]'],
        // evolved-into → DESCENDS_FROM
        ["cl-002", "latin", "Latin", "french", "French",
          "evolved-into", "800", "1200", "90", "[]", "desc", '["Smith 2001"]'],
        // vague association → skipped-type (no canonical home)
        ["cl-003", "a", "A", "b", "B", "possibly-associated", "", "", "50", "[]", "d", "[]"],
      ];

      const { edges, skipped } = extractEdgesFromLexicon(
        "cultural-lineages.tsv", headers, rows,
      );

      expect(edges).toHaveLength(2);

      const split = edge(edges, "proto_indo_european", "proto_anatolian");
      expect(split.type).toBe(edgeTypeByName("split-from")!.type);
      expect(split.edgeName).toBe("split-from");
      expect(split.timeStart).toBe(-4500);
      expect(split.timeEnd).toBe(-3500);
      expect(split.provenance.confidence).toBeCloseTo(0.8);
      expect(split.provenance.source).toBe("Anthony 2007; Ringe 2006");
      expect(split.linguascrapeId).toBe("cl-001");
      expect(split.sourceFile).toBe("cultural-lineages.tsv");

      const evolved = edge(edges, "latin", "french");
      expect(evolved.type).toBe(edgeTypeByName("descended-from")!.type);
      expect(evolved.provenance.confidence).toBeCloseTo(0.9);

      // The vague relationship was recognised-but-skipped, not silently dropped.
      expect(skipped).toContainEqual({
        sourceFile: "cultural-lineages.tsv",
        reason: "skipped-type",
        value: "possibly-associated",
      });
    });

    it("reports unmapped relationship tokens instead of guessing", () => {
      const headers = [
        "id", "source_id", "source_name", "target_id", "target_name",
        "relationship_type", "time_start", "time_end", "confidence",
        "evidence_types", "description", "sources",
      ];
      const rows = [
        ["cl-9", "x", "X", "y", "Y", "teleported-from", "", "", "", "[]", "d", "[]"],
      ];
      const { edges, skipped } = extractEdgesFromLexicon(
        "cultural-lineages.tsv", headers, rows,
      );
      expect(edges).toHaveLength(0);
      expect(skipped).toContainEqual({
        sourceFile: "cultural-lineages.tsv",
        reason: "unmapped-type",
        value: "teleported-from",
      });
    });

    it("maps etymology relation vocabulary onto canonical edges", () => {
      const headers = [
        "id", "source_word", "source_language", "target_word",
        "target_language", "relation_type",
      ];
      const rows = [
        ["e1", "table", "english", "tabula", "latin", "borrowed_from"],
        ["e2", "night", "english", "nacht", "german", "cognate"],
        ["e3", "rascacielos", "spanish", "skyscraper", "english", "calque"],
        ["e4", "x", "a", "y", "b", "etymology"], // generic → skipped
      ];
      const { edges, skipped } = extractEdgesFromLexicon(
        "etymology-relations.tsv", headers, rows,
      );
      expect(edges.map((e) => e.edgeName).sort()).toEqual([
        "borrowed-from", "borrowed-from", "cognate-with",
      ]);
      // No confidence column → default; no sources column → falls back to filename.
      const borrowed = edge(edges, "english", "latin");
      expect(borrowed.provenance.confidence).toBe(DEFAULT_EDGE_CONFIDENCE);
      expect(borrowed.provenance.source).toBe("etymology-relations.tsv");
      expect(borrowed.timeStart).toBeNull();
      expect(skipped).toContainEqual({
        sourceFile: "etymology-relations.tsv",
        reason: "skipped-type",
        value: "etymology",
      });
    });

    it("collapses language-contact strata to influenced-by", () => {
      const headers = [
        "id", "source_language_id", "target_language_id", "contact_type",
        "time_period", "region", "features_transferred", "example_features",
        "intensity",
      ];
      const rows = [
        ["c1", "norman_french", "english", "superstrate", "1066", "England", "", "", "high"],
        ["c2", "brittonic", "english", "substrate", "", "", "", "", "low"],
      ];
      const { edges } = extractEdgesFromLexicon("language-contacts.tsv", headers, rows);
      expect(edges).toHaveLength(2);
      for (const e of edges) {
        expect(e.edgeName).toBe("influenced-by");
        expect(e.type).toBe(edgeTypeByName("influenced-by")!.type);
      }
    });

    it("skips rows with a missing endpoint or a self-reference", () => {
      const headers = [
        "id", "source_id", "source_name", "target_id", "target_name",
        "relationship_type", "time_start", "time_end", "confidence",
        "evidence_types", "description", "sources",
      ];
      const rows = [
        ["cl-a", "", "", "b", "B", "split-from", "", "", "", "[]", "d", "[]"],
        ["cl-b", "x", "X", "x", "X", "split-from", "", "", "", "[]", "d", "[]"],
      ];
      const { edges, skipped } = extractEdgesFromLexicon(
        "cultural-lineages.tsv", headers, rows,
      );
      expect(edges).toHaveLength(0);
      expect(skipped.map((s) => s.reason).sort()).toEqual([
        "missing-endpoint", "self-reference",
      ]);
    });
  });

  describe("embedded foreign-key edges", () => {
    it("extracts languages.family_id and parent_language_id as descended-from", () => {
      const headers = [
        "id", "name", "native_name", "iso639_1", "iso639_2", "family_id",
        "parent_language_id", "region", "countries", "native_speakers",
        "total_speakers", "status", "time_origin", "time_end", "classification",
        "writing_system", "is_historical_variant", "is_dialect",
        "chronological_order", "historical_context", "latitude", "longitude",
      ];
      const rows = [
        // family_id set, parent_language_id set
        ["french", "French", "", "fr", "fra", "indo_european__romance", "latin",
          ...Array(15).fill("")],
        // family_id set, parent_language_id empty
        ["cmn", "Mandarin", "", "zh", "zho", "sino_tibetan__sinitic", "",
          ...Array(15).fill("")],
      ];
      const { edges } = extractEdgesFromLexicon("languages.tsv", headers, rows);
      const descends = edgeTypeByName("descended-from")!.type;

      const toFamily = edge(edges, "french", "indo_european__romance");
      expect(toFamily.type).toBe(descends);
      expect(toFamily.timeStart).toBeNull();
      expect(toFamily.provenance.confidence).toBe(DEFAULT_EDGE_CONFIDENCE);
      expect(toFamily.linguascrapeId).toBeNull();

      const toParent = edge(edges, "french", "latin");
      expect(toParent.type).toBe(descends);

      // cmn has an empty parent_language_id — no dangling edge to "".
      expect(edges.filter((e) => e.startId === "cmn")).toHaveLength(1);
      expect(edges.every((e) => e.endId !== "")).toBe(true);
    });

    it("splits JSON id-lists and carries row provenance (archaeological-cultures)", () => {
      const headers = [
        "id", "name", "region", "coordinates", "boundary_geometry",
        "time_period_start", "time_period_end", "time_period_label",
        "subsistence_pattern", "pottery_style", "burial_practices",
        "material_culture_traits", "probable_language_family",
        "probable_haplogroups", "predecessor_culture_ids",
        "successor_culture_ids", "confidence", "sources", "description",
      ];
      const rows = [
        ["ppnb", "PPNB", "Levant", "", "", "-8700", "-6900", "", "", "", "", "",
          "", "", '["ppna","natufian"]', '["pottery-neolithic"]', "80",
          '["Kuijt 2002","Cauvin 2000"]', "desc"],
      ];
      const { edges } = extractEdgesFromLexicon(
        "archaeological-cultures.tsv", headers, rows,
      );
      const descends = edgeTypeByName("descended-from")!.type;
      const absorbed = edgeTypeByName("absorbed-into")!.type;

      // predecessor_culture_ids → descended-from (one per list element)
      expect(edge(edges, "ppnb", "ppna").type).toBe(descends);
      expect(edge(edges, "ppnb", "natufian").type).toBe(descends);
      // successor_culture_ids → absorbed-into
      const succ = edge(edges, "ppnb", "pottery-neolithic");
      expect(succ.type).toBe(absorbed);
      // provenance normalised from the row's confidence + JSON sources
      expect(succ.provenance.confidence).toBeCloseTo(0.8);
      expect(succ.provenance.source).toBe("Kuijt 2002; Cauvin 2000");
    });

    it("extracts deities.syncretism_links as syncretized-with", () => {
      const headers = [
        "id", "name", "native_name", "pantheon", "domain", "gender",
        "syncretism_links", "associated_religion_ids", "associated_language_ids",
        "time_origin", "time_end", "coordinates", "description", "sources",
      ];
      const rows = [
        ["zeus", "Zeus", "", "greek", "sky", "m", '["jupiter","indra"]',
          "", "", "", "", "", "", '["Hesiod Theogony"]'],
      ];
      const { edges } = extractEdgesFromLexicon("deities.tsv", headers, rows);
      const syncretized = edgeTypeByName("syncretized-with")!.type;
      expect(edges).toHaveLength(2);
      expect(edge(edges, "zeus", "jupiter").type).toBe(syncretized);
      expect(edge(edges, "zeus", "indra").type).toBe(syncretized);
      expect(edge(edges, "zeus", "jupiter").provenance.source).toBe("Hesiod Theogony");
    });
  });

  describe("whole-corpus extraction (live lexicons)", () => {
    it("covers every declared edge-bearing file and only valid canonical types", () => {
      const files = edgeBearingFiles();
      // The US-002 mapping's edge tables + embedded-FK files must all be here.
      expect(files).toEqual(
        expect.arrayContaining([
          "cultural-lineages.tsv", "etymology-relations.tsv",
          "language-contacts.tsv", "art-style-evolutions.tsv",
          "languages.tsv", "families.tsv", "writing-systems.tsv",
          "archaeological-cultures.tsv", "deities.tsv",
        ]),
      );

      const { edges } = extractAllCanonicalEdges();
      expect(edges.length).toBeGreaterThan(0);
      for (const e of edges) {
        // Every emitted edge resolves to a real canonical type and token.
        expect(edgeTypeByName(e.edgeName)?.type).toBe(e.type);
        expect(e.startId).not.toBe("");
        expect(e.endId).not.toBe("");
        expect(e.startId).not.toBe(e.endId);
        expect(e.provenance.confidence).toBeGreaterThanOrEqual(0);
        expect(e.provenance.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});
