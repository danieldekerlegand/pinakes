/**
 * Bidirectional TSV write-back: import culture-scrape-derived facts back into the
 * LinguaScrape lexicons (US-007).
 *
 * US-004 exports `lexicons/*.tsv` → the shared canonical shape culture-scrape ingests.
 * This module is the return leg: it reads canonical node TSVs (the *enriched* export
 * culture-scrape hands back — graph-derived values, filled gaps) and writes those facts
 * back into the lexicon rows they came from, so the two stores do not drift and the
 * lexicons remain a complete, graph-independent source of truth.
 *
 * The write-back is deliberately conservative:
 *
 *   * **It never overwrites a human-curated value.** A lexicon cell that already holds a
 *     (different) value is a *conflict*: it is reported, never silently resolved. Only an
 *     explicit `{ overwrite: true }` applies the incoming value over a curated one.
 *   * **It only fills gaps by default.** A blank lexicon cell for which culture-scrape
 *     supplies a value is an *enrichment* and is written.
 *   * **Provenance columns are preserved.** The lexicon columns that carry provenance /
 *     citations (`sources`, the column mapped to canonical `source`, …) and the identity /
 *     confidence columns are excluded from write-back — LinguaScrape owns those.
 *   * **No data loss.** A pure round-trip (export → import with no enrichment) is a
 *     byte-identical no-op: every writeable cell already matches, so nothing changes.
 *
 * Only canonical fields with a real `lexicons/*.tsv` column (a reverse of the US-002
 * `target` mapping) are writeable — that is what "where a canonical→lexicon mapping
 * exists" means. Graph-authored **relationships/edges** are *not* written back into
 * lexicon FK columns: an edge has no lexicon row identity to target, and relationships are
 * graph-owned (see the ownership table in `docs/canonical-schema.md` §9).
 *
 * `buildWriteBack` is pure over a (canonical dir, lexicons dir) pair so tests drive it
 * with fixtures; `writeWriteBack` / `runWriteBack` do the filesystem side. The report
 * lands in the gitignored export tree.
 */
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_SCHEMA } from "@shared/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@shared/lexicon-mapping";
import { EXPORT_DIR, EXPORT_SOURCE } from "./export-for-culturescrape.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Default gitignored location for the write-back report. */
export const WRITEBACK_DIR = path.join(EXPORT_DIR, "writeback");

/**
 * Canonical fields excluded from write-back. These are either the join key /
 * structural id (`linguascrape_id`) or LinguaScrape-owned provenance / confidence
 * columns that must be preserved, not overwritten from the graph (AC2). The lexicon
 * column mapped to canonical `source` actually holds bibliographic citations — never
 * clobber it with the acquisition-source id.
 */
export const NON_WRITEBACK_FIELDS: ReadonlySet<string> = new Set([
  "csid",
  ":LABEL",
  "linguascrape_id",
  "wikidata_qid",
  "source",
  "source_url",
  "source_query",
  "retrieved_at",
  "confidence",
]);

/** One applied write-back edit (enrichment or, under `overwrite`, a resolved conflict). */
export interface WriteBackChange {
  readonly file: string;
  readonly nodeType: string;
  readonly linguascrapeId: string;
  readonly field: string;
  readonly column: string;
  readonly oldValue: string;
  readonly newValue: string;
  readonly kind: "enrichment" | "overwrite";
}

/**
 * An id whose `linguascrape_id` join key is not unique (the same id appears on more than
 * one lexicon row, and/or more than one canonical row). Such a key cannot identify a single
 * row to write into, so the write-back **skips it entirely** — reported here, never written
 * — rather than risk writing one entity's facts into another entity's row. (The live
 * `lexicons/languages.tsv` reuses ids like `abe` for both *Western Abenaki* and *Great
 * Andamanese*; the export already drops the duplicate, but the import must not enrich the
 * survivor from the wrong twin.)
 */
