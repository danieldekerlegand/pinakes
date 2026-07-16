/**
 * Acquire language **endangerment status** (and, where available, a range polygon) from
 * Wikidata and curate it into a committed enrichment TSV for write-back (US-006,
 * data-population at scale — language breadth: ranges & endangerment).
 *
 * Unlike US-002…US-005 (which APPEND new node rows), this is an **enrichment** step: it
 * fills gaps on the EXISTING `lexicons/languages.tsv` rows (the corpus's 1,099 languages),
 * reconciled by ISO 639-3 code. The one networked step of the runbook (acquire →
 * reconcile); the committed output (`scripts/data/language-enrichment.tsv`) is the
 * network-free source of truth the enrichment write-back (`import-from-culturescrape
 * --enrich`) + QA gate operate on, so CI never touches Wikidata.
 *
 * What Wikidata carries for our corpus (probed against the 994 ISO-3 codes on disk):
 *  - **UNESCO language status** (P1999): ~562 of the corpus languages. Values are the
 *    UNESCO vitality scale ("1 safe" … "6 extinct"); we store the bare label
 *    ("critically endangered", "vulnerable", …) which `server/services/language-preservation
 *    .ts`'s `normalizeStatus` already maps onto its canonical VitalityLevel — so the
 *    endangered-language dashboard reflects the enriched, *sourced* status.
 *  - **Range polygon** (geoshape, P3896): **0** of the corpus languages carry one. Wikidata
 *    (and Glottolog) do not publish inline range polygons for these languages, so the range
 *    column is emitted but stays blank for now (honest "where available"). The curated
 *    `lexicons/language-range-polygons.tsv` (133 polygons) remains the polygon source; this
 *    acquire wires the geoshape path so a future Wikidata backfill lands automatically.
 *
 * Reconciliation / safety rules:
 *  - Matched by **ISO 639-3** (the `iso639_2` column — the corpus's ISO-3 slot). Only rows
 *    whose ISO code AND `id` are **unique** in the corpus are enriched; an ambiguous key
 *    (26 ISO codes / 30 ids recur — e.g. `abe` is both Western Abenaki and Great Andamanese)
 *    cannot address a single row, so it is skipped, never guessed (mirrors the write-back's
 *    ambiguous-id rule).
 *  - Every emitted row carries full provenance: `wikidata_qid`, `source_url`, `retrieved_at`,
 *    `confidence`, `sources` (Guiding Principle #8) — so the attribution gate enforces it.
 *
 * Run:  npx tsx scripts/acquire-language-status.ts
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");
const OUT_FILE = path.join(DATA_DIR, "language-enrichment.tsv");

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "pinakes/1.0 (https://github.com/; data-population; dldekerl@gmail.com)";

/** Confidence for Wikidata-acquired enrichment, on the 0–1 scale (export leaves ≤1 as-is). */
// `referenced-wikidata` (0.9) — P1999 endangerment cites UNESCO, a referenced statement;
// confidence comes from the rubric, not a literal (US-001).
const ACQUIRED_CONFIDENCE = confidenceCellForClass("referenced-wikidata");

/** ISO-3 chunk size per SPARQL VALUES block (keeps each query well under the WDQS timeout). */
const CHUNK = 150;

/** Columns emitted to the enrichment TSV, in write-back order (`id` is the join key). */
export const ENRICHMENT_COLUMNS = [
  "id",
  "endangerment_status",
  "range_geojson",
  "wikidata_qid",
  "source_url",
  "retrieved_at",
  "confidence",
  "sources",
] as const;

