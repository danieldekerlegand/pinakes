/**
 * Batch QID backfill for unreconciled lexicon rows (US-003).
 *
 * ~5,440 of the exported nodes are "likely-new" solely because their lexicon row lacks a
 * `wikidata_qid` — so the curated corpus sits outside the global identity space even where a
 * matching Wikidata entity plainly exists. This script is the **acquire → reconcile** step that
 * proposes QIDs for those rows via pinakes-engine's cascade step 1 (the QID anchor), keyed by an
 * **exact English label match** on Wikidata (optionally constrained to the node type's Wikidata
 * class). It is deliberately conservative — the identity layer must not be poisoned by a wrong
 * anchor:
 *
 *   * **accepted**  — EXACTLY ONE Wikidata entity matches the row's exact label (within the node
 *                     type's class when one is configured, else globally across Wikidata). A
 *                     unique global/class-scoped label is a strong, auto-acceptable signal.
 *   * **ambiguous** — TWO OR MORE distinct entities match the label. Listed with their competing
 *                     QIDs for human review and **never auto-accepted** (mirrors the reconciler's
 *                     blocking-key semantics — a collision is never auto-picked).
 *   * **none**      — no entity carries that exact label; the row stays unreconciled.
 *
 * Like the other acquire scripts this is the **one networked step**: it writes a committed,
 * deterministic candidates artifact (`scripts/data/lexicon-qid-candidates.tsv`) that is the
 * network-free replay source — CI never hits Wikidata. `--apply` reads that artifact and fills
 * the **blank** `wikidata_qid` cell (plus full provenance) on each accepted row via the established
 * enrichment write-back (`import-from-engine.buildEnrichment`), which only ever fills blanks
 * and reports (never resolves) a conflict — so no curated cell is clobbered and `lexicons/*.tsv`
 * stays the human-owned source of truth. Rerunning the acquire step is idempotent; rerunning
 * `--apply` is a no-op (the qid cell is now non-blank).
 *
 * Usage:
 *   npx tsx scripts/reconcile-lexicon-qids.ts [--file <lexicon.tsv>] [--limit N] [--min-batch N]
 *       → query Wikidata, (re)write scripts/data/lexicon-qid-candidates.tsv
 *   npx tsx scripts/reconcile-lexicon-qids.ts --apply [--overwrite]
 *       → apply the accepted anchors from the committed artifact into lexicons/*.tsv
 */
import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@shared/confidence-rubric";
import { nodeFiles } from "@shared/lexicon-mapping";
import {
  buildEnrichment,
  readLexiconFile,
  serializeLexiconFile,
  enrichmentReportJson,
  WRITEBACK_DIR,
  type EnrichmentRecord,
} from "./import-from-engine.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");

/** Committed, deterministic candidates artifact — the network-free replay source of truth. */
export const CANDIDATES_FILE = path.join(DATA_DIR, "lexicon-qid-candidates.tsv");

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "pinakes/1.0 (+https://github.com/danieldekerlegand/pinakes; qid-backfill)";

/** Fixed retrieval date → a deterministic committed artifact (no wall-clock). */
export const RETRIEVED_AT = "2026-07-13";

/** Names per SPARQL `VALUES` block (well under the WDQS timeout). */
const BATCH = 50;

/** Max competing QIDs recorded for an ambiguous row (full ambiguity is the point, bounded for size). */
const MAX_CANDIDATES = 8;

/**
 * The lexicon files carrying a `wikidata_qid` column, with the Wikidata class the node type maps
 * to (`undefined` = match on a globally-unique label instead). `languages.tsv` is intentionally
 * absent: languages already reconcile on their ISO/glottocode anchor, so a QID adds no `matched`.
 * Classes are the same ones the acquire scripts query; where a type is modelled as a *subclass*
 * (dance) or lacks a clean class (civilization/routes/motifs), we fall back to global uniqueness.
 */
