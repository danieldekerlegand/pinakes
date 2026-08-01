/**
 * Acquire the newer cultural domains from Wikidata (SPARQL) and curate them into committed
 * additions TSVs for write-back (US-005, data-population at scale).
 *
 * This is the one networked step of the per-domain runbook (docs/data-population-runbook.md,
 * steps 3–5) for the five bulk-acquirable cultural-breadth domains. The committed outputs
 * (`scripts/data/<lexicon>-additions.tsv`) are the network-free source of truth the write-back
 * + QA gate operate on, so CI never touches Wikidata.
 *
 * Five sibling domains, one script (same acquire machinery as acquire-food-drink.ts):
 *  - writing-systems       (node `writing-system`)   ← Wikidata Q8192     "writing system".
 *  - deities               (node `deity`)            ← Wikidata Q178885   "deity".
 *  - architectural-styles  (node `art-tradition`)    ← Wikidata Q32880    "architectural style".
 *  - dance-traditions      (node `art-tradition`)    ← subclasses of dance (Q11401 / Q201022).
 *  - literary-traditions   (node `literary-tradition`)← Wikidata Q2198855 "literary movement".
 *
 * (myth-motifs is NOT here — its Wikidata narrative-motif class is too polluted with modern
 *  tropes to bulk-acquire credibly, so it is hand-curated offline in curate-myth-motifs.ts,
 *  the same way migration/trade routes are.)
 *
 * Cross-domain edges: deities carry `syncretism_links` → a `syncretized-with` edge. Wikidata
 * `P460` ("said to be the same as") is resolved to the minted ids of OTHER deities in the same
 * batch (in-corpus targets only), so every emitted syncretized-with edge lands in the graph and
 * the gate's `edgesWithUnresolvedEndpoint` ratchet never regresses (à la US-003 cultures P155/P156).
 *
 * Curation rules (runbook step 5), identical to acquire-food-drink.ts:
 *  - Notability floor: only items with `>= MIN_SITELINKS` sitelinks; ranked by sitelinks.
 *  - Coordinates/region OPTIONAL (these are concepts, not points): derived from country-of-origin
 *    (P495) where present, else blank.
 *  - Class-suffix labels are normalised before reconciling (Wikidata "Latin script" → "Latin",
 *    "Gothic architecture" → "Gothic") so seed rows aren't re-added as un-caught duplicates.
 *  - Drop QID-named / empty labels and any normalised name already in the same node type; ids are
 *    deduped across the WHOLE corpus (the export's `ambiguousPinakesIds` diagnostic is global).
 *  - Every emitted row carries full provenance (Guiding Principle #8).
 *
 * Run:  npx tsx scripts/acquire-cultural-domains.ts [--domain writing-systems|deities|
 *          architectural-styles|dance-traditions|literary-traditions] [--limit N] [--min-sitelinks N]
 * (no --domain ⇒ all five; each domain has its own default limit / sitelink floor).
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "pinakes/1.0 (+https://github.com/danieldekerlegand/pinakes; data-population)";

/** Confidence for Wikidata-acquired rows, on the 0–1 scale (export leaves ≤1 as-is). */
// `unreferenced-wikidata` (0.8) — a bulk WDQS class-membership pull taken as-is;
// confidence comes from the rubric, not a literal (US-001).
const ACQUIRED_CONFIDENCE = confidenceCellForClass("unreferenced-wikidata");
const SOURCES = '["Wikidata"]';

/** One raw SPARQL binding (only the fields the queries below actually project). */
interface Binding {
  s: { value: string };
  label: { value: string };
  sl: { value: string };
  coord?: { value: string };
  regionLabel?: { value: string };
  inc?: { value: string };
  end?: { value: string };
  gender?: { value: string };
  rel?: { value: string };
  desc?: { value: string };
}

async function runQuery(query: string): Promise<Binding[]> {
  const body = new URLSearchParams({ query });
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(WDQS_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body,
      });
      const text = await res.text();
      if (res.ok) {
        const json = JSON.parse(text) as { results: { bindings: Binding[] } };
        return json.results.bindings;
      }
      lastError = `HTTP ${res.status}: ${text.slice(0, 120)}`;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error(`Wikidata query failed after 4 attempts: ${lastError}`);
}

