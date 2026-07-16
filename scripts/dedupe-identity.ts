/**
 * US-008 — Burn duplicate csids and ambiguous pinakes_ids to zero.
 *
 * The export (`scripts/export-for-culturescrape.ts`) minted 44 duplicate csids
 * (`cs:<type>:<id>` collisions — same `id` reused by ≥2 nodes of ONE type) and 16
 * ambiguous `pinakes_id`s (one raw `id` reused across ≥2 node TYPES → different
 * csids). Both poison every downstream join. This is the one-shot, deterministic,
 * idempotent migration that resolves them by RENAMING (never deleting curated data,
 * except three byte-identical duplicate rows) and re-pointing the affected FK / edge
 * columns so referential integrity holds.
 *
 * Design rules (see docs/reconciliation-report.md + scripts/CLAUDE.md):
 *  - For an id shared by ≥2 rows of the SAME type (duplicate csid) we keep the primary
 *    row's id and rename the others (`-classical` historical variants, `-manding`/
 *    `-western`/… family-split near-duplicates, or a name-slug for a distinct language
 *    that mis-shares an ISO code). Three cuisine-items rows are byte-identical dupes and
 *    are deleted.
 *  - For an id shared ACROSS types (ambiguous) we keep the id on the side that owns the
 *    FK / edge references and rename the lighter side, re-pointing only the precise
 *    columns that must follow the renamed node. Every original id still resolves to a
 *    kept node, so no edge is orphaned into a needs-curation stub (US-007).
 *
 * The lexicons are the source of truth, so this script mutates them in place
 * byte-faithfully (per-file EOL + trailing-newline preserved) and is idempotent: a row
 * that has already been renamed (its old id absent) is simply skipped.
 *
 * Run: `npx tsx scripts/dedupe-identity.ts`  (then regenerate the committed snapshots).
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

interface Rename {
  /** Lexicon file whose node `id` cell is rewritten. */
  readonly file: string;
  /** The current `id` value to match. */
  readonly id: string;
  /** Extra column==value predicates that pin the exact row when the id repeats. */
  readonly disc?: Readonly<Record<string, string>>;
  /** The new, globally-unique id. */
  readonly newId: string;
  /** Reference columns that must follow the renamed node (old id → new id). */
  readonly repoint?: ReadonlyArray<{ readonly file: string; readonly col: string }>;
  /** Human note (why). */
  readonly why: string;
}

/** Delete ONE redundant occurrence of a byte-identical duplicate row. */
interface DeleteDup {
  readonly file: string;
  readonly id: string;
  readonly why: string;
}

