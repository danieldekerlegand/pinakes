/**
 * Convergence QA gate & drift detection (US-008).
 *
 * A single, network-free health check that both projects can run in CI to catch
 * schema / id drift between LinguaScrape's lexicons and the shared canonical model
 * *before* it reaches culture-scrape's graph. It reports four convergence signals —
 *
 *   * **id-overlap**            — how much of the LinguaScrape export overlaps
 *                                 culture-scrape's identity space (the reconciliation
 *                                 dry-run's global-anchor matches), plus LinguaScrape's
 *                                 own internal id-collision diagnostics;
 *   * **unreconciled rate**     — the share of exported nodes that would *not* collapse
 *                                 onto an existing node (likely-new + ambiguous);
 *   * **provenance completeness** — per node/edge family, the non-blank rate of the
 *                                 required provenance columns (US-006);
 *   * **schema drift**          — the machine-readable canonical schema (US-001) and the
 *                                 lexicon→canonical mapping (US-002) still validate, every
 *                                 `lexicons/*.tsv` on disk is mapped, and every mapped
 *                                 column still exists in its live header.
 *
 * Only **drift** fails the gate: {@link runQA} exits non-zero when the canonical schema
 * or mapping no longer validates, a lexicon file is unmapped, a mapped column was
 * renamed/removed, or a canonical provenance column disappeared. The id-overlap /
 * unreconciled / provenance numbers are reported for humans but never fail the build on
 * their own (they drift gradually and belong to review, not a hard gate).
 *
 * `buildConvergenceQA` / `detectDrift` are pure over a lexicons directory so tests drive
 * them with fixtures; `writeConvergenceQA` / `runQA` do the filesystem side. The artifact
 * (`convergence-qa.json` + a human-readable `convergence-qa.md`) lands in the gitignored
 * export tree. See `docs/canonical-schema.md` §10 for the CI runbook.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_SCHEMA,
  assertValidCanonicalSchema,
} from "@shared/canonical-schema";
import {
  assertValidLexiconMapping,
  lexiconMappingByFile,
  mappedFiles,
} from "@shared/lexicon-mapping";
import {
  buildExport,
  EXPORT_DIR,
  EXPORT_SOURCE,
  NODE_PROVENANCE_FIELDS,
  EDGE_PROVENANCE_FIELDS,
  type ExportManifest,
} from "./export-for-culturescrape.ts";
import {
  buildReconciliation,
  type ReconciliationReport,
} from "./reconciliation-report.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Gitignored output tree for the convergence-QA artifact. */
export const QA_DIR = path.join(EXPORT_DIR, "convergence");

/** Committed dedup/QA regression baseline (the ratchet ceilings). */
export const BASELINE_FILE = path.join(REPO_ROOT, "docs", "convergence-qa-baseline.json");

/**
 * Canonical field whose non-blank lexicon cell marks a row as **acquisition-imported**
 * (written by the culture-scrape pipeline, not hand-curated). A file with no column
 * mapped to this target has no imported rows — every row is curated seed.
 */
export const IMPORT_MARKER_TARGET = "wikidata_qid";

/**
 * Provenance every imported row MUST carry, non-blank (roadmap Guiding Principle #8):
 * which authority (`source`), the record URL (`source_url`), when it was retrieved
 * (`retrieved_at`), and the reconciliation confidence (`confidence`). These are canonical
 * *targets*; each lexicon file names the columns itself (via shared/lexicon-mapping.json),
 * so the gate generalises across domains without hard-coding column names.
 */
export const REQUIRED_IMPORT_PROVENANCE_TARGETS = [
  "source",
  "source_url",
  "retrieved_at",
  "confidence",
] as const;

/** A single drift finding — any non-empty list fails the gate. */
export interface DriftIssue {
  readonly kind:
    | "schema-invalid"
    | "mapping-invalid"
    | "unmapped-lexicon-file"
    | "missing-source-column"
    | "canonical-column-missing";
  readonly message: string;
  /** The lexicon file the issue relates to, when file-scoped. */
  readonly file?: string;
}

