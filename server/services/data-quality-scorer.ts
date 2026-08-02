import fs from "node:fs";
import path from "node:path";
import { nodeFiles } from "@contracts/lexicon-mapping";
import {
  classifyTrustTier,
  ALL_TRUST_TIERS,
  type TrustTier,
} from "@contracts/trust-tier";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "../../lexicons");

export interface FieldQuality {
  column: string;
  filledCount: number;
  totalCount: number;
  completeness: number;
  distinctValues: number;
}

export interface ReferentialCheck {
  sourceFile: string;
  sourceColumn: string;
  targetFile: string;
  targetColumn: string;
  totalRefs: number;
  validRefs: number;
  missingRefs: string[];
}

export interface FileQualityScore {
  file: string;
  rowCount: number;
  columnCount: number;
  completeness: number;
  uniqueIdRate: number;
  duplicateIds: string[];
  fields: FieldQuality[];
  overallScore: number;
}

export interface DataQualityReport {
  timestamp: string;
  overallScore: number;
  fileCount: number;
  totalRows: number;
  files: FileQualityScore[];
  referentialIntegrity: ReferentialCheck[];
  coverage: CoverageReport;
  tierComposition: CorpusTierReport;
}

/** The size + quality of one trust tier within the corpus. */
export interface TierBucket {
  tier: TrustTier;
  /** Node rows classified into this tier. */
  nodeRows: number;
  /** Rows carrying a `wikidata_qid`. */
  withWikidataQid: number;
  /** Rows carrying a `source_url`. */
  withSourceUrl: number;
  /** Rows carrying a `confidence`. */
  withConfidence: number;
  /** Mean of the present confidences (0–1 normalised), rounded, or `null`. */
  avgConfidence: number | null;
  /** Rows with QID + source_url + confidence all present. */
  fullyProvenanced: number;
}

/**
 * Corpus composition **by trust tier** (US-004). Every pinakes lexicon row
 * is human-curated, so in the shared graph the whole app corpus occupies the
 * `curated` tier ({@link CorpusTierReport.graphTier}) — auto-admission never
 * writes `lexicons/*.tsv`. What varies, and what this report tracks over time, is
 * **auto-admission readiness**: {@link CorpusTierReport.byTier} classifies each
 * curated node row by its *intrinsic* provenance via {@link classifyTrustTier}
 * (would it auto-admit to the graph on its own merits — QID-anchored AND
 * reference-backed — or quarantine?). The higher the auto-admitted share, the
 * more of the curated corpus has converged with the global identity space.
 */
export interface CorpusTierReport {
  /** Total classified node rows across all node lexicons. */
  totalNodeRows: number;
  /** The graph-corpus tier of the whole app corpus (human-curation gate). */
  graphTier: TrustTier;
  /** Readiness composition by tier, in {@link ALL_TRUST_TIERS} order. */
  byTier: TierBucket[];
  /** Fraction of node rows that would auto-admit on their own provenance. */
  autoAdmissionReadyRate: number;
  /** Per node-file readiness breakdown. */
  files: Array<{
    file: string;
    node: string;
    nodeRows: number;
    autoAdmissionReady: number;
  }>;
}

