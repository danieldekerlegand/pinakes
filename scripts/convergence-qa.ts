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
  /** `true` iff there is no drift — the gate passes. */
  readonly ok: boolean;
  readonly drift: readonly DriftIssue[];
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
): ConvergenceQAReport {
  const drift = detectDrift(lexiconsDir);
  const { manifest } = buildExport(lexiconsDir);
  const { report: recon } = buildReconciliation(lexiconsDir);

  return {
    schemaVersion: CANONICAL_SCHEMA.version,
    source: EXPORT_SOURCE,
    ok: drift.length === 0,
    drift,
    metrics: {
      schema: {
        version: CANONICAL_SCHEMA.version,
        nodeTypes: CANONICAL_SCHEMA.nodeTypes.length,
        edgeTypes: CANONICAL_SCHEMA.edgeTypes.length,
        nodeColumns: CANONICAL_SCHEMA.node.columns.length,
        edgeColumns: CANONICAL_SCHEMA.edge.columns.length,
      },
      identity: identityMetrics(manifest, recon),
      reconciliation: reconciliationMetrics(recon),
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
  lines.push(`- **Gate:** ${report.ok ? "✅ PASS (no drift)" : "❌ FAIL (drift detected)"}`);
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

// CLI entry — mirrors export-for-culturescrape.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const { report, exitCode } = runQA();
  const { identity, reconciliation } = report.metrics;
  // eslint-disable-next-line no-console
  console.log(
    `Convergence QA: ${report.ok ? "PASS" : "FAIL"} — ` +
      `${identity.nodes} nodes, ${pct(identity.overlapRate)} id-overlap, ` +
      `${pct(reconciliation.unreconciledRate)} unreconciled, ` +
      `${report.drift.length} drift issue(s) → ${QA_DIR}`,
  );
  if (!report.ok) {
    for (const d of report.drift) {
      // eslint-disable-next-line no-console
      console.error(`  drift [${d.kind}]: ${d.message}`);
    }
  }
  process.exit(exitCode);
}