// ── Language duplicate csids ──────────────────────────────────────────────────
// Keep the primary row's `id`; rename the collider. No FK/edge repoint is needed
// because the primary keeps the shared id, so every id-keyed reference still
// resolves (words/grammar/phono/etymology belong to the ISO owner we keep).
const LANGUAGE_RENAMES: readonly Rename[] = [
  // Historical-variant entries (is_historical_variant=true) that reuse the base ISO code.
  { file: "languages.tsv", id: "akk", disc: { is_historical_variant: "true" }, newId: "akk-classical", why: "Classical Akkadian variant shares ISO akk with the base entry" },
  { file: "languages.tsv", id: "arc", disc: { is_historical_variant: "true" }, newId: "arc-classical", why: "Classical Aramaic variant shares ISO arc" },
  { file: "languages.tsv", id: "cop", disc: { is_historical_variant: "true" }, newId: "cop-classical", why: "Coptic variant shares ISO cop" },
  { file: "languages.tsv", id: "egy", disc: { is_historical_variant: "true" }, newId: "egy-classical", why: "Ancient Egyptian variant shares ISO egy" },
  { file: "languages.tsv", id: "got", disc: { is_historical_variant: "true" }, newId: "got-classical", why: "Gothic variant shares ISO got" },
  { file: "languages.tsv", id: "lat", disc: { is_historical_variant: "true" }, newId: "lat-classical", why: "Classical Latin variant shares ISO lat with the base entry" },
  // Same language entered under two family hierarchies.
  { file: "languages.tsv", id: "bam", disc: { family_id: "mande__manding" }, newId: "bam-manding", why: "Bambara duplicated under two family hierarchies" },
  { file: "languages.tsv", id: "dje", disc: { family_id: "songhay__southern_songhay" }, newId: "dje-southern-songhay", why: "Zarma duplicated under two family hierarchies" },
  { file: "languages.tsv", id: "dyu", disc: { family_id: "mande__manding" }, newId: "dyu-manding", why: "Dyula duplicated under two family hierarchies" },
  { file: "languages.tsv", id: "ses", disc: { family_id: "songhay__southern_songhay" }, newId: "ses-southern-songhay", why: "Koyraboro Senni duplicated under two family hierarchies" },
  { file: "languages.tsv", id: "xal", disc: { family_id: "mongolic__western_mongolic" }, newId: "xal-western", why: "Kalmyk duplicated under two family hierarchies" },
  // Distinct languages mis-sharing an ISO / collective code — keep the true owner.
  { file: "languages.tsv", id: "abe", disc: { name: "Great Andamanese" }, newId: "great-andamanese", why: "abe is Western Abenaki; Great Andamanese mis-shares it" },
  { file: "languages.tsv", id: "arb", disc: { name: "Arabela" }, newId: "arabela", why: "arb is Standard Arabic" },
  { file: "languages.tsv", id: "aym", disc: { name: "Southern Aymara" }, newId: "southern-aymara", why: "aym is the Aymara macrolanguage; keep the first sub-lect" },
  { file: "languages.tsv", id: "cre", disc: { name: "Swampy Cree" }, newId: "swampy-cree", why: "cre is the Cree macrolanguage; keep the first sub-lect" },
  { file: "languages.tsv", id: "cub", disc: { name: "Guna" }, newId: "guna", why: "cub is Cubeo; Guna mis-shares it" },
  { file: "languages.tsv", id: "ess", disc: { name: "Esselen" }, newId: "esselen-language", why: "ess is Central Siberian Yupik; families.tsv already has an 'esselen' family" },
  { file: "languages.tsv", id: "evn", disc: { name: "Even" }, newId: "even", why: "evn is Evenki" },
  { file: "languages.tsv", id: "gvc", disc: { name: "Kadiwéu" }, newId: "kadiweu", why: "gvc is Guanano" },
  { file: "languages.tsv", id: "hio", disc: { name: "Tshwa" }, newId: "tshwa", why: "hio is Tsoa" },
  { file: "languages.tsv", id: "jav", disc: { name: "Javaé" }, newId: "javae", why: "jav is Javanese" },
  { file: "languages.tsv", id: "khi", disc: { name: "Hai||om" }, newId: "haiom", why: "khi is the Khoisan collective code; keep the first entry" },
  { file: "languages.tsv", id: "kui", disc: { name: "Kalapalo" }, newId: "kalapalo", why: "kui covers both Kuikuro and Kalapalo; keep the first" },
  { file: "languages.tsv", id: "myn", disc: { name: "Classical Mayan" }, newId: "classical-mayan", why: "myn is the Mayan collective code; keep the first entry" },
  { file: "languages.tsv", id: "nah", disc: { name: "Guerrero Nahuatl" }, newId: "guerrero-nahuatl", why: "nah is the Nahuatl collective code; keep Huasteca" },
  { file: "languages.tsv", id: "nah", disc: { name: "Central Nahuatl" }, newId: "central-nahuatl", why: "nah is the Nahuatl collective code; keep Huasteca" },
  { file: "languages.tsv", id: "poc", disc: { name: "Proto-Oceanic" }, newId: "proto-oceanic", why: "poc is Poqomam" },
  { file: "languages.tsv", id: "san", disc: { name: "San" }, newId: "san-mande", why: "san is Sanskrit (186 etymology edges); the Mande 'San' mis-shares it" },
  { file: "languages.tsv", id: "tam", disc: { name: "Old Tamil" }, newId: "old-tamil", why: "tam is Tamil" },
  { file: "languages.tsv", id: "umu", disc: { name: "Umutina" }, newId: "umutina", why: "umu is Munsee" },
  // Totonac collective code `tot` reused by 9 lects — keep Highland Totonac.
  { file: "languages.tsv", id: "tot", disc: { name: "Papantla Totonac" }, newId: "papantla-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Xicotepec de Juárez Totonac" }, newId: "xicotepec-de-juarez-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Filomeno Mata Totonac" }, newId: "filomeno-mata-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Coyutla Totonac" }, newId: "coyutla-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Upper Necaxa Totonac" }, newId: "upper-necaxa-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Tecpatlán Totonac" }, newId: "tecpatlan-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Ozumatlán Totonac" }, newId: "ozumatlan-totonac", why: "tot is the Totonac collective code" },
  { file: "languages.tsv", id: "tot", disc: { name: "Yecuatla Totonac" }, newId: "yecuatla-totonac", why: "tot is the Totonac collective code" },
];