export interface QidTarget {
  readonly file: string;
  readonly node: string;
  /** Wikidata class QID (`wdt:P31/wdt:P279*` reachable); `undefined` ⇒ global-uniqueness match. */
  readonly classQid?: string;
}

export const QID_TARGETS: readonly QidTarget[] = [
  { file: "archaeological-cultures.tsv", node: "archaeological-culture", classQid: "Q465299" },
  { file: "archaeological-sites.tsv", node: "place", classQid: "Q839954" },
  { file: "architectural-styles.tsv", node: "art-tradition", classQid: "Q32880" },
  { file: "cooking-techniques.tsv", node: "cooking-technique", classQid: "Q1039303" },
  { file: "cuisines.tsv", node: "cuisine", classQid: "Q1968435" },
  { file: "dance-traditions.tsv", node: "art-tradition" },
  { file: "deities.tsv", node: "deity", classQid: "Q178885" },
  { file: "ingredient-origins.tsv", node: "ingredient", classQid: "Q25403900" },
  { file: "literary-traditions.tsv", node: "literary-tradition", classQid: "Q2198855" },
  { file: "migration-routes.tsv", node: "migration-route" },
  { file: "myth-motifs.tsv", node: "myth-motif" },
  { file: "trade-routes.tsv", node: "trade-good" },
  { file: "writing-systems.tsv", node: "writing-system", classQid: "Q8192" },
];

/** A lexicon row eligible for backfill: blank `wikidata_qid`, non-blank name, id unique in its file. */
export interface AddressableRow {
  readonly file: string;
  readonly node: string;
  readonly classQid: string;
  readonly id: string;
  readonly name: string;
}

/** One proposed reconciliation for an addressable row (accepted / ambiguous / none). */
export interface QidCandidate {
  readonly file: string;
  readonly node: string;
  readonly id: string;
  readonly name: string;
  readonly status: "accepted" | "ambiguous" | "none";
  /** The chosen QID when `accepted`, else `""`. */
  readonly qid: string;
  /** Number of distinct Wikidata entities that matched the exact label. */
  readonly candidateCount: number;
  /** Up to {@link MAX_CANDIDATES} matched QIDs (for human review of the ambiguous rows). */
  readonly candidates: readonly string[];
}

// --- reading the corpus -----------------------------------------------------

function splitLines(content: string): string[] {
  return content.split(/\r?\n/).filter((l) => l.trim() !== "");
}

/** The confidence scale used by a file: 100 when any existing value exceeds 1, else 1. */
export function detectConfidenceScale(headers: string[], rows: string[][]): 1 | 100 {
  const idx = headers.indexOf("confidence");
  if (idx < 0) return 1;
  for (const row of rows) {
    const v = Number((row[idx] ?? "").trim());
    if (Number.isFinite(v) && v > 1) return 100;
  }
  return 1;
}

/**
 * Read the addressable blank-QID rows across every {@link QID_TARGETS} file (pure over a lexicons
 * dir). A row is addressable only when its `id` is **unique in the file** — the enrichment
 * write-back keys on `id`, so a duplicated id cannot address a single row and is skipped.
 */
