import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseTsv,
  computeColumnStats,
  auditFile,
  checkReferentialIntegrity,
  identifyCoverageGaps,
  runAudit,
  type FileAudit,
} from "./audit-tsv";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "..", "data", "source", "lexicons");

// --- Unit tests with temp fixtures ---

let tmpDir: string;

function writeTsv(name: string, content: string): string {
  const fp = path.join(tmpDir, name);
  fs.writeFileSync(fp, content);
  return fp;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-tsv-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseTsv", () => {
  it("parses header and rows correctly", () => {
    const fp = writeTsv("simple.tsv", "id\tname\n1\tAlpha\n2\tBeta\n");
    const { headers, rows } = parseTsv(fp);
    expect(headers).toEqual(["id", "name"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["1", "Alpha"]);
  });

  it("handles header-only file", () => {
    const fp = writeTsv("headeronly.tsv", "id\tname");
    const { headers, rows } = parseTsv(fp);
    expect(headers).toEqual(["id", "name"]);
    expect(rows).toHaveLength(0);
  });
});

describe("computeColumnStats", () => {
  it("computes fill rates correctly", () => {
    const headers = ["id", "optional"];
    const rows = [
      ["1", "val"],
      ["2", ""],
      ["3", "null"],
      ["4", "data"],
    ];
    const stats = computeColumnStats(headers, rows);
    expect(stats[0].fillRate).toBe(1);
    expect(stats[0].filled).toBe(4);
    expect(stats[1].fillRate).toBe(0.5); // 2 of 4 filled
    expect(stats[1].empty).toBe(2);
  });

  it("handles empty rows array", () => {
    const stats = computeColumnStats(["id"], []);
    expect(stats[0].fillRate).toBe(0);
    expect(stats[0].filled).toBe(0);
  });
});

describe("auditFile", () => {
  it("identifies sparse columns", () => {
    const fp = writeTsv(
      "sparse.tsv",
      "id\tname\trare\n1\tA\t\n2\tB\t\n3\tC\tyes\n4\tD\t\n"
    );
    const audit = auditFile(fp);
    expect(audit.rowCount).toBe(4);
    expect(audit.sparseColumns).toContain("rare"); // 25% fill
    expect(audit.sparseColumns).not.toContain("id");
  });
});

describe("checkReferentialIntegrity", () => {
  it("detects missing foreign keys", () => {
    // Create a mini lexicons dir with languages and grammar-features
    const refDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ref-"));
    fs.writeFileSync(
      path.join(refDir, "languages.tsv"),
      "id\tname\n" + "eng\tEnglish\n" + "spa\tSpanish\n"
    );
    fs.writeFileSync(
      path.join(refDir, "grammar-features.tsv"),
      "id\tlanguage_id\n" + "gf1\teng\n" + "gf2\tzzz_nonexistent\n"
    );
    // Need families.tsv too since languages references it
    fs.writeFileSync(path.join(refDir, "families.tsv"), "id\tname\nfam1\tTest\n");

    const issues = checkReferentialIntegrity(refDir);
    const gfIssue = issues.find(
      (i) => i.file === "grammar-features.tsv" && i.column === "language_id"
    );
    expect(gfIssue).toBeDefined();
    expect(gfIssue!.missingIds).toContain("zzz_nonexistent");

    fs.rmSync(refDir, { recursive: true, force: true });
  });
});

describe("identifyCoverageGaps", () => {
  it("flags empty files", () => {
    const audits: FileAudit[] = [
      { file: "empty.tsv", rowCount: 0, columns: [], sparseColumns: [] },
    ];
    const gaps = identifyCoverageGaps(audits);
    expect(gaps).toContainEqual({ file: "empty.tsv", issue: "File is empty (0 data rows)" });
  });

  it("flags very low row counts", () => {
    const audits: FileAudit[] = [
      {
        file: "small.tsv",
        rowCount: 5,
        columns: [{ name: "id", filled: 5, empty: 0, fillRate: 1 }],
        sparseColumns: [],
      },
    ];
    const gaps = identifyCoverageGaps(audits);
    expect(gaps.some((g) => g.file === "small.tsv" && g.issue.includes("Very few rows"))).toBe(
      true
    );
  });

  it("flags sparse columns", () => {
    const audits: FileAudit[] = [
      {
        file: "data.tsv",
        rowCount: 100,
        columns: [
          { name: "id", filled: 100, empty: 0, fillRate: 1 },
          { name: "notes", filled: 10, empty: 90, fillRate: 0.1 },
        ],
        sparseColumns: ["notes"],
      },
    ];
    const gaps = identifyCoverageGaps(audits);
    expect(gaps.some((g) => g.file === "data.tsv" && g.issue.includes("notes"))).toBe(true);
  });
});

// --- Integration test against real data/source/lexicons/ data ---

describe("runAudit (integration)", () => {
  it("audits all real TSV files", () => {
    const report = runAudit(LEXICONS_DIR);
    expect(report.totalFiles).toBeGreaterThanOrEqual(40);
    expect(report.totalRows).toBeGreaterThan(100000);
    expect(report.files.length).toBe(report.totalFiles);

    // Every file audit should have columns
    for (const f of report.files) {
      expect(f.columns.length).toBeGreaterThan(0);
      expect(f.rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("languages.tsv has expected structure", () => {
    const report = runAudit(LEXICONS_DIR);
    const lang = report.files.find((f) => f.file === "languages.tsv");
    expect(lang).toBeDefined();
    expect(lang!.rowCount).toBeGreaterThan(1000);
    const colNames = lang!.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
    expect(colNames).toContain("family_id");
  });

  it("words.tsv is the largest file", () => {
    const report = runAudit(LEXICONS_DIR);
    const sorted = [...report.files].sort((a, b) => b.rowCount - a.rowCount);
    expect(sorted[0].file).toBe("words.tsv");
  });

  it("generates a valid JSON report", () => {
    const report = runAudit(LEXICONS_DIR);
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.totalFiles).toBe(report.totalFiles);
    expect(parsed.timestamp).toBeDefined();
  });
});
