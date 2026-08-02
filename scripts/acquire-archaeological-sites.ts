/**
 * Acquire notable archaeological sites from Wikidata (SPARQL) and curate them into a
 * committed additions TSV for write-back into `lexicons/archaeological-sites.tsv` (US-002,
 * data-population at scale).
 *
 * This is the one networked step of the per-domain runbook
 * (docs/data-population-runbook.md, steps 3–5): acquire → reconcile/dedup → curate. The
 * committed output (`scripts/data/archaeological-sites-additions.tsv`) is the network-free
 * source of truth the write-back + QA gate operate on, so CI never touches Wikidata.
 *
 * Curation rules (runbook step 5):
 *  - Notability floor: only sites with `>= MIN_SITELINKS` Wikipedia sitelinks (drops the
 *    long tail of obscure/QID-named findspots the broad class drags in).
 *  - Coordinates required (this is a map dataset).
 *  - Drop QID-named / non-Latin-only labels, and anything whose normalised name already
 *    exists in the curated lexicon (dedup against the existing 151 — never a duplicate).
 *  - Every emitted row carries full provenance: `wikidata_qid`, `source_url`,
 *    `retrieved_at`, `confidence`, `sources` (Guiding Principle #8).
 *
 * Run:  npx tsx scripts/acquire-archaeological-sites.ts [--limit N] [--min-sitelinks N]
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const OUT_FILE = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "archaeological-sites-additions.tsv",
);

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "pinakes/1.0 (+https://github.com/danieldekerlegand/pinakes; data-population)";

/** Wikidata class Q839954 = "archaeological site". */
const SITE_CLASS = "Q839954";

/** Notability floor — number of Wikipedia sitelinks a site must have to be curated in. */
const DEFAULT_MIN_SITELINKS = 6;

/** Cap on how many curated-new rows to emit (highest-sitelink first). */
const DEFAULT_LIMIT = 400;

/** Confidence for Wikidata-acquired rows, on the lexicon's 0–100 scale (export → 0.9). */
// `referenced-wikidata` (0.9) on the lexicon's 0–100 scale — sites are filtered by a
// sitelinks notability floor, so the confidence comes from the rubric, not a literal (US-001).
const ACQUIRED_CONFIDENCE = confidenceCellForClass("referenced-wikidata", {
  scale: 100,
});

interface RawBinding {
  s: { value: string };
  label: { value: string };
  sl: { value: string };
  coord: { value: string };
  inception?: { value: string };
  country?: { value: string };
}

/** One curated site row destined for the additions TSV. */
interface CuratedSite {
  id: string;
  name: string;
  coordinates: string;
  site_type: string;
  time_period_start: string;
  time_period_end: string;
  time_period_label: string;
  description: string;
  confidence: string;
  sources: string;
  wikidata_qid: string;
  source_url: string;
  retrieved_at: string;
}

/** Columns emitted to the additions TSV, in order. */
const ADDITIONS_HEADER: readonly (keyof CuratedSite)[] = [
  "id",
  "name",
  "coordinates",
  "site_type",
  "time_period_start",
  "time_period_end",
  "time_period_label",
  "description",
  "confidence",
  "sources",
  "wikidata_qid",
  "source_url",
  "retrieved_at",
];

function sparql(minSitelinks: number): string {
  return `SELECT ?s ?label ?sl ?coord ?inception ?country WHERE {
  ?s wdt:P31 wd:${SITE_CLASS}. ?s wdt:P625 ?coord. ?s wikibase:sitelinks ?sl.
  FILTER(?sl >= ${minSitelinks})
  ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  OPTIONAL { ?s wdt:P571 ?inception. }
  OPTIONAL { ?s wdt:P17 ?c. ?c rdfs:label ?country. FILTER(LANG(?country) = "en") }
}`;
}

async function runQuery(minSitelinks: number): Promise<RawBinding[]> {
  const body = new URLSearchParams({ query: sparql(minSitelinks) });
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
        const json = JSON.parse(text) as { results: { bindings: RawBinding[] } };
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
function parseCoordinates(point: string): string | null {
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(point.trim());
  if (m === null) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return JSON.stringify({ lat, lng });
}

/** Wikidata inception literal (`-0386-01-01T…`, `+2020-…`) → signed year, or "". */
function inceptionYear(value: string | undefined): string {
  if (value === undefined) return "";
  const m = /^([+-]?)(\d{1,})-\d{2}-\d{2}T/.exec(value);
  if (m === null) return "";
  const year = Number(m[2]);
  if (!Number.isFinite(year) || year === 0) return "";
  return m[1] === "-" ? String(-year) : String(year);
}

/** Human-readable era label from a signed year, e.g. -386 → "Founded 386 BCE". */
function periodLabel(year: string): string {
  if (year === "") return "";
  const n = Number(year);
  return n < 0 ? `Founded ${-n} BCE` : `Founded ${n} CE`;
}

/** Reject QID-named or empty labels; keep genuine site names. */
function isRealLabel(label: string): boolean {
  const t = label.trim();
  if (t === "") return false;
  return !/^Q\d+$/.test(t);
}

/** Normalise a name for duplicate detection (matches import-from-engine). */
function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** A URL/id-safe slug from a site name. */
function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "site"
  );
}

