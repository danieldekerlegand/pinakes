import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AnalyticalIndex,
  tableNameForFile,
  type FacetCount,
} from "./analytical-index";

/**
 * US-001 — runtime analytical index over the TSVs.
 *
 * Every query is checked for **parity** against a pure, in-memory reference
 * computed by re-parsing the same TSV the way server/tsv-storage.ts does
 * (`split("\t")`, empty cells kept as ""). The index must agree with that
 * reference, proving DuckDB is a faithful mirror of the source-of-truth TSVs.
 */

// ── Pure reference implementation (mirrors parseTsv + JS grouping) ───────────

interface ParsedTsv {
  header: string[];
  rows: string[][];
}

function parseTsv(text: string): ParsedTsv {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  const rows = lines.map((l) => l.split("\t"));
  return { header, rows };
}

function referenceFacetCounts(parsed: ParsedTsv, column: string): FacetCount[] {
  const idx = parsed.header.indexOf(column);
  const counts = new Map<string, number>();
  for (const row of parsed.rows) {
    const value = row[idx] ?? "";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
}

// ── Fixture corpus ───────────────────────────────────────────────────────────

let dir: string;
let index: AnalyticalIndex;

const LANGUAGES = [
  "id\tname\tregion\tstatus",
  "lat\tLatin\tItaly\textinct",
  "grc\tGreek\tGreece\textinct",
  "osc\tOscan\tItaly\textinct",
  "eng\tEnglish\t\tliving", // blank region cell — must stay ""
  "cmn\tMandarin\tChina\tliving",
].join("\n");

const BATTLES = [
  "id\tname\toutcome",
  "b1\tCannae\tdecisive",
  "b2\tZama\tdecisive",
].join("\n");

function writeCorpus(target: string): void {
  fs.writeFileSync(path.join(target, "languages.tsv"), LANGUAGES);
  fs.writeFileSync(path.join(target, "battles.tsv"), BATTLES);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lx-index-"));
  writeCorpus(dir);
  index = await AnalyticalIndex.create(dir);
});

afterEach(() => {
  index.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tableNameForFile", () => {
  it("sanitizes file base names into SQL identifiers", () => {
    expect(tableNameForFile("language-ranges.tsv")).toBe("language_ranges");
    expect(tableNameForFile("battles.TSV")).toBe("battles");
    expect(tableNameForFile("123-legacy.tsv")).toBe("t_123_legacy");
  });
});

describe("index construction", () => {
  it("builds one table per TSV file", () => {
    expect(index.tables()).toEqual(["battles", "languages"]);
    expect(index.columns("languages")).toEqual(["id", "name", "region", "status"]);
  });

  it("counts data rows (not the header)", async () => {
    await expect(index.count("languages")).resolves.toBe(5);
    await expect(index.count("battles")).resolves.toBe(2);
  });

  it("describe() reports table metadata", async () => {
    const described = await index.describe();
    expect(described.find((t) => t.table === "languages")).toEqual({
      table: "languages",
      file: "languages.tsv",
      columns: ["id", "name", "region", "status"],
      rowCount: 5,
    });
  });
});

describe("facetCounts parity with in-memory reference", () => {
  it.each([
    ["languages", "region"],
    ["languages", "status"],
    ["battles", "outcome"],
  ])("matches the reference for %s.%s", async (table, column) => {
    const parsed = parseTsv(fs.readFileSync(path.join(dir, `${table}.tsv`), "utf8"));
    const expected = referenceFacetCounts(parsed, column);
    await expect(index.facetCounts(table, column)).resolves.toEqual(expected);
  });

  it("keeps blank cells as empty string (never null)", async () => {
    const facets = await index.facetCounts("languages", "region");
    const blank = facets.find((f) => f.value === "");
    expect(blank).toEqual({ value: "", count: 1 });
    expect(facets.some((f) => f.value === null)).toBe(false);
  });

  it("orders by count desc then value asc", async () => {
    const facets = await index.facetCounts("languages", "region");
    // Italy appears twice (Latin, Oscan); the rest once each.
    expect(facets[0]).toEqual({ value: "Italy", count: 2 });
    const singles = facets.slice(1).map((f) => f.value);
    expect(singles).toEqual([...singles].sort());
  });
});

describe("query() aggregates and parameters", () => {
  it("runs GROUP BY aggregates with parity to the reference", async () => {
    const rows = (await index.query(
      `SELECT status, CAST(COUNT(*) AS BIGINT) AS n FROM languages GROUP BY status ORDER BY status`,
    )) as Array<{ status: string; n: string }>;
    expect(rows).toEqual([
      { status: "extinct", n: "3" },
      { status: "living", n: "2" },
    ]);
  });

  it("binds positional VARCHAR parameters", async () => {
    const rows = (await index.query(
      `SELECT name FROM languages WHERE region = $1 ORDER BY name`,
      ["Italy"],
    )) as Array<{ name: string }>;
    expect(rows).toEqual([{ name: "Latin" }, { name: "Oscan" }]);
  });

  it("rejects an unknown column for faceting", async () => {
    await expect(index.facetCounts("languages", "nope")).rejects.toThrow(/No column/);
  });
});

describe("incremental refresh", () => {
  it("rebuilds only changed files and reflects new rows", async () => {
    // No change → nothing rebuilt.
    let result = await index.refresh();
    expect(result).toEqual({ rebuilt: [], dropped: [] });

    // Append a battle; only battles.tsv should rebuild.
    fs.writeFileSync(
      path.join(dir, "battles.tsv"),
      `${BATTLES}\nb3\tTrebia\tdecisive`,
    );
    result = await index.refresh();
    expect(result.rebuilt).toEqual(["battles"]);
    expect(result.dropped).toEqual([]);
    await expect(index.count("battles")).resolves.toBe(3);
    // Untouched table is unaffected.
    await expect(index.count("languages")).resolves.toBe(5);
  });

  it("picks up a newly added file", async () => {
    fs.writeFileSync(path.join(dir, "religions.tsv"), "id\tname\nr1\tShinto\n");
    const result = await index.refresh();
    expect(result.rebuilt).toContain("religions");
    expect(index.tables()).toContain("religions");
    await expect(index.count("religions")).resolves.toBe(1);
  });

  it("drops a table when its file is removed", async () => {
    fs.rmSync(path.join(dir, "battles.tsv"));
    const result = await index.refresh();
    expect(result.dropped).toEqual(["battles"]);
    expect(index.hasTable("battles")).toBe(false);
    expect(index.tables()).toEqual(["languages"]);
  });
});
