/**
 * Export LinguaScrape lexicons in culture-scrape's ingestion-ready format (US-004).
 *
 * This reads every `lexicons/*.tsv` mapped as a canonical node (US-002) plus every
 * embedded / dedicated relationship (US-003) and emits the shared canonical shape
 * culture-scrape's tabular adapter can ingest without transformation:
 *
 *   <outDir>/nodes/<node-type>.tsv   — one file per canonical node type
 *   <outDir>/edges/<edge-type>.tsv   — one file per canonical edge type
 *   <outDir>/manifest.json           — node/edge type counts + diagnostics
 *
 * Every file carries the exact typed Neo4j-import header from the machine-readable
 * canonical schema (US-001) — `nodeHeaderRow()` / `edgeHeaderRow()` — so the output
 * validates against that schema and imports with `neo4j-admin import` directly.
 *
 * Provenance (US-006): every node and edge carries all four provenance columns —
 * `source`, `source_url`, `retrieved_at`, `confidence` (values may be blank, the column
 * is always present). `source = "linguascrape"` is the acquisition-source id the
 * reconciler keys on; the *original* LinguaScrape bibliographic `sources` citations are
 * preserved (never dropped) in the node `source_query` column. `source_url` and
 * `retrieved_at` propagate verbatim from the lexicon row when the acquisition step
 * recorded them (US-004: ~1.9k acquired rows carry a Wikidata entity URL + timestamp);
 * `source_url` otherwise falls back to a URL embedded in the citation, else blank — a URL
 * is never fabricated, and a row with no timestamp stays blank. The manifest carries a
 * per-type provenance-completeness coverage report.
 *
 * Identity: `csid` is minted deterministically (the id scheme's `cs:<type>:<local>`
 * format), so re-runs are byte-identical (idempotent). Per the `idScheme` in
 * `shared/canonical-schema.json`, a known Wikidata QID is the identity, so a row with a
 * non-blank `wikidata_qid` mints `cs:<node-type>:<QID>` (US-005); a row without one
 * falls back to `cs:<node-type>:<linguascrape-id>`. Every row also retains its original
 * `linguascrape_id` (the round-trip key for US-007). Edge endpoints are rewritten from
 * LinguaScrape ids to the csids of
 * the exported nodes; an edge whose endpoint has no exported node is not emitted
 * (dangling endpoints would break `neo4j-admin import`) and is counted + sampled in
 * the manifest rather than silently dropped.
 *
 * The build (`buildExport`) is pure over a lexicons directory so tests drive it with
 * fixtures; `writeExport` / `runExport` do the filesystem side. The output directory
 * is gitignored (see `.gitignore`); a manifest snapshot is committed to
 * `docs/culturescrape-export-manifest.json`.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_SCHEMA,
  nodeHeaderRow,
  edgeHeaderRow,
  nodeTypeByName,
  CANONICAL_DELIMITER,
} from "@shared/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@shared/lexicon-mapping";
import { extractAllCanonicalEdges } from "../server/services/canonical-edges.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Default gitignored output directory for the canonical export. */
export const EXPORT_DIR = path.join(REPO_ROOT, "export", "culturescrape");

/** Committed manifest snapshot (human-reviewable node/edge type counts). */
export const DOC_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "docs",
  "culturescrape-export-manifest.json",
);

/** Acquisition-source identifier stamped on every exported row. */
export const EXPORT_SOURCE = "linguascrape";

/**
 * Confidence for a node whose lexicon row carries no confidence value — mid-scale
 * ("present but unverified"), matching {@link DEFAULT_EDGE_CONFIDENCE} on the edge side.
 */
export const DEFAULT_NODE_CONFIDENCE = 0.5;

/**
 * Provenance fields the export handles explicitly rather than copying through the
 * generic `target`→column loop. `source` is force-set to {@link EXPORT_SOURCE} (the
 * lexicon column mapped to canonical `source` actually holds bibliographic citations,
 * which US-006 re-homes into `source_query`); `source_url`/`retrieved_at` are read from
 * their mapped lexicon columns with the US-004 propagation rules (verbatim, never
 * fabricated) so they need custom handling too.
 */
const PROVENANCE_FORCED_FIELDS: ReadonlySet<string> = new Set([
  "source",
  "source_url",
  "source_query",
  "retrieved_at",
]);

