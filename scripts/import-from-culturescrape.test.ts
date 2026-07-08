import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildWriteBack,
  serializeLexiconFile,
  NON_WRITEBACK_FIELDS,
  runCultureAdditions,
  ADDITION_PROVENANCE_COLUMNS,
} from "./import-from-culturescrape";
import { buildExport, writeExport } from "./export-for-culturescrape";
import { CANONICAL_SCHEMA } from "@shared/canonical-schema";

/** Write a `{ file: rows[][] }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-import-"));
  for (const [file, rows] of Object.entries(files)) {
    const content = rows.map((r) => r.join("\t")).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

/** Export a lexicons dir into a fresh temp canonical dir and return that dir. */
function exportTo(lexiconsDir: string): string {
  const canon = fs.mkdtempSync(path.join(os.tmpdir(), "ls-canon-"));
  writeExport(buildExport(lexiconsDir), canon);
  return canon;
}

const nodeCol = (field: string) =>
  CANONICAL_SCHEMA.node.columns.findIndex((c) => c.field === field);

/** Overwrite a cell in `<canon>/nodes/<type>.tsv` for the row with the given ls id. */
function editCanonicalCell(
  canonDir: string,
  type: string,
  lsId: string,
  field: string,
  value: string,
): void {
  const p = path.join(canonDir, "nodes", `${type}.tsv`);
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const idIdx = nodeCol("linguascrape_id");
  const fIdx = nodeCol(field);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const cells = lines[i].split("\t");
    if (cells[idIdx] === lsId) {
      cells[fIdx] = value;
      lines[i] = cells.join("\t");
    }
  }
  fs.writeFileSync(p, lines.join("\n"));
}

/** Read one lexicon file's cell for the row with the given id. */
function lexiconCell(
  dir: string,
  file: string,
  idColumn: string,
  id: string,
  column: string,
): string {
  const lines = fs
    .readFileSync(path.join(dir, file), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const headers = lines[0].split("\t");
  const idIdx = headers.indexOf(idColumn);
  const cIdx = headers.indexOf(column);
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (cells[idIdx] === id) return cells[cIdx] ?? "";
  }
  return "";
}

/** A two-language, two-family, one-archaeological-culture fixture (no duplicate ids). */
function fullFixture(): string {
  return makeFixtureDir({
    "languages.tsv": [
      [
        "id", "name", "native_name", "iso639_1", "iso639_2", "family_id",
        "parent_language_id", "region", "time_origin", "time_end",
        "writing_system", "latitude", "longitude",
      ],
      [
        "french", "French", "français", "fr", "fra", "romance", "latin",
        "Europe", "800", "", "latin_script", "48.8", "2.3",
      ],
      [
        "latin", "Latin", "", "la", "lat", "romance", "",
        "Europe", "-700", "600", "latin_script", "41.9", "12.5",
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
        "[]", "[]", "80", '["Kuijt 2002"]', "desc",
      ],
    ],
  });
}