export interface WriteBackAmbiguousId {
  readonly file: string;
  readonly nodeType: string;
  readonly linguascrapeId: string;
  /** How many lexicon rows in `file` carry this id (≥1; >1 means lexicon-side ambiguity). */
  readonly lexiconRows: number;
  /** True when the canonical export also had >1 row for this id. */
  readonly canonicalAmbiguous: boolean;
}

/** A curated lexicon value that disagrees with culture-scrape's — reported, never merged. */
export interface WriteBackConflict {
  readonly file: string;
  readonly nodeType: string;
  readonly linguascrapeId: string;
  readonly field: string;
  readonly column: string;
  /** The human-curated value currently in the lexicon (kept unless `overwrite`). */
  readonly curatedValue: string;
  /** The value culture-scrape's export supplied. */
  readonly incomingValue: string;
  /** The `source` the incoming value carried (for triage). */
  readonly incomingSource: string;
}

/** The write-back report (deterministic; ordered for stable diffs). */
export interface WriteBackReport {
  readonly schemaVersion: string;
  readonly overwrite: boolean;
  readonly totals: {
    readonly filesScanned: number;
    readonly filesChanged: number;
    readonly nodesMatched: number;
    readonly enrichments: number;
    readonly overwrites: number;
    readonly conflicts: number;
    /** Canonical node rows with no matching lexicon row (graph-only; not written). */
    readonly unmatchedCanonicalNodes: number;
    /** Distinct (type,id) keys skipped because the join key was not unique. */
    readonly skippedAmbiguousIds: number;
  };
  readonly changes: readonly WriteBackChange[];
  readonly conflicts: readonly WriteBackConflict[];
  readonly ambiguousIds: readonly WriteBackAmbiguousId[];
}

/** A parsed lexicon file with enough state to rewrite it byte-faithfully. */
interface LexiconFile {
  readonly file: string;
  /** Mutable: the additions path may extend the header with provenance columns. */
  headerLine: string;
  headers: string[];
  /** Data cells, kept raw (untrimmed) so an unchanged file re-serialises identically. */
  readonly rows: string[][];
  readonly eol: string;
  readonly trailingNewline: boolean;
  changed: boolean;
}

/** In-memory result of a build: per-file (possibly edited) content + the report. */
export interface BuiltWriteBack {
  /** base filename → parsed file (with `changed` flag + edited cells). */
  readonly files: Map<string, LexiconFile>;
  readonly report: WriteBackReport;
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/** Strip tab/newline so a written value cannot corrupt the TSV grid. */
function sanitize(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Parse a lexicon TSV, preserving the exact line ending + trailing-newline shape so an
 * unedited file re-serialises byte-for-byte. Returns `null` for a missing/empty file.
 */
function readLexiconFile(filePath: string, file: string): LexiconFile | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim() === "") return null;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (trailingNewline) lines.pop(); // drop the empty element the final newline produced
  const headerLine = lines[0];
  const headers = headerLine.split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { file, headerLine, headers, rows, eol, trailingNewline, changed: false };
}

/** Re-serialise a parsed lexicon file; byte-identical to the original when unchanged. */
export function serializeLexiconFile(f: LexiconFile): string {
  const body = f.rows.map((r) => r.join("\t"));
  return [f.headerLine, ...body].join(f.eol) + (f.trailingNewline ? f.eol : "");
}

/** Parse a canonical node TSV into `{ headers, rows }`; missing files yield empties. */
function readCanonicalTsv(filePath: string): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/** Canonical node field name → its column index in `CANONICAL_SCHEMA.node.columns`. */
function canonicalNodeFieldIndex(): Map<string, number> {
  return new Map(CANONICAL_SCHEMA.node.columns.map((c, i) => [c.field, i]));
}

/** Canonical node rows indexed by `linguascrape_id`, plus the ids that were non-unique. */
interface CanonicalNodeIndex {
  /** linguascrape_id → the first canonical row carrying it. */
  readonly byId: Map<string, string[]>;
  /** ids that appeared on more than one canonical row (ambiguous — do not write). */
  readonly ambiguousIds: Set<string>;
}

