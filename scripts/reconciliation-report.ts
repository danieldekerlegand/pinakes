/**
 * Reconciliation keys & dry-run report for cross-dataset entity merging (US-005).
 *
 * pinakes-engine reconciles rows from many sources onto one graph node by a strict
 * **cascade** of identity signals (strongest first — see
 * `engine/src/pinakes_engine/schema/{reconcile,merge}.py`):
 *
 *   1. `wikidata_qid`     — the QID *is* the identity;
 *   2. `getty_id`         — a shared Getty subject;
 *   3. language anchor    — `iso639_1/iso639_2/glottocode` (a globally-unique code
 *                           for a language, via `language_code`);
 *   4. exact `(name, type, region)` — same normalized name, node type, and region;
 *   5. fuzzy `name`       — within one type/region, above a similarity threshold.
 *
 * pinakes rows arrive with **no** `wikidata_qid`/`getty_id` (steps 1–2 are
 * inert), so this module emits the keys the reconciler actually keys on for our data
 * — language codes for languages, and the normalized `(name, type, region)` blocking
 * key for every other domain — and estimates, without touching the network or the
 * live graph, how the export would land:
 *
 *   * **matched**     — carries a deterministic global anchor (a language code, or a
 *                       QID/getty id if ever present) that resolves the same entity
 *                       every time — it will collapse onto an existing node;
 *   * **ambiguous**   — its blocking key collides with another *distinct* exported
 *                       node, so the reconciler cannot auto-pick one; these are listed
 *                       with their competing candidates and are **never auto-merged**;
 *   * **likely-new**  — a unique name-anchored key with no global anchor; probably
 *                       mints a new node (or fuzzy-matches downstream).
 *
 * `buildReconciliationKeys` / `buildReconciliationReport` are pure over a lexicons
 * directory so tests drive them with fixtures; `writeReconciliation` / `runReport` do
 * the filesystem side. The keys TSV lands in the gitignored export tree; a bounded,
 * human-reviewable report snapshot is committed to `docs/reconciliation-report.json`.
 * See `engine/docs/reconcile-pinakes.md` for how to feed it into
 * pinakes-engine's reconcile step.
 */
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_SCHEMA, nodeTypeByName } from "@shared/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@shared/lexicon-mapping";
import {
  mintCsid,
  normaliseConfidence,
  DEFAULT_NODE_CONFIDENCE,
  EXPORT_SOURCE,
  EXPORT_DIR,
} from "./export-for-engine.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Gitignored output tree for the reconciliation keys + full report. */
export const RECONCILE_DIR = path.join(EXPORT_DIR, "reconciliation");

/** Committed, bounded report snapshot (human-reviewable). */
export const DOC_REPORT_PATH = path.join(
  REPO_ROOT,
  "docs",
  "reconciliation-report.json",
);

/** Max ambiguity groups embedded in the committed snapshot (full set on disk). */
export const MAX_AMBIGUITY_SAMPLES = 50;

/**
 * pinakes-engine's reconciliation cascade, strongest first (documented so the
 * report is self-describing; mirrors `reconcile.py` / `merge.py`).
 */
export const RECONCILE_CASCADE: readonly string[] = [
  "wikidata_qid",
  "getty_id",
  "language-code (iso639_1/iso639_2/glottocode)",
  "exact (name, type, region)",
  "fuzzy name",
];

/** How each exported node is estimated to land in the reconcile step. */
export type ReconciliationBucket = "matched" | "ambiguous" | "likely-new";

/** The reconciliation keys emitted for one exported node. */
export interface ReconciliationKey {
  readonly csid: string;
  readonly pinakesId: string;
  readonly nodeType: string;
  readonly label: string;
  readonly name: string;
  readonly region: string;
  /** Normalized `wikidata_qid` (`Q…`), `""` when the row carries no QID. */
  readonly wikidataQid: string;
  readonly iso639_1: string;
  readonly iso639_2: string;
  readonly glottocode: string;
  /** First non-empty language code (normalized), `""` for non-languages. */
  readonly languageAnchor: string;
  /** Normalized `(name, type, region)` blocking key, `""` when no name. */
  readonly nameKey: string;
  readonly confidence: number;
  readonly bucket: ReconciliationBucket;
}

/** A set of exported nodes that collide on one blocking key (never auto-merged). */
export interface AmbiguityGroup {
  readonly keyType: "language-code" | "name-type-region";
  readonly key: string;
  readonly candidates: ReadonlyArray<{
    readonly csid: string;
    readonly pinakesId: string;
    readonly name: string;
    readonly region: string;
    readonly confidence: number;
  }>;
}