/** Provenance fields present on every exported node row (US-006 coverage). */
export const NODE_PROVENANCE_FIELDS = [
  "source",
  "source_url",
  "source_query",
  "retrieved_at",
  "confidence",
] as const;

/** Provenance fields present on every exported edge row (US-006 coverage). */
export const EDGE_PROVENANCE_FIELDS = [
  "source",
  "source_url",
  "retrieved_at",
  "confidence",
] as const;

/** An unresolved edge endpoint, retained (bounded) for the manifest. */
export interface UnresolvedEndpoint {
  readonly startId: string;
  readonly endId: string;
  readonly edgeName: string;
  readonly sourceFile: string;
}

/** An auto-generated needs-curation stub node minted for an unresolved endpoint (US-007). */
export interface StubNodeSample {
  readonly linguascrapeId: string;
  readonly type: string;
  readonly sourceFile: string;
}

/** Non-empty counts for the provenance columns of one node/edge type. */
export interface ProvenanceTypeCoverage {
  readonly type: string;
  readonly count: number;
  /** field name → number of rows whose value is non-blank. */
  readonly nonEmpty: Readonly<Record<string, number>>;
}

/** Per-family provenance completeness (US-006). */
export interface ProvenanceFamilyCoverage {
  readonly fields: readonly string[];
  readonly total: number;
  readonly byType: readonly ProvenanceTypeCoverage[];
  /** field name → non-blank count across every row of the family. */
  readonly nonEmpty: Readonly<Record<string, number>>;
}

/** Provenance coverage report attached to the manifest (US-006). */
export interface ProvenanceCoverage {
  readonly node: ProvenanceFamilyCoverage;
  readonly edge: ProvenanceFamilyCoverage & {
    /**
     * Edges that carried an original bibliographic citation for which the canonical
     * edge schema has no column (it has no `source_query`). These are never silently
     * dropped: embedded-FK edges preserve the citation on the host node's
     * `source_query`; this count flags the residue for review.
     */
    readonly citationsWithoutCanonicalColumn: number;
  };
  /** Human-readable notes on blank-but-expected columns (never-fabricated URLs, etc.). */
  readonly flags: readonly string[];
}

/** Per-type export summary written to the manifest. */
export interface ExportManifest {
  readonly schemaVersion: string;
  readonly source: string;
  readonly nodeTypes: ReadonlyArray<{
    readonly type: string;
    readonly label: string;
    readonly file: string;
    readonly count: number;
  }>;
  readonly edgeTypes: ReadonlyArray<{
    readonly type: string;
    readonly token: string;
    readonly file: string;
    readonly count: number;
  }>;
  readonly totals: {
    readonly nodes: number;
    readonly edges: number;
    readonly nodeTypes: number;
    readonly edgeTypes: number;
  };
  readonly diagnostics: {
    readonly skippedNodeRowsMissingId: number;
    readonly duplicateCsids: number;
    readonly ambiguousLinguascrapeIds: number;
    readonly edgesWithUnresolvedEndpoint: number;
    readonly unresolvedEndpointSamples: readonly UnresolvedEndpoint[];
    /**
     * Needs-curation stub nodes minted for edge endpoints with no real node (US-007),
     * so the referencing edges reach the export instead of being dropped. Each stub
     * carries {@link STUB_NEEDS_CURATION_NOTE} + confidence `0`; a follow-up curation
     * pass replaces them with real typed nodes.
     */
    readonly stubNodesMinted: number;
    readonly stubNodesByType: Readonly<Record<string, number>>;
    readonly stubNodeSamples: readonly StubNodeSample[];
  };
  readonly provenance: ProvenanceCoverage;
}

/** In-memory result of a build: grouped rows (in canonical column order) + manifest. */
export interface BuiltExport {
  /** node-type name → rows, each a string[] in `CANONICAL_SCHEMA.node.columns` order. */
  readonly nodeGroups: Map<string, string[][]>;
  /** edge-type name → rows, each a string[] in `CANONICAL_SCHEMA.edge.columns` order. */
  readonly edgeGroups: Map<string, string[][]>;
  readonly manifest: ExportManifest;
}