/**
 * Index every canonical node type's rows by `linguascrape_id`. Reads
 * `<canonicalDir>/nodes/<type>.tsv` for each node type that has a lexicon node file.
 * A `linguascrape_id` seen on more than one canonical row is recorded as ambiguous so the
 * caller can skip it rather than write from an arbitrary "first" row.
 */
function loadCanonicalNodes(
  canonicalDir: string,
): Map<string, CanonicalNodeIndex> {
  const fieldIdx = canonicalNodeFieldIndex();
  const idIdx = fieldIdx.get("linguascrape_id") ?? -1;
  const byType = new Map<string, CanonicalNodeIndex>();
  const types = new Set(nodeFiles().map((f) => f.node));
  for (const type of types) {
    const { headers, rows } = readCanonicalTsv(
      path.join(canonicalDir, "nodes", `${type}.tsv`),
    );
    if (headers.length === 0) continue;
    const byId = new Map<string, string[]>();
    const ambiguousIds = new Set<string>();
    for (const row of rows) {
      const lsId = cell(row, idIdx);
      if (lsId === "") continue;
      if (byId.has(lsId)) {
        ambiguousIds.add(lsId); // seen before → non-unique join key
        continue; // keep the first, but it will be skipped as ambiguous
      }
      byId.set(lsId, row);
    }
    byType.set(type, { byId, ambiguousIds });
  }
  return byType;
}

/** Reverse of the US-002 `target` map for one file: writeable canonical field → column. */
function reverseColumnMap(file: string, headers: string[]): Map<string, { column: string; idx: number }> {
  const map = new Map<string, { column: string; idx: number }>();
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return map;
  for (const c of mapping.columns) {
    if (c.target === undefined || NON_WRITEBACK_FIELDS.has(c.target)) continue;
    if (map.has(c.target)) continue; // first lexicon column wins for a field
    const idx = headers.indexOf(c.column);
    if (idx >= 0) map.set(c.target, { column: c.column, idx });
  }
  return map;
}

/**
 * Build the write-back from a canonical export directory and a lexicons directory.
 * Pure (returns edited in-memory files + a report); {@link writeWriteBack} does the
 * filesystem side. By default gaps are filled and conflicts are only reported; pass
 * `{ overwrite: true }` to apply incoming values over curated ones as well.
 */