interface Binding {
  iso: { value: string };
  entity: { value: string };
  statusLabel?: { value: string };
  geoshape?: { value: string };
  atlasId?: { value: string };
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

/** QID from a Wikidata entity URI, or "" for a non-entity value. */
function qidOf(uri: string): string {
  const q = uri.split("/").pop() ?? "";
  return /^Q\d+$/.test(q) ? q : "";
}

/**
 * The bare UNESCO vitality label from Wikidata's "N label" form, cleaned to a value the
 * preservation service's `normalizeStatus` recognises: "5 critically endangered" →
 * "critically endangered", "1 safe" → "safe".
 */
export function cleanStatusLabel(raw: string | undefined): string {
  if (raw === undefined) return "";
  return raw.replace(/^\s*\d+\s+/, "").replace(/[\t\r\n]+/g, " ").trim().toLowerCase();
}

/**
 * Read `id` + ISO-3 (`iso639_2`) from `languages.tsv` and build a map from a **unique** ISO-3
 * code to its **unique** corpus id. Any ISO code or id that recurs is dropped (ambiguous key —
 * cannot address a single row).
 */
export function buildIsoToUniqueId(
  content: string,
): { isoToId: Map<string, string>; ambiguousIso: number } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headers = lines[0].split("\t").map((h) => h.trim());
  const idIdx = headers.indexOf("id");
  const isoIdx = headers.indexOf("iso639_2");
  const idCount = new Map<string, number>();
  const isoCount = new Map<string, number>();
  const pairs: { id: string; iso: string }[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const id = (cells[idIdx] ?? "").trim();
    const iso = (cells[isoIdx] ?? "").trim();
    if (id !== "") idCount.set(id, (idCount.get(id) ?? 0) + 1);
    if (iso !== "") isoCount.set(iso, (isoCount.get(iso) ?? 0) + 1);
    if (id !== "" && iso !== "") pairs.push({ id, iso });
  }
  const isoToId = new Map<string, string>();
  let ambiguousIso = 0;
  for (const { id, iso } of pairs) {
    if ((isoCount.get(iso) ?? 0) > 1 || (idCount.get(id) ?? 0) > 1) {
      ambiguousIso += 1;
      continue; // ambiguous ISO or ambiguous id → cannot address one row.
    }
    if (!isoToId.has(iso)) isoToId.set(iso, id);
  }
  return { isoToId, ambiguousIso };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** SPARQL: for a batch of ISO-3 codes, project UNESCO status + geoshape + atlas id per language. */
function statusSparql(isoCodes: readonly string[]): string {
  const values = isoCodes.map((c) => `"${c}"`).join(" ");
  return `SELECT ?iso ?entity ?statusLabel ?geoshape ?atlasId WHERE {
  VALUES ?iso { ${values} }
  ?entity wdt:P220 ?iso .
  OPTIONAL { ?entity wdt:P1999 ?status . ?status rdfs:label ?statusLabel . FILTER(LANG(?statusLabel) = "en") }
  OPTIONAL { ?entity wdt:P3896 ?geoshape . }
  OPTIONAL { ?entity wdt:P2355 ?atlasId . }
}`;
}

/** One curated enrichment row (keyed by the corpus `id`). */
interface EnrichmentRow {
  id: string;
  endangerment_status: string;
  range_geojson: string;
  wikidata_qid: string;
  source_url: string;
  retrieved_at: string;
  confidence: string;
  sources: string;
}

interface AcquireStats {
  corpusWithIso: number;
  ambiguousIso: number;
  bindings: number;
  withStatus: number;
  withRange: number;
  emitted: number;
}

/**
 * Collapse the raw bindings (one language may bind multiple statuses/atlas ids) into one
 * enrichment row per corpus id: the highest-severity UNESCO status wins (a language marked
 * both "vulnerable" and "definitely endangered" is recorded at its most-endangered level).
 */
export function curateEnrichment(
  bindings: readonly Binding[],
  isoToId: Map<string, string>,
  retrievedAt: string,
): { rows: EnrichmentRow[]; withStatus: number; withRange: number } {
  // UNESCO severity ordering (higher = more endangered) so a multi-valued language keeps
  // the most severe status. `safe` is the floor; unknown labels sort below everything.
  const severity = (label: string): number =>
    ["safe", "vulnerable", "definitely endangered", "severely endangered", "critically endangered", "extinct"]
      .indexOf(label);

  const byId = new Map<string, EnrichmentRow>();
  for (const b of bindings) {
    const iso = b.iso.value.trim();
    const id = isoToId.get(iso);
    if (id === undefined) continue; // not a uniquely-addressable corpus row.
    const qid = qidOf(b.entity.value);
    if (qid === "") continue;
    const status = cleanStatusLabel(b.statusLabel?.value);
    const geoshape = (b.geoshape?.value ?? "").trim();
    const atlasId = (b.atlasId?.value ?? "").trim();

    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, {
        id,
        endangerment_status: status,
        range_geojson: geoshape,
        wikidata_qid: qid,
        source_url: `http://www.wikidata.org/entity/${qid}`,
        retrieved_at: retrievedAt,
        confidence: ACQUIRED_CONFIDENCE,
        sources: sourcesCitation(atlasId),
      });
      continue;
    }
    // Merge: keep the most-severe status; fill any blank optional.
    if (status !== "" && severity(status) > severity(existing.endangerment_status)) {
      existing.endangerment_status = status;
      existing.sources = sourcesCitation(atlasId);
    }
    if (existing.range_geojson === "" && geoshape !== "") existing.range_geojson = geoshape;
  }

  // Only keep rows that carry at least one real enrichment (a status and/or a range); a bare
  // QID with no status/range is not worth stamping provenance on.
  const rows = [...byId.values()].filter(
    (r) => r.endangerment_status !== "" || r.range_geojson !== "",
  );
  const withStatus = rows.filter((r) => r.endangerment_status !== "").length;
  const withRange = rows.filter((r) => r.range_geojson !== "").length;
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows, withStatus, withRange };
}

