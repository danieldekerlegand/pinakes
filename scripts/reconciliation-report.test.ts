import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReconciliation,
  buildReconciliationKeys,
  buildReconciliationReport,
  writeReconciliation,
  normalizeKey,
  keysTsv,
  snapshotReport,
  KEYS_HEADER,
  RECONCILE_CASCADE,
  MAX_AMBIGUITY_SAMPLES,
  DOC_REPORT_PATH,
  type ReconciliationKey,
} from "./reconciliation-report";

/** Write a `{ file: rows[][] }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-recon-"));
  for (const [file, rows] of Object.entries(files)) {
    const content = rows.map((r) => r.join("\t")).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const byCsid = (keys: readonly ReconciliationKey[], csid: string) =>
  keys.find((k) => k.csid === csid);

describe("reconciliation-report (US-005)", () => {
  describe("normalizeKey", () => {
    it("NFKC-normalizes, collapses whitespace, and casefolds", () => {
      expect(normalizeKey("  Café\tCriollo ")).toBe("café criollo");
      expect(normalizeKey("SHONA")).toBe("shona");
    });
  });

  describe("key emission", () => {
    it("emits iso639 codes for languages and (name,type,region) keys for others", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "native_name", "iso639_1", "iso639_2", "region"],
          ["fr", "French", "français", "fr", "fra", "Europe"],
        ],
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["thai", "Thai", "Southeast Asia"],
        ],
      });
      try {
        const { keys } = buildReconciliationKeys(dir);
        const french = byCsid(keys, "cs:language:fr")!;
        expect(french.iso639_1).toBe("fr");
        expect(french.iso639_2).toBe("fra");
        expect(french.languageAnchor).toBe("fr");

        const thai = byCsid(keys, "cs:cuisine:thai")!;
        expect(thai.languageAnchor).toBe("");
        expect(thai.region).toBe("Southeast Asia");
        // (name, type, region) blocking key, normalized.
        expect(thai.nameKey).toBe("thai\x1fcuisine\x1fsoutheast asia");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("dedupes by csid and counts the drops", () => {
      const dir = makeFixtureDir({
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["thai", "Thai", "Asia"],
          ["thai", "Thai (dup)", "Asia"],
        ],
      });
      try {
        const { keys, duplicateCsidsDropped } = buildReconciliationKeys(dir);
        expect(keys.filter((k) => k.csid === "cs:cuisine:thai")).toHaveLength(1);
        expect(duplicateCsidsDropped).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("skips rows with no pinakes id", () => {
      const dir = makeFixtureDir({
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["", "No Id", "Asia"],
          ["ok", "Has Id", "Asia"],
        ],
      });
      try {
        const { keys } = buildReconciliationKeys(dir);
        expect(keys).toHaveLength(1);
        expect(keys[0].csid).toBe("cs:cuisine:ok");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("dry-run classification (cascade order)", () => {
    it("marks iso-coded languages matched and code-less ones likely-new", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1", "iso639_2", "region"],
          ["fr", "French", "fr", "fra", "Europe"],
          ["xx", "Unattested", "", "", "Nowhere"],
        ],
      });
      try {
        const { report, keys } = buildReconciliation(dir);
        expect(byCsid(keys, "cs:language:fr")!.bucket).toBe("matched");
        expect(byCsid(keys, "cs:language:xx")!.bucket).toBe("likely-new");
        expect(report.totals).toMatchObject({ matched: 1, likelyNew: 1, ambiguous: 0 });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("flags a shared language code as ambiguous with competing candidates", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1", "iso639_2", "region"],
          ["hnj", "Hmong Njua", "hmn", "hmn", "SE Asia"],
          ["mww", "Hmong Daw", "hmn", "hmn", "SE Asia"],
        ],
      });
      try {
        const { report, keys } = buildReconciliation(dir);
        expect(byCsid(keys, "cs:language:hnj")!.bucket).toBe("ambiguous");
        expect(byCsid(keys, "cs:language:mww")!.bucket).toBe("ambiguous");
        expect(report.totals.ambiguous).toBe(2);

        const group = report.ambiguities.find(
          (a) => a.keyType === "language-code" && a.key === "hmn",
        )!;
        expect(group.candidates.map((c) => c.csid)).toEqual([
          "cs:language:hnj",
          "cs:language:mww",
        ]);
        // Competing candidates carry their confidence; never auto-merged.
        expect(group.candidates.every((c) => typeof c.confidence === "number")).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("flags a shared (name,type,region) key as ambiguous, but not across regions", () => {
      const dir = makeFixtureDir({
        "settlements.tsv": [
          ["id", "name", "region"],
          ["springfield-il", "Springfield", "Illinois"],
          ["springfield-ma", "Springfield", "Massachusetts"],
        ],
        "rivers-and-waters.tsv": [
          ["id", "name", "region"],
          ["nile-1", "Nile", "Africa"],
          ["nile-2", "Nile", "Africa"],
        ],
      });
      try {
        const { report, keys } = buildReconciliation(dir);
        // Same name, different region → distinct blocking keys → both new.
        expect(byCsid(keys, "cs:place:springfield-il")!.bucket).toBe("likely-new");
        expect(byCsid(keys, "cs:place:springfield-ma")!.bucket).toBe("likely-new");
        // Same name AND region → competing → ambiguous.
        expect(byCsid(keys, "cs:place:nile-1")!.bucket).toBe("ambiguous");
        expect(byCsid(keys, "cs:place:nile-2")!.bucket).toBe("ambiguous");

        const group = report.ambiguities.find((a) => a.keyType === "name-type-region")!;
        expect(group.candidates.map((c) => c.csid)).toEqual([
          "cs:place:nile-1",
          "cs:place:nile-2",
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports the documented cascade and per-type/coverage rollups", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1", "iso639_2", "region"],
          ["fr", "French", "fr", "fra", "Europe"],
        ],
      });
      try {
        const { report } = buildReconciliation(dir);
        expect(report.cascade).toEqual(RECONCILE_CASCADE);
        expect(report.cascade[0]).toBe("wikidata_qid");
        expect(report.keyCoverage.languages).toMatchObject({
          total: 1,
          withIso639: 1,
          withGlottocode: 0,
        });
        const lang = report.byType.find((t) => t.type === "language")!;
        expect(lang).toMatchObject({ count: 1, matched: 1 });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("empty inputs never crash classification", () => {
    it("returns a zeroed report for an empty corpus", () => {
      const { keys, report } = buildReconciliationReport([], 0);
      expect(keys).toEqual([]);
      expect(report.totals).toEqual({ nodes: 0, matched: 0, ambiguous: 0, likelyNew: 0 });
      expect(report.ambiguities).toEqual([]);
    });
  });

  describe("serialisation & write", () => {
    it("keysTsv carries the declared header and one row per key, csid-sorted", () => {
      const dir = makeFixtureDir({
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["z", "Zeta", "R"],
          ["a", "Alpha", "R"],
        ],
      });
      try {
        const { keys } = buildReconciliation(dir);
        const tsv = keysTsv(keys).trimEnd().split("\n");
        expect(tsv[0].split("\t")).toEqual([...KEYS_HEADER]);
        expect(tsv[1].split("\t")[0]).toBe("cs:cuisine:a");
        expect(tsv[2].split("\t")[0]).toBe("cs:cuisine:z");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("snapshotReport bounds the ambiguity list but preserves the full count", () => {
      const many = Array.from({ length: MAX_AMBIGUITY_SAMPLES + 5 }, (_, i) => ({
        keyType: "name-type-region" as const,
        key: `k${i}`,
        candidates: [],
      }));
      const report = { ...emptyReport(), ambiguities: many, ambiguityGroupCount: many.length };
      const snap = snapshotReport(report);
      expect(snap.ambiguities).toHaveLength(MAX_AMBIGUITY_SAMPLES);
      expect(snap.ambiguityGroupCount).toBe(many.length);
    });

    it("writeReconciliation emits keys.tsv, report.json, and a bounded doc snapshot", () => {
      const dir = makeFixtureDir({
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["thai", "Thai", "Asia"],
        ],
      });
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-recon-out-"));
      const docPath = path.join(outDir, "doc-report.json");
      try {
        const built = buildReconciliation(dir);
        writeReconciliation(built, { outDir, docReportPath: docPath });
        expect(fs.existsSync(path.join(outDir, "keys.tsv"))).toBe(true);
        expect(fs.existsSync(path.join(outDir, "report.json"))).toBe(true);
        expect(fs.existsSync(docPath)).toBe(true);
        const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
        expect(doc.totals.nodes).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });

  describe("live corpus", () => {
    let live: ReturnType<typeof buildReconciliation>;
    beforeAll(() => {
      live = buildReconciliation();
    });

    it("classifies every node into exactly one bucket summing to the total", () => {
      const { totals } = live.report;
      expect(totals.nodes).toBeGreaterThan(0);
      expect(totals.matched + totals.ambiguous + totals.likelyNew).toBe(totals.nodes);
      expect(live.keys).toHaveLength(totals.nodes);
    });

    it("every ambiguity group has ≥2 competing candidates", () => {
      for (const group of live.report.ambiguities) {
        expect(group.candidates.length).toBeGreaterThanOrEqual(2);
      }
      expect(live.report.ambiguityGroupCount).toBe(live.report.ambiguities.length);
    });

    it("the committed snapshot is in sync with the current corpus", () => {
      const onDisk = JSON.parse(fs.readFileSync(DOC_REPORT_PATH, "utf8"));
      expect(onDisk.totals).toEqual(live.report.totals);
      expect(onDisk.keyCoverage).toEqual(live.report.keyCoverage);
    });
  });
});

/** A minimal zeroed report for snapshot-bound testing. */
function emptyReport() {
  return buildReconciliationReport([], 0).report;
}