export function buildWriteBack(
  canonicalDir: string = EXPORT_DIR,
  lexiconsDir: string = LEXICONS_DIR,
  opts: { overwrite?: boolean } = {},
): BuiltWriteBack {
  const overwrite = opts.overwrite ?? false;
  const canonicalByType = loadCanonicalNodes(canonicalDir);
  const fieldIdx = canonicalNodeFieldIndex();
  const sourceFieldIdx = fieldIdx.get("source") ?? -1;

  const files = new Map<string, LexiconFile>();
  const changes: WriteBackChange[] = [];
  const conflicts: WriteBackConflict[] = [];
  const ambiguous: WriteBackAmbiguousId[] = [];
  const ambiguousSeen = new Set<string>();
  const matchedCanonical = new Set<string>();
  const matchKey = (type: string, lsId: string) => `${type}\x1f${lsId}`;

  let filesScanned = 0;
  let nodesMatched = 0;
  let enrichments = 0;
  let overwriteCount = 0;

  // Pass 1 — parse every node file and count each `linguascrape_id` across the whole node
  // *type* (not just within one file). The same id can appear in more than one lexicon file
  // that maps to the same type (e.g. `mohenjo-daro` is in both `archaeological-sites.tsv`
  // and `settlements.tsv` → both `place`), which the export dedups to one canonical row.
  // Such a key cannot address a single lexicon row, so it must be skipped, not written.
  interface ParsedNodeFile {
    readonly file: string;
    readonly node: string;
    readonly parsed: LexiconFile;
    readonly idIdx: number;
    readonly reverse: Map<string, { column: string; idx: number }>;
  }
  const parsedFiles: ParsedNodeFile[] = [];
  const idCountByType = new Map<string, Map<string, number>>();

  for (const { file, node } of nodeFiles()) {
    const parsed = readLexiconFile(path.join(lexiconsDir, file), file);
    if (parsed === null) continue;
    filesScanned += 1;
    files.set(file, parsed);

    const reverse = reverseColumnMap(file, parsed.headers);
    if (reverse.size === 0) continue;

    const mapping = lexiconMappingByFile(file);
    const idColumn = mapping?.columns.find((c) => c.target === "linguascrape_id");
    const idIdx = idColumn ? parsed.headers.indexOf(idColumn.column) : -1;
    if (idIdx < 0) continue;
    if (!canonicalByType.has(node)) continue;

    const counts = idCountByType.get(node) ?? new Map<string, number>();
    for (const row of parsed.rows) {
      const lsId = cell(row, idIdx);
      if (lsId !== "") counts.set(lsId, (counts.get(lsId) ?? 0) + 1);
    }
    idCountByType.set(node, counts);
    parsedFiles.push({ file, node, parsed, idIdx, reverse });
  }

  // Pass 2 — write back where the join key is unambiguous; report the rest.
  for (const { file, node, parsed, idIdx, reverse } of parsedFiles) {
    const { byId: canonicalRows, ambiguousIds: canonicalAmbiguousIds } =
      canonicalByType.get(node)!;
    const typeCounts = idCountByType.get(node)!;

    for (const row of parsed.rows) {
      const lsId = cell(row, idIdx);
      if (lsId === "") continue;
      const canonRow = canonicalRows.get(lsId);
      if (canonRow === undefined) continue; // lexicon row absent from the graph return

      // Non-unique join key (across the type's lexicon rows and/or canonical rows): the id
      // cannot identify a single row → skip write-back, report the ambiguity.
      const lexiconRows = typeCounts.get(lsId) ?? 1;
      const canonicalAmbiguous = canonicalAmbiguousIds.has(lsId);
      if (lexiconRows > 1 || canonicalAmbiguous) {
        const key = matchKey(node, lsId);
        if (!ambiguousSeen.has(key)) {
          ambiguousSeen.add(key);
          ambiguous.push({ file, nodeType: node, linguascrapeId: lsId, lexiconRows, canonicalAmbiguous });
        }
        continue;
      }

      if (!matchedCanonical.has(matchKey(node, lsId))) {
        matchedCanonical.add(matchKey(node, lsId));
        nodesMatched += 1;
      }
      const incomingSource = cell(canonRow, sourceFieldIdx);

      for (const [field, { column, idx: lexIdx }] of reverse) {
        const canonIdx = fieldIdx.get(field) ?? -1;
        const incoming = cell(canonRow, canonIdx);
        if (incoming === "") continue; // graph supplies nothing → nothing to write
        const current = cell(row, lexIdx);
        if (current === incoming) continue; // already agrees (round-trip no-op)

        if (current === "") {
          // Gap fill — enrichment.
          setCell(row, lexIdx, sanitize(incoming));
          parsed.changed = true;
          enrichments += 1;
          changes.push({
            file, nodeType: node, linguascrapeId: lsId, field, column,
            oldValue: "", newValue: sanitize(incoming), kind: "enrichment",
          });
        } else {
          // Curated value disagrees — a conflict. Reported, never silently resolved.
          conflicts.push({
            file, nodeType: node, linguascrapeId: lsId, field, column,
            curatedValue: current, incomingValue: incoming, incomingSource,
          });
          if (overwrite) {
            setCell(row, lexIdx, sanitize(incoming));
            parsed.changed = true;
            overwriteCount += 1;
            changes.push({
              file, nodeType: node, linguascrapeId: lsId, field, column,
              oldValue: current, newValue: sanitize(incoming), kind: "overwrite",
            });
          }
        }
      }
    }
  }

  // Canonical node rows that matched no lexicon row (graph-only entities, no home to
  // write into — creating new lexicon rows is out of scope; surfaced for review).
  let unmatchedCanonicalNodes = 0;
  for (const [type, index] of canonicalByType) {
    for (const lsId of index.byId.keys()) {
      if (
        !matchedCanonical.has(matchKey(type, lsId)) &&
        !ambiguousSeen.has(matchKey(type, lsId))
      ) {
        unmatchedCanonicalNodes += 1;
      }
    }
  }

  const filesChanged = [...files.values()].filter((f) => f.changed).length;

  // Deterministic ordering so the report diffs cleanly.
  changes.sort(compareChange);
  conflicts.sort(compareConflict);
  ambiguous.sort(compareAmbiguous);

  const report: WriteBackReport = {
    schemaVersion: CANONICAL_SCHEMA.version,
    overwrite,
    totals: {
      filesScanned,
      filesChanged,
      nodesMatched,
      enrichments,
      overwrites: overwriteCount,
      conflicts: conflicts.length,
      unmatchedCanonicalNodes,
      skippedAmbiguousIds: ambiguous.length,
    },
    changes,
    conflicts,
    ambiguousIds: ambiguous,
  };

  return { files, report };
}

