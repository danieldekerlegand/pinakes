/**
 * Acquire notable archaeological cultures from Wikidata (SPARQL) and curate them into a
 * committed additions TSV for write-back into `lexicons/archaeological-cultures.tsv`
 * (US-003, data-population at scale).
 *
 * This is the one networked step of the per-domain runbook
 * (docs/data-population-runbook.md, steps 3–5): acquire → reconcile/dedup → curate. The
 * committed output (`scripts/data/archaeological-cultures-additions.tsv`) is the
 * network-free source of truth the write-back + QA gate operate on, so CI never touches
 * Wikidata.
 *
 * Curation rules (runbook step 5):
 *  - Notability floor: only cultures with `>= MIN_SITELINKS` Wikipedia sitelinks (drops the
 *    long tail of obscure/QID-named findspots the broad class drags in).
 *  - Coordinates are OPTIONAL — unlike sites, an archaeological culture is a *region*, so
 *    most Wikidata items carry none (only ~10% do). Blank is fine; it is a property.
 *  - Drop QID-named / empty labels, and anything whose normalised name already exists in the
 *    curated lexicon (dedup against the existing 27 — never a duplicate).
 *  - Predecessor / successor (Wikidata P155 "follows" / P156 "followed by") are resolved to
 *    the *minted ids of other acquired cultures in the same batch* — only in-corpus targets
 *    are written, so every emitted `descended-from` / `absorbed-into` edge lands on a real
 *    node (the QA gate's `edgesWithUnresolvedEndpoint` ratchet never regresses).
 *  - Every emitted row carries full provenance: `wikidata_qid`, `source_url`,
 *    `retrieved_at`, `confidence`, `sources` (Guiding Principle #8).
 *
 * Run:  npx tsx scripts/acquire-archaeological-cultures.ts [--limit N] [--min-sitelinks N]
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const TARGET_LEXICON = path.join(LEXICONS_DIR, "archaeological-cultures.tsv");
const OUT_FILE = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "archaeological-cultures-additions.tsv",
);

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Pinakes/1.0 (https://github.com/; data-population; dldekerl@gmail.com)";

/** Wikidata class Q465299 = "archaeological culture". */
const CULTURE_CLASS = "Q465299";

/** Notability floor — number of Wikipedia sitelinks a culture must have to be curated in. */
const DEFAULT_MIN_SITELINKS = 4;

/** Cap on how many curated-new rows to emit (highest-sitelink first). */
const DEFAULT_LIMIT = 250;

/** Confidence for Wikidata-acquired rows, on the lexicon's 0–100 scale (export → 0.8). */
// `unreferenced-wikidata` (0.8) on the lexicon's 0–100 scale — a bulk WDQS class-membership
// pull taken as-is; confidence comes from the rubric, not a literal (US-001).
const ACQUIRED_CONFIDENCE = confidenceCellForClass("unreferenced-wikidata", {
  scale: 100,
});

/** One raw binding from the base attribute query. */
interface BaseBinding {
  s: { value: string };
  label: { value: string };
  sl: { value: string };
  coord?: { value: string };
  inception?: { value: string };
  dissolution?: { value: string };
}

/** One raw binding from the predecessor/successor relationship query. */
interface RelBinding {
  s: { value: string };
  follows?: { value: string };
  followedby?: { value: string };
}

/** One curated culture row destined for the additions TSV. */
interface CuratedCulture {
  id: string;
  name: string;
  region: string;
  coordinates: string;
  time_period_start: string;
  time_period_end: string;
  time_period_label: string;
  predecessor_culture_ids: string;
  successor_culture_ids: string;
  description: string;
  confidence: string;
  sources: string;
  wikidata_qid: string;
  source_url: string;
  retrieved_at: string;
}

/** Columns emitted to the additions TSV, in order. */
const ADDITIONS_HEADER: readonly (keyof CuratedCulture)[] = [
  "id",
  "name",
  "region",
  "coordinates",
  "time_period_start",
  "time_period_end",
  "time_period_label",
  "predecessor_culture_ids",
  "successor_culture_ids",
  "description",
  "confidence",
  "sources",
  "wikidata_qid",
  "source_url",
  "retrieved_at",
];

function baseSparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl (SAMPLE(?coordV) AS ?coord) (MIN(?incV) AS ?inception) (MIN(?disV) AS ?dissolution) WHERE {
  ?s wdt:P31 wd:${CULTURE_CLASS}. ?s wikibase:sitelinks ?sl.
  FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P625 ?coordV. }
  OPTIONAL { ?s wdt:P571 ?incV. }
  OPTIONAL { ?s wdt:P576 ?disV. }
} GROUP BY ?s ?label ?sl`;
}

function relSparql(minSitelinks: number): string {
  return `SELECT ?s ?follows ?followedby WHERE {
  ?s wdt:P31 wd:${CULTURE_CLASS}. ?s wikibase:sitelinks ?sl.
  FILTER(?sl >= ${minSitelinks})
  { ?s wdt:P155 ?follows } UNION { ?s wdt:P156 ?followedby }
}`;
}

async function runQuery<T>(query: string): Promise<T[]> {
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
        const json = JSON.parse(text) as { results: { bindings: T[] } };
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

/** `Point(lng lat)` → `{"lat":..,"lng":..}` (the lexicon's coordinate cell shape). */
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

/** Human-readable era label from a signed year, e.g. -5500 → "from 5500 BCE". */
function periodLabel(start: string, end: string): string {
  const era = (y: string): string => {
    const n = Number(y);
    return n < 0 ? `${-n} BCE` : `${n} CE`;
  };
  if (start !== "" && end !== "") return `${era(start)}–${era(end)}`;
  if (start !== "") return `from ${era(start)}`;
  if (end !== "") return `until ${era(end)}`;
  return "";
}

/** Reject QID-named or empty labels; keep genuine culture names. */
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

/** A URL/id-safe slug from a culture name. */
function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "culture"
  );
}

/** Every lexicon file that maps to a canonical node type (for global id dedup). */
function nodeLexiconFiles(): string[] {
  const mapping = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "shared", "lexicon-mapping.json"), "utf8"),
  ) as { files: { file: string; kind: string }[] };
  return mapping.files.filter((f) => f.kind === "node").map((f) => f.file);
}

/**
 * Existing archaeological-culture names (normalised) + **all node-type ids** for dedup.
 *
 * Names are deduped per-type (a `culture` named "Sumer" may coexist with a `civilization`
 * of the same name — reconciliation keys on `(name, type, region)`), but ids must be unique
 * across the **whole corpus**: the export's `ambiguousPinakesIds` diagnostic keys on the
 * raw `pinakes_id` across every node type, so a new culture id colliding with a
 * civilization/place id of the same string is a regression the QA gate blocks. We therefore
 * seed the used-id set from every node lexicon and suffix any collision.
 */
function loadExisting(): { names: Set<string>; ids: Set<string> } {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const file of nodeLexiconFiles()) {
    const abs = path.join(LEXICONS_DIR, file);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const headers = lines[0].split("\t");
    const nameIdx = headers.indexOf("name");
    const idIdx = headers.indexOf("id");
    const isTarget = file === "archaeological-cultures.tsv";
    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      const id = (cells[idIdx] ?? "").trim();
      if (id !== "") ids.add(id);
      if (!isTarget) continue; // names dedup only within the same node type
      const nm = (cells[nameIdx] ?? "").trim();
      if (nm !== "") names.add(normaliseName(nm));
    }
  }
  return { names, ids };
}

/** QID from a Wikidata entity URI, or "" for a non-entity value. */
function qidOf(uri: string | undefined): string {
  if (uri === undefined) return "";
  const q = uri.split("/").pop() ?? "";
  return /^Q\d+$/.test(q) ? q : "";
}

/** Collapse the relationship query into `qid → { follows, followedby }` QID sets. */
function indexRelations(
  bindings: readonly RelBinding[],
): Map<string, { follows: Set<string>; followedby: Set<string> }> {
  const rels = new Map<string, { follows: Set<string>; followedby: Set<string> }>();
  for (const b of bindings) {
    const qid = qidOf(b.s.value);
    if (qid === "") continue;
    const entry = rels.get(qid) ?? { follows: new Set(), followedby: new Set() };
    const f = qidOf(b.follows?.value);
    const fb = qidOf(b.followedby?.value);
    if (f !== "") entry.follows.add(f);
    if (fb !== "") entry.followedby.add(fb);
    rels.set(qid, entry);
  }
  return rels;
}

function curate(
  base: readonly BaseBinding[],
  rels: Map<string, { follows: Set<string>; followedby: Set<string> }>,
  limit: number,
  retrievedAt: string,
): { rows: CuratedCulture[]; stats: Record<string, number> } {
  const { names: existingNames, ids: existingIds } = loadExisting();

  // Collapse the base bindings per QID (GROUP BY already made them unique) and rank by
  // notability so the curated cap keeps the most significant cultures.
  const merged = base
    .map((b) => ({
      qid: qidOf(b.s.value),
      label: b.label.value,
      sitelinks: Number(b.sl.value) || 0,
      coord: parseCoordinates(b.coord?.value),
      start: toYear(b.inception?.value),
      end: toYear(b.dissolution?.value),
    }))
    .filter((m) => m.qid !== "")
    .sort((a, b) => b.sitelinks - a.sitelinks);

  const stats = { candidates: merged.length, droppedLabel: 0, droppedDup: 0, edges: 0 };
  const usedIds = new Set(existingIds);
  const usedQids = new Set<string>();
  const rows: CuratedCulture[] = [];
  const idByQid = new Map<string, string>();

  // First pass — select + mint ids (so predecessor/successor can resolve within the batch).
  const selected: (typeof merged[number] & { id: string })[] = [];
  for (const m of merged) {
    if (selected.length >= limit) break;
    if (!isRealLabel(m.label)) {
      stats.droppedLabel++;
      continue;
    }
    if (existingNames.has(normaliseName(m.label)) || usedQids.has(m.qid)) {
      stats.droppedDup++;
      continue;
    }
    usedQids.add(m.qid);
    // Mint a corpus-unique id: prefer the bare slug, then a readable `-culture` suffix
    // (a culture named like an existing civilization/place), then the QID as a last resort.
    let id = slugify(m.label);
    if (usedIds.has(id)) id = `${id}-culture`;
    if (usedIds.has(id)) id = `${slugify(m.label)}-${m.qid.toLowerCase()}`;
    usedIds.add(id);
    idByQid.set(m.qid, id);
    selected.push({ ...m, id });
  }

  // Second pass — build rows, resolving predecessor/successor to in-batch minted ids only.
  const resolveIds = (qids: Set<string> | undefined): string[] => {
    if (qids === undefined) return [];
    const out: string[] = [];
    for (const q of qids) {
      const id = idByQid.get(q);
      if (id !== undefined) out.push(id);
    }
    return out;
  };

  for (const m of selected) {
    const rel = rels.get(m.qid);
    const predecessors = resolveIds(rel?.follows).filter((id) => id !== m.id);
    const successors = resolveIds(rel?.followedby).filter((id) => id !== m.id);
    stats.edges += predecessors.length + successors.length;

    rows.push({
      id: m.id,
      name: m.label,
      region: "",
      coordinates: m.coord,
      time_period_start: m.start,
      time_period_end: m.end,
      time_period_label: periodLabel(m.start, m.end),
      predecessor_culture_ids: predecessors.length ? JSON.stringify(predecessors) : "",
      successor_culture_ids: successors.length ? JSON.stringify(successors) : "",
      description: "Archaeological culture recorded in Wikidata.",
      confidence: ACQUIRED_CONFIDENCE,
      sources: '["Wikidata"]',
      wikidata_qid: m.qid,
      source_url: `http://www.wikidata.org/entity/${m.qid}`,
      retrieved_at: retrievedAt,
    });
  }
  return { rows, stats };
}

