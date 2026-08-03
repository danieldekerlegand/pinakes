/**
 * Canonical edge extraction (US-003).
 *
 * pinakes stores relationships two ways: as dedicated *edge tables*
 * (`cultural-lineages.tsv`, `etymology-relations.tsv`, …) and as *embedded
 * foreign-key columns* on node tables (`languages.family_id`,
 * `archaeological-cultures.predecessor_culture_ids`, …). This module reads both
 * and emits first-class {@link CanonicalEdge} records — `(start_id, end_id,
 * type, time_start, time_end, provenance)` — so the shared graph gets real
 * relationships instead of dangling id strings.
 *
 * Which columns carry edges is *not* hard-coded here: it is driven by the
 * US-002 lexicon mapping (`@contracts/lexicon-mapping`). Edge tables declare their
 * structural columns via `target` dispositions (`:START_ID`/`:END_ID`/`:TYPE`/
 * `time_start`/`time_end`/`confidence`/`source`); node tables declare embedded
 * relationships via `edge` dispositions (a canonical edge-type name). The only
 * per-file knowledge kept locally is {@link EDGE_TYPE_VALUE_MAPS}, which aligns
 * each edge table's free-text relationship vocabulary onto the canonical edge
 * types — a translation the declarative mapping cannot express.
 *
 * Edge *direction* follows the source table's declared START/END columns
 * (US-002); the canonical `:TYPE` is a best-effort vocabulary alignment. Rows
 * whose relationship token has no canonical home are skipped (not mis-typed) and
 * surfaced in {@link FileExtraction.skipped} for review.
 */
import fs from "node:fs";
import path from "node:path";
import {
  edgeTypeByName,
  type CanonicalEdgeType,
} from "@contracts/canonical-schema";
import {
  LEXICON_MAPPING,
  lexiconMappingByFile,
  type LexiconFileMapping,
} from "@contracts/lexicon-mapping";
import { confidenceForClass } from "@contracts/confidence-rubric";

const LEXICONS_DIR = path.resolve("data", "source", "lexicons");

/**
 * Confidence assigned to an edge whose source row carries no confidence value.
 * The `legacy-curated` rubric prior ("unknown, neither trusted nor distrusted";
 * grandfathered at mid-scale), sourced from the confidence rubric so the number is
 * tuned in one place (US-001). Rows that do carry confidence keep it (normalised —
 * see {@link normaliseConfidence}).
 */
export const DEFAULT_EDGE_CONFIDENCE = confidenceForClass("legacy-curated");

/**
 * Provenance fields pinakes TSVs do not carry per-row. They are required on
 * the canonical edge family, so we emit empty strings here; US-006 (provenance
 * propagation) is responsible for filling `source_url`/`retrieved_at` from each
 * lexicon's dataset-level provenance.
 */
const UNKNOWN_SOURCE_URL = "";
const UNKNOWN_RETRIEVED_AT = "";

/**
 * Per-edge-table translation from the file's free-text relationship vocabulary
 * to a canonical edge-type *name*. `null` means "recognised but has no canonical
 * home" (intentionally skipped); a token absent from the map is treated as
 * unknown (also skipped, and reported as `unmapped-type`).
 */
export const EDGE_TYPE_VALUE_MAPS: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = {
  "cultural-lineages.tsv": {
    "split-from": "split-from",
    "evolved-into": "descended-from",
    "gave-rise-to": "descended-from",
    influenced: "influenced-by",
    // Temporal precedence / vague association have no canonical edge type.
    "preceded-by": null,
    "associated-with": null,
    "possibly-associated": null,
  },
  "etymology-relations.tsv": {
    borrowed_from: "borrowed-from",
    calque: "borrowed-from", // a loan translation — a form of borrowing
    cognate: "cognate-with",
    derived_from: "derived-from",
    etymology: null, // generic marker, no specific relation
  },
  "language-contacts.tsv": {
    // All contact strata are directional influence between the two languages.
    substrate: "influenced-by",
    superstrate: "influenced-by",
    adstrate: "influenced-by",
  },
  "art-style-evolutions.tsv": {
    direct_evolution: "derived-from",
    influence: "influenced-by",
    revival: "derived-from",
  },
};