/** Set a cell, padding the row with empty cells when the target index is past its end. */
function setCell(row: string[], idx: number, value: string): void {
  while (row.length <= idx) row.push("");
  row[idx] = value;
}

function compareChange(a: WriteBackChange, b: WriteBackChange): number {
  return (
    cmp(a.file, b.file) ||
    cmp(a.linguascrapeId, b.linguascrapeId) ||
    cmp(a.field, b.field)
  );
}

function compareConflict(a: WriteBackConflict, b: WriteBackConflict): number {
  return (
    cmp(a.file, b.file) ||
    cmp(a.linguascrapeId, b.linguascrapeId) ||
    cmp(a.field, b.field)
  );
}

function compareAmbiguous(a: WriteBackAmbiguousId, b: WriteBackAmbiguousId): number {
  return cmp(a.file, b.file) || cmp(a.linguascrapeId, b.linguascrapeId);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Serialise a report to JSON (trailing newline). */
export function reportJson(report: WriteBackReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Write the write-back result: the edited lexicon files (only those that changed) back
 * into `lexiconsDir`, and the report JSON under `<outDir>/report.json`. Nothing is
 * written to a lexicon file that did not change (a pure round-trip touches no lexicon).
 */
export function writeWriteBack(
  built: BuiltWriteBack,
  opts: { lexiconsDir?: string; outDir?: string } = {},
): void {
  const lexiconsDir = opts.lexiconsDir ?? LEXICONS_DIR;
  const outDir = opts.outDir ?? WRITEBACK_DIR;
  for (const f of built.files.values()) {
    if (!f.changed) continue;
    fs.writeFileSync(path.join(lexiconsDir, f.file), serializeLexiconFile(f));
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), reportJson(built.report));
}

/** Build + write the write-back and report. */
export function runWriteBack(
  opts: {
    canonicalDir?: string;
    lexiconsDir?: string;
    outDir?: string;
    overwrite?: boolean;
  } = {},
): BuiltWriteBack {
  const built = buildWriteBack(
    opts.canonicalDir ?? EXPORT_DIR,
    opts.lexiconsDir ?? LEXICONS_DIR,
    { overwrite: opts.overwrite },
  );
  writeWriteBack(built, { lexiconsDir: opts.lexiconsDir, outDir: opts.outDir });
  return built;
}

// ---------------------------------------------------------------------------
// New-culture additions (US-003)
//
// The write-back above ENRICHES existing lexicon rows from the graph return. The
// data-population pilot also needs the absent-row case: entities that were acquired and
// reconciled as **new** (no lexicon row yet) must be APPENDED as fresh, curated rows —
// without touching a single existing (human-curated) cell.
//
// This is deliberately append-only and conservative:
//   * Existing rows are never rewritten (appends only), so a curated cell can never be
//     clobbered — a disagreement with an incoming value is impossible by construction.
//   * A candidate is skipped (never appended) when it duplicates an existing row by
//     `wikidata_qid`, by normalised name, or when its id collides with a different
//     existing row (reported as a conflict) — so re-running the import is idempotent.
//   * Every appended row carries provenance columns (`wikidata_qid`, `source_url`,
//     `retrieved_at`, `confidence`) + a bibliographic `sources` cell (Guiding Principle
//     #8). The target header is extended with any missing provenance column first, and
//     every existing row padded with a blank cell so the grid stays rectangular.
// ---------------------------------------------------------------------------

/** Default curated candidate file the CLI reads (committed; derived from the acquired corpus). */
export const DEFAULT_ADDITIONS_FILE = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "civilizations-additions.tsv",
);