function serialize(rows: readonly CuratedCulture[]): string {
  const lines = [ADDITIONS_HEADER.join("\t")];
  // Deterministic order: by id (retrieved_at is the only wall-clock cell).
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of sorted) {
    lines.push(ADDITIONS_HEADER.map((h) => r[h]).join("\t"));
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) ? v : fallback;
  };
  const limit = arg("--limit", DEFAULT_LIMIT);
  const minSitelinks = arg("--min-sitelinks", DEFAULT_MIN_SITELINKS);

  // eslint-disable-next-line no-console
  console.log(`Querying Wikidata for archaeological cultures (>= ${minSitelinks} sitelinks)…`);
  const base = await runQuery<BaseBinding>(baseSparql(minSitelinks));
  const rel = await runQuery<RelBinding>(relSparql(minSitelinks));
  const rels = indexRelations(rel);
  const retrievedAt = new Date().toISOString();
  const { rows, stats } = curate(base, rels, limit, retrievedAt);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, serialize(rows));

  // eslint-disable-next-line no-console
  console.log(
    `Acquired ${base.length} cultures; dropped ${stats.droppedLabel} QID-named, ` +
      `${stats.droppedDup} duplicate; emitted ${rows.length} curated rows ` +
      `(${stats.edges} predecessor/successor edges resolved) → ${path.relative(REPO_ROOT, OUT_FILE)}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