// ── Cross-type ambiguous ids ──────────────────────────────────────────────────
// Keep the id on the FK/edge-referenced side; rename the lighter side and re-point
// only the precise columns that must follow it.
const CROSS_TYPE_RENAMES: readonly Rename[] = [
  // culture (civilization) vs place (settlement) — keep the civilization, rename the settlement (a leaf: no FK/edge points at it).
  { file: "settlements.tsv", id: "ava", newId: "ava-city", why: "language ava (Avar) owns the id; the Ava settlement is renamed" },
  { file: "settlements.tsv", id: "ayutthaya", newId: "ayutthaya-city", why: "keep the Ayutthaya civilization" },
  { file: "settlements.tsv", id: "delhi-sultanate", newId: "delhi-city", why: "keep the Delhi Sultanate civilization; the settlement is Delhi" },
  { file: "settlements.tsv", id: "great-zimbabwe", newId: "great-zimbabwe-city", why: "keep the Great Zimbabwe civilization" },
  { file: "settlements.tsv", id: "majapahit", newId: "majapahit-city", why: "keep the Majapahit civilization" },
  { file: "settlements.tsv", id: "mari", newId: "mari-city", why: "keep the Mari civilization (QID-anchored)" },
  { file: "settlements.tsv", id: "tiwanaku", newId: "tiwanaku-city", why: "keep the Tiwanaku civilization" },
  { file: "settlements.tsv", id: "vijayanagara", newId: "vijayanagara-city", why: "keep the Vijayanagara civilization" },
  { file: "settlements.tsv", id: "wari", newId: "wari-city", why: "keep the Wari civilization (QID-anchored)" },
  // archaeological-culture vs place — keep the archaeological culture (an edge endpoint), rename the settlement.
  { file: "settlements.tsv", id: "kerma", newId: "kerma-city", why: "keep the Kerma archaeological culture" },
  { file: "settlements.tsv", id: "uruk", newId: "uruk-city", why: "keep the Uruk archaeological culture (successor of ubaid)" },
  // place vs place (same type, duplicate csid) — keep the archaeological site, rename the settlement.
  { file: "settlements.tsv", id: "mohenjo-daro", newId: "mohenjo-daro-city", why: "same place also in archaeological-sites.tsv; a 'mohenjo-daro-settlement' row already exists" },
  // culture vs language-family — keep the civilization (heavily referenced); rename the family and re-point its one child's parent_id.
  { file: "families.tsv", id: "elamite", newId: "elamite-family", why: "keep the Elamite civilization; the Elamite language family is renamed", repoint: [{ file: "families.tsv", col: "parent_id" }] },
  { file: "families.tsv", id: "sumerian", newId: "sumerian-family", why: "keep the Sumer civilization; the Sumerian language family is renamed", repoint: [{ file: "families.tsv", col: "parent_id" }] },
  // archaeological-culture vs civilization — keep the archaeological culture (an edge endpoint); rename the civilization and re-point its civilization_id references.
  { file: "civilizations.tsv", id: "indus-valley", newId: "indus-valley-civ", why: "keep the Indus Valley archaeological culture (successor of mehrgarh); an 'indus-valley-civilization' archaeological culture already exists", repoint: [{ file: "civilization-boundaries.tsv", col: "civilization_id" }, { file: "culture-profiles.tsv", col: "civilization_id" }, { file: "settlements.tsv", col: "civilization_id" }] },
  { file: "civilizations.tsv", id: "olmec", newId: "olmec-civilization", why: "keep the Olmec archaeological culture (cultural-lineage source)", repoint: [{ file: "civilization-boundaries.tsv", col: "civilization_id" }, { file: "culture-profiles.tsv", col: "civilization_id" }] },
  // archaeological-culture vs language — keep the archaeological culture (a lineage source); rename the language and re-point its FK columns.
  { file: "languages.tsv", id: "nok", disc: { name: "Nooksack" }, newId: "nooksack", why: "keep the Nok archaeological culture; Nooksack is renamed", repoint: [{ file: "grammar-features.tsv", col: "language_id" }, { file: "phonological-inventories.tsv", col: "language_id" }] },
];