/**
 * An imported lexicon row missing required attribution. Any non-empty list fails the
 * gate — a scaled corpus stays credible only if every acquired row is sourced.
 */
export interface AttributionIssue {
  readonly file: string;
  /** The row's `id` (or its wikidata QID when no id column exists). */
  readonly rowId: string;
  /** Required provenance target(s) that are blank or whose column is unmapped/absent. */
  readonly missing: readonly string[];
}

/**
 * Dedup / reconciliation ceilings the corpus must not exceed (a monotone ratchet).
 * Committed at {@link BASELINE_FILE}; adding data may only hold or lower these. A
 * legitimate increase is re-baselined deliberately (a reviewed act), which is exactly
 * what keeps dedup regressions from sneaking in with a bulk import.
 */
export interface RegressionBaseline {
  readonly duplicateCsids: number;
  readonly ambiguousLinguascrapeIds: number;
  readonly edgesWithUnresolvedEndpoint: number;
  readonly reconciliationAmbiguous: number;
}

/** One metric that regressed past its baseline ceiling — fails the gate. */
export interface RegressionIssue {
  readonly metric: keyof RegressionBaseline;
  readonly baseline: number;
  readonly current: number;
}

/** id-overlap signal: cross-dataset overlap + LinguaScrape-internal id health. */
export interface IdentityMetrics {
  readonly nodes: number;
  /** Nodes carrying a global anchor that overlaps culture-scrape's identity space. */
  readonly anchoredOverlap: number;
  readonly overlapRate: number;
  /** LinguaScrape ids reused by more than one node of the same type (export drops). */
  readonly duplicateCsids: number;
  readonly ambiguousLinguascrapeIds: number;
  readonly edgesWithUnresolvedEndpoint: number;
}

/** Unreconciled-rate signal from the reconciliation dry-run (US-005). */
export interface ReconciliationMetrics {
  readonly nodes: number;
  readonly matched: number;
  readonly ambiguous: number;
  readonly likelyNew: number;
  /** (ambiguous + likely-new) / nodes — the share that will not collapse onto a node. */
  readonly unreconciledRate: number;
}

/** Provenance-completeness signal for one node/edge family (US-006). */
export interface ProvenanceFamilyMetrics {
  readonly total: number;
  /** Required provenance field → non-blank rate in `[0, 1]`. */
  readonly completeness: Readonly<Record<string, number>>;
}

/** All provenance-completeness signals. */
export interface ProvenanceMetrics {
  readonly node: ProvenanceFamilyMetrics;
  readonly edge: ProvenanceFamilyMetrics;
  readonly flags: readonly string[];
}

/** Schema shape at the time of the run (for the report header). */
export interface SchemaMetrics {
  readonly version: string;
  readonly nodeTypes: number;
  readonly edgeTypes: number;
  readonly nodeColumns: number;
  readonly edgeColumns: number;
}

/** The full convergence-QA report. */
export interface ConvergenceQAReport {
  readonly schemaVersion: string;
  readonly source: string;
  /** `true` iff no drift, no attribution gap, and no regression — the gate passes. */
  readonly ok: boolean;
  readonly drift: readonly DriftIssue[];
  /** Imported rows missing provenance (US-001 hard gate). */
  readonly attribution: readonly AttributionIssue[];
  /** Dedup/reconciliation metrics that regressed past baseline (US-001 hard gate). */
  readonly regressions: readonly RegressionIssue[];
  readonly metrics: {
    readonly schema: SchemaMetrics;
    readonly identity: IdentityMetrics;
    readonly reconciliation: ReconciliationMetrics;
    readonly provenance: ProvenanceMetrics;
  };
}

/** Read a lexicon file's header columns; missing/empty files yield `[]`. */
function headerColumns(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim() === "") return [];
  return firstLine.split(CANONICAL_SCHEMA.delimiter).map((h) => h.trim());
}