/** Provenance attached to every emitted edge (mirrors the canonical edge provenance columns). */
export interface EdgeProvenance {
  /** Human-readable citation(s), or the originating lexicon file when the row has none. */
  readonly source: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  /** Normalised to `[0, 1]`; {@link DEFAULT_EDGE_CONFIDENCE} when the row is silent. */
  readonly confidence: number;
}

/** A single canonical relationship extracted from a lexicon. */
export interface CanonicalEdge {
  /** `:START_ID` — the pinakes id of the origin node. */
  readonly startId: string;
  /** `:END_ID` — the pinakes id of the destination node. */
  readonly endId: string;
  /** `:TYPE` — the canonical Neo4j edge-type token (e.g. `DESCENDS_FROM`). */
  readonly type: string;
  /** The canonical edge-type kebab name (e.g. `descended-from`). */
  readonly edgeName: string;
  /** Inclusive lower bound of the edge's active period, or `null` if unknown. */
  readonly timeStart: number | null;
  /** Inclusive upper bound of the edge's active period, or `null` if unknown. */
  readonly timeEnd: number | null;
  readonly provenance: EdgeProvenance;
  /** The edge row's own pinakes id (edge tables only), else `null`. */
  readonly pinakesId: string | null;
  /** Base name of the lexicon the edge came from. */
  readonly sourceFile: string;
}

/** A source row that produced no edge, with a machine-readable reason. */
export interface SkippedEdge {
  readonly sourceFile: string;
  readonly reason:
    | "missing-endpoint"
    | "self-reference"
    | "unmapped-type"
    | "skipped-type"
    | "unknown-edge-type";
  /** The offending relationship token / endpoint, when relevant. */
  readonly value?: string;
}

/** Result of extracting one file (or the whole corpus). */
export interface FileExtraction {
  readonly edges: CanonicalEdge[];
  readonly skipped: SkippedEdge[];
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Placeholder tokens some lexicons write to mean "no id" (e.g. `writing-systems.tsv`
 * stores a literal `"null"` in `parent_system_id` for a root script). Treated as a
 * blank endpoint — never a real node id — so no dangling edge to a phantom `null`
 * node is emitted.
 */
const BLANK_ID_SENTINELS: ReadonlySet<string> = new Set([
  "null",
  "none",
  "n/a",
  "undefined",
]);

/** True when an id cell is empty or a placeholder standing in for "no value". */
function isBlankId(value: string): boolean {
  return value === "" || BLANK_ID_SENTINELS.has(value.toLowerCase());
}

/** Column index of the file's single column carrying a given canonical `target`. */
function indexForTarget(
  mapping: LexiconFileMapping,
  headers: string[],
  target: string,
): number {
  const col = mapping.columns.find((c) => c.target === target);
  return col ? headers.indexOf(col.column) : -1;
}

/** Parse an integer year cell, returning `null` for empty / non-numeric values. */
function parseYear(value: string): number | null {
  if (value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Normalise a raw confidence cell to `[0, 1]`. pinakes mixes 0–100
 * (`cultural-lineages`, `archaeological-cultures`) and 0–1 scales, so values
 * above 1 are treated as percentages. Empty / non-numeric ⇒ default.
 */
function normaliseConfidence(value: string): number {
  if (value === "") return DEFAULT_EDGE_CONFIDENCE;
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return DEFAULT_EDGE_CONFIDENCE;
  const scaled = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

/**
 * Parse a source cell into a single citation string. Many lexicons store
 * `sources` as a JSON array (`["Anthony 2007","Ringe 2006"]`); those are joined
 * with `"; "`. A plain string is returned as-is.
 */
function parseSourceCell(value: string, fallback: string): string {
  if (value === "") return fallback;
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const joined = parsed
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .join("; ");
        return joined === "" ? fallback : joined;
      }
    } catch {
      // fall through to raw value
    }
  }
  return value;
}

/**
 * Split an id-list cell into individual ids. Embedded FK columns are either a
 * scalar id (`family_id`) or a JSON array of ids
 * (`predecessor_culture_ids`, `syncretism_links`). Falls back to `[,;]`
 * splitting for defensive robustness.
 */
function splitIdList(value: string): string[] {
  if (value === "") return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter((s) => !isBlankId(s));
      }
    } catch {
      // fall through
    }
  }
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => !isBlankId(s));
}