/** `Point(lng lat)` → `{"lat":..,"lng":..}` (the lexicon's coordinate cell shape), else "". */
function parseCoordinates(point: string | undefined): string {
  if (point === undefined) return "";
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(point.trim());
  if (m === null) return "";
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return "";
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return "";
  return JSON.stringify({ lat, lng });
}

/** Wikidata date literal (`-0386-01-01T…`, `+2020-…`) → signed year, or "". */
function toYear(value: string | undefined): string {
  if (value === undefined) return "";
  const m = /^([+-]?)(\d{1,})-\d{2}-\d{2}T/.exec(value);
  if (m === null) return "";
  const year = Number(m[2]);
  if (!Number.isFinite(year) || year === 0) return "";
  return m[1] === "-" ? String(-year) : String(year);
}

/** Reject QID-named or empty labels; keep genuine names. */
function isRealLabel(label: string): boolean {
  const t = label.trim();
  if (t === "") return false;
  return !/^Q\d+$/.test(t);
}

/** Normalise a name for duplicate detection (matches import-from-culturescrape). */
function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** A URL/id-safe slug from a name. */
function slugify(name: string, fallback: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

/** Collapse a Wikidata text value to a single clean TSV cell. */
function cleanText(value: string | undefined): string {
  if (value === undefined) return "";
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/** Every lexicon file that maps to a canonical node type (for global id dedup). */
function nodeLexiconFiles(): string[] {
  const mapping = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "shared", "lexicon-mapping.json"), "utf8"),
  ) as { files: { file: string; kind: string }[] };
  return mapping.files.filter((f) => f.kind === "node").map((f) => f.file);
}

/** Read the `id`/`name` columns of a lexicon (missing file → empty). */
function readIdsAndNames(file: string): { ids: string[]; names: string[] } {
  const abs = path.join(LEXICONS_DIR, file);
  if (!fs.existsSync(abs)) return { ids: [], names: [] };
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { ids: [], names: [] };
  const headers = lines[0].split("\t");
  const idIdx = headers.indexOf("id");
  const nameIdx = headers.indexOf("name");
  const ids: string[] = [];
  const names: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (idIdx >= 0) {
      const v = (cells[idIdx] ?? "").trim();
      if (v !== "") ids.push(v);
    }
    if (nameIdx >= 0) {
      const v = (cells[nameIdx] ?? "").trim();
      if (v !== "") names.push(v);
    }
  }
  return { ids, names };
}

/** One curated row. Only the columns a given domain declares are emitted. */
type CuratedRow = Record<string, string>;

/** A per-QID collapsed item (first non-blank of each optional field; rels accumulated). */
interface MergedItem {
  qid: string;
  label: string;
  sitelinks: number;
  coord: string;
  region: string;
  inception: string;
  endYear: string;
  gender: string;
  description: string;
  /** QIDs of `P460` ("said to be the same as") targets — resolved to in-batch ids for edges. */
  rels: string[];
}

interface DomainConfig {
  key: string;
  /** Wikidata class Q-number instantiated by the domain's items. */
  wikidataClass: string;
  targetLexicon: string;
  outFile: string;
  /** Ordered domain columns emitted (core provenance appended automatically). */
  columns: readonly string[];
  /** Lexicon files whose `name`s reconcile with this domain (same node type). */
  nameSiblings: readonly string[];
  /** Fallback slug when a name reduces to nothing. */
  slugFallback: string;
  defaultMinSitelinks: number;
  defaultLimit: number;
  sparql: (minSitelinks: number) => string;
  /** Strip class-suffix noise from a raw label before reconciling (e.g. "Latin script" → "Latin"). */
  nameTransform: (label: string) => string;
  /** Map one merged binding → the domain's non-provenance cells (id minted by the caller). */
  buildCells: (m: MergedItem) => CuratedRow;
  /**
   * When set, this column is a JSON array of in-batch ids resolved from each item's `rels`
   * (P460). Filled in a post-mint pass so only in-corpus edge endpoints are written.
   */
  edgeColumn?: string;
}