/** Every `*.tsv` present in a lexicons directory (sorted); missing dir ⇒ `[]`. */
function lexiconFilesOnDisk(lexiconsDir: string): string[] {
  if (!fs.existsSync(lexiconsDir)) return [];
  return fs
    .readdirSync(lexiconsDir)
    .filter((f) => f.endsWith(".tsv"))
    .sort();
}

/**
 * Detect convergence drift for a lexicons directory. Cheap (header reads only, no
 * export build). Returns every drift finding; an empty list means the gate passes.
 *
 * Faithfully treats a directory as a *corpus*: only files actually present are checked
 * for column drift (so a fixture with a subset of the mapped files is fine), while any
 * `*.tsv` present-but-unmapped, and any structural break in the canonical schema/mapping,
 * is drift.
 */
export function detectDrift(lexiconsDir: string = LEXICONS_DIR): DriftIssue[] {
  const drift: DriftIssue[] = [];

  // 1. Canonical schema still validates (renamed/removed structural or provenance column).
  try {
    assertValidCanonicalSchema();
  } catch (err) {
    drift.push({
      kind: "schema-invalid",
      message: `canonical schema does not validate: ${(err as Error).message}`,
    });
  }

  // 2. lexicon→canonical mapping still validates (target points at a real canonical field;
  //    a renamed canonical column surfaces here as an unknown target).
  try {
    assertValidLexiconMapping();
  } catch (err) {
    drift.push({
      kind: "mapping-invalid",
      message: `lexicon mapping does not validate: ${(err as Error).message}`,
    });
  }

  // 3. The canonical provenance columns the export relies on still exist (US-006).
  const nodeFieldSet = new Set(CANONICAL_SCHEMA.node.columns.map((c) => c.field));
  const edgeFieldSet = new Set(CANONICAL_SCHEMA.edge.columns.map((c) => c.field));
  for (const f of NODE_PROVENANCE_FIELDS) {
    if (!nodeFieldSet.has(f)) {
      drift.push({
        kind: "canonical-column-missing",
        message: `canonical node schema is missing provenance column '${f}' the export writes`,
      });
    }
  }
  for (const f of EDGE_PROVENANCE_FIELDS) {
    if (!edgeFieldSet.has(f)) {
      drift.push({
        kind: "canonical-column-missing",
        message: `canonical edge schema is missing provenance column '${f}' the export writes`,
      });
    }
  }

  // 4. Every lexicons/*.tsv on disk is mapped (US-002 totality); unmapped ⇒ drift.
  const mapped = new Set(mappedFiles());
  for (const file of lexiconFilesOnDisk(lexiconsDir)) {
    if (!mapped.has(file)) {
      drift.push({
        kind: "unmapped-lexicon-file",
        message: `lexicons/${file} is present on disk but not in shared/lexicon-mapping.json`,
        file,
      });
    }
  }

  // 5. Every mapped column still exists in its live header (renamed/removed source column).
  for (const file of lexiconFilesOnDisk(lexiconsDir)) {
    const mapping = lexiconMappingByFile(file);
    if (mapping === undefined) continue; // reported by step 4.
    const header = new Set(headerColumns(path.join(lexiconsDir, file)));
    if (header.size === 0) continue; // empty file — nothing to compare against.
    const missing = mapping.columns
      .map((c) => c.column)
      .filter((c) => !header.has(c));
    if (missing.length > 0) {
      drift.push({
        kind: "missing-source-column",
        message: `lexicons/${file}: mapped column(s) absent from the live header: ${missing.join(", ")}`,
        file,
      });
    }
  }

  return drift;
}

/** Parse a lexicon TSV into `{ headers, rows }` (cells kept raw); missing/empty ⇒ null. */
function readLexiconTable(
  filePath: string,
): { headers: string[]; rows: string[][] } | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim() === "") return null;
  const lines = text.split(/\r?\n/).filter((l) => l !== "");
  if (lines.length === 0) return null;
  const headers = lines[0].split(CANONICAL_SCHEMA.delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(CANONICAL_SCHEMA.delimiter));
  return { headers, rows };
}

