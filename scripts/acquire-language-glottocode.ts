/**
 * Acquire **glottocodes** for `lexicons/languages.tsv` and curate them into a committed
 * enrichment TSV for write-back (US-006 — language identity must not rest solely on ISO
 * codes; macro-code collisions like `hmn` need Glottolog's stable languoid ids).
 *
 * Like {@link ./acquire-language-status}, this is an **enrichment** step (it fills a gap on
 * EXISTING `languages.tsv` rows, keyed by the corpus `id`), not an append. It is the one
 * networked step of the runbook; the committed output
 * (`scripts/data/language-glottocode-enrichment.tsv`) is the network-free source of truth the
 * enrichment write-back (`import-from-culturescrape --enrich`) + QA gate operate on, so CI
 * never touches Wikidata.
 *
 * Two glottocode sources (AC — "Wikidata P1394 and/or joined from words.tsv Glottocode"):
 *  1. **Wikidata P1394** (`glottolog code`), keyed by the row's `wikidata_qid` — the primary
 *     source (~552 of the corpus languages carry a QID, and every one resolves a P1394).
 *     These rows already carry Wikidata provenance (`source_url`/`retrieved_at`/… stamped by
 *     the endangerment enrichment), so the glottocode inherits it and the enrichment record
 *     carries **only** `glottocode` (re-stamping would conflict on `sources`/`retrieved_at`).
 *  2. **words.tsv Glottocode** — the LexiBank/CLDF cognate corpus already carries a Glottocode
 *     per ISO-639-3 `Language_ID`; joined by the corpus `iso639_2` slot. This covers a handful
 *     of languages that have NO Wikidata QID, so those rows get their first sourced datum and
 *     are stamped with Glottolog provenance (a QID row always resolves via Wikidata first).
 *
 * Reconciliation / safety rules (mirror the endangerment acquire):
 *  - Only rows whose `id` is **unique** in `languages.tsv` are enriched — an ambiguous id
 *    (`abe` is two distinct languages) cannot address a single row, so it is skipped, never
 *    guessed. The enrichment write-back applies the same rule; pre-filtering keeps the
 *    committed TSV clean.
 *  - Wikidata over words.tsv when both carry a glottocode (Wikidata P1394 is the row's own
 *    entity; the words.tsv join is by ISO code).
 *
 * Run:  npx tsx scripts/acquire-language-glottocode.ts
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");
const OUT_FILE = path.join(DATA_DIR, "language-glottocode-enrichment.tsv");

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Pinakes/1.0 (https://github.com/; data-population; dldekerl@gmail.com)";

/** Confidence for the words.tsv (Glottolog) glottocode join, on the 0–1 scale. */
// `referenced-wikidata` (0.9) — a Glottolog code (Wikidata P1394 / LexiBank), a referenced
// external authority; confidence comes from the rubric, not a literal (US-001).
const GLOTTOLOG_CONFIDENCE = confidenceCellForClass("referenced-wikidata");

/** QID chunk size per SPARQL VALUES block (keeps each query well under the WDQS timeout). */
const CHUNK = 150;

/** Columns emitted to the enrichment TSV, in write-back order (`id` is the join key). */
export const ENRICHMENT_COLUMNS = [
  "id",
  "glottocode",
  "source_url",
  "retrieved_at",
  "confidence",
  "sources",
] as const;

interface Binding {
  entity: { value: string };
  glottocode: { value: string };
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

/** A uniquely-addressable `languages.tsv` row: its id + the keys we source a glottocode by. */
export interface LanguageRow {
  readonly id: string;
  readonly iso639_2: string;
  readonly wikidataQid: string;
  /** True when the row already carries an external anchor (a non-blank source_url). */
  readonly hasProvenance: boolean;
}

/**
 * Parse `languages.tsv` into the rows whose `id` is **unique** (so the enrichment key
 * addresses exactly one row). Ambiguous ids are counted and dropped.
 */
export function readUniqueLanguageRows(
  content: string,
): { rows: LanguageRow[]; ambiguousIds: number } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headers = lines[0].split("\t").map((h) => h.trim());
  const idIdx = headers.indexOf("id");
  const isoIdx = headers.indexOf("iso639_2");
  const qidIdx = headers.indexOf("wikidata_qid");
  const urlIdx = headers.indexOf("source_url");

  const idCount = new Map<string, number>();
  const parsed: LanguageRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const id = (cells[idIdx] ?? "").trim();
    if (id === "") continue;
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
    parsed.push({
      id,
      iso639_2: (cells[isoIdx] ?? "").trim(),
      wikidataQid: (cells[qidIdx] ?? "").trim(),
      hasProvenance: (cells[urlIdx] ?? "").trim() !== "",
    });
  }
  const rows = parsed.filter((r) => (idCount.get(r.id) ?? 0) === 1);
  const ambiguousIds = parsed.length - rows.length;
  return { rows, ambiguousIds };
}

/**
 * Build an ISO-639-3 → Glottocode map from `words.tsv` (`Language_ID` → `Glottocode`). Only a
 * code that maps to exactly ONE glottocode across the corpus is kept (a conflicting code is
 * dropped rather than guessed).
 */