export function readAddressableRows(lexiconsDir: string = LEXICONS_DIR): AddressableRow[] {
  const nodeByFile = new Map(nodeFiles().map((n) => [n.file, n.node]));
  const out: AddressableRow[] = [];
  for (const target of QID_TARGETS) {
    const filePath = path.join(lexiconsDir, target.file);
    if (!fs.existsSync(filePath)) continue;
    const lines = splitLines(fs.readFileSync(filePath, "utf8"));
    if (lines.length === 0) continue;
    const headers = lines[0].split("\t").map((h) => h.trim());
    const idIdx = headers.indexOf("id");
    const nameIdx = headers.indexOf("name");
    const qidIdx = headers.indexOf("wikidata_qid");
    if (idIdx < 0 || nameIdx < 0 || qidIdx < 0) continue;

    const rows = lines.slice(1).map((l) => l.split("\t"));
    const idCount = new Map<string, number>();
    for (const row of rows) {
      const id = (row[idIdx] ?? "").trim();
      if (id !== "") idCount.set(id, (idCount.get(id) ?? 0) + 1);
    }
    const node = nodeByFile.get(target.file) ?? target.node;
    for (const row of rows) {
      const id = (row[idIdx] ?? "").trim();
      const name = (row[nameIdx] ?? "").trim();
      const qid = (row[qidIdx] ?? "").trim();
      if (id === "" || name === "" || qid !== "") continue;
      if ((idCount.get(id) ?? 0) !== 1) continue; // not addressable by a single id
      out.push({ file: target.file, node, classQid: target.classQid ?? "", id, name });
    }
  }
  out.sort((a, b) => cmp(a.file, b.file) || cmp(a.id, b.id));
  return out;
}

// --- Wikidata query ---------------------------------------------------------