/** The dry-run reconciliation report. */
export interface ReconciliationReport {
  readonly schemaVersion: string;
  readonly source: string;
  readonly cascade: readonly string[];
  readonly totals: {
    readonly nodes: number;
    readonly matched: number;
    readonly ambiguous: number;
    readonly likelyNew: number;
  };
  readonly byType: ReadonlyArray<{
    readonly type: string;
    readonly count: number;
    readonly matched: number;
    readonly ambiguous: number;
    readonly likelyNew: number;
  }>;
  readonly keyCoverage: {
    readonly languages: {
      readonly total: number;
      readonly withIso639: number;
      readonly withGlottocode: number;
    };
    /** Nodes carrying a global `wikidata_qid` anchor (matched via cascade step 1). */
    readonly withWikidataQid: number;
    readonly withRegion: number;
    readonly duplicateCsidsDropped: number;
  };
  /** Bounded when written to the committed snapshot; full set on disk. */
  readonly ambiguities: readonly AmbiguityGroup[];
  readonly ambiguityGroupCount: number;
}

/** Built keys + report (pure, no filesystem). */
export interface BuiltReconciliation {
  readonly keys: readonly ReconciliationKey[];
  readonly report: ReconciliationReport;
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/** Parse a TSV file into `{ headers, rows }`; missing files yield empties. */
function readTsv(filePath: string): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/**
 * Normalize a key component: NFKC, whitespace-collapsed, casefolded — mirrors
 * pinakes-engine's `normalize_name` so pinakes's keys block the same way.
 */
export function normalizeKey(value: string): string {
  return value.normalize("NFKC").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** Field separator inside a composite blocking key (cannot occur in normalized input). */
const KEY_SEP = "\x1f";

/** Column index (in `headers`) for the lexicon column mapped to canonical `target`. */
function targetColIndex(file: string, headers: string[], target: string): number {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return -1;
  const col = mapping.columns.find((c) => c.target === target);
  return col ? headers.indexOf(col.column) : -1;
}

/** Case-insensitive lookup of a header column by exact name, else -1. */
function headerIndex(headers: string[], name: string): number {
  const lower = name.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase() === lower);
}

/** Normalize a `wikidata_qid` cell to `Q<digits>`, or `""` when it is not a QID. */
export function normalizeQid(value: string): string {
  const q = value.trim().toUpperCase();
  return /^Q\d+$/.test(q) ? q : "";
}

/** First header whose name ends in `region` (region/origin_region/proposed_region). */
function regionColIndex(headers: string[]): number {
  return headers.findIndex((h) => /(^|_)region$/i.test(h));
}

/** First header matching `glottocode`/`glottolog`, else -1. */
function glottocodeColIndex(headers: string[]): number {
  return headers.findIndex((h) => /glotto/i.test(h));
}

/**
 * Build the reconciliation keys for every exported node (pure over a lexicons dir).
 * Deduplicates by `csid` (mirrors the export) and counts the drops.
 */
export function buildReconciliationKeys(
  lexiconsDir: string = LEXICONS_DIR,
): { keys: ReconciliationKey[]; duplicateCsidsDropped: number } {
  const keys: ReconciliationKey[] = [];
  const seenCsids = new Set<string>();
  let duplicateCsidsDropped = 0;

  for (const { file, node } of nodeFiles()) {
    const typeInfo = nodeTypeByName(node);
    if (typeInfo === undefined) continue;
    const { headers, rows } = readTsv(path.join(lexiconsDir, file));
    if (headers.length === 0) continue;

    const idIdx = targetColIndex(file, headers, "pinakes_id");
    const qidIdx = targetColIndex(file, headers, "wikidata_qid");
    const nameIdx = targetColIndex(file, headers, "name");
    const confIdx = targetColIndex(file, headers, "confidence");
    const iso1Idx = headerIndex(headers, "iso639_1");
    const iso2Idx = headerIndex(headers, "iso639_2");
    const glottoIdx = glottocodeColIndex(headers);
    const regionIdx = regionColIndex(headers);

    for (const row of rows) {
      const pinakesId = cell(row, idIdx);
      if (pinakesId === "") continue;
      const csid = mintCsid(node, pinakesId, cell(row, qidIdx));
      if (seenCsids.has(csid)) {
        duplicateCsidsDropped += 1;
        continue;
      }
      seenCsids.add(csid);

      const name = cell(row, nameIdx);
      const region = cell(row, regionIdx);
      const wikidataQid = normalizeQid(cell(row, qidIdx));
      const iso639_1 = cell(row, iso1Idx);
      const iso639_2 = cell(row, iso2Idx);
      const glottocode = cell(row, glottoIdx);
      const languageAnchor = normalizeKey(iso639_1 || iso639_2 || glottocode);
      const nameKey =
        name === ""
          ? ""
          : [normalizeKey(name), node, normalizeKey(region)].join(KEY_SEP);

      keys.push({
        csid,
        pinakesId,
        nodeType: node,
        label: typeInfo.label,
        name,
        region,
        wikidataQid,
        iso639_1,
        iso639_2,
        glottocode,
        languageAnchor,
        nameKey,
        confidence: normaliseConfidence(cell(row, confIdx), DEFAULT_NODE_CONFIDENCE),
        // Bucket is assigned in a second pass (needs cross-row collision info).
        bucket: "likely-new",
      });
    }
  }

  return { keys, duplicateCsidsDropped };
}

/**
 * Classify each key by pinakes-engine's cascade and assemble the dry-run report.
 * Anchored nodes (language codes / QIDs) take precedence over name blocking; a key
 * shared by two *distinct* nodes is ambiguous and its candidates are listed.
 */
export function buildReconciliationReport(
  keys: readonly ReconciliationKey[],
  duplicateCsidsDropped: number,
): BuiltReconciliation {
  // Blocking buckets, in cascade precedence: a `wikidata_qid` is a *global* anchor (the QID
  // IS the entity — cascade step 1), so a QID-bearing node reconciles deterministically and
  // is `matched` regardless of any name collision. A node with no QID but a language code
  // blocks on that code; every other node blocks on its (name, type, region) key.
  const langBuckets = new Map<string, ReconciliationKey[]>();
  const nameBuckets = new Map<string, ReconciliationKey[]>();
  for (const k of keys) {
    if (k.wikidataQid !== "") {
      continue; // QID anchor — never blocks on a weaker key.
    }
    if (k.languageAnchor !== "") {
      push(langBuckets, k.languageAnchor, k);
    } else if (k.nameKey !== "") {
      push(nameBuckets, k.nameKey, k);
    }
  }

  const classified: ReconciliationKey[] = keys.map((k) => {
    let bucket: ReconciliationBucket;
    if (k.wikidataQid !== "") {
      // A QID resolves the same Wikidata entity every time; two nodes sharing a QID are the
      // same entity (collapsed by reconcile_shared_qids), not a blocking ambiguity.
      bucket = "matched";
    } else if (k.languageAnchor !== "") {
      bucket = (langBuckets.get(k.languageAnchor)?.length ?? 0) > 1 ? "ambiguous" : "matched";
    } else if (k.nameKey !== "") {
      bucket = (nameBuckets.get(k.nameKey)?.length ?? 0) > 1 ? "ambiguous" : "likely-new";
    } else {
      // No anchor and no name — nothing to reconcile on; treat as new.
      bucket = "likely-new";
    }
    return { ...k, bucket };
  });

  const ambiguities: AmbiguityGroup[] = [];
  for (const [key, group] of langBuckets) {
    if (group.length > 1) ambiguities.push(toAmbiguityGroup("language-code", key, group));
  }
  for (const [key, group] of nameBuckets) {
    if (group.length > 1) ambiguities.push(toAmbiguityGroup("name-type-region", key, group));
  }
  ambiguities.sort((a, b) =>
    a.keyType !== b.keyType
      ? a.keyType < b.keyType ? -1 : 1
      : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  const report = buildReport(classified, ambiguities, duplicateCsidsDropped);
  return { keys: classified, report };
}

/** Convenience: build keys and report from a lexicons dir in one call (pure). */
export function buildReconciliation(
  lexiconsDir: string = LEXICONS_DIR,
): BuiltReconciliation {
  const { keys, duplicateCsidsDropped } = buildReconciliationKeys(lexiconsDir);
  return buildReconciliationReport(keys, duplicateCsidsDropped);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function toAmbiguityGroup(
  keyType: AmbiguityGroup["keyType"],
  key: string,
  group: readonly ReconciliationKey[],
): AmbiguityGroup {
  const candidates = group
    .map((k) => ({
      csid: k.csid,
      pinakesId: k.pinakesId,
      name: k.name,
      region: k.region,
      confidence: k.confidence,
    }))
    .sort((a, b) => (a.csid < b.csid ? -1 : a.csid > b.csid ? 1 : 0));
  // A composite name key is stored with \x1f separators; present it readably.
  return { keyType, key: key.split(KEY_SEP).join(" | "), candidates };
}

function buildReport(
  keys: readonly ReconciliationKey[],
  ambiguities: readonly AmbiguityGroup[],
  duplicateCsidsDropped: number,
): ReconciliationReport {
  const byType = new Map<
    string,
    { count: number; matched: number; ambiguous: number; likelyNew: number }
  >();
  let matched = 0;
  let ambiguous = 0;
  let likelyNew = 0;
  let languagesTotal = 0;
  let languagesWithIso = 0;
  let languagesWithGlotto = 0;
  let withWikidataQid = 0;
  let withRegion = 0;

  for (const k of keys) {
    const t = byType.get(k.nodeType) ?? {
      count: 0,
      matched: 0,
      ambiguous: 0,
      likelyNew: 0,
    };
    t.count += 1;
    if (k.bucket === "matched") {
      t.matched += 1;
      matched += 1;
    } else if (k.bucket === "ambiguous") {
      t.ambiguous += 1;
      ambiguous += 1;
    } else {
      t.likelyNew += 1;
      likelyNew += 1;
    }
    byType.set(k.nodeType, t);

    if (k.nodeType === "language") {
      languagesTotal += 1;
      if (k.iso639_1 !== "" || k.iso639_2 !== "") languagesWithIso += 1;
      if (k.glottocode !== "") languagesWithGlotto += 1;
    }
    if (k.wikidataQid !== "") withWikidataQid += 1;
    if (k.region !== "") withRegion += 1;
  }

  const byTypeSorted = [...byType.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

  return {
    schemaVersion: CANONICAL_SCHEMA.version,
    source: EXPORT_SOURCE,
    cascade: RECONCILE_CASCADE,
    totals: { nodes: keys.length, matched, ambiguous, likelyNew },
    byType: byTypeSorted,
    keyCoverage: {
      languages: {
        total: languagesTotal,
        withIso639: languagesWithIso,
        withGlottocode: languagesWithGlotto,
      },
      withWikidataQid,
      withRegion,
      duplicateCsidsDropped,
    },
    ambiguities,
    ambiguityGroupCount: ambiguities.length,
  };
}

// --- filesystem side -------------------------------------------------------

/** TSV header for the emitted reconciliation keys file. */
export const KEYS_HEADER: readonly string[] = [
  "csid",
  "pinakes_id",
  "node_type",
  "name",
  "region",
  "wikidata_qid",
  "iso639_1",
  "iso639_2",
  "glottocode",
  "language_anchor",
  "name_key",
  "confidence",
  "bucket",
];

/** Serialise a key row in `KEYS_HEADER` order (tabs/newlines stripped from cells). */
function keyRow(k: ReconciliationKey): string {
  const sani = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return [
    k.csid,
    k.pinakesId,
    k.nodeType,
    sani(k.name),
    sani(k.region),
    k.wikidataQid,
    k.iso639_1,
    k.iso639_2,
    k.glottocode,
    k.languageAnchor,
    // name_key uses \x1f internally; render readably.
    k.nameKey.split(KEY_SEP).join(" | "),
    String(k.confidence),
    k.bucket,
  ].join("\t");
}

/** Serialise the keys as a full TSV document (trailing newline). */
export function keysTsv(keys: readonly ReconciliationKey[]): string {
  const sorted = [...keys].sort((a, b) => (a.csid < b.csid ? -1 : a.csid > b.csid ? 1 : 0));
  return [KEYS_HEADER.join("\t"), ...sorted.map(keyRow)].join("\n") + "\n";
}

/** Serialise a report to JSON (trailing newline). */
export function reportJson(report: ReconciliationReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/** The committed snapshot: the report with its ambiguity list bounded. */
export function snapshotReport(report: ReconciliationReport): ReconciliationReport {
  return { ...report, ambiguities: report.ambiguities.slice(0, MAX_AMBIGUITY_SAMPLES) };
}

/**
 * Write the reconciliation artifacts:
 *   <RECONCILE_DIR>/keys.tsv    — per-node reconciliation keys (gitignored)
 *   <RECONCILE_DIR>/report.json — full dry-run report (gitignored)
 *   docs/reconciliation-report.json — bounded, committed snapshot
 */
export function writeReconciliation(
  built: BuiltReconciliation,
  opts: { outDir?: string; docReportPath?: string } = {},
): void {
  const outDir = opts.outDir ?? RECONCILE_DIR;
  const docReportPath = opts.docReportPath ?? DOC_REPORT_PATH;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "keys.tsv"), keysTsv(built.keys));
  fs.writeFileSync(path.join(outDir, "report.json"), reportJson(built.report));
  fs.writeFileSync(docReportPath, reportJson(snapshotReport(built.report)));
}

/** Build + write the reconciliation artifacts and refresh the committed snapshot. */
export function runReport(
  opts: {
    lexiconsDir?: string;
    outDir?: string;
    docReportPath?: string;
  } = {},
): BuiltReconciliation {
  const built = buildReconciliation(opts.lexiconsDir ?? LEXICONS_DIR);
  writeReconciliation(built, opts);
  return built;
}

// CLI entry — mirrors export-for-engine.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const { report } = runReport();
  const { totals } = report;
  // eslint-disable-next-line no-console
  console.log(
    `Reconciliation dry-run: ${totals.nodes} nodes → ${totals.matched} matched, ` +
      `${totals.likelyNew} likely-new, ${totals.ambiguous} ambiguous ` +
      `(${report.ambiguityGroupCount} ambiguity groups) → ${RECONCILE_DIR}`,
  );
}