/** Normalise a confidence cell to 0–1 (files may store 0–100). `null` if unparseable. */
function normaliseConfidence(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * Pure: classify every node row of the given parsed node files into its trust
 * tier by intrinsic provenance and aggregate size + quality per tier. Rows are
 * classified with `source` omitted (the export stamps `pinakes` on export —
 * the point of this report is the *readiness* view, not the graph tier), so a row
 * lands in `auto-admitted` iff it is QID-anchored AND reference-backed, else
 * `quarantine`. Deterministic (no clock/fs).
 */
export function computeCorpusTiers(
  files: Array<{ file: string; node: string; header: string[]; rows: string[][] }>,
): CorpusTierReport {
  const buckets = new Map<
    TrustTier,
    { rows: number; qid: number; url: number; conf: number; confSum: number; full: number }
  >();
  for (const tier of ALL_TRUST_TIERS) {
    buckets.set(tier, { rows: 0, qid: 0, url: 0, conf: 0, confSum: 0, full: 0 });
  }
  let totalNodeRows = 0;
  const fileSummaries: CorpusTierReport["files"] = [];

  for (const f of files) {
    const qidIdx = f.header.indexOf("wikidata_qid");
    const urlIdx = f.header.indexOf("source_url");
    const confIdx = f.header.indexOf("confidence");
    let fileReady = 0;
    for (const row of f.rows) {
      const qid = qidIdx !== -1 ? (row[qidIdx] ?? "").trim() : "";
      const url = urlIdx !== -1 ? (row[urlIdx] ?? "").trim() : "";
      const confRaw = confIdx !== -1 ? (row[confIdx] ?? "") : "";
      const conf = normaliseConfidence(confRaw);
      const tier = classifyTrustTier({ wikidataQid: qid, sourceUrl: url });
      const b = buckets.get(tier)!;
      b.rows++;
      if (qid) b.qid++;
      if (url) b.url++;
      if (conf !== null) {
        b.conf++;
        b.confSum += conf;
      }
      if (qid && url && conf !== null) b.full++;
      if (tier === "auto-admitted") fileReady++;
      totalNodeRows++;
    }
    fileSummaries.push({
      file: f.file,
      node: f.node,
      nodeRows: f.rows.length,
      autoAdmissionReady: fileReady,
    });
  }

  const byTier: TierBucket[] = ALL_TRUST_TIERS.map((tier) => {
    const b = buckets.get(tier)!;
    return {
      tier,
      nodeRows: b.rows,
      withWikidataQid: b.qid,
      withSourceUrl: b.url,
      withConfidence: b.conf,
      avgConfidence: b.conf > 0 ? Math.round((b.confSum / b.conf) * 10000) / 10000 : null,
      fullyProvenanced: b.full,
    };
  });

  const ready = buckets.get("auto-admitted")!.rows;
  return {
    totalNodeRows,
    graphTier: "curated",
    byTier,
    autoAdmissionReadyRate:
      totalNodeRows > 0 ? Math.round((ready / totalNodeRows) * 10000) / 10000 : 0,
    files: fileSummaries.sort((a, b) => a.file.localeCompare(b.file)),
  };
}

/**
 * Reads the node lexicons from `lexiconsDir` and builds the deterministic
 * corpus-tier report (no timestamp) — the committed-report + `/api/data-quality`
 * source of truth for tier composition.
 */
export function buildCorpusTierReport(lexiconsDir: string): CorpusTierReport {
  const files: Array<{ file: string; node: string; header: string[]; rows: string[][] }> = [];
  for (const { file, node } of nodeFiles()) {
    const filePath = path.join(lexiconsDir, file);
    if (!fs.existsSync(filePath)) continue;
    const { header, rows } = parseTsvFile(filePath);
    files.push({ file, node, header, rows });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return computeCorpusTiers(files);
}

/**
 * A domain's population target.
 *
 * `kind: "roadmap"` targets are the hard numbers from the deep-history roadmap
 * (docs/prd-pinakes-deep-history-roadmap.md §8 / §15). `kind: "breadth"`
 * targets are the credible-breadth goals the data-population stories set for the
 * newer cultural domains the roadmap describes only qualitatively
 * ("foundational corpus", "credible breadth"); `source` records where each came from.
 */
export interface RoadmapTarget {
  domain: string;
  file: string;
  target: number;
  targetLabel: string;
  kind: "roadmap" | "breadth";
  source: string;
}

export interface DomainCoverage {
  domain: string;
  file: string;
  actual: number;
  target: number;
  targetLabel: string;
  kind: "roadmap" | "breadth";
  source: string;
  met: boolean;
  percentOfTarget: number;
}

export interface CoverageReport {
  domains: DomainCoverage[];
  domainsMet: number;
  domainsUnderTarget: number;
  underTarget: string[];
  allMet: boolean;
}

/**
 * Roadmap / data-population targets per domain. Ordered as the roadmap §15 table
 * lists them (hard roadmap targets first, then the story-breadth domains).
 * Kept in sync with docs/prd-pinakes-deep-history-roadmap.md.
 */
export const ROADMAP_TARGETS: RoadmapTarget[] = [
  { domain: "civilizations", file: "civilizations.tsv", target: 150, targetLabel: "150+", kind: "roadmap", source: "roadmap §8.1 / §15" },
  { domain: "archaeological-sites", file: "archaeological-sites.tsv", target: 500, targetLabel: "500+", kind: "roadmap", source: "roadmap §8.2 / §15" },
  { domain: "archaeological-cultures", file: "archaeological-cultures.tsv", target: 200, targetLabel: "200+", kind: "roadmap", source: "roadmap §15" },
  { domain: "migration-routes", file: "migration-routes.tsv", target: 100, targetLabel: "100+", kind: "roadmap", source: "roadmap §8.3 / §15" },
  { domain: "cuisines", file: "cuisines.tsv", target: 80, targetLabel: "80+", kind: "roadmap", source: "roadmap §15" },
  { domain: "language-range-polygons", file: "language-range-polygons.tsv", target: 200, targetLabel: "200+", kind: "roadmap", source: "roadmap §8.4" },
  { domain: "trade-routes", file: "trade-routes.tsv", target: 30, targetLabel: "expanded (30+)", kind: "breadth", source: "US-003 breadth (roadmap: named corridors)" },
  { domain: "ingredient-origins", file: "ingredient-origins.tsv", target: 100, targetLabel: "100+", kind: "breadth", source: "US-004 food-drink breadth" },
  { domain: "cooking-techniques", file: "cooking-techniques.tsv", target: 80, targetLabel: "80+", kind: "breadth", source: "US-004 food-drink breadth" },
  { domain: "writing-systems", file: "writing-systems.tsv", target: 100, targetLabel: "100+", kind: "breadth", source: "US-005 breadth" },
  { domain: "deities", file: "deities.tsv", target: 200, targetLabel: "200+", kind: "breadth", source: "US-005 breadth" },
  { domain: "architectural-styles", file: "architectural-styles.tsv", target: 90, targetLabel: "90+", kind: "breadth", source: "US-005 breadth" },
  { domain: "dance-traditions", file: "dance-traditions.tsv", target: 90, targetLabel: "90+", kind: "breadth", source: "US-005 breadth" },
  { domain: "literary-traditions", file: "literary-traditions.tsv", target: 50, targetLabel: "50+ (foundational corpus)", kind: "breadth", source: "US-005 breadth (roadmap: foundational corpus)" },
  { domain: "myth-motifs", file: "myth-motifs.tsv", target: 60, targetLabel: "60+", kind: "breadth", source: "US-005 breadth" },
];

/**
 * Pure: compares actual row counts (keyed by lexicon file) against ROADMAP_TARGETS.
 * A domain missing from `rowCounts` scores 0 actual. Deterministic (no clock/fs).
 */
export function computeCoverage(rowCounts: Record<string, number>): CoverageReport {
  const domains: DomainCoverage[] = ROADMAP_TARGETS.map((t) => {
    const actual = rowCounts[t.file] ?? 0;
    const met = actual >= t.target;
    const percentOfTarget = t.target > 0 ? Math.round((actual / t.target) * 1000) / 1000 : 1;
    return {
      domain: t.domain,
      file: t.file,
      actual,
      target: t.target,
      targetLabel: t.targetLabel,
      kind: t.kind,
      source: t.source,
      met,
      percentOfTarget,
    };
  });
  const underTarget = domains.filter((d) => !d.met).map((d) => d.domain);
  return {
    domains,
    domainsMet: domains.length - underTarget.length,
    domainsUnderTarget: underTarget.length,
    underTarget,
    allMet: underTarget.length === 0,
  };
}

/**
 * Reads the target lexicons from `lexiconsDir` and builds a deterministic coverage
 * report (no timestamp) — the committed-report + `/api/data-quality` source of truth.
 */
export function buildCoverageReport(lexiconsDir: string): CoverageReport {
  const rowCounts: Record<string, number> = {};
  for (const t of ROADMAP_TARGETS) {
    const filePath = path.join(lexiconsDir, t.file);
    rowCounts[t.file] = fs.existsSync(filePath) ? parseTsvFile(filePath).rows.length : 0;
  }
  return computeCoverage(rowCounts);
}

const FOREIGN_KEY_MAP: Array<{
  sourceFile: string;
  sourceColumn: string;
  targetFile: string;
  targetColumn: string;
}> = [
  { sourceFile: "languages.tsv", sourceColumn: "family_id", targetFile: "families.tsv", targetColumn: "id" },
  { sourceFile: "languages.tsv", sourceColumn: "parent_language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "families.tsv", sourceColumn: "parent_id", targetFile: "families.tsv", targetColumn: "id" },
  { sourceFile: "grammar-features.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "phonological-inventories.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "words.tsv", sourceColumn: "Language_ID", targetFile: "languages.tsv", targetColumn: "id" },
];

function parseTsvFile(filePath: string): { header: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { header, rows };
}

function scoreFile(fileName: string, header: string[], rows: string[][]): FileQualityScore {
  const rowCount = rows.length;
  const columnCount = header.length;

  // Field-level completeness
  const fields: FieldQuality[] = header.map((col, colIdx) => {
    const values = rows.map((r) => r[colIdx] ?? "");
    const filled = values.filter((v) => v.trim().length > 0);
    const distinct = new Set(filled);
    return {
      column: col,
      filledCount: filled.length,
      totalCount: rowCount,
      completeness: rowCount > 0 ? filled.length / rowCount : 0,
      distinctValues: distinct.size,
    };
  });

  const completeness =
    fields.length > 0 ? fields.reduce((sum, f) => sum + f.completeness, 0) / fields.length : 0;

  // ID uniqueness
  const idColIdx = header.indexOf("id") !== -1 ? header.indexOf("id") : header.indexOf("Language_ID");
  let uniqueIdRate = 1;
  let duplicateIds: string[] = [];
  if (idColIdx !== -1 && rowCount > 0) {
    const ids = rows.map((r) => r[idColIdx] ?? "").filter((v) => v.trim().length > 0);
    const seen = new Map<string, number>();
    for (const id of ids) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    duplicateIds = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    const uniqueCount = seen.size;
    uniqueIdRate = ids.length > 0 ? uniqueCount / ids.length : 1;
  }

  // Overall score: weighted combination
  // 60% completeness, 20% ID uniqueness, 20% row adequacy (at least 10 rows)
  const rowAdequacy = Math.min(rowCount / 10, 1);
  const overallScore = completeness * 0.6 + uniqueIdRate * 0.2 + rowAdequacy * 0.2;

  return {
    file: fileName,
    rowCount,
    columnCount,
    completeness: Math.round(completeness * 10000) / 10000,
    uniqueIdRate: Math.round(uniqueIdRate * 10000) / 10000,
    duplicateIds: duplicateIds.slice(0, 20),
    fields,
    overallScore: Math.round(overallScore * 10000) / 10000,
  };
}

function checkReferentialIntegrity(): ReferentialCheck[] {
  const results: ReferentialCheck[] = [];
  const idCache = new Map<string, Set<string>>();

  function getIds(fileName: string, column: string): Set<string> {
    const key = `${fileName}:${column}`;
    if (idCache.has(key)) return idCache.get(key)!;
    const filePath = path.join(LEXICONS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      idCache.set(key, new Set());
      return new Set();
    }
    const { header, rows } = parseTsvFile(filePath);
    const colIdx = header.indexOf(column);
    if (colIdx === -1) {
      idCache.set(key, new Set());
      return new Set();
    }
    const ids = new Set(rows.map((r) => r[colIdx] ?? "").filter((v) => v.trim().length > 0));
    idCache.set(key, ids);
    return ids;
  }

  for (const fk of FOREIGN_KEY_MAP) {
    const sourceFilePath = path.join(LEXICONS_DIR, fk.sourceFile);
    if (!fs.existsSync(sourceFilePath)) continue;

    const { header, rows } = parseTsvFile(sourceFilePath);
    const srcColIdx = header.indexOf(fk.sourceColumn);
    if (srcColIdx === -1) continue;

    const targetIds = getIds(fk.targetFile, fk.targetColumn);
    const sourceValues = rows
      .map((r) => r[srcColIdx] ?? "")
      .filter((v) => v.trim().length > 0);

    const missing = new Set<string>();
    let valid = 0;
    for (const val of sourceValues) {
      if (targetIds.has(val)) {
        valid++;
      } else {
        missing.add(val);
      }
    }

    results.push({
      sourceFile: fk.sourceFile,
      sourceColumn: fk.sourceColumn,
      targetFile: fk.targetFile,
      targetColumn: fk.targetColumn,
      totalRefs: sourceValues.length,
      validRefs: valid,
      missingRefs: [...missing].slice(0, 20),
    });
  }

  return results;
}

export function generateDataQualityReport(): DataQualityReport {
  const tsvFiles = fs.readdirSync(LEXICONS_DIR).filter((f) => f.endsWith(".tsv")).sort();

  const fileScores: FileQualityScore[] = [];
  let totalRows = 0;

  for (const fileName of tsvFiles) {
    const filePath = path.join(LEXICONS_DIR, fileName);
    const { header, rows } = parseTsvFile(filePath);
    const score = scoreFile(fileName, header, rows);
    fileScores.push(score);
    totalRows += score.rowCount;
  }

  const referentialIntegrity = checkReferentialIntegrity();

  const refIntegrityScore =
    referentialIntegrity.length > 0
      ? referentialIntegrity.reduce(
          (sum, r) => sum + (r.totalRefs > 0 ? r.validRefs / r.totalRefs : 1),
          0,
        ) / referentialIntegrity.length
      : 1;

  const avgFileScore =
    fileScores.length > 0
      ? fileScores.reduce((sum, f) => sum + f.overallScore, 0) / fileScores.length
      : 0;

  // Overall: 70% average file score, 30% referential integrity
  const overallScore = Math.round((avgFileScore * 0.7 + refIntegrityScore * 0.3) * 10000) / 10000;

  // Coverage vs roadmap targets (reuses the row counts just computed above).
  const rowCounts: Record<string, number> = {};
  for (const f of fileScores) rowCounts[f.file] = f.rowCount;
  const coverage = computeCoverage(rowCounts);
  const tierComposition = buildCorpusTierReport(LEXICONS_DIR);

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    fileCount: tsvFiles.length,
    totalRows,
    files: fileScores,
    referentialIntegrity,
    coverage,
    tierComposition,
  };
}

export function getFileSummary(): Array<{ file: string; rowCount: number; score: number }> {
  const report = generateDataQualityReport();
  return report.files.map((f) => ({ file: f.file, rowCount: f.rowCount, score: f.overallScore }));
}