// ── Cuisine-items duplicate csids ─────────────────────────────────────────────
const CUISINE_RENAMES: readonly Rename[] = [
  { file: "cuisine-items.tsv", id: "iranian-kufteh-tabrizi", disc: { food_type: "Soup" }, newId: "iranian-kufteh-tabrizi-2", why: "same dish, two food_type categorisations — keep both" },
  { file: "cuisine-items.tsv", id: "korean-japchae", disc: { food_type: "Side Dish" }, newId: "korean-japchae-2", why: "same dish, two food_type categorisations — keep both" },
];
const CUISINE_DELETES: readonly DeleteDup[] = [
  { file: "cuisine-items.tsv", id: "french-bouillabaisse", why: "byte-identical duplicate row" },
  { file: "cuisine-items.tsv", id: "iranian-eshkeneh", why: "byte-identical duplicate row" },
  { file: "cuisine-items.tsv", id: "vietnamese-banh-trang-tron", why: "byte-identical duplicate row" },
];

const ALL_RENAMES: readonly Rename[] = [...LANGUAGE_RENAMES, ...CROSS_TYPE_RENAMES, ...CUISINE_RENAMES];

// ── byte-faithful TSV editing ─────────────────────────────────────────────────
interface Tsv {
  readonly eol: string;
  readonly trailingNewline: boolean;
  readonly header: string[];
  readonly rows: string[][];
  dirty: boolean;
}

function readTsv(file: string): Tsv {
  const raw = fs.readFileSync(path.join(LEXICONS_DIR, file), "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = raw.endsWith("\n");
  const body = trailingNewline ? raw.slice(0, raw.length - eol.length) : raw;
  const lines = body.split(eol);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { eol, trailingNewline, header, rows, dirty: false };
}

function writeTsv(file: string, tsv: Tsv): void {
  const lines = [tsv.header.join("\t"), ...tsv.rows.map((r) => r.join("\t"))];
  let out = lines.join(tsv.eol);
  if (tsv.trailingNewline) out += tsv.eol;
  fs.writeFileSync(path.join(LEXICONS_DIR, file), out, "utf8");
}

const cache = new Map<string, Tsv>();
function tsvFor(file: string): Tsv {
  let t = cache.get(file);
  if (t === undefined) {
    t = readTsv(file);
    cache.set(file, t);
  }
  return t;
}

/** Repoint a single or delimited/JSON-list reference cell from oldId → newId. */
function repointCell(value: string, oldId: string, newId: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return value;
  if (trimmed === oldId) return newId;
  // JSON array of ids
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(arr) && arr.some((x) => String(x) === oldId)) {
        return JSON.stringify(arr.map((x) => (String(x) === oldId ? newId : x)));
      }
    } catch {
      /* fall through */
    }
  }
  // Delimited list
  if (/[;,|]/.test(trimmed)) {
    const parts = trimmed.split(/([;,|])/); // keep delimiters
    let changed = false;
    const rebuilt = parts.map((p) => {
      if (p.trim() === oldId) {
        changed = true;
        return p.replace(oldId, newId);
      }
      return p;
    });
    if (changed) return rebuilt.join("");
  }
  return value;
}