/** Core provenance columns appended to every domain's additions header, in write-back order. */
const PROVENANCE_COLUMNS = [
  "wikidata_qid",
  "source_url",
  "retrieved_at",
  "confidence",
  "sources",
] as const;

function writingSystemSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?inc ?regionLabel WHERE {
  ?s wdt:P31 wd:Q8192. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P571 ?inc. }
  OPTIONAL { ?s wdt:P495 ?orig. ?orig rdfs:label ?regionLabel. FILTER(LANG(?regionLabel) = "en") }
}`;
}

function deitySparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?gender ?rel ?desc WHERE {
  ?s wdt:P31 wd:Q178885. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P21 ?g. ?g rdfs:label ?gender. FILTER(LANG(?gender) = "en") }
  OPTIONAL { ?s wdt:P460 ?rel. }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

function architecturalStyleSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?inc ?coord ?regionLabel ?desc WHERE {
  ?s wdt:P31 wd:Q32880. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P571 ?inc. }
  OPTIONAL { ?s wdt:P495 ?orig. OPTIONAL { ?orig wdt:P625 ?coord. }
            ?orig rdfs:label ?regionLabel. FILTER(LANG(?regionLabel) = "en") }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/**
 * Dances are modelled as subclasses of dance (Q11401) / folk dance (Q201022) in Wikidata, so
 * this queries subclasses rather than instances. Music genres are also (mis-)filed under dance
 * (rap, trap, crunk, …), so exclude anything that is/subclasses a music genre (Q188451).
 */
function danceSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?coord ?regionLabel ?desc WHERE {
  { ?s wdt:P279 wd:Q11401. } UNION { ?s wdt:P279 wd:Q201022. }
  ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  FILTER NOT EXISTS { ?s wdt:P279* wd:Q188451 }
  FILTER NOT EXISTS { ?s wdt:P31 wd:Q188451 }
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P495 ?orig. OPTIONAL { ?orig wdt:P625 ?coord. }
            ?orig rdfs:label ?regionLabel. FILTER(LANG(?regionLabel) = "en") }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

function literarySparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?inc ?end ?regionLabel ?desc WHERE {
  ?s wdt:P31 wd:Q2198855. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P571 ?inc. }
  OPTIONAL { ?s wdt:P576 ?end. }
  OPTIONAL { ?s wdt:P495 ?orig. ?orig rdfs:label ?regionLabel. FILTER(LANG(?regionLabel) = "en") }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/** Strip a trailing class word ("Latin script"→"Latin", "Gothic architecture"→"Gothic"). */
function stripSuffix(label: string, re: RegExp): string {
  return label.trim().replace(re, "").trim();
}

const DOMAINS: readonly DomainConfig[] = [
  {
    key: "writing-systems",
    wikidataClass: "Q8192",
    targetLexicon: "writing-systems.tsv",
    outFile: path.join(DATA_DIR, "writing-systems-additions.tsv"),
    columns: [
      "id",
      "name",
      "type",
      "direction",
      "parent_system_id",
      "language_ids",
      "origin_date",
      "origin_region",
      "character_count",
      "sample_characters",
      "unicode_block",
      "is_active",
    ],
    nameSiblings: ["writing-systems.tsv"],
    slugFallback: "script",
    defaultMinSitelinks: 5,
    defaultLimit: 55,
    sparql: writingSystemSparql,
    nameTransform: (l) =>
      stripSuffix(l, /\s+(script|alphabet|writing system|syllabary|abjad|abugida)$/i),
    buildCells: (m) => ({
      type: "",
      direction: "",
      parent_system_id: "",
      language_ids: "",
      origin_date: m.inception,
      origin_region: m.region,
      character_count: "",
      sample_characters: "",
      unicode_block: "",
      is_active: "",
    }),
  },
  {
    key: "deities",
    wikidataClass: "Q178885",
    targetLexicon: "deities.tsv",
    outFile: path.join(DATA_DIR, "deities-additions.tsv"),
    columns: [
      "id",
      "name",
      "native_name",
      "pantheon",
      "domain",
      "gender",
      "syncretism_links",
      "associated_religion_ids",
      "associated_language_ids",
      "time_origin",
      "time_end",
      "coordinates",
      "description",
    ],
    nameSiblings: ["deities.tsv"],
    slugFallback: "deity",
    defaultMinSitelinks: 5,
    defaultLimit: 130,
    sparql: deitySparql,
    nameTransform: (l) => l.trim(),
    edgeColumn: "syncretism_links",
    buildCells: (m) => ({
      native_name: "",
      pantheon: "",
      domain: "",
      gender: m.gender,
      syncretism_links: "",
      associated_religion_ids: "",
      associated_language_ids: "",
      time_origin: "",
      time_end: "",
      coordinates: m.coord,
      description: m.description !== "" ? m.description : "Deity recorded in Wikidata.",
    }),
  },
  {
    key: "architectural-styles",
    wikidataClass: "Q32880",
    targetLexicon: "architectural-styles.tsv",
    outFile: path.join(DATA_DIR, "architectural-styles-additions.tsv"),
    columns: [
      "id",
      "name",
      "style_period",
      "origin_date",
      "end_date",
      "origin_coordinates",
      "region",
      "description",
      "associated_civilizations",
      "associated_languages",
      "key_features",
      "notable_examples",
      "building_types",
    ],
    // architectural-styles, art-traditions, dance-traditions, music-traditions are all `art-tradition`.
    nameSiblings: [
      "architectural-styles.tsv",
      "art-traditions.tsv",
      "dance-traditions.tsv",
      "music-traditions.tsv",
    ],
    slugFallback: "style",
    defaultMinSitelinks: 6,
    defaultLimit: 70,
    sparql: architecturalStyleSparql,
    nameTransform: (l) => stripSuffix(l, /\s+architecture$/i),
    buildCells: (m) => ({
      style_period: "",
      origin_date: m.inception,
      end_date: "",
      origin_coordinates: m.coord,
      region: m.region,
      description:
        m.description !== "" ? m.description : "Architectural style recorded in Wikidata.",
      associated_civilizations: "",
      associated_languages: "",
      key_features: "",
      notable_examples: "",
      building_types: "",
    }),
  },
  {
    key: "dance-traditions",
    wikidataClass: "Q11401/Q201022",
    targetLexicon: "dance-traditions.tsv",
    outFile: path.join(DATA_DIR, "dance-traditions-additions.tsv"),
    columns: [
      "id",
      "name",
      "native_name",
      "region",
      "coordinates",
      "time_origin",
      "time_end",
      "associated_language_ids",
      "dance_type",
      "associated_music_tradition_ids",
      "costumes",
      "key_movements",
      "cultural_significance",
      "description",
    ],
    nameSiblings: [
      "architectural-styles.tsv",
      "art-traditions.tsv",
      "dance-traditions.tsv",
      "music-traditions.tsv",
    ],
    slugFallback: "dance",
    defaultMinSitelinks: 3,
    defaultLimit: 60,
    sparql: danceSparql,
    nameTransform: (l) => l.trim(),
    buildCells: (m) => ({
      native_name: "",
      region: m.region,
      coordinates: m.coord,
      time_origin: "",
      time_end: "",
      associated_language_ids: "",
      dance_type: "folk",
      associated_music_tradition_ids: "",
      costumes: "",
      key_movements: "",
      cultural_significance: "",
      description:
        m.description !== "" ? m.description : "Folk dance tradition recorded in Wikidata.",
    }),
  },
  {
    key: "literary-traditions",
    wikidataClass: "Q2198855",
    targetLexicon: "literary-traditions.tsv",
    outFile: path.join(DATA_DIR, "literary-traditions-additions.tsv"),
    columns: [
      "id",
      "name",
      "region",
      "origin_date",
      "end_date",
      "origin_coordinates",
      "associated_language_ids",
      "genre_focus",
      "key_themes",
      "description",
      "notable_authors",
      "influences",
    ],
    nameSiblings: ["literary-traditions.tsv"],
    slugFallback: "movement",
    defaultMinSitelinks: 5,
    defaultLimit: 50,
    sparql: literarySparql,
    nameTransform: (l) => l.trim(),
    buildCells: (m) => ({
      region: m.region,
      origin_date: m.inception,
      end_date: m.endYear,
      origin_coordinates: "",
      associated_language_ids: "",
      genre_focus: "",
      key_themes: "",
      description:
        m.description !== "" ? m.description : "Literary movement recorded in Wikidata.",
      notable_authors: "",
      influences: "",
    }),
  },
];

/** QID from a Wikidata entity URI, or "" for a non-entity value. */
function qidOf(uri: string): string {
  const q = uri.split("/").pop() ?? "";
  return /^Q\d+$/.test(q) ? q : "";
}

/** Collapse the raw bindings into one MergedItem per QID (first non-blank; rels accumulated). */
function mergeBindings(bindings: readonly Binding[]): MergedItem[] {
  const byQid = new Map<string, MergedItem>();
  for (const b of bindings) {
    const qid = qidOf(b.s.value);
    if (qid === "") continue;
    const coord = parseCoordinates(b.coord?.value);
    const region = cleanText(b.regionLabel?.value);
    const inception = toYear(b.inc?.value);
    const endYear = toYear(b.end?.value);
    const gender = cleanText(b.gender?.value);
    const description = cleanText(b.desc?.value);
    const relQid = b.rel !== undefined ? qidOf(b.rel.value) : "";
    let existing = byQid.get(qid);
    if (existing === undefined) {
      existing = {
        qid,
        label: b.label.value,
        sitelinks: Number(b.sl.value) || 0,
        coord: "",
        region: "",
        inception: "",
        endYear: "",
        gender: "",
        description: "",
        rels: [],
      };
      byQid.set(qid, existing);
    }
    if (existing.coord === "" && coord !== "") existing.coord = coord;
    if (existing.region === "" && region !== "") existing.region = region;
    if (existing.inception === "" && inception !== "") existing.inception = inception;
    if (existing.endYear === "" && endYear !== "") existing.endYear = endYear;
    if (existing.gender === "" && gender !== "") existing.gender = gender;
    if (existing.description === "" && description !== "") existing.description = description;
    if (relQid !== "" && !existing.rels.includes(relQid)) existing.rels.push(relQid);
  }
  return [...byQid.values()].sort((a, b) => b.sitelinks - a.sitelinks);
}

interface CurateStats {
  candidates: number;
  droppedLabel: number;
  droppedDup: number;
  emitted: number;
  edges: number;
}

function curate(
  domain: DomainConfig,
  merged: readonly MergedItem[],
  limit: number,
  retrievedAt: string,
  /**
   * Corpus-wide used-id set, SHARED across every domain in the run (seeded once from all node
   * lexicons; each domain mutates it as it mints ids). Sharing is essential: several domains are
   * acquired in one run before ANY write-back, so re-reading the lexicons per domain can't see a
   * sibling domain's just-minted ids — two domains would then mint the same generic id (e.g.
   * "romanticism" as both an art-tradition and a literary-tradition, "oduduwa" as both a
   * writing-system and a deity) and regress the export's global `ambiguousPinakesIds` ratchet.
   */
  usedIds: Set<string>,
): { rows: CuratedRow[]; stats: CurateStats } {
  // Names dedup within the same node type (ids dedup across the whole corpus via `usedIds`).
  const existingNames = new Set<string>();
  for (const sib of domain.nameSiblings) {
    for (const nm of readIdsAndNames(sib).names) existingNames.add(normaliseName(nm));
  }
  // Attribute-only targets aren't node files; seed the target's own ids too (all five here are
  // node files, but this keeps the pattern identical to acquire-food-drink.ts).
  for (const id of readIdsAndNames(domain.targetLexicon).ids) usedIds.add(id);

  const stats: CurateStats = {
    candidates: merged.length,
    droppedLabel: 0,
    droppedDup: 0,
    emitted: 0,
    edges: 0,
  };
  const usedQids = new Set<string>();
  const rows: CuratedRow[] = [];
  const qidToId = new Map<string, string>();
  const rowRels = new Map<string, string[]>(); // minted id → source rels (QIDs)

  for (const m of merged) {
    if (rows.length >= limit) break;
    if (!isRealLabel(m.label)) {
      stats.droppedLabel++;
      continue;
    }
    const displayName = domain.nameTransform(m.label);
    if (
      displayName === "" ||
      existingNames.has(normaliseName(displayName)) ||
      usedQids.has(m.qid)
    ) {
      stats.droppedDup++;
      continue;
    }
    usedQids.add(m.qid);
    existingNames.add(normaliseName(displayName)); // guard against in-batch name collisions.
    // Mint a corpus-unique id: bare slug → `-<fallback>` suffix → `-<qid>` last resort.
    let id = slugify(displayName, domain.slugFallback);
    if (usedIds.has(id)) id = `${id}-${domain.slugFallback}`;
    if (usedIds.has(id)) id = `${slugify(displayName, domain.slugFallback)}-${m.qid.toLowerCase()}`;
    usedIds.add(id);
    qidToId.set(m.qid, id);
    if (domain.edgeColumn !== undefined) rowRels.set(id, m.rels);

    rows.push({
      ...domain.buildCells(m),
      id,
      name: displayName,
      wikidata_qid: m.qid,
      source_url: `http://www.wikidata.org/entity/${m.qid}`,
      retrieved_at: retrievedAt,
      confidence: ACQUIRED_CONFIDENCE,
      sources: SOURCES,
    });
  }

  // Post-mint pass: resolve edge endpoints (P460) to in-batch ids only, so every edge lands.
  if (domain.edgeColumn !== undefined) {
    for (const row of rows) {
      const rels = rowRels.get(row.id) ?? [];
      const targets = rels
        .map((q) => qidToId.get(q))
        .filter((t): t is string => t !== undefined && t !== row.id);
      const unique = [...new Set(targets)];
      if (unique.length > 0) {
        row[domain.edgeColumn] = JSON.stringify(unique);
        stats.edges += unique.length;
      }
    }
  }

  stats.emitted = rows.length;
  return { rows, stats };
}