/** Build a {@link CanonicalEdge}, resolving the canonical `:TYPE` token. */
function buildEdge(args: {
  file: string;
  startId: string;
  endId: string;
  edgeType: CanonicalEdgeType;
  timeStart: number | null;
  timeEnd: number | null;
  provenance: EdgeProvenance;
  pinakesId: string | null;
}): CanonicalEdge {
  return {
    startId: args.startId,
    endId: args.endId,
    type: args.edgeType.type,
    edgeName: args.edgeType.name,
    timeStart: args.timeStart,
    timeEnd: args.timeEnd,
    provenance: args.provenance,
    pinakesId: args.pinakesId,
    sourceFile: args.file,
  };
}

/** Extract edges from a dedicated edge table (`kind === "edge"`). */
function extractEdgeTable(
  file: string,
  mapping: LexiconFileMapping,
  headers: string[],
  rows: string[][],
): FileExtraction {
  const edges: CanonicalEdge[] = [];
  const skipped: SkippedEdge[] = [];

  const startIdx = indexForTarget(mapping, headers, ":START_ID");
  const endIdx = indexForTarget(mapping, headers, ":END_ID");
  const typeIdx = indexForTarget(mapping, headers, ":TYPE");
  const timeStartIdx = indexForTarget(mapping, headers, "time_start");
  const timeEndIdx = indexForTarget(mapping, headers, "time_end");
  const confIdx = indexForTarget(mapping, headers, "confidence");
  const sourceIdx = indexForTarget(mapping, headers, "source");
  const aliasIdx = indexForTarget(mapping, headers, "pinakes_id");
  const valueMap = EDGE_TYPE_VALUE_MAPS[file] ?? {};

  for (const row of rows) {
    const startId = cell(row, startIdx);
    const endId = cell(row, endIdx);
    if (isBlankId(startId) || isBlankId(endId)) {
      skipped.push({ sourceFile: file, reason: "missing-endpoint" });
      continue;
    }
    if (startId === endId) {
      skipped.push({ sourceFile: file, reason: "self-reference", value: startId });
      continue;
    }

    const rawType = cell(row, typeIdx);
    const edgeName = Object.prototype.hasOwnProperty.call(valueMap, rawType)
      ? valueMap[rawType]
      : undefined;
    if (edgeName === undefined) {
      skipped.push({ sourceFile: file, reason: "unmapped-type", value: rawType });
      continue;
    }
    if (edgeName === null) {
      skipped.push({ sourceFile: file, reason: "skipped-type", value: rawType });
      continue;
    }
    const edgeType = edgeTypeByName(edgeName);
    if (edgeType === undefined) {
      skipped.push({ sourceFile: file, reason: "unknown-edge-type", value: edgeName });
      continue;
    }

    edges.push(
      buildEdge({
        file,
        startId,
        endId,
        edgeType,
        timeStart: parseYear(cell(row, timeStartIdx)),
        timeEnd: parseYear(cell(row, timeEndIdx)),
        provenance: {
          source: parseSourceCell(cell(row, sourceIdx), file),
          sourceUrl: UNKNOWN_SOURCE_URL,
          retrievedAt: UNKNOWN_RETRIEVED_AT,
          confidence: normaliseConfidence(cell(row, confIdx)),
        },
        pinakesId: aliasIdx >= 0 ? cell(row, aliasIdx) || null : null,
      }),
    );
  }

  return { edges, skipped };
}

