/**
 * TSV Data Completeness Audit
 *
 * Analyzes all TSV files in lexicons/ for:
 * - Row counts and empty-field rates per column
 * - Referential integrity (foreign key checks)
 * - Coverage gaps (low-data files, sparse columns)
 */

import fs from "fs";
import path from "path";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "..", "lexicons");

export interface ColumnStats {
  name: string;
  filled: number;
  empty: number;
  fillRate: number; // 0–1
}

export interface FileAudit {
  file: string;
  rowCount: number;
  columns: ColumnStats[];
  sparseColumns: string[]; // columns with <50% fill rate
}

export interface ReferentialIssue {
  file: string;
  column: string;
  missingIds: string[];
}

export interface AuditReport {
  timestamp: string;
  totalFiles: number;
  totalRows: number;
  files: FileAudit[];
  referentialIssues: ReferentialIssue[];
  coverageGaps: CoverageGap[];
}

export interface CoverageGap {
  file: string;
  issue: string;
}

/** Parse a TSV file into header + rows of string arrays. */
export function parseTsv(filePath: string): { headers: string[]; rows: string[][] } {
  const content = fs.readFileSync(filePath, "utf-8").trim();
  const lines = content.split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/** Compute per-column fill stats for a parsed TSV. */
export function computeColumnStats(headers: string[], rows: string[][]): ColumnStats[] {
  return headers.map((name, i) => {
    let filled = 0;
    let empty = 0;
    for (const row of rows) {
      const val = (row[i] ?? "").trim();
      if (val === "" || val === "null" || val === "undefined") {
        empty++;
      } else {
        filled++;
      }
    }
    const total = filled + empty;
    return { name, filled, empty, fillRate: total > 0 ? filled / total : 0 };
  });
}

/** Audit a single TSV file. */
export function auditFile(filePath: string): FileAudit {
  const { headers, rows } = parseTsv(filePath);
  const columns = computeColumnStats(headers, rows);
  const sparseColumns = columns
    .filter((c) => c.fillRate < 0.5 && rows.length > 0)
    .map((c) => c.name);

  return {
    file: path.basename(filePath),
    rowCount: rows.length,
    columns,
    sparseColumns,
  };
}

/** Collect all IDs from a TSV file's "id" column. */
function collectIds(filePath: string): Set<string> {
  const { headers, rows } = parseTsv(filePath);
  const idIdx = headers.indexOf("id");
  if (idIdx === -1) return new Set();
  return new Set(rows.map((r) => r[idIdx]?.trim()).filter(Boolean));
}

/** Known foreign-key relationships between TSV files. */
const FK_RELATIONS: Array<{
  file: string;
  column: string;
  refFile: string;
  /** If true, the column may contain semicolon-separated or JSON array IDs */
  multi?: boolean;
}> = [
  { file: "languages.tsv", column: "family_id", refFile: "families.tsv" },
  { file: "grammar-features.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "phonological-inventories.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "sample-texts.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "verb-paradigms.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "sound-changes.tsv", column: "family_id", refFile: "families.tsv" },
  { file: "civilization-boundaries.tsv", column: "civilization_id", refFile: "civilizations.tsv" },
  { file: "cuisine-items.tsv", column: "cuisine_id", refFile: "cuisines.tsv" },
  { file: "cooking-techniques.tsv", column: "cuisine_id", refFile: "cuisines.tsv" },
  { file: "ingredient-origins.tsv", column: "cuisine_id", refFile: "cuisines.tsv" },
  { file: "literary-works.tsv", column: "tradition_id", refFile: "literary-traditions.tsv" },
  { file: "literary-works.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "language-range-polygons.tsv", column: "language_id", refFile: "languages.tsv" },
  { file: "language-ranges.tsv", column: "language_id", refFile: "languages.tsv" },
];

/** Extract multiple IDs from a cell that may be semicolon-separated or a JSON array. */
function extractIds(cell: string): string[] {
  const val = cell.trim();
  if (!val || val === "null") return [];
  if (val.startsWith("[")) {
    try {
      const arr = JSON.parse(val);
      return Array.isArray(arr) ? arr.map(String).map((s) => s.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return val.split(";").map((s) => s.trim()).filter(Boolean);
}

/** Check referential integrity across TSV files. */
export function checkReferentialIntegrity(lexiconsDir: string): ReferentialIssue[] {
  const issues: ReferentialIssue[] = [];
  const idCache = new Map<string, Set<string>>();

  function getIds(refFile: string): Set<string> {
    if (!idCache.has(refFile)) {
      const fp = path.join(lexiconsDir, refFile);
      idCache.set(refFile, fs.existsSync(fp) ? collectIds(fp) : new Set());
    }
    return idCache.get(refFile)!;
  }

  for (const rel of FK_RELATIONS) {
    const fp = path.join(lexiconsDir, rel.file);
    if (!fs.existsSync(fp)) continue;

    const { headers, rows } = parseTsv(fp);
    const colIdx = headers.indexOf(rel.column);
    if (colIdx === -1) continue;

    const refIds = getIds(rel.refFile);
    if (refIds.size === 0) continue; // ref file empty or missing

    const missing = new Set<string>();
    for (const row of rows) {
      const ids = rel.multi ? extractIds(row[colIdx] ?? "") : [(row[colIdx] ?? "").trim()];
      for (const id of ids) {
        if (id && id !== "null" && id !== "" && !refIds.has(id)) {
          missing.add(id);
        }
      }
    }

    if (missing.size > 0) {
      issues.push({
        file: rel.file,
        column: rel.column,
        missingIds: [...missing].sort().slice(0, 20), // cap at 20 for readability
      });
    }
  }

  return issues;
}

/** Thresholds for coverage gap detection. */
const LOW_ROW_THRESHOLD = 10;
const SPARSE_FILL_THRESHOLD = 0.3;

/** Identify high-level coverage gaps. */
export function identifyCoverageGaps(audits: FileAudit[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const a of audits) {
    if (a.rowCount === 0) {
      gaps.push({ file: a.file, issue: "File is empty (0 data rows)" });
    } else if (a.rowCount < LOW_ROW_THRESHOLD) {
      gaps.push({ file: a.file, issue: `Very few rows (${a.rowCount})` });
    }

    const verySparse = a.columns.filter(
      (c) => c.fillRate < SPARSE_FILL_THRESHOLD && a.rowCount > 0
    );
    if (verySparse.length > 0) {
      gaps.push({
        file: a.file,
        issue: `Columns with <30% fill: ${verySparse.map((c) => `${c.name} (${Math.round(c.fillRate * 100)}%)`).join(", ")}`,
      });
    }
  }

  return gaps;
}

/** Run the full audit. */
export function runAudit(lexiconsDir: string = LEXICONS_DIR): AuditReport {
  const tsvFiles = fs
    .readdirSync(lexiconsDir)
    .filter((f) => f.endsWith(".tsv"))
    .sort();

  const files: FileAudit[] = tsvFiles.map((f) => auditFile(path.join(lexiconsDir, f)));
  const totalRows = files.reduce((sum, f) => sum + f.rowCount, 0);
  const referentialIssues = checkReferentialIntegrity(lexiconsDir);
  const coverageGaps = identifyCoverageGaps(files);

  return {
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    totalRows,
    files,
    referentialIssues,
    coverageGaps,
  };
}

/** Pretty-print the audit report to stdout. */
function printReport(report: AuditReport): void {
  console.log("=== TSV Data Completeness Audit ===");
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total files: ${report.totalFiles}`);
  console.log(`Total data rows: ${report.totalRows.toLocaleString()}\n`);

  console.log("--- File Summary ---");
  for (const f of report.files) {
    const sparse = f.sparseColumns.length > 0 ? ` [sparse: ${f.sparseColumns.join(", ")}]` : "";
    console.log(`  ${f.file}: ${f.rowCount} rows, ${f.columns.length} columns${sparse}`);
  }

  if (report.referentialIssues.length > 0) {
    console.log("\n--- Referential Integrity Issues ---");
    for (const issue of report.referentialIssues) {
      console.log(`  ${issue.file}.${issue.column} -> missing: ${issue.missingIds.join(", ")}`);
    }
  } else {
    console.log("\n--- Referential Integrity: OK ---");
  }

  if (report.coverageGaps.length > 0) {
    console.log("\n--- Coverage Gaps ---");
    for (const gap of report.coverageGaps) {
      console.log(`  ${gap.file}: ${gap.issue}`);
    }
  } else {
    console.log("\n--- Coverage: No gaps detected ---");
  }
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const report = runAudit();
  printReport(report);
  const outPath = path.resolve(LEXICONS_DIR, "..", "audit-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${outPath}`);
}