function applyRename(r: Rename, log: string[]): void {
  const tsv = tsvFor(r.file);
  const idIdx = tsv.header.indexOf("id");
  if (idIdx < 0) throw new Error(`${r.file} has no id column`);
  const discEntries = Object.entries(r.disc ?? {}).map(([col, val]) => {
    const idx = tsv.header.indexOf(col);
    if (idx < 0) throw new Error(`${r.file} has no ${col} column`);
    return [idx, val] as const;
  });
  const matches = tsv.rows.filter(
    (row) =>
      (row[idIdx] ?? "").trim() === r.id &&
      discEntries.every(([idx, val]) => (row[idx] ?? "").trim() === val),
  );
  if (matches.length === 0) {
    // idempotent: already renamed (or newId already present)
    const already = tsv.rows.some((row) => (row[idIdx] ?? "").trim() === r.newId);
    log.push(`  skip ${r.file} ${r.id}→${r.newId} (${already ? "already applied" : "no match"})`);
    return;
  }
  if (matches.length > 1) {
    throw new Error(`${r.file} ${r.id} + ${JSON.stringify(r.disc)} matched ${matches.length} rows (need exactly 1)`);
  }
  matches[0][idIdx] = r.newId;
  tsv.dirty = true;
  log.push(`  rename ${r.file} ${r.id}→${r.newId}  (${r.why})`);
  // Re-point references.
  for (const rp of r.repoint ?? []) {
    const ref = tsvFor(rp.file);
    const cidx = ref.header.indexOf(rp.col);
    if (cidx < 0) throw new Error(`${rp.file} has no ${rp.col} column`);
    let n = 0;
    for (const row of ref.rows) {
      const before = row[cidx] ?? "";
      const after = repointCell(before, r.id, r.newId);
      if (after !== before) {
        row[cidx] = after;
        ref.dirty = true;
        n += 1;
      }
    }
    log.push(`    repoint ${rp.file}.${rp.col}: ${r.id}→${r.newId} (${n} cells)`);
  }
}

function applyDelete(d: DeleteDup, log: string[]): void {
  const tsv = tsvFor(d.file);
  const idIdx = tsv.header.indexOf("id");
  const idxs = tsv.rows.map((row, i) => [i, row] as const).filter(([, row]) => (row[idIdx] ?? "").trim() === d.id);
  if (idxs.length <= 1) {
    log.push(`  skip delete ${d.file} ${d.id} (${idxs.length} row(s), nothing redundant)`);
    return;
  }
  // Remove the last occurrence (byte-identical, so which one is irrelevant).
  const removeAt = idxs[idxs.length - 1][0];
  tsv.rows.splice(removeAt, 1);
  tsv.dirty = true;
  log.push(`  delete ${d.file} ${d.id} (removed 1 of ${idxs.length} identical rows) — ${d.why}`);
}

export function runDedupe(): string[] {
  const log: string[] = [];
  log.push("Renames:");
  for (const r of ALL_RENAMES) applyRename(r, log);
  log.push("Deletes:");
  for (const d of CUISINE_DELETES) applyDelete(d, log);
  for (const [file, tsv] of cache) {
    if (tsv.dirty) writeTsv(file, tsv);
  }
  return log;
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""));
if (isMain) {
  const log = runDedupe();
  console.log(log.join("\n"));
}