/** Bibliographic citation for the enrichment row (UNESCO Atlas id folded in when present). */
function sourcesCitation(atlasId: string): string {
  const parts = ["UNESCO Atlas of the World's Languages in Danger (via Wikidata P1999)"];
  if (atlasId !== "") parts.push(`UNESCO Atlas language id ${atlasId}`);
  return JSON.stringify(parts);
}

function serialize(rows: readonly EnrichmentRow[]): string {
  const header = [...ENRICHMENT_COLUMNS];
  const lines = [header.join("\t")];
  for (const r of rows) {
    lines.push(header.map((h) => (r as unknown as Record<string, string>)[h] ?? "").join("\t"));
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const content = fs.readFileSync(path.join(LEXICONS_DIR, "languages.tsv"), "utf8");
  const { isoToId, ambiguousIso } = buildIsoToUniqueId(content);
  const isoCodes = [...isoToId.keys()].sort();
  const retrievedAt = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.log(
    `[language-status] ${isoCodes.length} uniquely-addressable ISO-3 codes ` +
      `(${ambiguousIso} rows skipped as ambiguous); querying Wikidata in ` +
      `${Math.ceil(isoCodes.length / CHUNK)} chunk(s)…`,
  );

  const allBindings: Binding[] = [];
  for (const codes of chunk(isoCodes, CHUNK)) {
    const bindings = await runQuery(statusSparql(codes));
    allBindings.push(...bindings);
  }

  const { rows, withStatus, withRange } = curateEnrichment(allBindings, isoToId, retrievedAt);
  const stats: AcquireStats = {
    corpusWithIso: isoCodes.length,
    ambiguousIso,
    bindings: allBindings.length,
    withStatus,
    withRange,
    emitted: rows.length,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, serialize(rows));

  // eslint-disable-next-line no-console
  console.log(
    `[language-status] ${stats.bindings} bindings → ${stats.emitted} enrichment rows ` +
      `(${stats.withStatus} with UNESCO status, ${stats.withRange} with range geoshape) → ` +
      `${path.relative(REPO_ROOT, OUT_FILE)}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