/** Default target lexicon the additions land in. */
export const ADDITIONS_TARGET_FILE = "civilizations.tsv";

/** Provenance columns every appended culture row must carry (added to the header if absent). */
export const ADDITION_PROVENANCE_COLUMNS = [
  "wikidata_qid",
  "source_url",
  "retrieved_at",
  "confidence",
] as const;

/** Core columns every addition carries; any other column in the file is domain-specific `extra`. */
const ADDITION_CORE_COLUMNS = [
  "id",
  "name",
  "wikidata_qid",
  "source_url",
  "retrieved_at",
  "confidence",
  "sources",
] as const;

/** One curated, reconciliation-"new" row to append to the lexicon. */
export interface CultureAddition {
  readonly id: string;
  readonly name: string;
  readonly wikidata_qid: string;
  readonly source_url: string;
  readonly retrieved_at: string;
  readonly confidence: string;
  /** Bibliographic sources cell (a JSON-array string, e.g. `["Wikidata"]`). */
  readonly sources: string;
  /**
   * Domain-specific columns (e.g. `coordinates`, `site_type`, `description`), keyed by column
   * name. Each is written only if the target lexicon actually has that column, so one code path
   * serves every domain — see {@link buildCultureAdditions}.
   */
  readonly extra?: Readonly<Record<string, string>>;
}

/** A candidate that was not appended, with why. */
export interface AdditionSkip {
  readonly name: string;
  readonly wikidata_qid: string;
  readonly reason: "duplicate-qid" | "duplicate-name" | "invalid";
}

/** A candidate whose id collided with a *different* existing row (never appended). */
export interface AdditionConflict {
  readonly id: string;
  readonly name: string;
  readonly existingName: string;
}

/** The additions report (deterministic; ordered for stable diffs). */
export interface AdditionsReport {
  readonly file: string;
  readonly totals: {
    readonly candidates: number;
    readonly added: number;
    /** Always 0 — additions are append-only, so no existing (curated) row is updated. */
    readonly updated: number;
    readonly skipped: number;
    readonly conflicts: number;
    readonly rowsBefore: number;
    readonly rowsAfter: number;
  };
  readonly added: readonly { id: string; name: string; wikidata_qid: string }[];
  readonly skipped: readonly AdditionSkip[];
  readonly conflicts: readonly AdditionConflict[];
}

/** Normalise a name for duplicate detection (lowercase, strip diacritics + punctuation). */
function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Extend a file's header with any missing columns, padding every row to stay rectangular. */
function ensureColumns(f: LexiconFile, columns: readonly string[]): void {
  let extended = false;
  for (const c of columns) {
    if (f.headers.includes(c)) continue;
    f.headers.push(c);
    extended = true;
  }
  if (!extended) return;
  for (const row of f.rows) {
    while (row.length < f.headers.length) row.push("");
  }
  f.headerLine = f.headers.join("\t");
  f.changed = true;
}

/**
 * Append curated `candidates` to a parsed lexicon file as new rows. Pure (mutates + returns
 * the in-memory file + a report); {@link runCultureAdditions} does the filesystem side.
 */