/** Trimmed cell at `idx`; out-of-range indices yield `""`. */
function cellAt(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Attribution gate (US-001): every **acquisition-imported** lexicon row must carry full
 * provenance. A row is imported iff its {@link IMPORT_MARKER_TARGET}-mapped cell is
 * non-blank; each such row must have a non-blank cell for every
 * {@link REQUIRED_IMPORT_PROVENANCE_TARGETS} column. Reads the **lexicons** (the source of
 * truth) — not the canonical export, which force-blanks `source_url`/`retrieved_at`.
 *
 * Files with no column mapped to the import marker have no imported rows (all curated) and
 * are skipped. A required provenance *target* that isn't even mapped in an importing file
 * is itself a gap (imported data with nowhere to record its attribution).
 */
export function detectAttributionGaps(
  lexiconsDir: string = LEXICONS_DIR,
): AttributionIssue[] {
  const issues: AttributionIssue[] = [];
  for (const file of lexiconFilesOnDisk(lexiconsDir)) {
    const mapping = lexiconMappingByFile(file);
    if (mapping === undefined) continue; // unmapped file → reported by detectDrift.

    const columnForTarget = (target: string): string | undefined =>
      mapping.columns.find((c) => c.target === target)?.column;
    const markerColumn = columnForTarget(IMPORT_MARKER_TARGET);
    if (markerColumn === undefined) continue; // no import marker → no imported rows.

    const table = readLexiconTable(path.join(lexiconsDir, file));
    if (table === null) continue;
    const headerIndex = (name: string | undefined): number =>
      name === undefined ? -1 : table.headers.indexOf(name);

    const markerIdx = headerIndex(markerColumn);
    if (markerIdx < 0) continue; // marker column absent from live header (drift's job).

    // Resolve each required provenance target to its live column index (-1 if unmapped/absent).
    const required = REQUIRED_IMPORT_PROVENANCE_TARGETS.map((target) => ({
      target,
      idx: headerIndex(columnForTarget(target)),
    }));
    const idIdx = table.headers.includes("id")
      ? table.headers.indexOf("id")
      : 0;

    for (const row of table.rows) {
      if (cellAt(row, markerIdx) === "") continue; // curated seed row.
      const missing = required
        .filter((r) => cellAt(row, r.idx) === "")
        .map((r) => r.target);
      if (missing.length > 0) {
        issues.push({
          file,
          rowId: cellAt(row, idIdx) || cellAt(row, markerIdx),
          missing,
        });
      }
    }
  }
  return issues;
}

/** Read the committed regression baseline; returns `undefined` when absent. */
export function loadBaseline(
  baselineFile: string = BASELINE_FILE,
): RegressionBaseline | undefined {
  if (!fs.existsSync(baselineFile)) return undefined;
  return JSON.parse(fs.readFileSync(baselineFile, "utf8")) as RegressionBaseline;
}

/**
 * Regression ratchet (US-001): fail if any dedup/reconciliation metric climbed above its
 * committed ceiling. `undefined` baseline ⇒ no ratchet (empty list) — the gate still runs
 * on drift + attribution.
 */
export function detectRegressions(
  identity: IdentityMetrics,
  reconciliation: ReconciliationMetrics,
  baseline: RegressionBaseline | undefined,
): RegressionIssue[] {
  if (baseline === undefined) return [];
  const current: RegressionBaseline = {
    duplicateCsids: identity.duplicateCsids,
    ambiguousLinguascrapeIds: identity.ambiguousLinguascrapeIds,
    edgesWithUnresolvedEndpoint: identity.edgesWithUnresolvedEndpoint,
    reconciliationAmbiguous: reconciliation.ambiguous,
  };
  const issues: RegressionIssue[] = [];
  for (const metric of Object.keys(current) as (keyof RegressionBaseline)[]) {
    if (current[metric] > baseline[metric]) {
      issues.push({ metric, baseline: baseline[metric], current: current[metric] });
    }
  }
  return issues;
}

/** Round a rate to 4 decimals for stable, human-readable reporting. */
function rate(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}

/** Assemble the id-overlap metric from the export manifest + reconciliation report. */
function identityMetrics(
  manifest: ExportManifest,
  recon: ReconciliationReport,
): IdentityMetrics {
  const nodes = recon.totals.nodes;
  return {
    nodes,
    anchoredOverlap: recon.totals.matched,
    overlapRate: rate(recon.totals.matched, nodes),
    duplicateCsids: manifest.diagnostics.duplicateCsids,
    ambiguousLinguascrapeIds: manifest.diagnostics.ambiguousLinguascrapeIds,
    edgesWithUnresolvedEndpoint: manifest.diagnostics.edgesWithUnresolvedEndpoint,
  };
}

/** Assemble the unreconciled-rate metric from the reconciliation report. */
function reconciliationMetrics(recon: ReconciliationReport): ReconciliationMetrics {
  const { nodes, matched, ambiguous, likelyNew } = recon.totals;
  return {
    nodes,
    matched,
    ambiguous,
    likelyNew,
    unreconciledRate: rate(ambiguous + likelyNew, nodes),
  };
}

/** Assemble provenance completeness from the export manifest's coverage report (US-006). */
function provenanceMetrics(manifest: ExportManifest): ProvenanceMetrics {
  const family = (
    total: number,
    fields: readonly string[],
    nonEmpty: Readonly<Record<string, number>>,
  ): ProvenanceFamilyMetrics => ({
    total,
    completeness: Object.fromEntries(
      fields.map((f) => [f, rate(nonEmpty[f] ?? 0, total)]),
    ),
  });
  const { node, edge } = manifest.provenance;
  return {
    node: family(node.total, node.fields, node.nonEmpty),
    edge: family(edge.total, edge.fields, edge.nonEmpty),
    flags: manifest.provenance.flags,
  };
}

/**
 * Build the full convergence-QA report from a lexicons directory. Pure (runs the
 * export + reconciliation dry-run in memory; {@link writeConvergenceQA} does the
 * filesystem side).
 */
export function buildConvergenceQA(
  lexiconsDir: string = LEXICONS_DIR,
  opts: { baseline?: RegressionBaseline } = {},
): ConvergenceQAReport {
  const drift = detectDrift(lexiconsDir);
  const attribution = detectAttributionGaps(lexiconsDir);
  const { manifest } = buildExport(lexiconsDir);
  const { report: recon } = buildReconciliation(lexiconsDir);
  const identity = identityMetrics(manifest, recon);
  const reconciliation = reconciliationMetrics(recon);
  const baseline = "baseline" in opts ? opts.baseline : loadBaseline();
  const regressions = detectRegressions(identity, reconciliation, baseline);

  return {
    schemaVersion: CANONICAL_SCHEMA.version,
    source: EXPORT_SOURCE,
    ok: drift.length === 0 && attribution.length === 0 && regressions.length === 0,
    drift,
    attribution,
    regressions,
    metrics: {
      schema: {
        version: CANONICAL_SCHEMA.version,
        nodeTypes: CANONICAL_SCHEMA.nodeTypes.length,
        edgeTypes: CANONICAL_SCHEMA.edgeTypes.length,
        nodeColumns: CANONICAL_SCHEMA.node.columns.length,
        edgeColumns: CANONICAL_SCHEMA.edge.columns.length,
      },
      identity,
      reconciliation,
      provenance: provenanceMetrics(manifest),
    },
  };
}

// --- rendering + filesystem side -------------------------------------------

/** Format a `[0,1]` rate as a percentage string (e.g. `98.2%`). */
function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

/** Render the report as a human-readable Markdown artifact. */
export function formatMarkdown(report: ConvergenceQAReport): string {
  const { metrics } = report;
  const lines: string[] = [];
  lines.push(`# Convergence QA report`);
  lines.push("");
  lines.push(`- **Gate:** ${report.ok ? "✅ PASS" : "❌ FAIL"}`);
  lines.push(`- **Schema version:** ${report.schemaVersion}`);
  lines.push(`- **Source:** ${report.source}`);
  lines.push("");

  lines.push(`## Schema drift`);
  if (report.drift.length === 0) {
    lines.push(`No drift: canonical schema + lexicon mapping validate, every `);
    lines.push(`\`lexicons/*.tsv\` is mapped, and every mapped column exists.`);
  } else {
    lines.push(`${report.drift.length} drift issue(s) — the gate fails:`);
    for (const d of report.drift) {
      lines.push(`- \`${d.kind}\`: ${d.message}`);
    }
  }
  lines.push("");

  lines.push(`## Attribution (imported-row provenance)`);
  if (report.attribution.length === 0) {
    lines.push(`No gaps: every acquisition-imported row (\`${IMPORT_MARKER_TARGET}\` set) `);
    lines.push(`carries ${REQUIRED_IMPORT_PROVENANCE_TARGETS.join(", ")}.`);
  } else {
    lines.push(`${report.attribution.length} imported row(s) missing provenance — the gate fails:`);
    for (const a of report.attribution.slice(0, 50)) {
      lines.push(`- \`${a.file}\` row \`${a.rowId}\`: missing ${a.missing.join(", ")}`);
    }
    if (report.attribution.length > 50) {
      lines.push(`- …and ${report.attribution.length - 50} more`);
    }
  }
  lines.push("");

  lines.push(`## Dedup / reconciliation regression`);
  if (report.regressions.length === 0) {
    lines.push(`No regression: dedup + reconciliation metrics are at or below baseline.`);
  } else {
    lines.push(`${report.regressions.length} metric(s) regressed past baseline — the gate fails:`);
    for (const r of report.regressions) {
      lines.push(`- \`${r.metric}\`: ${r.current} > baseline ${r.baseline}`);
    }
  }
  lines.push("");

  lines.push(`## id-overlap (cross-dataset identity)`);
  const id = metrics.identity;
  lines.push(`- Nodes exported: **${id.nodes}**`);
  lines.push(`- Overlap w/ culture-scrape identity space (global-anchor matches): **${id.anchoredOverlap}** (${pct(id.overlapRate)})`);
  lines.push(`- Duplicate csids dropped: ${id.duplicateCsids}`);
  lines.push(`- Ambiguous LinguaScrape ids (id reused by ≥2 nodes of a type): ${id.ambiguousLinguascrapeIds}`);
  lines.push(`- Edges dropped for an unresolved endpoint: ${id.edgesWithUnresolvedEndpoint}`);
  lines.push("");

  lines.push(`## Unreconciled rate`);
  const r = metrics.reconciliation;
  lines.push(`- matched: **${r.matched}** · ambiguous: **${r.ambiguous}** · likely-new: **${r.likelyNew}**`);
  lines.push(`- **Unreconciled rate** (ambiguous + likely-new): **${pct(r.unreconciledRate)}**`);
  lines.push("");

  lines.push(`## Provenance completeness`);
  const fam = (label: string, f: ProvenanceFamilyMetrics) => {
    lines.push(`- **${label}** (${f.total} rows):`);
    for (const [field, c] of Object.entries(f.completeness)) {
      lines.push(`  - ${field}: ${pct(c)}`);
    }
  };
  fam("nodes", metrics.provenance.node);
  fam("edges", metrics.provenance.edge);
  if (metrics.provenance.flags.length > 0) {
    lines.push(`- Notes:`);
    for (const flag of metrics.provenance.flags) lines.push(`  - ${flag}`);
  }
  lines.push("");

  return lines.join("\n");
}

/** Serialise the report to JSON (trailing newline). */
export function reportJson(report: ConvergenceQAReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Write the convergence-QA artifact:
 *   <QA_DIR>/convergence-qa.json — machine-readable report (gitignored)
 *   <QA_DIR>/convergence-qa.md   — human-readable summary (gitignored)
 */
export function writeConvergenceQA(
  report: ConvergenceQAReport,
  outDir: string = QA_DIR,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "convergence-qa.json"), reportJson(report));
  fs.writeFileSync(path.join(outDir, "convergence-qa.md"), formatMarkdown(report));
}

