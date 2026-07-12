import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExport,
  writeExport,
  runExport,
  mintCsid,
  parseCoordinates,
  parseCitation,
  deriveSourceUrl,
  normaliseConfidence,
  EXPORT_SOURCE,
  DEFAULT_NODE_CONFIDENCE,
  NODE_PROVENANCE_FIELDS,
  EDGE_PROVENANCE_FIELDS,
} from "./export-for-culturescrape";
import {
  nodeHeaderRow,
  edgeHeaderRow,
  CANONICAL_SCHEMA,
  edgeTypeByName,
} from "@shared/canonical-schema";

/** Write a `{ file: "h1\th2\n r1..." }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-export-"));
  for (const [file, rows] of Object.entries(files)) {
    const content = rows.map((r) => r.join("\t")).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const nodeCol = (field: string) =>
  CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === field);
const edgeCol = (field: string) =>
  CANONICAL_SCHEMA.edge.columns.findIndex((c) => c.field === field);

describe("export-for-culturescrape (US-004)", () => {
  describe("pure helpers", () => {
    it("mints deterministic cs:<type>:<local> ids", () => {
      expect(mintCsid("language", "french")).toBe("cs:language:french");
    });

    it("parses JSON and bare coordinate cells, rejects garbage", () => {
      expect(parseCoordinates('{"lat":31.8,"lng":35.2}')).toEqual({
        lat: 31.8,
        lon: 35.2,
      });
      expect(parseCoordinates("30.9,46.1")).toEqual({ lat: 30.9, lon: 46.1 });
      expect(parseCoordinates("")).toBeNull();
      expect(parseCoordinates("not-coords")).toBeNull();
    });

    it("normalises 0–100 and 0–1 confidence, defaults when blank", () => {
      expect(normaliseConfidence("80")).toBeCloseTo(0.8);
      expect(normaliseConfidence("0.9")).toBeCloseTo(0.9);
      expect(normaliseConfidence("")).toBe(DEFAULT_NODE_CONFIDENCE);
    });
  });

  describe("build over fixtures", () => {
    // Two languages (one with a parent + family) and two families that resolve
    // to each other, plus an archaeological culture with a combined coordinate
    // cell and a JSON predecessor id-list.
    const fixture = () =>
      makeFixtureDir({
        "languages.tsv": [
          [
            "id", "name", "native_name", "iso639_1", "iso639_2", "family_id",
            "parent_language_id", "region", "countries", "native_speakers",
            "total_speakers", "status", "time_origin", "time_end",
            "classification", "writing_system", "is_historical_variant",
            "is_dialect", "chronological_order", "historical_context",
            "latitude", "longitude",
          ],
          [
            "french", "French", "français", "fr", "fra", "romance", "latin",
            "Europe", "", "", "", "", "800", "", "", "latin_script", "", "",
            "", "", "48.8", "2.3",
          ],
          [
            "latin", "Latin", "", "la", "lat", "romance", "",
            "Europe", "", "", "", "", "-700", "600", "", "latin_script", "",
            "", "", "", "41.9", "12.5",
          ],
        ],
        "families.tsv": [
          ["id", "name", "taxonomic_level", "region", "total_speakers",
            "language_count", "parent_id", "description"],
          ["romance", "Romance", "branch", "Europe", "", "", "indo_european",
            "Romance languages"],
          ["indo_european", "Indo-European", "family", "Eurasia", "", "", "",
            "IE family"],
        ],
        "archaeological-cultures.tsv": [
          [
            "id", "name", "region", "coordinates", "boundary_geometry",
            "time_period_start", "time_period_end", "time_period_label",
            "subsistence_pattern", "pottery_style", "burial_practices",
            "material_culture_traits", "probable_language_family",
            "probable_haplogroups", "predecessor_culture_ids",
            "successor_culture_ids", "confidence", "sources", "description",
          ],
          [
            "ppnb", "PPNB", "Levant", '{"lat":31.9,"lng":35.4}', "",
            "-8700", "-6900", "", "", "", "", "", "", "",
            '["ppna"]', "[]", "80", '["Kuijt 2002"]', "desc",
          ],
          [
            "ppna", "PPNA", "Levant", '{"lat":31.8,"lng":35.2}', "",
            "-9500", "-8700", "", "", "", "", "", "", "",
            "[]", "[]", "", "[]", "desc",
          ],
        ],
      });

    it("emits typed canonical headers and stamps linguascrape provenance", () => {
      const dir = fixture();
      try {
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-out-"));
        writeExport(buildExport(dir), outDir);

        const langTsv = fs
          .readFileSync(path.join(outDir, "nodes", "language.tsv"), "utf8")
          .trim()
          .split("\n");
        expect(langTsv[0]).toBe(nodeHeaderRow());
        // Every data row carries the full column count + forced provenance.
        const nCols = CANONICAL_SCHEMA.node.columns.length;
        for (const line of langTsv.slice(1)) {
          const cells = line.split("\t");
          expect(cells).toHaveLength(nCols);
          expect(cells[nodeCol("source")]).toBe(EXPORT_SOURCE);
          expect(cells[nodeCol("source_url")]).toBe("");
          expect(cells[nodeCol("retrieved_at")]).toBe("");
          expect(Number(cells[nodeCol("confidence")])).toBeGreaterThanOrEqual(0);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("mints csids, keeps linguascrape_id, and splits combined coordinates", () => {
      const dir = fixture();
      try {
        const { nodeGroups } = buildExport(dir);
        const langRows = nodeGroups.get("language")!;
        // Sorted by csid → cs:language:french before cs:language:latin.
        const french = langRows[0];
        expect(french[nodeCol("csid")]).toBe("cs:language:french");
        expect(french[nodeCol(":LABEL")]).toBe("Language");
        expect(french[nodeCol("linguascrape_id")]).toBe("french");
        expect(french[nodeCol("name")]).toBe("French");
        expect(french[nodeCol("language_code")]).toBe("fr");
        expect(french[nodeCol("lat")]).toBe("48.8");
        expect(french[nodeCol("time_start")]).toBe("800");

        const arch = nodeGroups.get("archaeological-culture")!;
        const ppnb = arch.find((r) => r[nodeCol("csid")] === "cs:archaeological-culture:ppnb")!;
        // combined {"lat","lng"} coordinate → lat/lon columns.
        expect(ppnb[nodeCol("lat")]).toBe("31.9");
        expect(ppnb[nodeCol("lon")]).toBe("35.4");
        // confidence 80 → 0.8; blank row → default.
        expect(Number(ppnb[nodeCol("confidence")])).toBeCloseTo(0.8);
        const ppna = arch.find((r) => r[nodeCol("csid")] === "cs:archaeological-culture:ppna")!;
        expect(Number(ppna[nodeCol("confidence")])).toBe(DEFAULT_NODE_CONFIDENCE);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rewrites edge endpoints to node csids with typed header + provenance", () => {
      const dir = fixture();
      try {
        const { edgeGroups } = buildExport(dir);
        const descends = edgeGroups.get("descended-from")!;
        // french→latin, french→romance, latin→romance, romance→indo_european.
        const findEdge = (start: string, end: string) =>
          descends.find(
            (r) => r[edgeCol(":START_ID")] === start && r[edgeCol(":END_ID")] === end,
          );

        const frToLatin = findEdge("cs:language:french", "cs:language:latin")!;
        expect(frToLatin[edgeCol(":TYPE")]).toBe(edgeTypeByName("descended-from")!.type);
        expect(frToLatin[edgeCol("source")]).toBe(EXPORT_SOURCE);
        expect(frToLatin).toHaveLength(CANONICAL_SCHEMA.edge.columns.length);

        expect(findEdge("cs:language:french", "cs:language-family:romance")).toBeDefined();
        expect(findEdge("cs:language-family:romance", "cs:language-family:indo_european")).toBeDefined();

        // predecessor_culture_ids → descended-from between archaeological cultures.
        expect(
          findEdge("cs:archaeological-culture:ppnb", "cs:archaeological-culture:ppna"),
        ).toBeDefined();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports (never emits) edges whose endpoint has no exported node", () => {
      // A dedicated edge table referencing ids that are not exported nodes.
      const dir = makeFixtureDir({
        "cultural-lineages.tsv": [
          ["id", "source_id", "source_name", "target_id", "target_name",
            "relationship_type", "time_start", "time_end", "confidence",
            "evidence_types", "description", "sources"],
          ["cl1", "ghost_a", "A", "ghost_b", "B", "split-from", "", "", "50",
            "[]", "d", "[]"],
        ],
      });
      try {
        const { edgeGroups, manifest } = buildExport(dir);
        expect(edgeGroups.size).toBe(0);
        expect(manifest.diagnostics.edgesWithUnresolvedEndpoint).toBe(1);
        expect(manifest.diagnostics.unresolvedEndpointSamples[0]).toMatchObject({
          startId: "ghost_a",
          endId: "ghost_b",
          edgeName: "split-from",
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("is idempotent — two runs produce byte-identical output", () => {
      const dir = fixture();
      try {
        const outA = fs.mkdtempSync(path.join(os.tmpdir(), "ls-a-"));
        const outB = fs.mkdtempSync(path.join(os.tmpdir(), "ls-b-"));
        const doc = path.join(outA, "manifest-doc.json");
        runExport({ lexiconsDir: dir, outDir: outA, docManifestPath: doc });
        runExport({ lexiconsDir: dir, outDir: outB, docManifestPath: doc });
        const read = (root: string, rel: string) =>
          fs.readFileSync(path.join(root, rel), "utf8");
        expect(read(outA, "nodes/language.tsv")).toBe(read(outB, "nodes/language.tsv"));
        expect(read(outA, "edges/descended-from.tsv")).toBe(
          read(outB, "edges/descended-from.tsv"),
        );
        expect(read(outA, "manifest.json")).toBe(read(outB, "manifest.json"));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("live corpus", () => {
    let outDir: string;
    beforeAll(() => {
      outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-live-"));
      writeExport(buildExport(), outDir);
    });
    afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

    it("writes every node/edge file with the canonical header and provenance columns", () => {
      const nCols = CANONICAL_SCHEMA.node.columns.length;
      const eCols = CANONICAL_SCHEMA.edge.columns.length;
      for (const f of fs.readdirSync(path.join(outDir, "nodes"))) {
        const lines = fs.readFileSync(path.join(outDir, "nodes", f), "utf8").trim().split("\n");
        expect(lines[0]).toBe(nodeHeaderRow());
        for (const line of lines.slice(1)) {
          const cells = line.split("\t");
          expect(cells).toHaveLength(nCols);
          expect(cells[nodeCol("source")]).toBe(EXPORT_SOURCE);
          expect(cells[nodeCol("csid")]).toMatch(/^cs:[a-z-]+:/);
        }
      }
      for (const f of fs.readdirSync(path.join(outDir, "edges"))) {
        const lines = fs.readFileSync(path.join(outDir, "edges", f), "utf8").trim().split("\n");
        expect(lines[0]).toBe(edgeHeaderRow());
        for (const line of lines.slice(1)) {
          const cells = line.split("\t");
          expect(cells).toHaveLength(eCols);
          expect(cells[edgeCol("source")]).toBe(EXPORT_SOURCE);
          // endpoints reference exported node csids.
          expect(cells[edgeCol(":START_ID")]).toMatch(/^cs:/);
          expect(cells[edgeCol(":END_ID")]).toMatch(/^cs:/);
        }
      }
    });

    it("produces a manifest whose counts match the emitted rows", () => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"),
      );
      expect(manifest.source).toBe(EXPORT_SOURCE);
      expect(manifest.totals.nodes).toBeGreaterThan(0);
      for (const nt of manifest.nodeTypes) {
        const lines = fs
          .readFileSync(path.join(outDir, nt.file), "utf8")
          .trim()
          .split("\n");
        expect(lines.length - 1).toBe(nt.count);
      }
    });
  });
});

describe("provenance propagation (US-006)", () => {
  describe("pure helpers", () => {
    it("preserves JSON-array and plain citations, never fabricates", () => {
      expect(parseCitation('["Kuijt 2002","Cauvin 2000"]')).toBe(
        "Kuijt 2002; Cauvin 2000",
      );
      expect(parseCitation("Homer Iliad")).toBe("Homer Iliad");
      expect(parseCitation("")).toBe("");
      expect(parseCitation("[]")).toBe("");
    });

    it("derives a source_url only from a real URL, else blank", () => {
      expect(deriveSourceUrl("see https://example.org/x for detail")).toBe(
        "https://example.org/x",
      );
      expect(deriveSourceUrl("http://a.test/1", "https://b.test/2")).toBe(
        "http://a.test/1",
      );
      // No URL present → blank (never fabricated).
      expect(deriveSourceUrl("Homer Iliad", "")).toBe("");
      expect(deriveSourceUrl()).toBe("");
    });
  });

  // An archaeological-culture whose `sources` is a citation list (no URL) plus a
  // deity whose `sources` embeds a real URL — exercises both preservation paths.
  const fixture = () =>
    makeFixtureDir({
      "archaeological-cultures.tsv": [
        [
          "id", "name", "region", "coordinates", "boundary_geometry",
          "time_period_start", "time_period_end", "time_period_label",
          "subsistence_pattern", "pottery_style", "burial_practices",
          "material_culture_traits", "probable_language_family",
          "probable_haplogroups", "predecessor_culture_ids",
          "successor_culture_ids", "confidence", "sources", "description",
        ],
        [
          "ppnb", "PPNB", "Levant", "", "", "-8700", "-6900", "", "", "", "",
          "", "", "", "[]", "[]", "80", '["Kuijt 2002","Cauvin 2000"]', "desc",
        ],
      ],
      "deities.tsv": [
        ["id", "name", "culture", "domain", "description", "sources"],
        [
          "zeus", "Zeus", "Greek", "sky",
          "king of the gods", '["Hesiod https://example.org/theogony"]',
        ],
      ],
    });

  it("preserves the original citation in source_query, keeps source=linguascrape", () => {
    const dir = fixture();
    try {
      const { nodeGroups } = buildExport(dir);
      const q = (field: string) =>
        CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === field);
      const ppnb = nodeGroups.get("archaeological-culture")![0];
      expect(ppnb[q("source")]).toBe(EXPORT_SOURCE);
      expect(ppnb[q("source_query")]).toBe("Kuijt 2002; Cauvin 2000");
      // No URL in the citation → source_url blank (never fabricated).
      expect(ppnb[q("source_url")]).toBe("");
      expect(ppnb[q("retrieved_at")]).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives source_url from a citation that embeds a real URL", () => {
    const dir = fixture();
    try {
      const { nodeGroups } = buildExport(dir);
      const q = (field: string) =>
        CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === field);
      const zeus = nodeGroups.get("deity")![0];
      expect(zeus[q("source_url")]).toBe("https://example.org/theogony");
      expect(zeus[q("source_query")]).toBe("Hesiod https://example.org/theogony");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("propagates a lexicon source_url/retrieved_at verbatim; blank stays blank (US-004)", () => {
    // archaeological-cultures maps `source_url`/`retrieved_at` columns. One row is
    // acquired (carries a Wikidata entity URL + timestamp), one is curated without.
    const dir = makeFixtureDir({
      "archaeological-cultures.tsv": [
        [
          "id", "name", "region", "coordinates", "boundary_geometry",
          "time_period_start", "time_period_end", "time_period_label",
          "subsistence_pattern", "pottery_style", "burial_practices",
          "material_culture_traits", "probable_language_family",
          "probable_haplogroups", "predecessor_culture_ids",
          "successor_culture_ids", "confidence", "sources", "description",
          "source_url", "retrieved_at",
        ],
        [
          "clovis", "Clovis", "Americas", "", "", "-13050", "-12750", "", "",
          "", "", "", "", "", "[]", "[]", "90", "[]", "desc",
          "https://www.wikidata.org/entity/Q484725", "2026-01-15",
        ],
        [
          "ppna", "PPNA", "Levant", "", "", "-9500", "-8700", "", "", "", "",
          "", "", "", "[]", "[]", "", "[]", "desc", "", "",
        ],
      ],
    });
    try {
      const { nodeGroups, manifest } = buildExport(dir);
      const q = (field: string) =>
        CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === field);
      const rows = nodeGroups.get("archaeological-culture")!;
      const byId = (id: string) =>
        rows.find((r) => r[q("linguascrape_id")] === id)!;

      // Acquired row: URL + timestamp survive verbatim (not fabricated, not dropped).
      const clovis = byId("clovis");
      expect(clovis[q("source_url")]).toBe(
        "https://www.wikidata.org/entity/Q484725",
      );
      expect(clovis[q("retrieved_at")]).toBe("2026-01-15");

      // Curated row without provenance: both stay blank (never fabricated).
      const ppna = byId("ppna");
      expect(ppna[q("source_url")]).toBe("");
      expect(ppna[q("retrieved_at")]).toBe("");

      // Coverage now rises above zero for both columns.
      expect(manifest.provenance.node.nonEmpty.source_url).toBe(1);
      expect(manifest.provenance.node.nonEmpty.retrieved_at).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports per-type provenance coverage + flags in the manifest", () => {
    const dir = fixture();
    try {
      const { manifest } = buildExport(dir);
      const prov = manifest.provenance;
      // `source` is present on 100% of rows ("no fact without a source").
      expect(prov.node.nonEmpty.source).toBe(prov.node.total);
      // One of the two nodes has a citation → source_query non-empty count.
      expect(prov.node.nonEmpty.source_query).toBeGreaterThan(0);
      expect(prov.node.fields).toEqual([...NODE_PROVENANCE_FIELDS]);
      expect(prov.edge.fields).toEqual([...EDGE_PROVENANCE_FIELDS]);
      // Flags surface the blank-but-expected columns (never-fabricated URLs, etc.).
      expect(prov.flags.some((f) => f.startsWith("node.retrieved_at:"))).toBe(true);
      expect(prov.flags.some((f) => f.startsWith("node.source_query:"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("live corpus", () => {
    it("every exported row carries all provenance columns (AC4)", () => {
      const { nodeGroups, edgeGroups } = buildExport();
      const nCols = CANONICAL_SCHEMA.node.columns.length;
      const eCols = CANONICAL_SCHEMA.edge.columns.length;
      const nSource = CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === "source");
      const nConf = CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === "confidence");
      const eSource = CANONICAL_SCHEMA.edge.columns.findIndex((c) => c.field === "source");
      const eConf = CANONICAL_SCHEMA.edge.columns.findIndex((c) => c.field === "confidence");

      let nodeRows = 0;
      for (const rows of nodeGroups.values()) {
        for (const row of rows) {
          expect(row).toHaveLength(nCols);
          expect(row[nSource]).toBe(EXPORT_SOURCE); // 100% carry a source
          const conf = Number(row[nConf]);
          expect(conf).toBeGreaterThanOrEqual(0);
          expect(conf).toBeLessThanOrEqual(1);
          nodeRows += 1;
        }
      }
      let edgeRows = 0;
      for (const rows of edgeGroups.values()) {
        for (const row of rows) {
          expect(row).toHaveLength(eCols);
          expect(row[eSource]).toBe(EXPORT_SOURCE);
          const conf = Number(row[eConf]);
          expect(conf).toBeGreaterThanOrEqual(0);
          expect(conf).toBeLessThanOrEqual(1);
          edgeRows += 1;
        }
      }
      expect(nodeRows).toBeGreaterThan(0);
      expect(edgeRows).toBeGreaterThan(0);
    });

    it("committed manifest snapshot matches a fresh build's provenance coverage", () => {
      const fresh = buildExport();
      const snapshot = JSON.parse(
        fs.readFileSync(
          path.resolve(import.meta.dirname, "..", "docs", "culturescrape-export-manifest.json"),
          "utf8",
        ),
      );
      expect(snapshot.provenance).toEqual(fresh.manifest.provenance);
    });
  });
});