/** SPARQL-escape a label literal (backslash + quote; control chars stripped). */
function escapeLabel(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * SPARQL for a batch of exact English labels. When `classQid` is set the match is constrained to
 * that Wikidata class (`wdt:P31/wdt:P279*`); otherwise it matches any entity, minus Wikimedia
 * internal pages (disambiguation / category / list), so "globally unique label" means one real
 * entity. `rdfs:label` only (not altLabel) keeps it a precise, primary-label match.
 */
export function exactLabelSparql(names: readonly string[], classQid: string): string {
  const values = names.map((n) => `"${escapeLabel(n)}"@en`).join(" ");
  const typeClause = classQid
    ? `?item wdt:P31/wdt:P279* wd:${classQid} .`
    : `FILTER NOT EXISTS { ?item wdt:P31 wd:Q4167410 }\n` + // disambiguation page
      `  FILTER NOT EXISTS { ?item wdt:P31 wd:Q4167836 }\n` + // Wikimedia category
      `  FILTER NOT EXISTS { ?item wdt:P31 wd:Q13406463 }`; // Wikimedia list article
  return (
    `SELECT ?item ?name WHERE {\n` +
    `  VALUES ?name { ${values} }\n` +
    `  ?item rdfs:label ?name .\n` +
    `  ${typeClause}\n` +
    `}`
  );
}

interface Binding {
  item: { value: string };
  name: { value: string };
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
      lastError = `HTTP ${res.status}: ${text.slice(0, 160)}`;
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

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Query Wikidata for every addressable row and classify it. Rows are grouped by class so each
 * SPARQL batch shares one class constraint; the exact label is matched case-sensitively, so a
 * label is only counted for a row whose name matches it verbatim.
 */
export async function proposeQids(
  rows: readonly AddressableRow[],
  log: (msg: string) => void = () => {},
): Promise<QidCandidate[]> {
  const byClass = new Map<string, AddressableRow[]>();
  for (const row of rows) {
    const list = byClass.get(row.classQid) ?? [];
    list.push(row);
    byClass.set(row.classQid, list);
  }

  const out: QidCandidate[] = [];
  for (const [classQid, classRows] of byClass) {
    // A label may recur across rows (different ids, same name); query each distinct name once.
    const names = [...new Set(classRows.map((r) => r.name))];
    const qidsByName = new Map<string, Set<string>>();
    for (const name of names) qidsByName.set(name, new Set());

    const batches = chunk(names, BATCH);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      log(
        `  class=${classQid || "(global)"} batch ${i + 1}/${batches.length} (${batch.length} labels)`,
      );
      const bindings = await runQuery(exactLabelSparql(batch, classQid));
      for (const b of bindings) {
        const qid = qidOf(b.item.value);
        const name = b.name.value;
        if (qid === "") continue;
        qidsByName.get(name)?.add(qid);
      }
    }

    for (const row of classRows) {
      const matched = [...(qidsByName.get(row.name) ?? new Set<string>())].sort(compareQid);
      let status: QidCandidate["status"];
      let qid = "";
      if (matched.length === 1) {
        status = "accepted";
        qid = matched[0];
      } else if (matched.length >= 2) {
        status = "ambiguous";
      } else {
        status = "none";
      }
      out.push({
        file: row.file,
        node: row.node,
        id: row.id,
        name: row.name,
        status,
        qid,
        candidateCount: matched.length,
        candidates: matched.slice(0, MAX_CANDIDATES),
      });
    }
  }
  out.sort((a, b) => cmp(a.file, b.file) || cmp(a.id, b.id));
  return out;
}

// --- candidates artifact (serialise / parse) --------------------------------

export const CANDIDATE_HEADER: readonly string[] = [
  "file",
  "node",
  "id",
  "name",
  "status",
  "wikidata_qid",
  "candidate_count",
  "candidates",
];

function sani(s: string): string {
  return s.replace(/[\t\r\n]+/g, " ").trim();
}

export function serializeCandidates(candidates: readonly QidCandidate[]): string {
  const sorted = [...candidates].sort((a, b) => cmp(a.file, b.file) || cmp(a.id, b.id));
  const rows = sorted.map((c) =>
    [
      c.file,
      c.node,
      c.id,
      sani(c.name),
      c.status,
      c.qid,
      String(c.candidateCount),
      c.candidates.join(" "),
    ].join("\t"),
  );
  return [CANDIDATE_HEADER.join("\t"), ...rows].join("\n") + "\n";
}

export function parseCandidates(content: string): QidCandidate[] {
  const lines = splitLines(content);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  const idx = (name: string) => headers.indexOf(name);
  const fi = idx("file"), ni = idx("node"), ii = idx("id"), nm = idx("name");
  const si = idx("status"), qi = idx("wikidata_qid"), ci = idx("candidate_count"), cd = idx("candidates");
  return lines.slice(1).map((line) => {
    const c = line.split("\t");
    const status = (c[si] ?? "").trim();
    return {
      file: (c[fi] ?? "").trim(),
      node: (c[ni] ?? "").trim(),
      id: (c[ii] ?? "").trim(),
      name: (c[nm] ?? "").trim(),
      status: (status === "accepted" || status === "ambiguous" ? status : "none") as QidCandidate["status"],
      qid: (c[qi] ?? "").trim(),
      candidateCount: Number((c[ci] ?? "0").trim()) || 0,
      candidates: (c[cd] ?? "").trim() === "" ? [] : (c[cd] ?? "").trim().split(/\s+/),
    };
  });
}

// --- apply accepted anchors via the enrichment write-back -------------------

/** The citation written to the `sources` column for a reconciled row. */
export function reconcileCitation(qid: string): string {
  return `Wikidata ${qid} (exact-label reconciliation, US-003)`;
}

export interface ApplySummary {
  readonly file: string;
  readonly proposed: number;
  readonly enrichments: number;
  readonly conflicts: number;
  readonly unmatched: number;
  readonly ambiguous: number;
}

/**
 * Apply every `accepted` candidate to its lexicon: fill the blank `wikidata_qid` cell plus full
 * provenance (`source_url`/`retrieved_at`/`confidence`/`sources`) via {@link buildEnrichment}
 * (fills blanks only; a differing curated cell is a reported conflict, never clobbered unless
 * `overwrite`). Confidence is stamped from the `exact-reconciled` rubric class, on the file's own
 * confidence scale. Writes the edited lexicons in place and a per-file enrichment report.
 */
export function applyAccepted(
  candidates: readonly QidCandidate[],
  opts: { lexiconsDir?: string; outDir?: string; overwrite?: boolean } = {},
): ApplySummary[] {
  const lexiconsDir = opts.lexiconsDir ?? LEXICONS_DIR;
  const outDir = opts.outDir ?? WRITEBACK_DIR;
  const byFile = new Map<string, QidCandidate[]>();
  for (const c of candidates) {
    if (c.status !== "accepted" || c.qid === "") continue;
    const list = byFile.get(c.file) ?? [];
    list.push(c);
    byFile.set(c.file, list);
  }

  const summaries: ApplySummary[] = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const [file, accepted] of [...byFile].sort((a, b) => cmp(a[0], b[0]))) {
    const parsed = readLexiconFile(path.join(lexiconsDir, file), file);
    if (parsed === null) throw new Error(`Target lexicon not found or empty: ${file}`);
    const scale = detectConfidenceScale(
      parsed.headers,
      parsed.rows.map((r) => r.slice()),
    );
    const confidence = confidenceCellForClass("exact-reconciled", { scale });

    const records: EnrichmentRecord[] = accepted.map((c) => ({
      key: c.id,
      values: {
        wikidata_qid: c.qid,
        source_url: `https://www.wikidata.org/entity/${c.qid}`,
        retrieved_at: RETRIEVED_AT,
        confidence,
        sources: reconcileCitation(c.qid),
      },
    }));

    const built = buildEnrichment(parsed, records, { keyColumn: "id", overwrite: opts.overwrite });
    if (built.file.changed) {
      fs.writeFileSync(path.join(lexiconsDir, file), serializeLexiconFile(built.file));
    }
    const reportName = `${file.replace(/\.tsv$/, "")}-qid-enrichment-report.json`;
    fs.writeFileSync(path.join(outDir, reportName), enrichmentReportJson(built.report));
    summaries.push({
      file,
      proposed: records.length,
      enrichments: built.report.totals.enrichments,
      conflicts: built.report.totals.conflicts,
      unmatched: built.report.totals.unmatched,
      ambiguous: built.report.totals.ambiguous,
    });
  }
  return summaries;
}