/**
 * Every lexicon file that maps to the canonical `place` node type. New site ids/names must
 * be reconciled against *all* of these, not just archaeological-sites.tsv: the csid namespace
 * is `cs:place:<id>`, so reusing an id already used by a settlement/river would collapse two
 * distinct nodes into one on export (a duplicate-csid regression the QA gate blocks).
 */
function placeLexiconFiles(): string[] {
  const mapping = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "shared", "lexicon-mapping.json"), "utf8"),
  ) as { files: { file: string; kind: string; node: string | null }[] };
  return mapping.files
    .filter((f) => f.kind === "node" && f.node === "place")
    .map((f) => f.file);
}

/** Existing place names (normalised) + ids across all `place`-typed lexicons, for dedup. */
function loadExisting(): { names: Set<string>; ids: Set<string> } {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const file of placeLexiconFiles()) {
    const abs = path.join(LEXICONS_DIR, file);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const headers = lines[0].split("\t");
    const nameIdx = headers.indexOf("name");
    const idIdx = headers.indexOf("id");
    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      const nm = (cells[nameIdx] ?? "").trim();
      if (nm !== "") names.add(normaliseName(nm));
      const id = (cells[idIdx] ?? "").trim();
      if (id !== "") ids.add(id);
    }
  }
  return { names, ids };
}

/** Collapse multi-row (repeated inception/country) bindings to one record per QID. */
interface Merged {
  qid: string;
  label: string;
  sitelinks: number;
  coord: string;
  inception: string;
  country: string;
}

function mergeBindings(bindings: readonly RawBinding[]): Merged[] {
  const byQid = new Map<string, Merged>();
  for (const b of bindings) {
    const qid = b.s.value.split("/").pop() ?? "";
    if (qid === "") continue;
    const year = inceptionYear(b.inception?.value);
    const country = b.country?.value ?? "";
    const existing = byQid.get(qid);
    if (existing === undefined) {
      byQid.set(qid, {
        qid,
        label: b.label.value,
        sitelinks: Number(b.sl.value) || 0,
        coord: b.coord.value,
        inception: year,
        country,
      });
      continue;
    }
    // Keep the earliest (most negative) inception; fill a missing country.
    if (year !== "" && (existing.inception === "" || Number(year) < Number(existing.inception))) {
      existing.inception = year;
    }
    if (existing.country === "" && country !== "") existing.country = country;
  }
  return [...byQid.values()];
}

function curate(
  bindings: readonly RawBinding[],
  limit: number,
  retrievedAt: string,
): { rows: CuratedSite[]; stats: Record<string, number> } {
  const { names: existingNames, ids: existingIds } = loadExisting();
  const merged = mergeBindings(bindings).sort((a, b) => b.sitelinks - a.sitelinks);

  const stats = { candidates: merged.length, droppedLabel: 0, droppedCoord: 0, droppedDup: 0 };
  const usedIds = new Set(existingIds);
  const usedQids = new Set<string>();
  const rows: CuratedSite[] = [];

  for (const m of merged) {
    if (rows.length >= limit) break;
    if (!isRealLabel(m.label)) {
      stats.droppedLabel++;
      continue;
    }
    const coordinates = parseCoordinates(m.coord);
    if (coordinates === null) {
      stats.droppedCoord++;
      continue;
    }
    if (existingNames.has(normaliseName(m.label)) || usedQids.has(m.qid)) {
      stats.droppedDup++;
      continue;
    }
    usedQids.add(m.qid);

    let id = slugify(m.label);
    if (usedIds.has(id)) id = `${id}-${m.qid.toLowerCase()}`;
    usedIds.add(id);

    const description = m.country !== ""
      ? `Archaeological site in ${m.country}.`
      : "Archaeological site.";

    rows.push({
      id,
      name: m.label,
      coordinates,
      site_type: "",
      time_period_start: m.inception,
      time_period_end: "",
      time_period_label: periodLabel(m.inception),
      description,
      confidence: ACQUIRED_CONFIDENCE,
      sources: '["Wikidata"]',
      wikidata_qid: m.qid,
      source_url: `http://www.wikidata.org/entity/${m.qid}`,
      retrieved_at: retrievedAt,
    });
  }
  return { rows, stats };
}

function serialize(rows: readonly CuratedSite[]): string {
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
  console.log(`Querying Wikidata for archaeological sites (>= ${minSitelinks} sitelinks)…`);
  const bindings = await runQuery(minSitelinks);
  const retrievedAt = new Date().toISOString();
  const { rows, stats } = curate(bindings, limit, retrievedAt);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, serialize(rows));

  // eslint-disable-next-line no-console
  console.log(
    `Acquired ${bindings.length} bindings → ${stats.candidates} sites; ` +
      `dropped ${stats.droppedLabel} QID-named, ${stats.droppedCoord} no-coord, ` +
      `${stats.droppedDup} duplicate; emitted ${rows.length} curated rows → ${path.relative(REPO_ROOT, OUT_FILE)}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