export function buildCultureAdditions(
  target: LexiconFile,
  candidates: readonly CultureAddition[],
): { file: LexiconFile; report: AdditionsReport } {
  ensureColumns(target, ADDITION_PROVENANCE_COLUMNS);

  const idIdx = target.headers.indexOf("id");
  const nameIdx = target.headers.indexOf("name");
  const qidIdx = target.headers.indexOf("wikidata_qid");

  // Index existing rows for duplicate / id-collision detection.
  const existingIds = new Map<string, string>(); // id → its row's name
  const existingQids = new Set<string>();
  const existingNames = new Set<string>(); // normalised
  for (const row of target.rows) {
    const id = cell(row, idIdx);
    if (id !== "") existingIds.set(id, cell(row, nameIdx));
    const q = cell(row, qidIdx);
    if (q !== "") existingQids.add(q);
    const nm = cell(row, nameIdx);
    if (nm !== "") existingNames.add(normaliseName(nm));
  }

  const rowsBefore = target.rows.length;
  const added: { id: string; name: string; wikidata_qid: string }[] = [];
  const skipped: AdditionSkip[] = [];
  const conflicts: AdditionConflict[] = [];

  const setByName = (row: string[], column: string, value: string): void => {
    const i = target.headers.indexOf(column);
    if (i >= 0) row[i] = sanitize(value);
  };

  for (const c of candidates) {
    const id = c.id.trim();
    const name = c.name.trim();
    const qid = c.wikidata_qid.trim();
    if (id === "" || name === "") {
      skipped.push({ name, wikidata_qid: qid, reason: "invalid" });
      continue;
    }
    if (qid !== "" && existingQids.has(qid)) {
      skipped.push({ name, wikidata_qid: qid, reason: "duplicate-qid" });
      continue;
    }
    const nn = normaliseName(name);
    if (existingNames.has(nn)) {
      skipped.push({ name, wikidata_qid: qid, reason: "duplicate-name" });
      continue;
    }
    if (existingIds.has(id)) {
      // The slug collides with a *different* curated row — never overwrite it.
      conflicts.push({ id, name, existingName: existingIds.get(id) ?? "" });
      continue;
    }

    const row = new Array<string>(target.headers.length).fill("");
    setByName(row, "id", id);
    setByName(row, "name", name);
    setByName(row, "sources", c.sources);
    setByName(row, "wikidata_qid", qid);
    setByName(row, "source_url", c.source_url);
    setByName(row, "retrieved_at", c.retrieved_at);
    setByName(row, "confidence", c.confidence);
    // Domain-specific columns (only those the target lexicon actually has).
    for (const [col, value] of Object.entries(c.extra ?? {})) {
      setByName(row, col, value);
    }
    target.rows.push(row);
    target.changed = true;

    existingIds.set(id, name);
    if (qid !== "") existingQids.add(qid);
    existingNames.add(nn);
    added.push({ id, name, wikidata_qid: qid });
  }

  const report: AdditionsReport = {
    file: target.file,
    totals: {
      candidates: candidates.length,
      added: added.length,
      updated: 0,
      skipped: skipped.length,
      conflicts: conflicts.length,
      rowsBefore,
      rowsAfter: target.rows.length,
    },
    added,
    skipped,
    conflicts,
  };
  return { file: target, report };
}

