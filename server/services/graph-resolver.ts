/**
 * Entity ID resolution at query time (US-006).
 *
 * Maps a pinakes entity reference (a canonical node type + local
 * `pinakes_id`, e.g. a `language`/`culture`/`language-family` id) to its
 * shared-graph `csid` so "show in graph" affordances (US-007) can jump from an
 * app entity to its node in the culture-scrape graph.
 *
 * Resolution leans on the convergence reconciliation (tasklist 15 / the
 * `reconciliation-report` + `export-for-culturescrape` work):
 *
 *   1. **Alias hit** — the deterministic `cs:<node-type>:<pinakes-id>` id the
 *      export mints for every node *is* the alias between a pinakes row and its
 *      graph node. A row may also carry an explicit `csid`/`alias` column populated
 *      during convergence write-back; when present it wins over the minted value.
 *      An exact `(type, id)` hit resolves with confidence `1.0`.
 *   2. **Fuzzy fallback** — with no id (or an id that has no exported node) the
 *      resolver falls back to a normalized-name similarity match within the same
 *      node type (optionally narrowed by region), returning the best candidate with
 *      its similarity as the confidence.
 *
 * **Ambiguity is never silently mis-linked.** When two *distinct* csids tie for the
 * best score (or one `(type, id)` maps to two distinct csids), the resolver logs the
 * competing candidates with their confidence and returns `null` rather than guessing.
 *
 * `createGraphResolver(entries, opts)` builds an in-memory resolver over an array of
 * alias entries so tests drive it with fixtures; `loadAliasEntries(lexiconsDir)` reads
 * the live lexicons, and `getGraphResolver()` memoises a lexicon-backed singleton.
 */
import fs from "node:fs";
import path from "node:path";
import { nodeTypeByName } from "@shared/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@shared/lexicon-mapping";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Default minimum name similarity (Dice coefficient) for a fuzzy match. */
export const DEFAULT_FUZZY_THRESHOLD = 0.6;

/** A pinakes entity reference to resolve into a shared-graph csid. */
export interface EntityRef {
  /** Canonical node type name, e.g. `"language"`, `"culture"`, `"language-family"`. */
  readonly type: string;
  /** pinakes local id (`pinakes_id`); the strong signal when present. */
  readonly id?: string;
  /** Display name, used for the fuzzy fallback when `id` is absent/unknown. */
  readonly name?: string;
  /** Optional region to disambiguate fuzzy candidates. */
  readonly region?: string;
}

/** How a csid was resolved. */
export type ResolutionMethod = "alias" | "fuzzy";

/** A resolved shared-graph id with the confidence and method behind it. */
export interface ResolvedCsid {
  readonly csid: string;
  /** 0–1; `1.0` for an exact alias hit, the similarity score for a fuzzy match. */
  readonly confidence: number;
  readonly method: ResolutionMethod;
}

/** One csid ↔ pinakes-entity alias, the unit the resolver indexes. */
export interface AliasEntry {
  readonly csid: string;
  readonly pinakesId: string;
  readonly nodeType: string;
  readonly name: string;
  readonly region?: string;
}

/** An ambiguous resolution — logged, never silently resolved. */
export interface AmbiguityEvent {
  readonly ref: EntityRef;
  readonly method: ResolutionMethod;
  readonly candidates: ReadonlyArray<{ readonly csid: string; readonly confidence: number }>;
}

/** Options for {@link createGraphResolver}. */
export interface GraphResolverOptions {
  /** Minimum Dice similarity to accept a fuzzy match (default {@link DEFAULT_FUZZY_THRESHOLD}). */
  readonly fuzzyThreshold?: number;
  /** Invoked when a match is ambiguous; defaults to a `console.warn`. */
  readonly onAmbiguous?: (event: AmbiguityEvent) => void;
}

/** The query-time resolver: entity ref → csid and back. */
export interface GraphResolver {
  /** Resolve an entity ref to a csid, or `null` when unresolved/ambiguous. */
  resolve(ref: EntityRef): ResolvedCsid | null;
  /** Reverse lookup: a known csid back to its pinakes entity ref. */
  reverse(csid: string): EntityRef | null;
  /** Number of indexed alias entries (distinct csids). */
  readonly size: number;
}

/** Mint the deterministic canonical id (mirrors `scripts/export-for-culturescrape`). */
export function mintCsid(nodeType: string, pinakesId: string): string {
  return `cs:${nodeType}:${pinakesId}`;
}