function serialize(domain: DomainConfig, rows: readonly CuratedRow[]): string {
  const header = [...domain.columns, ...PROVENANCE_COLUMNS];
  const lines = [header.join("\t")];
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of sorted) {
    lines.push(header.map((h) => r[h] ?? "").join("\t"));
  }
  return lines.join("\n") + "\n";
}

function numArg(argv: string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = (() => {
    const i = argv.indexOf("--domain");
    return i >= 0 ? argv[i + 1] : undefined;
  })();
  const retrievedAt = new Date().toISOString();

  // One shared used-id set for the whole run (seeded from every node lexicon), so sibling domains
  // never mint the same id — the fix for the cross-domain `ambiguousPinakesIds` collisions.
  const usedIds = new Set<string>();
  for (const file of nodeLexiconFiles()) {
    for (const id of readIdsAndNames(file).ids) usedIds.add(id);
  }

  for (const domain of DOMAINS) {
    if (only !== undefined && only !== domain.key) continue;
    const minSitelinks = numArg(argv, "--min-sitelinks", domain.defaultMinSitelinks);
    const limit = numArg(argv, "--limit", domain.defaultLimit);

    // eslint-disable-next-line no-console
    console.log(
      `[${domain.key}] querying Wikidata (${domain.wikidataClass}, >= ${minSitelinks} sitelinks)…`,
    );
    const bindings = await runQuery(domain.sparql(minSitelinks));
    const merged = mergeBindings(bindings);
    const { rows, stats } = curate(domain, merged, limit, retrievedAt, usedIds);

    fs.mkdirSync(path.dirname(domain.outFile), { recursive: true });
    fs.writeFileSync(domain.outFile, serialize(domain, rows));

    // eslint-disable-next-line no-console
    console.log(
      `[${domain.key}] ${stats.candidates} candidates; dropped ${stats.droppedLabel} QID-named, ` +
        `${stats.droppedDup} duplicate; emitted ${stats.emitted} curated rows` +
        (domain.edgeColumn !== undefined ? ` (${stats.edges} ${domain.edgeColumn} edges)` : "") +
        ` → ${path.relative(REPO_ROOT, domain.outFile)}`,
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