/**
 * Build + write the convergence-QA artifact. Returns the report and the process exit
 * code (`0` clean, `1` on drift) so the CLI — and CI — can gate on it.
 */
export function runQA(
  opts: { lexiconsDir?: string; outDir?: string } = {},
): { report: ConvergenceQAReport; exitCode: number } {
  const report = buildConvergenceQA(opts.lexiconsDir ?? LEXICONS_DIR);
  writeConvergenceQA(report, opts.outDir ?? QA_DIR);
  return { report, exitCode: report.ok ? 0 : 1 };
}

/**
 * Recompute the dedup/reconciliation baseline from the live corpus and write it to
 * {@link BASELINE_FILE}. Run deliberately (`--write-baseline`) after a data change that
 * legitimately shifts these metrics — the write is the reviewed re-baseline act.
 */
export function writeBaseline(baselineFile: string = BASELINE_FILE): RegressionBaseline {
  const report = buildConvergenceQA(LEXICONS_DIR, { baseline: undefined });
  const baseline: RegressionBaseline = {
    duplicateCsids: report.metrics.identity.duplicateCsids,
    ambiguousLinguascrapeIds: report.metrics.identity.ambiguousLinguascrapeIds,
    edgesWithUnresolvedEndpoint: report.metrics.identity.edgesWithUnresolvedEndpoint,
    reconciliationAmbiguous: report.metrics.reconciliation.ambiguous,
  };
  const withHeader = {
    "//":
      "Convergence-QA dedup/reconciliation regression baseline (US-001). A monotone " +
      "ratchet: scaled data may hold or lower these, never exceed them without a " +
      "deliberate, reviewed re-baseline. Regenerate: npx tsx scripts/convergence-qa.ts --write-baseline",
    ...baseline,
  };
  fs.writeFileSync(baselineFile, JSON.stringify(withHeader, null, 2) + "\n");
  return baseline;
}