/**
 * Normalize a name/region for keying and comparison: NFKC, whitespace-collapsed,
 * casefolded — mirrors the reconciliation `normalizeKey` so app-side resolution
 * blocks the same way culture-scrape's reconciler does.
 */
export function normalizeName(value: string): string {
  return value.normalize("NFKC").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

// ── Fuzzy similarity (Sørensen–Dice over character bigrams) ────────────────

/** Character-bigram multiset of a normalized string. */
function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sørensen–Dice similarity of two already-normalized strings, in `[0, 1]`.
 * Deterministic; equal strings score `1`, single-character inputs compare by equality.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return a === "" ? 0 : 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of Array.from(left.entries())) {
    const other = right.get(gram);
    if (other !== undefined) intersection += Math.min(count, other);
  }
  const total = a.length - 1 + (b.length - 1);
  return (2 * intersection) / total;
}

// ── Resolver ───────────────────────────────────────────────────────────────

interface IndexedEntry extends AliasEntry {
  readonly normName: string;
  readonly normRegion: string;
}

const TYPE_ID_SEP = "\x1f";

function defaultOnAmbiguous(event: AmbiguityEvent): void {
  const list = event.candidates
    .map((c) => `${c.csid}@${c.confidence.toFixed(3)}`)
    .join(", ");
  // eslint-disable-next-line no-console
  console.warn(
    `[graph-resolver] ambiguous ${event.method} match for ` +
      `${event.ref.type}:${event.ref.id ?? event.ref.name ?? "?"} — not linked; candidates: ${list}`,
  );
}

/** Round a confidence to 3 dp so results are stable and comparable. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Build a resolver over the given alias entries. Entries that collide on `csid`
 * are merged (the first wins for reverse lookup); `(type, id)` pairs that map to
 * two *distinct* csids are recorded as ambiguous and never auto-resolved.
 */
export function createGraphResolver(
  entries: readonly AliasEntry[],
  opts: GraphResolverOptions = {},
): GraphResolver {
  const threshold = opts.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const onAmbiguous = opts.onAmbiguous ?? defaultOnAmbiguous;

  const byCsid = new Map<string, IndexedEntry>();
  const byTypeId = new Map<string, Set<string>>();
  const byType = new Map<string, IndexedEntry[]>();

  for (const entry of entries) {
    if (entry.csid === "") continue;
    const indexed: IndexedEntry = {
      ...entry,
      region: entry.region ?? "",
      normName: normalizeName(entry.name),
      normRegion: normalizeName(entry.region ?? ""),
    };
    if (!byCsid.has(indexed.csid)) byCsid.set(indexed.csid, indexed);

    if (indexed.pinakesId !== "") {
      const key = indexed.nodeType + TYPE_ID_SEP + indexed.pinakesId;
      const set = byTypeId.get(key) ?? new Set<string>();
      set.add(indexed.csid);
      byTypeId.set(key, set);
    }

    const list = byType.get(indexed.nodeType) ?? [];
    // A csid can recur across rows (duplicate ids collapse to one node); index once.
    if (!list.some((e) => e.csid === indexed.csid)) list.push(indexed);
    byType.set(indexed.nodeType, list);
  }

  function resolveByAlias(ref: EntityRef): ResolvedCsid | null {
    if (ref.id === undefined || ref.id === "") return null;
    const key = ref.type + TYPE_ID_SEP + ref.id;
    const csids = byTypeId.get(key);
    if (csids === undefined || csids.size === 0) {
      // No indexed row for this id: fall back to the deterministic mint if the
      // node exists in the graph index, else defer to the fuzzy pass.
      const minted = mintCsid(ref.type, ref.id);
      return byCsid.has(minted)
        ? { csid: minted, confidence: 1, method: "alias" }
        : null;
    }
    if (csids.size > 1) {
      onAmbiguous({
        ref,
        method: "alias",
        candidates: Array.from(csids).sort().map((csid) => ({ csid, confidence: 1 })),
      });
      return null;
    }
    return { csid: Array.from(csids)[0], confidence: 1, method: "alias" };
  }

  function resolveByFuzzy(ref: EntityRef): ResolvedCsid | null {
    if (ref.name === undefined || ref.name.trim() === "") return null;
    const query = normalizeName(ref.name);
    if (query === "") return null;

    const pool = ref.type ? byType.get(ref.type) ?? [] : Array.from(byCsid.values());
    if (pool.length === 0) return null;

    const wantRegion = ref.region ? normalizeName(ref.region) : "";
    // Prefer region-matching candidates when a region is supplied and any match.
    const regional = wantRegion
      ? pool.filter((e) => e.normRegion === wantRegion)
      : [];
    const candidates = regional.length > 0 ? regional : pool;

    let best: { csid: string; score: number } | null = null;
    let runnerUp: { csid: string; score: number } | null = null;
    for (const entry of candidates) {
      const score = nameSimilarity(query, entry.normName);
      if (score < threshold) continue;
      if (best === null || score > best.score) {
        runnerUp = best;
        best = { csid: entry.csid, score };
      } else if (
        (runnerUp === null || score > runnerUp.score) &&
        entry.csid !== best.csid
      ) {
        runnerUp = { csid: entry.csid, score };
      }
    }

    if (best === null) return null;

    // A distinct csid tying the best score is ambiguous — never silently linked.
    if (
      runnerUp !== null &&
      runnerUp.csid !== best.csid &&
      Math.abs(runnerUp.score - best.score) < 1e-9
    ) {
      onAmbiguous({
        ref,
        method: "fuzzy",
        candidates: [best, runnerUp]
          .sort((a, b) => (a.csid < b.csid ? -1 : 1))
          .map((c) => ({ csid: c.csid, confidence: round3(c.score) })),
      });
      return null;
    }

    return { csid: best.csid, confidence: round3(best.score), method: "fuzzy" };
  }

  return {
    resolve(ref: EntityRef): ResolvedCsid | null {
      return resolveByAlias(ref) ?? resolveByFuzzy(ref);
    },
    reverse(csid: string): EntityRef | null {
      const entry = byCsid.get(csid);
      if (entry === undefined) return null;
      return {
        type: entry.nodeType,
        id: entry.pinakesId,
        name: entry.name,
        region: entry.region,
      };
    },
    get size(): number {
      return byCsid.size;
    },
  };
}