const MAX_UNRESOLVED_SAMPLES = 25;

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/** Strip tab/newline so a value cannot corrupt the TSV grid. */
function sanitize(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/** Parse an integer-year cell to its canonical string form (`""` when absent/invalid). */
function yearCell(value: string): string {
  if (value === "") return "";
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? "" : String(n);
}

/**
 * Normalise a raw confidence cell to `[0, 1]`. LinguaScrape mixes 0–100 and 0–1
 * scales, so values above 1 are treated as percentages. Empty / non-numeric ⇒
 * `fallback`.
 */
export function normaliseConfidence(
  value: string,
  fallback: number = DEFAULT_NODE_CONFIDENCE,
): number {
  if (value === "") return fallback;
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  const scaled = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

/**
 * Parse a combined coordinate cell into `{ lat, lon }`. LinguaScrape stores these as
 * JSON `{"lat":..,"lng":..}`; a bare `"lat,lon"` string is also accepted. Returns
 * `null` when the cell is empty or unparseable.
 */
export function parseCoordinates(
  value: string,
): { lat: number; lon: number } | null {
  if (value === "") return null;
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const lat = Number(parsed.lat);
      const lon = Number(parsed.lng ?? parsed.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch {
      // fall through
    }
    return null;
  }
  const parts = value.split(",").map((p) => Number(p.trim()));
  if (parts.length === 2 && parts.every((p) => Number.isFinite(p))) {
    return { lat: parts[0], lon: parts[1] };
  }
  return null;
}

/**
 * Parse a LinguaScrape citation cell into a single preserved string. Many lexicons
 * store `sources` as a JSON array (`["Kuijt 2002","Cauvin 2000"]`); those are joined
 * with `"; "`. A plain string is returned trimmed; empty ⇒ `""`. This never drops the
 * original citation — it only reshapes it for the `source_query` column (US-006).
 */
export function parseCitation(value: string): string {
  if (value === "") return "";
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .map((s) => s.trim())
          .join("; ");
      }
    } catch {
      // fall through to the raw value
    }
  }
  return value.trim();
}

/** Matches the first `http(s)` URL in a string. */
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;

/**
 * Derive a `source_url` from the first real `http(s)` URL found in any candidate
 * string (a citation, a raw cell, …). Returns `""` when none is present — the export
 * **never fabricates** a URL (US-006), it only surfaces one that already exists.
 */
export function deriveSourceUrl(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(URL_PATTERN);
    if (match) return match[0];
  }
  return "";
}

/**
 * Mint a deterministic canonical id (US-005). Per the `idScheme` in
 * `shared/canonical-schema.json`, a known Wikidata QID **is** the identity, so a row
 * carrying a non-blank `wikidata_qid` mints `cs:<node-type>:<QID>`; a row without one
 * falls back to the readable `cs:<node-type>:<linguascrape-id>`. QID-anchoring makes
 * the same entity carry the same csid regardless of which pipeline exported it.
 */
export function mintCsid(
  nodeType: string,
  linguascrapeId: string,
  wikidataQid?: string,
): string {
  const qid = (wikidataQid ?? "").trim();
  const local = qid !== "" ? qid : linguascrapeId;
  return `cs:${nodeType}:${local}`;
}

/**
 * Recover the node-type slug from a minted csid (`cs:<type>:<local>`). The type
 * slug carries hyphens but never a colon, and the local id/QID never does, so the
 * middle `:`-segment is the type. Returns `""` for a malformed csid.
 */
export function nodeTypeFromCsid(csid: string): string {
  const parts = csid.split(":");
  return parts.length >= 3 ? parts[1] : "";
}

/**
 * Turn a LinguaScrape id into a human-readable display name for a stub node —
 * `proto_indo_european` → `Proto Indo European`. Used only for auto-generated
 * needs-curation stubs (US-007); real nodes keep their curated `name`.
 */