// CLI entry — mirrors export-for-culturescrape.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  if (process.argv.includes("--write-baseline")) {
    const baseline = writeBaseline();
    // eslint-disable-next-line no-console
    console.log(`Wrote convergence-QA baseline → ${BASELINE_FILE}: ${JSON.stringify(baseline)}`);
    process.exit(0);
  }
  const { report, exitCode } = runQA();
  const { identity, reconciliation } = report.metrics;
  // eslint-disable-next-line no-console
  console.log(
    `Convergence QA: ${report.ok ? "PASS" : "FAIL"} — ` +
      `${identity.nodes} nodes, ${pct(identity.overlapRate)} id-overlap, ` +
      `${pct(reconciliation.unreconciledRate)} unreconciled, ` +
      `${report.drift.length} drift, ${report.attribution.length} attribution, ` +
      `${report.regressions.length} regression issue(s) → ${QA_DIR}`,
  );
  if (!report.ok) {
    for (const d of report.drift) {
      // eslint-disable-next-line no-console
      console.error(`  drift [${d.kind}]: ${d.message}`);
    }
    for (const a of report.attribution) {
      // eslint-disable-next-line no-console
      console.error(`  attribution [${a.file}:${a.rowId}]: missing ${a.missing.join(", ")}`);
    }
    for (const r of report.regressions) {
      // eslint-disable-next-line no-console
      console.error(`  regression [${r.metric}]: ${r.current} > baseline ${r.baseline}`);
    }
  }
  process.exit(exitCode);
}