// --- helpers ----------------------------------------------------------------

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort QIDs numerically (Q7 before Q100), so the artifact is stable. */
function compareQid(a: string, b: string): number {
  return (Number(a.slice(1)) || 0) - (Number(b.slice(1)) || 0);
}

// --- CLI --------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes("--apply")) {
    const overwrite = argv.includes("--overwrite");
    if (!fs.existsSync(CANDIDATES_FILE)) {
      throw new Error(`Candidates artifact not found — run the acquire step first: ${CANDIDATES_FILE}`);
    }
    const candidates = parseCandidates(fs.readFileSync(CANDIDATES_FILE, "utf8"));
    const summaries = applyAccepted(candidates, { overwrite });
    const total = summaries.reduce((n, s) => n + s.enrichments, 0);
    for (const s of summaries) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${s.file}: +${s.enrichments} qid (proposed ${s.proposed}, conflicts ${s.conflicts}, unmatched ${s.unmatched})`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`Applied ${total} QID anchors across ${summaries.length} lexicon(s).`);
    return;
  }

  // Acquire (networked): propose QIDs and (re)write the committed candidates artifact.
  let rows = readAddressableRows();
  const fileFilter = flagValue("--file");
  if (fileFilter) rows = rows.filter((r) => r.file === fileFilter);
  const limit = Number(flagValue("--limit") ?? "");
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);

  // eslint-disable-next-line no-console
  console.log(`Reconciling ${rows.length} unreconciled row(s) against Wikidata…`);
  const candidates = await proposeQids(rows, (m) => console.log(m));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CANDIDATES_FILE, serializeCandidates(candidates));

  const by = (s: string) => candidates.filter((c) => c.status === s).length;
  // eslint-disable-next-line no-console
  console.log(
    `→ ${CANDIDATES_FILE}\n  accepted ${by("accepted")}, ambiguous ${by("ambiguous")}, none ${by("none")}`,
  );
}

// CLI entry — mirrors export-for-engine.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
