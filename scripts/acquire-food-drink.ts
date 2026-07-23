/**
 * Acquire cuisines, ingredient-origins and cooking-techniques from Wikidata (SPARQL) and
 * curate them into committed additions TSVs for write-back (US-004, data-population at scale).
 *
 * This is the one networked step of the per-domain runbook (docs/data-population-runbook.md,
 * steps 3–5) for the food-drink blueprint: acquire → reconcile/dedup → curate. The committed
 * outputs (`scripts/data/{cuisines,ingredient-origins,cooking-techniques}-additions.tsv`) are
 * the network-free source of truth the write-back + QA gate operate on, so CI never touches
 * Wikidata.
 *
 * Three sibling domains, one script (they share the food-drink blueprint + the same acquire
 * machinery — see core/blueprints/food-drink.yml):
 *  - cuisines            (node `cuisine`)     ← Wikidata Q1968435 "national cuisine".
 *  - ingredient-origins  (node `ingredient`)  ← Wikidata Q25403900 "food ingredient".
 *  - cooking-techniques  (attribute)          ← Wikidata Q1039303  "cooking technique".
 *
 * Curation rules (runbook step 5):
 *  - Notability floor: only items with `>= MIN_SITELINKS` Wikipedia sitelinks (drops the
 *    obscure long tail the broad class drags in). Ranked by sitelinks so the cap keeps the
 *    most significant items.
 *  - Coordinates are OPTIONAL for all three (a cuisine/ingredient/technique is not a point):
 *    derived from the cuisine's country (P17) or the ingredient's country-of-origin (P495)
 *    when present, else blank. Blank is fine; `coordinates` is a property column.
 *  - Drop QID-named / empty labels, and anything whose normalised name already exists in the
 *    curated lexicon (dedup against the same node type — never a duplicate). Ids are deduped
 *    across the WHOLE corpus (the export's `ambiguousPinakesIds` diagnostic keys on the
 *    raw id across every node type), so a generic id gets a domain suffix on collision.
 *  - Every emitted row carries full provenance: `wikidata_qid`, `source_url`, `retrieved_at`,
 *    `confidence`, `sources` (Guiding Principle #8).
 *
 * Run:  npx tsx scripts/acquire-food-drink.ts [--domain cuisines|ingredients|techniques]
 *                                            [--limit N] [--min-sitelinks N]
 * (no --domain ⇒ all three; each domain has its own default limit / sitelink floor).
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "pinakes/1.0 (https://github.com/; data-population; dldekerl@gmail.com)";

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
  origLabel?: { value: string };
  inc?: { value: string };
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

/** Collapse a Wikidata description to a single clean TSV cell. */
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

/** One curated food-domain row. Only the columns a given domain declares are emitted. */
type CuratedRow = Record<string, string>;

interface DomainConfig {
  key: string;
  /** Wikidata class Q-number instantiated by the domain's items. */
  wikidataClass: string;
  targetLexicon: string;
  outFile: string;
  /** Ordered columns emitted to the additions TSV (core provenance appended automatically). */
  columns: readonly string[];
  /** Lexicon files whose `name`s reconcile with this domain (same node type). */
  nameSiblings: readonly string[];
  /** Fallback slug when a name reduces to nothing. */
  slugFallback: string;
  defaultMinSitelinks: number;
  defaultLimit: number;
  /** True when the class carries a country (P17) or country-of-origin (P495) for coordinates. */
  sparql: (minSitelinks: number) => string;
  /** Map one merged binding → the domain's non-provenance cells (id is minted by the caller). */
  buildCells: (m: MergedItem) => CuratedRow;
}

/** A per-QID collapsed item (first non-blank of each optional field). */
interface MergedItem {
  qid: string;
  label: string;
  sitelinks: number;
  coord: string;
  origin: string;
  inception: string;
  description: string;
}