/** Extract edges from a node table's embedded FK columns (`edge` dispositions). */
function extractEmbeddedEdges(
  file: string,
  mapping: LexiconFileMapping,
  headers: string[],
  rows: string[][],
): FileExtraction {
  const edges: CanonicalEdge[] = [];
  const skipped: SkippedEdge[] = [];

  const idIdx = indexForTarget(mapping, headers, "pinakes_id");
  const sourceIdx = indexForTarget(mapping, headers, "source");
  const confIdx = indexForTarget(mapping, headers, "confidence");

  const edgeColumns = mapping.columns
    .filter((c) => c.edge !== undefined)
    .map((c) => ({
      idx: headers.indexOf(c.column),
      edgeType: edgeTypeByName(c.edge as string),
      edgeName: c.edge as string,
    }));
  if (edgeColumns.length === 0) return { edges, skipped };

  for (const row of rows) {
    const startId = cell(row, idIdx);
    if (startId === "") continue;
    const provenance: EdgeProvenance = {
      source: parseSourceCell(cell(row, sourceIdx), file),
      sourceUrl: UNKNOWN_SOURCE_URL,
      retrievedAt: UNKNOWN_RETRIEVED_AT,
      confidence: normaliseConfidence(cell(row, confIdx)),
    };

    for (const col of edgeColumns) {
      if (col.edgeType === undefined) {
        skipped.push({
          sourceFile: file,
          reason: "unknown-edge-type",
          value: col.edgeName,
        });
        continue;
      }
      for (const endId of splitIdList(cell(row, col.idx))) {
        if (endId === startId) {
          skipped.push({ sourceFile: file, reason: "self-reference", value: startId });
          continue;
        }
        edges.push(
          buildEdge({
            file,
            startId,
            endId,
            edgeType: col.edgeType,
            timeStart: null,
            timeEnd: null,
            provenance,
            pinakesId: null,
          }),
        );
      }
    }
  }

  return { edges, skipped };
}

/**
 * Extract canonical edges from a single lexicon's parsed rows. Dispatches to the
 * edge-table or embedded-FK path based on the file's US-002 mapping. Files with
 * no edge information yield an empty extraction. Pure (no filesystem) so tests
 * can drive it with inline fixtures.
 */
export function extractEdgesFromLexicon(
  file: string,
  headers: string[],
  rows: string[][],
): FileExtraction {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return { edges: [], skipped: [] };
  if (mapping.kind === "edge") {
    return extractEdgeTable(file, mapping, headers, rows);
  }
  return extractEmbeddedEdges(file, mapping, headers, rows);
}

/** Base names of every lexicon that carries edges (edge tables + embedded FKs). */
export function edgeBearingFiles(): string[] {
  return LEXICON_MAPPING.files
    .filter(
      (f) => f.kind === "edge" || f.columns.some((c) => c.edge !== undefined),
    )
    .map((f) => f.file);
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
 * Read every edge-bearing lexicon from disk and extract all canonical edges.
 * Results are concatenated across files (order follows the mapping).
 */
export function extractAllCanonicalEdges(
  lexiconsDir: string = LEXICONS_DIR,
): FileExtraction {
  const edges: CanonicalEdge[] = [];
  const skipped: SkippedEdge[] = [];
  for (const file of edgeBearingFiles()) {
    const { headers, rows } = readTsv(path.join(lexiconsDir, file));
    if (headers.length === 0) continue;
    const extraction = extractEdgesFromLexicon(file, headers, rows);
    edges.push(...extraction.edges);
    skipped.push(...extraction.skipped);
  }
  return { edges, skipped };
}