// ── Lexicon-backed loading ──────────────────────────────────────────────────

/** Parse a TSV file into `{ headers, rows }`; a missing file yields empties. */
function readTsv(filePath: string): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/** Column index of the lexicon header mapped to canonical `target`, else -1. */
function targetColIndex(file: string, headers: string[], target: string): number {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return -1;
  const col = mapping.columns.find((c) => c.target === target);
  return col ? headers.indexOf(col.column) : -1;
}

/** First header exactly `csid` or `alias` (a convergence-populated alias), else -1. */
function csidColIndex(headers: string[]): number {
  return headers.findIndex((h) => /^(csid|alias)$/i.test(h));
}

/** First header ending in `region` (region/origin_region/proposed_region), else -1. */
function regionColIndex(headers: string[]): number {
  return headers.findIndex((h) => /(^|_)region$/i.test(h));
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Build alias entries from the live lexicons: one per canonical node row, keyed by
 * its explicit `csid`/`alias` column when present (convergence write-back) else the
 * deterministic minted csid. Pure over a lexicons directory.
 */
export function loadAliasEntries(lexiconsDir: string = LEXICONS_DIR): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const { file, node } of nodeFiles()) {
    if (nodeTypeByName(node) === undefined) continue;
    const { headers, rows } = readTsv(path.join(lexiconsDir, file));
    if (headers.length === 0) continue;

    const idIdx = targetColIndex(file, headers, "pinakes_id");
    const nameIdx = targetColIndex(file, headers, "name");
    const regionIdx = regionColIndex(headers);
    const csidIdx = csidColIndex(headers);

    for (const row of rows) {
      const pinakesId = cell(row, idIdx);
      if (pinakesId === "") continue;
      const explicit = cell(row, csidIdx);
      entries.push({
        csid: explicit !== "" ? explicit : mintCsid(node, pinakesId),
        pinakesId,
        nodeType: node,
        name: cell(row, nameIdx),
        region: cell(row, regionIdx),
      });
    }
  }
  return entries;
}

let cached: GraphResolver | null = null;

/** Memoised, lexicon-backed resolver for the server request path. */
export function getGraphResolver(lexiconsDir: string = LEXICONS_DIR): GraphResolver {
  if (cached === null) {
    cached = createGraphResolver(loadAliasEntries(lexiconsDir));
  }
  return cached;
}

/** Drop the memoised resolver (tests / after a lexicon reload). */
export function resetGraphResolver(): void {
  cached = null;
}