export function readWordsGlottocodes(content: string): Map<string, string> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return new Map();
  const headers = lines[0].split("\t").map((h) => h.trim());
  const langIdx = headers.indexOf("Language_ID");
  const glottoIdx = headers.indexOf("Glottocode");
  const seen = new Map<string, Set<string>>();
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const iso = (cells[langIdx] ?? "").trim();
    const glotto = (cells[glottoIdx] ?? "").trim();
    if (iso === "" || glotto === "") continue;
    const set = seen.get(iso) ?? new Set<string>();
    set.add(glotto);
    seen.set(iso, set);
  }
  const map = new Map<string, string>();
  for (const [iso, set] of seen) {
    if (set.size === 1) map.set(iso, [...set][0]);
  }
  return map;
}

/** One curated enrichment row (keyed by the corpus `id`). */
export interface EnrichmentRow {
  id: string;
  glottocode: string;
  source_url: string;
  retrieved_at: string;
  confidence: string;
  sources: string;
}

interface CurateStats {
  uniqueRows: number;
  ambiguousIds: number;
  fromWikidata: number;
  fromWords: number;
  emitted: number;
}

/** Glottolog citation for a words.tsv-joined glottocode (the row's first sourced datum). */
function glottologCitation(): string {
  return JSON.stringify([
    "Glottolog (glottocode joined via the LexiBank/CLDF words.tsv Glottocode column)",
  ]);
}

/**
 * Merge the two glottocode sources into one enrichment row per corpus id. Wikidata P1394 wins
 * over the words.tsv join; a Wikidata-sourced row carries only `glottocode` (its Wikidata
 * provenance is already on the target row), a words.tsv-only row is stamped with Glottolog
 * provenance so it does not gain an unsourced value.
 */
export function curateGlottocodes(
  rows: readonly LanguageRow[],
  wikidataGlotto: ReadonlyMap<string, string>,
  wordsGlotto: ReadonlyMap<string, string>,
  retrievedAt: string,
): { rows: EnrichmentRow[]; fromWikidata: number; fromWords: number } {
  const out: EnrichmentRow[] = [];
  let fromWikidata = 0;
  let fromWords = 0;
  for (const r of rows) {
    const wdGlotto = r.wikidataQid !== "" ? wikidataGlotto.get(r.wikidataQid) : undefined;
    if (wdGlotto !== undefined && wdGlotto !== "") {
      fromWikidata += 1;
      out.push({
        id: r.id,
        glottocode: wdGlotto,
        // Provenance already on the target row (its Wikidata QID/URL); leave blank so the
        // write-back does not conflict on the existing UNESCO/Wikidata provenance.
        source_url: "",
        retrieved_at: "",
        confidence: "",
        sources: "",
      });
      continue;
    }
    const wGlotto = r.iso639_2 !== "" ? wordsGlotto.get(r.iso639_2) : undefined;
    if (wGlotto !== undefined && wGlotto !== "") {
      fromWords += 1;
      // A non-QID row: this glottocode is its first external anchor, so stamp Glottolog
      // provenance (unless the row somehow already carries provenance, in which case leave
      // it to avoid a conflict — glottocode still fills the blank).
      out.push({
        id: r.id,
        glottocode: wGlotto,
        source_url: r.hasProvenance
          ? ""
          : `https://glottolog.org/resource/languoid/id/${wGlotto}`,
        retrieved_at: r.hasProvenance ? "" : retrievedAt,
        confidence: r.hasProvenance ? "" : GLOTTOLOG_CONFIDENCE,
        sources: r.hasProvenance ? "" : glottologCitation(),
      });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows: out, fromWikidata, fromWords };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** SPARQL: for a batch of QIDs, project the Glottolog code (P1394) per entity. */
function glottocodeSparql(qids: readonly string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `SELECT ?entity ?glottocode WHERE {
  VALUES ?entity { ${values} }
  ?entity wdt:P1394 ?glottocode .
}`;
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
  const languages = fs.readFileSync(path.join(LEXICONS_DIR, "languages.tsv"), "utf8");
  const words = fs.readFileSync(path.join(LEXICONS_DIR, "words.tsv"), "utf8");
  const { rows, ambiguousIds } = readUniqueLanguageRows(languages);
  const wordsGlotto = readWordsGlottocodes(words);
  const retrievedAt = new Date().toISOString();

  const qids = [...new Set(rows.map((r) => r.wikidataQid).filter((q) => q !== ""))].sort();
  // eslint-disable-next-line no-console
  console.log(
    `[glottocode] ${rows.length} uniquely-addressable rows ` +
      `(${ambiguousIds} skipped as ambiguous); ${qids.length} carry a QID; ` +
      `words.tsv has ${wordsGlotto.size} ISO→glottocode joins; querying Wikidata P1394…`,
  );

  const wikidataGlotto = new Map<string, string>();
  for (const codes of chunk(qids, CHUNK)) {
    const bindings = await runQuery(glottocodeSparql(codes));
    for (const b of bindings) {
      const qid = qidOf(b.entity.value);
      const glotto = (b.glottocode.value ?? "").trim();
      if (qid !== "" && glotto !== "" && !wikidataGlotto.has(qid)) wikidataGlotto.set(qid, glotto);
    }
  }

  const { rows: enrichmentRows, fromWikidata, fromWords } = curateGlottocodes(
    rows,
    wikidataGlotto,
    wordsGlotto,
    retrievedAt,
  );
  const stats: CurateStats = {
    uniqueRows: rows.length,
    ambiguousIds,
    fromWikidata,
    fromWords,
    emitted: enrichmentRows.length,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, serialize(enrichmentRows));

  // eslint-disable-next-line no-console
  console.log(
    `[glottocode] ${stats.emitted} enrichment rows ` +
      `(${stats.fromWikidata} from Wikidata P1394, ${stats.fromWords} from words.tsv) → ` +
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