describe("import-from-culturescrape / write-back (US-007)", () => {
  it("round-trips export→import with no data loss (AC3): a pure no-op", () => {
    const dir = fullFixture();
    try {
      const canon = exportTo(dir);
      const before = new Map(
        fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]),
      );

      const { files, report } = buildWriteBack(canon, dir);

      // Nothing filled, nothing conflicts, nothing changed — the two stores agree.
      expect(report.totals.enrichments).toBe(0);
      expect(report.totals.overwrites).toBe(0);
      expect(report.totals.conflicts).toBe(0);
      expect(report.totals.filesChanged).toBe(0);
      expect(report.totals.nodesMatched).toBeGreaterThan(0);

      // Every parsed file re-serialises byte-for-byte identical to the original.
      for (const [file, original] of before) {
        const parsed = files.get(file);
        if (parsed === undefined) continue;
        expect(parsed.changed).toBe(false);
        expect(serializeLexiconFile(parsed)).toBe(original);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fills a lexicon gap from the graph return (enrichment where a mapping exists)", () => {
    const dir = fullFixture();
    try {
      const canon = exportTo(dir);
      // Latin's native_name (→ canonical `aliases`) is blank; the graph supplies one.
      editCanonicalCell(canon, "language", "latin", "aliases", "Latina");

      const { files, report } = buildWriteBack(canon, dir);

      expect(report.totals.enrichments).toBe(1);
      expect(report.totals.conflicts).toBe(0);
      const change = report.changes.find((c) => c.linguascrapeId === "latin");
      expect(change).toMatchObject({
        file: "languages.tsv",
        field: "aliases",
        column: "native_name",
        oldValue: "",
        newValue: "Latina",
        kind: "enrichment",
      });
      // The edited file, re-serialised, carries the new value; French is untouched.
      const langs = serializeLexiconFile(files.get("languages.tsv")!);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-w-"));
      fs.writeFileSync(path.join(tmp, "languages.tsv"), langs);
      expect(lexiconCell(tmp, "languages.tsv", "id", "latin", "native_name")).toBe("Latina");
      expect(lexiconCell(tmp, "languages.tsv", "id", "french", "native_name")).toBe("français");
      fs.rmSync(tmp, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a conflict, never silently resolving it (AC4); --overwrite applies it", () => {
    const dir = fullFixture();
    try {
      const canon = exportTo(dir);
      // The graph disagrees with a curated name.
      editCanonicalCell(canon, "language", "french", "name", "Frankish");

      // Default: reported, not applied.
      const noWrite = buildWriteBack(canon, dir);
      expect(noWrite.report.totals.enrichments).toBe(0);
      expect(noWrite.report.totals.overwrites).toBe(0);
      expect(noWrite.report.totals.conflicts).toBe(1);
      expect(noWrite.report.conflicts[0]).toMatchObject({
        file: "languages.tsv",
        linguascrapeId: "french",
        field: "name",
        curatedValue: "French",
        incomingValue: "Frankish",
        incomingSource: "linguascrape",
      });
      expect(noWrite.files.get("languages.tsv")!.changed).toBe(false);

      // With overwrite: still reported as a conflict, but now applied.
      const withWrite = buildWriteBack(canon, dir, { overwrite: true });
      expect(withWrite.report.totals.conflicts).toBe(1);
      expect(withWrite.report.totals.overwrites).toBe(1);
      const change = withWrite.report.changes.find((c) => c.field === "name");
      expect(change).toMatchObject({ oldValue: "French", newValue: "Frankish", kind: "overwrite" });
      expect(withWrite.files.get("languages.tsv")!.changed).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves LinguaScrape-owned provenance columns (AC2): never written, never conflicted", () => {
    const dir = fullFixture();
    try {
      const canon = exportTo(dir);
      // Change the canonical provenance/confidence for ppnb — all non-writeback fields.
      editCanonicalCell(canon, "archaeological-culture", "ppnb", "confidence", "0.05");
      editCanonicalCell(canon, "archaeological-culture", "ppnb", "source_query", "Graph Cite");
      editCanonicalCell(canon, "archaeological-culture", "ppnb", "source", "graph");

      const { files, report } = buildWriteBack(canon, dir);

      // No change or conflict touches a provenance / identity column.
      const provTouched = [...report.changes, ...report.conflicts].filter((c) =>
        NON_WRITEBACK_FIELDS.has(c.field),
      );
      expect(provTouched).toEqual([]);
      // The curated lexicon confidence / sources survive verbatim.
      const arch = files.get("archaeological-cultures.tsv")!;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-p-"));
      fs.writeFileSync(path.join(tmp, "archaeological-cultures.tsv"), serializeLexiconFile(arch));
      expect(lexiconCell(tmp, "archaeological-cultures.tsv", "id", "ppnb", "confidence")).toBe("80");
      expect(lexiconCell(tmp, "archaeological-cultures.tsv", "id", "ppnb", "sources")).toBe('["Kuijt 2002"]');
      fs.rmSync(tmp, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips (never writes) an id reused within one lexicon file — ambiguous join key", () => {
    // `abe` names two distinct languages in one file (as the live corpus does).
    const dir = makeFixtureDir({
      "languages.tsv": [
        ["id", "name", "native_name", "iso639_1", "time_origin"],
        ["abe", "Western Abenaki", "", "", "1600"],
        ["abe", "Great Andamanese", "", "", "1800"],
      ],
    });
    try {
      const canon = exportTo(dir);
      // Try to enrich the (deduped) survivor's blank alias — must be refused.
      editCanonicalCell(canon, "language", "abe", "aliases", "SHOULD-NOT-WRITE");

      const { files, report } = buildWriteBack(canon, dir);

      expect(report.totals.enrichments).toBe(0);
      expect(report.totals.conflicts).toBe(0);
      expect(report.totals.skippedAmbiguousIds).toBe(1);
      expect(report.ambiguousIds[0]).toMatchObject({
        file: "languages.tsv",
        nodeType: "language",
        linguascrapeId: "abe",
        lexiconRows: 2,
      });
      expect(files.get("languages.tsv")!.changed).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips an id reused across two files of the same node type (cross-file ambiguity)", () => {
    // The same id in two files that both map to `place` — the export dedups to one
    // canonical row, so the id cannot address a single lexicon row.
    const dir = makeFixtureDir({
      "archaeological-sites.tsv": [
        ["id", "name", "time_period_start"],
        ["shared-site", "Site (dig record)", "-2600"],
      ],
      "settlements.tsv": [
        ["id", "name", "founded_year"],
        ["shared-site", "Site (settlement record)", "-2500"],
      ],
    });
    try {
      const canon = exportTo(dir);
      const { report } = buildWriteBack(canon, dir);

      expect(report.totals.enrichments).toBe(0);
      expect(report.totals.skippedAmbiguousIds).toBe(1);
      expect(report.ambiguousIds[0]).toMatchObject({
        nodeType: "place",
        linguascrapeId: "shared-site",
        lexiconRows: 2,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts canonical rows with no lexicon home as unmatched (graph-only, not written)", () => {
    const dir = fullFixture();
    try {
      const canon = exportTo(dir);
      // Append a graph-only language row that has no lexicon counterpart.
      const p = path.join(canon, "nodes", "language.tsv");
      const lines = fs.readFileSync(p, "utf8").trimEnd().split("\n");
      const cells = new Array(CANONICAL_SCHEMA.node.columns.length).fill("");
      cells[nodeCol("csid")] = "cs:language:klingon";
      cells[nodeCol(":LABEL")] = "Language";
      cells[nodeCol("linguascrape_id")] = "klingon";
      cells[nodeCol("name")] = "Klingon";
      cells[nodeCol("source")] = "graph";
      fs.writeFileSync(p, [...lines, cells.join("\t")].join("\n") + "\n");

      const { report } = buildWriteBack(canon, dir);
      expect(report.totals.unmatchedCanonicalNodes).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("new-culture additions (US-003)", () => {
    /** A civilizations.tsv fixture (no provenance columns yet) + a candidate additions TSV. */
    function additionsFixture(candidateRows: string[][]): {
      lexiconsDir: string;
      additionsFile: string;
      outDir: string;
    } {
      const lexiconsDir = makeFixtureDir({
        "civilizations.tsv": [
          ["id", "name", "native_name", "time_period_start", "sources", "description"],
          ["roman-empire", "Roman Empire", "Imperium Romanum", "-27", '["Records"]', "Rome"],
          ["ancient-greece", "Ancient Greece", "", "-800", "[]", "Greek city-states"],
        ],
      });
      const additionsFile = path.join(lexiconsDir, "additions.tsv");
      const header = [
        "id", "name", "wikidata_qid", "wikidata_class",
        "source_url", "retrieved_at", "confidence", "sources",
      ];
      fs.writeFileSync(
        additionsFile,
        [header, ...candidateRows].map((r) => r.join("\t")).join("\n") + "\n",
      );
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-add-out-"));
      return { lexiconsDir, additionsFile, outDir };
    }

    const civ = (
      dir: string,
    ): { headers: string[]; rows: Record<string, string>[] } => {
      const lines = fs
        .readFileSync(path.join(dir, "civilizations.tsv"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "");
      const headers = lines[0].split("\t");
      const rows = lines.slice(1).map((l) => {
        const cells = l.split("\t");
        return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
      });
      return { headers, rows };
    };

    it("appends new rows with provenance columns; extends the header; preserves curated rows", () => {
      const { lexiconsDir, additionsFile, outDir } = additionsFixture([
        ["babylonia", "Babylonia", "Q47690", "ancient-civilization",
          "http://www.wikidata.org/entity/Q47690", "2026-07-08T00:00:00Z", "1.0", '["Wikidata"]'],
        ["elam", "Elam", "Q35355", "civilization",
          "http://www.wikidata.org/entity/Q35355", "2026-07-08T00:00:00Z", "1.0", '["Wikidata"]'],
      ]);
      try {
        const { report } = runCultureAdditions({ additionsFile, lexiconsDir, outDir });

        expect(report.totals).toMatchObject({
          candidates: 2, added: 2, skipped: 0, conflicts: 0, updated: 0,
          rowsBefore: 2, rowsAfter: 4,
        });

        const { headers, rows } = civ(lexiconsDir);
        // Header gained every provenance column.
        for (const col of ADDITION_PROVENANCE_COLUMNS) expect(headers).toContain(col);

        // A curated row is byte-preserved in its own cells and simply padded with blanks.
        const roman = rows.find((r) => r.id === "roman-empire")!;
        expect(roman.name).toBe("Roman Empire");
        expect(roman.native_name).toBe("Imperium Romanum");
        expect(roman.wikidata_qid).toBe("");
        expect(roman.confidence).toBe("");

        // A new row carries full provenance.
        const babylon = rows.find((r) => r.id === "babylonia")!;
        expect(babylon).toMatchObject({
          name: "Babylonia",
          wikidata_qid: "Q47690",
          source_url: "http://www.wikidata.org/entity/Q47690",
          retrieved_at: "2026-07-08T00:00:00Z",
          confidence: "1.0",
          sources: '["Wikidata"]',
        });

        // The report JSON landed in the out dir.
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(outDir, "civilizations-additions-report.json"), "utf8"),
        );
        expect(onDisk.totals.added).toBe(2);
      } finally {
        fs.rmSync(lexiconsDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("dedups by wikidata_qid and by normalised name; reports id collisions as conflicts", () => {
      const { lexiconsDir, additionsFile, outDir } = additionsFixture([
        // duplicate by qid is moot (existing rows have none); duplicate by NAME:
        ["ancient-greece-2", "ancient greece", "Q11772", "civilization",
          "http://www.wikidata.org/entity/Q11772", "", "1.0", '["Wikidata"]'],
        // id collides with a curated row but is a different entity → conflict, never appended.
        ["roman-empire", "Western Roman Empire", "Q201038", "empire",
          "http://www.wikidata.org/entity/Q201038", "", "1.0", '["Wikidata"]'],
        // a genuinely new one that should be added.
        ["elam", "Elam", "Q35355", "civilization",
          "http://www.wikidata.org/entity/Q35355", "", "1.0", '["Wikidata"]'],
      ]);
      try {
        const { report } = runCultureAdditions({ additionsFile, lexiconsDir, outDir });

        expect(report.totals.added).toBe(1);
        expect(report.totals.skipped).toBe(1);
        expect(report.totals.conflicts).toBe(1);
        expect(report.skipped[0]).toMatchObject({ name: "ancient greece", reason: "duplicate-name" });
        expect(report.conflicts[0]).toMatchObject({
          id: "roman-empire", name: "Western Roman Empire", existingName: "Roman Empire",
        });
        // The curated roman-empire row is untouched (not overwritten by the collision).
        const roman = civ(lexiconsDir).rows.find((r) => r.id === "roman-empire")!;
        expect(roman.name).toBe("Roman Empire");
      } finally {
        fs.rmSync(lexiconsDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("is idempotent — re-running appends nothing (dedup by the qid it just wrote)", () => {
      const { lexiconsDir, additionsFile, outDir } = additionsFixture([
        ["elam", "Elam", "Q35355", "civilization",
          "http://www.wikidata.org/entity/Q35355", "", "1.0", '["Wikidata"]'],
      ]);
      try {
        const first = runCultureAdditions({ additionsFile, lexiconsDir, outDir });
        expect(first.report.totals.added).toBe(1);
        const after1 = fs.readFileSync(path.join(lexiconsDir, "civilizations.tsv"), "utf8");

        const second = runCultureAdditions({ additionsFile, lexiconsDir, outDir });
        expect(second.report.totals.added).toBe(0);
        expect(second.report.totals.skipped).toBe(1);
        const after2 = fs.readFileSync(path.join(lexiconsDir, "civilizations.tsv"), "utf8");
        expect(after2).toBe(after1); // byte-identical — a true no-op
      } finally {
        fs.rmSync(lexiconsDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("writes domain-specific extra columns into an arbitrary target lexicon (US-002)", () => {
      // A site lexicon that already has domain columns (coordinates/site_type) but no provenance.
      const lexiconsDir = makeFixtureDir({
        "archaeological-sites.tsv": [
          ["id", "name", "coordinates", "site_type", "confidence", "sources", "description"],
          ["pompeii-site", "Pompeii", '{"lat":40.75,"lng":14.48}', "settlement", "95", "[]", "Roman city"],
        ],
      });
      const additionsFile = path.join(lexiconsDir, "site-additions.tsv");
      fs.writeFileSync(
        additionsFile,
        [
          ["id", "name", "coordinates", "site_type", "description",
            "confidence", "sources", "wikidata_qid", "source_url", "retrieved_at"],
          ["merv", "Merv", '{"lat":37.66,"lng":62.19}', "", "Archaeological site in Turkmenistan.",
            "90", '["Wikidata"]', "Q193325", "http://www.wikidata.org/entity/Q193325", "2026-07-08T00:00:00Z"],
        ].map((r) => r.join("\t")).join("\n") + "\n",
      );
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-add-out-"));
      try {
        const { report } = runCultureAdditions({
          additionsFile,
          targetFile: "archaeological-sites.tsv",
          lexiconsDir,
          outDir,
        });
        expect(report.totals).toMatchObject({ added: 1, skipped: 0, conflicts: 0 });

        const lines = fs
          .readFileSync(path.join(lexiconsDir, "archaeological-sites.tsv"), "utf8")
          .split(/\r?\n/)
          .filter((l) => l.trim() !== "");
        const headers = lines[0].split("\t");
        const merv = Object.fromEntries(
          headers.map((h, i) => [h, lines[lines.length - 1].split("\t")[i] ?? ""]),
        );
        // Domain-specific extra columns landed on the new row.
        expect(merv.coordinates).toBe('{"lat":37.66,"lng":62.19}');
        expect(merv.description).toBe("Archaeological site in Turkmenistan.");
        // Full provenance too.
        expect(merv.wikidata_qid).toBe("Q193325");
        expect(merv.source_url).toBe("http://www.wikidata.org/entity/Q193325");
        // The report file name is derived from the target lexicon.
        expect(
          fs.existsSync(path.join(outDir, "archaeological-sites-additions-report.json")),
        ).toBe(true);
      } finally {
        fs.rmSync(lexiconsDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });

  describe("live corpus", () => {
    it("real export→import is lossless: no fills, no conflicts, no file changes (AC3)", () => {
      const canon = fs.mkdtempSync(path.join(os.tmpdir(), "ls-live-"));
      try {
        writeExport(buildExport(), canon);
        // Default lexiconsDir = the real lexicons; buildWriteBack is pure (no writes).
        const { report } = buildWriteBack(canon);
        expect(report.totals.enrichments).toBe(0);
        expect(report.totals.overwrites).toBe(0);
        expect(report.totals.conflicts).toBe(0);
        expect(report.totals.filesChanged).toBe(0);
        expect(report.totals.nodesMatched).toBeGreaterThan(0);
        // The corpus reuses some ids (e.g. `mohenjo-daro` across place files); those are
        // safely skipped and surfaced, never written.
        expect(report.totals.skippedAmbiguousIds).toBeGreaterThan(0);
      } finally {
        fs.rmSync(canon, { recursive: true, force: true });
      }
    });
  });
});