/** Parse a curated additions TSV (header-addressed) into {@link CultureAddition}s. */
export function loadCultureAdditions(additionsFile: string): CultureAddition[] {
  const content = fs.readFileSync(additionsFile, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  const at = (row: string[], name: string): string => {
    const i = headers.indexOf(name);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };
  const coreSet = new Set<string>(ADDITION_CORE_COLUMNS);
  const extraColumns = headers.filter((h) => h !== "" && !coreSet.has(h));
  return lines.slice(1).map((line) => {
    const row = line.split("\t");
    const extra: Record<string, string> = {};
    for (const col of extraColumns) extra[col] = at(row, col);
    return {
      id: at(row, "id"),
      name: at(row, "name"),
      wikidata_qid: at(row, "wikidata_qid"),
      source_url: at(row, "source_url"),
      retrieved_at: at(row, "retrieved_at"),
      confidence: at(row, "confidence") || "1.0",
      sources: at(row, "sources") || '["Wikidata"]',
      extra,
    };
  });
}

/** Serialise an additions report to JSON (trailing newline). */
export function additionsReportJson(report: AdditionsReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/** Build + write culture additions into the target lexicon; report to the gitignored tree. */
export function runCultureAdditions(
  opts: {
    additionsFile?: string;
    targetFile?: string;
    lexiconsDir?: string;
    outDir?: string;
  } = {},
): { file: LexiconFile; report: AdditionsReport } {
  const additionsFile = opts.additionsFile ?? DEFAULT_ADDITIONS_FILE;
  const targetFile = opts.targetFile ?? ADDITIONS_TARGET_FILE;
  const lexiconsDir = opts.lexiconsDir ?? LEXICONS_DIR;
  const outDir = opts.outDir ?? WRITEBACK_DIR;

  const parsed = readLexiconFile(path.join(lexiconsDir, targetFile), targetFile);
  if (parsed === null) {
    throw new Error(`Target lexicon not found or empty: ${targetFile}`);
  }
  const candidates = loadCultureAdditions(additionsFile);
  const built = buildCultureAdditions(parsed, candidates);

  if (built.file.changed) {
    fs.writeFileSync(path.join(lexiconsDir, targetFile), serializeLexiconFile(built.file));
  }
  fs.mkdirSync(outDir, { recursive: true });
  // Report name mirrors the target lexicon (civilizations.tsv → civilizations-additions-report.json).
  const reportName = `${targetFile.replace(/\.tsv$/, "")}-additions-report.json`;
  fs.writeFileSync(path.join(outDir, reportName), additionsReportJson(built.report));
  return built;
}

// CLI entry — mirrors export-for-culturescrape.ts's main-module guard.
// Default: enrichment write-back (`--overwrite` applies incoming over curated).
// `--add-cultures [file]`: append curated new cultures into civilizations.tsv (US-003).
// `--add-rows <file> --target <lexicon.tsv>`: generic append into any node lexicon (US-002+).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const argv = process.argv.slice(2);
  const addFlag = argv.indexOf("--add-cultures");
  const addRowsFlag = argv.indexOf("--add-rows");
  const flagValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
  };
  if (addRowsFlag >= 0) {
    const additionsFile = flagValue("--add-rows");
    const targetFile = flagValue("--target");
    if (additionsFile === undefined || targetFile === undefined) {
      // eslint-disable-next-line no-console
      console.error("usage: import-from-culturescrape --add-rows <file> --target <lexicon.tsv>");
      process.exit(1);
    }
    const { report } = runCultureAdditions({ additionsFile, targetFile });
    const { totals } = report;
    // eslint-disable-next-line no-console
    console.log(
      `Row additions (${report.file}): ${totals.candidates} candidates → ` +
        `${totals.added} added, ${totals.skipped} skipped, ${totals.conflicts} conflicts, ` +
        `${totals.updated} updated; rows ${totals.rowsBefore} → ${totals.rowsAfter}.`,
    );
  } else if (addFlag >= 0) {
    const next = argv[addFlag + 1];
    const additionsFile = next && !next.startsWith("--") ? next : DEFAULT_ADDITIONS_FILE;
    const { report } = runCultureAdditions({ additionsFile });
    const { totals } = report;
    // eslint-disable-next-line no-console
    console.log(
      `Culture additions (${report.file}): ${totals.candidates} candidates → ` +
        `${totals.added} added, ${totals.skipped} skipped, ${totals.conflicts} conflicts, ` +
        `${totals.updated} updated; rows ${totals.rowsBefore} → ${totals.rowsAfter}.`,
    );
  } else {
    const overwrite = argv.includes("--overwrite");
    const { report } = runWriteBack({ overwrite });
    const { totals } = report;
    // eslint-disable-next-line no-console
    console.log(
      `Write-back: ${totals.nodesMatched} nodes matched → ${totals.enrichments} enrichments, ` +
        `${totals.overwrites} overwrites, ${totals.conflicts} conflicts` +
        `${overwrite ? "" : " (reported, not applied)"}, ` +
        `${totals.skippedAmbiguousIds} ambiguous ids skipped; ` +
        `${totals.filesChanged} lexicon files changed. source anchor: ${EXPORT_SOURCE}.`,
    );
  }
}