/** Core provenance columns appended to every domain's additions header, in write-back order. */
const PROVENANCE_COLUMNS = [
  "wikidata_qid",
  "source_url",
  "retrieved_at",
  "confidence",
  "sources",
] as const;

function cuisineSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?coord ?inc ?desc WHERE {
  ?s wdt:P31 wd:Q1968435. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P17 ?country. ?country wdt:P625 ?coord. }
  OPTIONAL { ?s wdt:P571 ?inc. }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

function ingredientSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?coord ?origLabel ?desc WHERE {
  ?s wdt:P31 wd:Q25403900. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P495 ?orig. OPTIONAL { ?orig wdt:P625 ?coord. }
            ?orig rdfs:label ?origLabel. FILTER(LANG(?origLabel) = "en") }
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

function techniqueSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?desc WHERE {
  ?s wdt:P31 wd:Q1039303. ?s wikibase:sitelinks ?sl. FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/** Strip a trailing " cuisine" / leading "cuisine of the" so names match the seed lexicon. */
function cuisineName(label: string): string {
  const ofMatch = /^cuisine of (?:the )?(.+)$/i.exec(label.trim());
  const base = ofMatch !== null ? ofMatch[1] : label;
  return base.replace(/\s+cuisine$/i, "").trim();
}

const DOMAINS: readonly DomainConfig[] = [
  {
    key: "cuisines",
    wikidataClass: "Q1968435",
    targetLexicon: "cuisines.tsv",
    outFile: path.join(DATA_DIR, "cuisines-additions.tsv"),
    columns: [
      "id",
      "name",
      "native_name",
      "region",
      "coordinates",
      "associated_language_ids",
      "time_origin",
      "time_end",
      "description",
    ],
    nameSiblings: ["cuisines.tsv"],
    slugFallback: "cuisine",
    defaultMinSitelinks: 5,
    defaultLimit: 80,
    sparql: cuisineSparql,
    buildCells: (m) => ({
      name: cuisineName(m.label),
      native_name: "",
      region: "",
      coordinates: m.coord,
      associated_language_ids: "",
      time_origin: m.inception,
      time_end: "",
      description:
        m.description !== ""
          ? m.description
          : "National culinary tradition recorded in Wikidata.",
    }),
  },
  {
    key: "ingredients",
    wikidataClass: "Q25403900",
    targetLexicon: "ingredient-origins.tsv",
    outFile: path.join(DATA_DIR, "ingredient-origins-additions.tsv"),
    columns: [
      "id",
      "name",
      "cuisine_id",
      "origin_region",
      "coordinates",
      "time_origin",
      "time_end",
      "native_name",
      "description",
    ],
    // ingredient-origins and cuisine-items are both the canonical `ingredient` node type.
    nameSiblings: ["ingredient-origins.tsv", "cuisine-items.tsv"],
    slugFallback: "ingredient",
    defaultMinSitelinks: 4,
    defaultLimit: 70,
    sparql: ingredientSparql,
    buildCells: (m) => ({
      name: m.label.trim(),
      cuisine_id: "",
      origin_region: m.origin,
      coordinates: m.coord,
      time_origin: "",
      time_end: "",
      native_name: "",
      description:
        m.description !== "" ? m.description : "Food ingredient recorded in Wikidata.",
    }),
  },
  {
    key: "techniques",
    wikidataClass: "Q1039303",
    targetLexicon: "cooking-techniques.tsv",
    outFile: path.join(DATA_DIR, "cooking-techniques-additions.tsv"),
    columns: [
      "id",
      "name",
      "cuisine_id",
      "category",
      "coordinates",
      "time_origin",
      "time_end",
      "description",
    ],
    nameSiblings: ["cooking-techniques.tsv"],
    slugFallback: "technique",
    defaultMinSitelinks: 3,
    defaultLimit: 50,
    sparql: techniqueSparql,
    buildCells: (m) => ({
      name: m.label.trim(),
      cuisine_id: "",
      category: "",
      coordinates: "",
      time_origin: "",
      time_end: "",
      description:
        m.description !== "" ? m.description : "Cooking technique recorded in Wikidata.",
    }),
  },
];

/** QID from a Wikidata entity URI, or "" for a non-entity value. */
function qidOf(uri: string): string {
  const q = uri.split("/").pop() ?? "";
  return /^Q\d+$/.test(q) ? q : "";
}

/** Collapse the raw bindings into one MergedItem per QID (first non-blank of each optional). */
function mergeBindings(bindings: readonly Binding[]): MergedItem[] {
  const byQid = new Map<string, MergedItem>();
  for (const b of bindings) {
    const qid = qidOf(b.s.value);
    if (qid === "") continue;
    const existing = byQid.get(qid);
    const coord = parseCoordinates(b.coord?.value);
    const origin = cleanText(b.origLabel?.value);
    const inception = toYear(b.inc?.value);
    const description = cleanText(b.desc?.value);
    if (existing === undefined) {
      byQid.set(qid, {
        qid,
        label: b.label.value,
        sitelinks: Number(b.sl.value) || 0,
        coord,
        origin,
        inception,
        description,
      });
      continue;
    }
    if (existing.coord === "" && coord !== "") existing.coord = coord;
    if (existing.origin === "" && origin !== "") existing.origin = origin;
    if (existing.inception === "" && inception !== "") existing.inception = inception;
    if (existing.description === "" && description !== "") existing.description = description;
  }
  return [...byQid.values()].sort((a, b) => b.sitelinks - a.sitelinks);
}

interface CurateStats {
  candidates: number;
  droppedLabel: number;
  droppedDup: number;
  emitted: number;
}

function curate(
  domain: DomainConfig,
  merged: readonly MergedItem[],
  limit: number,
  retrievedAt: string,
): { rows: CuratedRow[]; stats: CurateStats } {
  // Names dedup within the same node type; ids dedup across the WHOLE corpus (every node file).
  const existingNames = new Set<string>();
  for (const sib of domain.nameSiblings) {
    for (const nm of readIdsAndNames(sib).names) existingNames.add(normaliseName(nm));
  }
  const usedIds = new Set<string>();
  for (const file of nodeLexiconFiles()) {
    for (const id of readIdsAndNames(file).ids) usedIds.add(id);
  }
  // Attribute targets (e.g. cooking-techniques) aren't node files, so seed the target's own
  // ids too — keeps appended ids unique within the file even when it isn't in the node set.
  for (const id of readIdsAndNames(domain.targetLexicon).ids) usedIds.add(id);

  const stats: CurateStats = {
    candidates: merged.length,
    droppedLabel: 0,
    droppedDup: 0,
    emitted: 0,
  };
  const usedQids = new Set<string>();
  const rows: CuratedRow[] = [];

  for (const m of merged) {
    if (rows.length >= limit) break;
    if (!isRealLabel(m.label)) {
      stats.droppedLabel++;
      continue;
    }
    const cells = domain.buildCells(m);
    const displayName = cells.name;
    if (displayName === "" || existingNames.has(normaliseName(displayName)) || usedQids.has(m.qid)) {
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

    rows.push({
      ...cells,
      id,
      wikidata_qid: m.qid,
      source_url: `http://www.wikidata.org/entity/${m.qid}`,
      retrieved_at: retrievedAt,
      confidence: ACQUIRED_CONFIDENCE,
      sources: SOURCES,
    });
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
    const { rows, stats } = curate(domain, merged, limit, retrievedAt);

    fs.mkdirSync(path.dirname(domain.outFile), { recursive: true });
    fs.writeFileSync(domain.outFile, serialize(domain, rows));

    // eslint-disable-next-line no-console
    console.log(
      `[${domain.key}] ${stats.candidates} candidates; dropped ${stats.droppedLabel} QID-named, ` +
        `${stats.droppedDup} duplicate; emitted ${stats.emitted} curated rows → ` +
        `${path.relative(REPO_ROOT, domain.outFile)}`,
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