export function humanizeId(id: string): string {
  return id
    .split(/[_\-\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Default node type for a stub minted when BOTH endpoints of an edge are unresolved
 * (so neither's type can be borrowed). Keyed by the edge's source lexicon — the
 * dominant kind of entity that file's edges connect. When one endpoint *is* a real
 * node, its type is borrowed instead (see {@link buildExport}); this table is the
 * both-unresolved fallback only. Any file not listed falls back to
 * {@link DEFAULT_STUB_TYPE}.
 */
const STUB_TYPE_BY_SOURCE_FILE: Readonly<Record<string, string>> = {
  "cultural-lineages.tsv": "language-family",
  "deities.tsv": "deity",
  "archaeological-cultures.tsv": "archaeological-culture",
  "writing-systems.tsv": "writing-system",
  "etymology-relations.tsv": "language",
  "language-contacts.tsv": "language",
  "art-style-evolutions.tsv": "art-tradition",
};

/** Fallback stub node type when no per-file default nor a borrowable endpoint exists. */
const DEFAULT_STUB_TYPE = "culture";

/**
 * `description` stamped on every auto-generated stub node so a curator (and any graph
 * consumer) can tell it apart from a real curated node. Confidence is set to `0` for
 * the same reason.
 */
export const STUB_NEEDS_CURATION_NOTE =
  "[needs-curation] Auto-generated stub node for an unresolved edge endpoint; requires curation into a real typed node.";

const MAX_STUB_SAMPLES = 25;

/** Serialise a canonical record (field→value) into a row in the schema's column order. */
function orderRow(
  columns: readonly { readonly field: string }[],
  record: Map<string, string>,
): string[] {
  return columns.map((c) => sanitize(record.get(c.field) ?? ""));
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
 * Build the canonical node rows for one lexicon file, appending them (grouped by
 * node type) into `nodeGroups`, minting csids into `idIndex`, and updating counters.
 */
function buildNodesForFile(
  file: string,
  nodeType: string,
  lexiconsDir: string,
  nodeGroups: Map<string, string[][]>,
  idIndex: Map<string, string>,
  seenCsids: Set<string>,
  counters: { skippedMissingId: number; duplicateCsids: number; ambiguousIds: number },
): void {
  const mapping = lexiconMappingByFile(file);
  const typeInfo = nodeTypeByName(nodeType);
  if (mapping === undefined || typeInfo === undefined) return;
  const { headers, rows } = readTsv(path.join(lexiconsDir, file));
  if (headers.length === 0) return;

  // canonical field → source column index (drop the forced provenance fields).
  const targetIdx = new Map<string, number>();
  for (const c of mapping.columns) {
    if (c.target === undefined || PROVENANCE_FORCED_FIELDS.has(c.target)) continue;
    targetIdx.set(c.target, headers.indexOf(c.column));
  }
  // A combined `*coordinates` property splits into lat/lon when not already mapped.
  const coordCol = mapping.columns.find(
    (c) => c.property === true && /coordinates$/i.test(c.column),
  );
  const coordIdx = coordCol ? headers.indexOf(coordCol.column) : -1;

  // The lexicon column mapped to canonical `source` holds bibliographic citations,
  // not the acquisition-source id — preserve it into `source_query` (US-006).
  const citationCol = mapping.columns.find((c) => c.target === "source");
  const citationIdx = citationCol ? headers.indexOf(citationCol.column) : -1;

  // Provenance the acquisition scripts stamp on the lexicon row (US-004): a real
  // Wikidata entity URL + retrieval timestamp. These survive verbatim into the
  // export; a row without them stays blank (they are never fabricated). Both are
  // in PROVENANCE_FORCED_FIELDS (excluded from the generic `targetIdx`) so they are
  // read explicitly here — source_url with a citation-embedded-URL fallback.
  const sourceUrlCol = mapping.columns.find((c) => c.target === "source_url");
  const sourceUrlIdx = sourceUrlCol ? headers.indexOf(sourceUrlCol.column) : -1;
  const retrievedAtCol = mapping.columns.find((c) => c.target === "retrieved_at");
  const retrievedAtIdx = retrievedAtCol ? headers.indexOf(retrievedAtCol.column) : -1;

  const group = nodeGroups.get(nodeType) ?? [];

  const qidIdxForFile = targetIdx.get("wikidata_qid") ?? -1;

  for (const row of rows) {
    const idIdxForFile = targetIdx.get("linguascrape_id") ?? -1;
    const lsId = cell(row, idIdxForFile);
    if (lsId === "") {
      counters.skippedMissingId += 1;
      continue;
    }
    // US-005: a known QID is the identity; rows without one keep the readable id.
    const rowQid = cell(row, qidIdxForFile);
    const csid = mintCsid(nodeType, lsId, rowQid);
    if (seenCsids.has(csid)) {
      counters.duplicateCsids += 1;
      continue;
    }
    seenCsids.add(csid);

    const record = new Map<string, string>();
    record.set("csid", csid);
    record.set(":LABEL", typeInfo.label);

    for (const [field, idx] of targetIdx) {
      if (field === "csid" || field === ":LABEL") continue;
      const raw = cell(row, idx);
      if (field === "time_start" || field === "time_end") {
        record.set(field, yearCell(raw));
      } else {
        record.set(field, raw);
      }
    }

    // Split combined coordinates only when lat/lon were not mapped directly.
    if (coordIdx >= 0 && !record.get("lat") && !record.get("lon")) {
      const coords = parseCoordinates(cell(row, coordIdx));
      if (coords) {
        record.set("lat", String(coords.lat));
        record.set("lon", String(coords.lon));
      }
    }

    // Provenance: `source` = acquisition-source id (reconciler anchor); the
    // original LinguaScrape citation is preserved in `source_query` and never
    // dropped (US-006). `source_url`/`retrieved_at` (US-004): a URL/timestamp the
    // acquisition step recorded on the row survives verbatim; when the row carries
    // no URL we fall back to one embedded in the citation, else blank — a URL is
    // never fabricated.
    const citation = citationIdx >= 0 ? parseCitation(cell(row, citationIdx)) : "";
    const rowSourceUrl = sourceUrlIdx >= 0 ? cell(row, sourceUrlIdx) : "";
    const rowRetrievedAt = retrievedAtIdx >= 0 ? cell(row, retrievedAtIdx) : "";
    record.set("source", EXPORT_SOURCE);
    record.set("source_query", citation);
    record.set("source_url", rowSourceUrl || deriveSourceUrl(citation));
    record.set("retrieved_at", rowRetrievedAt);
    record.set(
      "confidence",
      String(normaliseConfidence(record.get("confidence") ?? "")),
    );

    group.push(orderRow(CANONICAL_SCHEMA.node.columns, record));

    if (idIndex.has(lsId)) {
      // Same LinguaScrape id used by more than one node — keep the first mapping.
      if (idIndex.get(lsId) !== csid) counters.ambiguousIds += 1;
    } else {
      idIndex.set(lsId, csid);
    }
  }

  nodeGroups.set(nodeType, group);
}

/**
 * Build the full canonical export from a lexicons directory. Pure (returns in-memory
 * grouped rows + manifest); {@link writeExport} performs the filesystem side.
 */
export function buildExport(lexiconsDir: string = LEXICONS_DIR): BuiltExport {
  const nodeGroups = new Map<string, string[][]>();
  const idIndex = new Map<string, string>();
  const seenCsids = new Set<string>();
  const nodeCounters = {
    skippedMissingId: 0,
    duplicateCsids: 0,
    ambiguousIds: 0,
  };

  for (const { file, node } of nodeFiles()) {
    buildNodesForFile(
      file,
      node,
      lexiconsDir,
      nodeGroups,
      idIndex,
      seenCsids,
      nodeCounters,
    );
  }

  // Edges: reuse the US-003 extractor, then rewrite endpoints to node csids.
  const edgeGroups = new Map<string, string[][]>();
  const unresolvedSamples: UnresolvedEndpoint[] = [];
  let unresolvedCount = 0;

  let edgeCitationsWithoutColumn = 0;

  // US-007: mint a flagged needs-curation stub node for an edge endpoint that has
  // no real exported node, so the referencing edge reaches the export instead of
  // being counted-and-dropped. Idempotent per id (first mint wins, later references
  // reuse it via `idIndex`) so the same endpoint never yields two csids. Returns the
  // stub's csid, or `undefined` when the type is unknown or the csid would collide
  // (extremely rare — the edge then stays genuinely unresolved).
  let stubNodesMinted = 0;
  const stubNodesByType = new Map<string, number>();
  const stubNodeSamples: StubNodeSample[] = [];
  const mintStub = (
    id: string,
    stubType: string,
    sourceFile: string,
  ): string | undefined => {
    const existing = idIndex.get(id);
    if (existing !== undefined) return existing;
    const typeInfo = nodeTypeByName(stubType);
    if (typeInfo === undefined) return undefined;
    const csid = mintCsid(stubType, id);
    if (seenCsids.has(csid)) return undefined;
    seenCsids.add(csid);

    const record = new Map<string, string>();
    record.set("csid", csid);
    record.set(":LABEL", typeInfo.label);
    record.set("name", humanizeId(id));
    record.set("linguascrape_id", id);
    record.set("description", STUB_NEEDS_CURATION_NOTE);
    record.set("source", EXPORT_SOURCE);
    record.set("source_url", "");
    record.set("source_query", "");
    record.set("retrieved_at", "");
    record.set("confidence", "0");

    const group = nodeGroups.get(stubType) ?? [];
    group.push(orderRow(CANONICAL_SCHEMA.node.columns, record));
    nodeGroups.set(stubType, group);
    idIndex.set(id, csid);

    stubNodesMinted += 1;
    stubNodesByType.set(stubType, (stubNodesByType.get(stubType) ?? 0) + 1);
    if (stubNodeSamples.length < MAX_STUB_SAMPLES) {
      stubNodeSamples.push({ linguascrapeId: id, type: stubType, sourceFile });
    }
    return csid;
  };

  const { edges } = extractAllCanonicalEdges(lexiconsDir);
  for (const e of edges) {
    let startCsid = idIndex.get(e.startId);
    let endCsid = idIndex.get(e.endId);
    // Borrow the counterpart's node type when it is a real node; else fall back to
    // the edge source file's default type (both endpoints unresolved).
    if (startCsid === undefined) {
      const stubType =
        endCsid !== undefined
          ? nodeTypeFromCsid(endCsid)
          : STUB_TYPE_BY_SOURCE_FILE[e.sourceFile] ?? DEFAULT_STUB_TYPE;
      startCsid = mintStub(e.startId, stubType, e.sourceFile);
    }
    if (endCsid === undefined) {
      const stubType =
        startCsid !== undefined
          ? nodeTypeFromCsid(startCsid)
          : STUB_TYPE_BY_SOURCE_FILE[e.sourceFile] ?? DEFAULT_STUB_TYPE;
      endCsid = mintStub(e.endId, stubType, e.sourceFile);
    }
    if (startCsid === undefined || endCsid === undefined) {
      unresolvedCount += 1;
      if (unresolvedSamples.length < MAX_UNRESOLVED_SAMPLES) {
        unresolvedSamples.push({
          startId: e.startId,
          endId: e.endId,
          edgeName: e.edgeName,
          sourceFile: e.sourceFile,
        });
      }
      continue;
    }

    // The extractor's `provenance.source` is the original citation, or the source
    // file name when the row carried none. A real citation has no canonical edge
    // column (edges have no `source_query`); flag it rather than drop it silently.
    const edgeCitation = e.provenance.source;
    if (edgeCitation !== "" && edgeCitation !== e.sourceFile) {
      edgeCitationsWithoutColumn += 1;
    }

    const record = new Map<string, string>();
    record.set(":START_ID", startCsid);
    record.set(":END_ID", endCsid);
    record.set(":TYPE", e.type);
    record.set("time_start", e.timeStart === null ? "" : String(e.timeStart));
    record.set("time_end", e.timeEnd === null ? "" : String(e.timeEnd));
    record.set("linguascrape_id", e.linguascrapeId ?? "");
    record.set("source", EXPORT_SOURCE);
    record.set("source_url", deriveSourceUrl(e.provenance.sourceUrl, edgeCitation));
    record.set("retrieved_at", "");
    record.set("confidence", String(e.provenance.confidence));

    const group = edgeGroups.get(e.edgeName) ?? [];
    group.push(orderRow(CANONICAL_SCHEMA.edge.columns, record));
    edgeGroups.set(e.edgeName, group);
  }

  // Deterministic ordering — sort within each group so runs are byte-identical.
  for (const rows of nodeGroups.values()) {
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  for (const rows of edgeGroups.values()) {
    rows.sort((a, b) => {
      const key = (r: string[]) => `${r[0]} ${r[1]} ${r[2]}`;
      const ka = key(a);
      const kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  const provenance = buildProvenanceCoverage(
    nodeGroups,
    edgeGroups,
    edgeCitationsWithoutColumn,
  );

  const manifest = buildManifest(
    nodeGroups,
    edgeGroups,
    nodeCounters,
    unresolvedCount,
    unresolvedSamples,
    provenance,
    {
      minted: stubNodesMinted,
      byType: Object.fromEntries(
        [...stubNodesByType.entries()].sort((a, b) =>
          a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
        ),
      ),
      samples: stubNodeSamples,
    },
  );

  return { nodeGroups, edgeGroups, manifest };
}

/** Count, per type (in schema order), how many rows have a non-blank value per field. */
function familyCoverage(
  family: "node" | "edge",
  groups: Map<string, string[][]>,
  fields: readonly string[],
): ProvenanceFamilyCoverage {
  const fieldIdx = new Map(
    fields.map((f) => [
      f,
      CANONICAL_SCHEMA[family].columns.findIndex((c) => c.field === f),
    ]),
  );
  const typeOrder =
    family === "node" ? CANONICAL_SCHEMA.nodeTypes : CANONICAL_SCHEMA.edgeTypes;
  const totalNonEmpty: Record<string, number> = Object.fromEntries(
    fields.map((f) => [f, 0]),
  );
  const byType: ProvenanceTypeCoverage[] = [];
  let total = 0;

  for (const t of typeOrder) {
    const rows = groups.get(t.name);
    if (rows === undefined) continue;
    const nonEmpty: Record<string, number> = Object.fromEntries(
      fields.map((f) => [f, 0]),
    );
    for (const row of rows) {
      for (const f of fields) {
        const idx = fieldIdx.get(f)!;
        if (idx >= 0 && (row[idx] ?? "") !== "") {
          nonEmpty[f] += 1;
          totalNonEmpty[f] += 1;
        }
      }
    }
    total += rows.length;
    byType.push({ type: t.name, count: rows.length, nonEmpty });
  }

  return { fields: [...fields], total, byType, nonEmpty: totalNonEmpty };
}

/** Assemble the US-006 provenance-completeness report (per node/edge type + flags). */
function buildProvenanceCoverage(
  nodeGroups: Map<string, string[][]>,
  edgeGroups: Map<string, string[][]>,
  edgeCitationsWithoutColumn: number,
): ProvenanceCoverage {
  const node = familyCoverage("node", nodeGroups, NODE_PROVENANCE_FIELDS);
  const edgeBase = familyCoverage("edge", edgeGroups, EDGE_PROVENANCE_FIELDS);
  const edge = { ...edgeBase, citationsWithoutCanonicalColumn: edgeCitationsWithoutColumn };

  const flags: string[] = [];
  if (node.nonEmpty.source_url === 0) {
    flags.push(
      `node.source_url: 0/${node.total} rows carry a URL — LinguaScrape lexicons record no source URLs; left blank, never fabricated.`,
    );
  }
  if (node.nonEmpty.retrieved_at === 0) {
    flags.push(
      `node.retrieved_at: 0/${node.total} rows carry a retrieval timestamp — LinguaScrape records none; left blank, never fabricated.`,
    );
  }
  flags.push(
    `node.source_query: ${node.nonEmpty.source_query}/${node.total} rows preserve the original LinguaScrape citation.`,
  );
  if (edge.nonEmpty.source_url === 0) {
    flags.push(
      `edge.source_url: 0/${edge.total} edges carry a URL; left blank, never fabricated.`,
    );
  }
  if (edge.nonEmpty.retrieved_at === 0) {
    flags.push(
      `edge.retrieved_at: 0/${edge.total} edges carry a retrieval timestamp; left blank, never fabricated.`,
    );
  }
  if (edge.citationsWithoutCanonicalColumn > 0) {
    flags.push(
      `edge.citationsWithoutCanonicalColumn: ${edge.citationsWithoutCanonicalColumn} edges carried an original citation, but the canonical edge schema has no citation column; embedded-FK edges preserve it on the host node's source_query.`,
    );
  }

  return { node, edge, flags };
}

/** Assemble the manifest from grouped rows + counters (type order follows the schema). */
function buildManifest(
  nodeGroups: Map<string, string[][]>,
  edgeGroups: Map<string, string[][]>,
  nodeCounters: {
    skippedMissingId: number;
    duplicateCsids: number;
    ambiguousIds: number;
  },
  unresolvedCount: number,
  unresolvedSamples: readonly UnresolvedEndpoint[],
  provenance: ProvenanceCoverage,
  stubNodes: {
    minted: number;
    byType: Readonly<Record<string, number>>;
    samples: readonly StubNodeSample[];
  },
): ExportManifest {
  const nodeTypes = CANONICAL_SCHEMA.nodeTypes
    .filter((t) => nodeGroups.has(t.name))
    .map((t) => ({
      type: t.name,
      label: t.label,
      file: `nodes/${t.name}.tsv`,
      count: nodeGroups.get(t.name)!.length,
    }));
  const edgeTypes = CANONICAL_SCHEMA.edgeTypes
    .filter((t) => edgeGroups.has(t.name))
    .map((t) => ({
      type: t.name,
      token: t.type,
      file: `edges/${t.name}.tsv`,
      count: edgeGroups.get(t.name)!.length,
    }));

  const nodeTotal = nodeTypes.reduce((sum, t) => sum + t.count, 0);
  const edgeTotal = edgeTypes.reduce((sum, t) => sum + t.count, 0);

  return {
    schemaVersion: CANONICAL_SCHEMA.version,
    source: EXPORT_SOURCE,
    nodeTypes,
    edgeTypes,
    totals: {
      nodes: nodeTotal,
      edges: edgeTotal,
      nodeTypes: nodeTypes.length,
      edgeTypes: edgeTypes.length,
    },
    diagnostics: {
      skippedNodeRowsMissingId: nodeCounters.skippedMissingId,
      duplicateCsids: nodeCounters.duplicateCsids,
      ambiguousLinguascrapeIds: nodeCounters.ambiguousIds,
      edgesWithUnresolvedEndpoint: unresolvedCount,
      unresolvedEndpointSamples: unresolvedSamples,
      stubNodesMinted: stubNodes.minted,
      stubNodesByType: stubNodes.byType,
      stubNodeSamples: stubNodes.samples,
    },
    provenance,
  };
}

/** Join a header + grouped rows into a full TSV document (trailing newline). */
function tsvDocument(header: string, rows: string[][]): string {
  const body = rows.map((r) => r.join(CANONICAL_DELIMITER));
  return [header, ...body].join("\n") + "\n";
}

/**
 * Write a built export to disk: `<outDir>/nodes/*.tsv`, `<outDir>/edges/*.tsv`, and
 * `<outDir>/manifest.json`. The `nodes/` and `edges/` subdirectories are cleared
 * first so a removed type leaves no stale file (the output dir is gitignored).
 */
export function writeExport(built: BuiltExport, outDir: string = EXPORT_DIR): void {
  const nodesDir = path.join(outDir, "nodes");
  const edgesDir = path.join(outDir, "edges");
  fs.rmSync(nodesDir, { recursive: true, force: true });
  fs.rmSync(edgesDir, { recursive: true, force: true });
  fs.mkdirSync(nodesDir, { recursive: true });
  fs.mkdirSync(edgesDir, { recursive: true });

  const nodeHeader = nodeHeaderRow();
  for (const [type, rows] of built.nodeGroups) {
    fs.writeFileSync(
      path.join(nodesDir, `${type}.tsv`),
      tsvDocument(nodeHeader, rows),
    );
  }
  const edgeHeader = edgeHeaderRow();
  for (const [type, rows] of built.edgeGroups) {
    fs.writeFileSync(
      path.join(edgesDir, `${type}.tsv`),
      tsvDocument(edgeHeader, rows),
    );
  }

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(built.manifest, null, 2) + "\n",
  );
}

/** Serialise a manifest to its committed JSON form. */
export function manifestJson(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** Build + write the export and refresh the committed manifest snapshot. */
export function runExport(
  opts: {
    lexiconsDir?: string;
    outDir?: string;
    docManifestPath?: string;
  } = {},
): BuiltExport {
  const lexiconsDir = opts.lexiconsDir ?? LEXICONS_DIR;
  const outDir = opts.outDir ?? EXPORT_DIR;
  const docManifestPath = opts.docManifestPath ?? DOC_MANIFEST_PATH;

  const built = buildExport(lexiconsDir);
  writeExport(built, outDir);
  fs.writeFileSync(docManifestPath, manifestJson(built.manifest));
  return built;
}

// CLI entry — mirrors scripts/audit-tsv.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const built = runExport();
  const { totals } = built.manifest;
  // eslint-disable-next-line no-console
  console.log(
    `Exported ${totals.nodes} nodes (${totals.nodeTypes} types) + ` +
      `${totals.edges} edges (${totals.edgeTypes} types) → ${EXPORT_DIR}`,
  );
}
