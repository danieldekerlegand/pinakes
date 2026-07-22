/**
 * Entity-grounding snapshot exporter (analyzer-bridge US-002, Bridge 1's producer).
 *
 * Emits a compact, license-filtered JSON export of canonical entities + the
 * reconciliation keys Analyzer's enrichment step consumes **offline** to ground
 * per-file facts in real-world referents (the media-bridge mapping spec §4.2). Two files that
 * mention the same entity link through it and inherit pinakes's knowledge — that is
 * what turns per-file datapoints into a web *connecting* files.
 *
 * Shape (envelope + one record per entity):
 *
 *   {
 *     contractVersion, generatedAt, source, licenseClasses, domains,
 *     entities: [{
 *       csid, entityType, name, aliases,
 *       reconciliation: { wikidataQid, normalizedName, iso639_1?, iso639_2?, glottocode? },
 *       provenance: { source, sourceUrl, retrievedAt, confidence },
 *       license,           // SPDX id
 *     }]
 *   }
 *
 * **Size-conscious by design:** keys and names only — no `description`/bulk fields —
 * so the snapshot stays small enough to ship and diff.
 *
 * **Deterministic + idempotent:** entities are csid-sorted and carry no wall-clock,
 * so two builds are byte-identical *modulo* the envelope `generatedAt` timestamp
 * (the only non-deterministic field; the pure builder never stamps it — the writer
 * does). A committed fixture snapshot (`scripts/data/entity-grounding-snapshot.json`,
 * built from `scripts/data/entity-grounding-fixture/`) pins the shape.
 *
 * **License-filterable:** `--license-classes CC0,CC-BY` (default) keeps only entities
 * whose SPDX license belongs to an allowed *class* (family, version-independent —
 * `CC-BY-4.0`→`CC-BY`, `CC0-1.0`→`CC0`). A share-alike source (`CC-BY-SA-*`) is
 * excluded by default. **Domain-filterable:** `--domains language,culture` keeps only
 * those entity types. Both filters are pure over the built entity list.
 *
 * `buildEntityGrounding` is pure over a lexicons directory (tests drive it with
 * fixtures); `snapshotEnvelope`/`writeSnapshot`/`runExport` do the wrapping + fs side.
 */
import fs from "node:fs";
import path from "node:path";
import { nodeTypeByName } from "@shared/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@shared/lexicon-mapping";
import {
  mintCsid,
  normaliseConfidence,
  DEFAULT_NODE_CONFIDENCE,
  EXPORT_SOURCE,
  EXPORT_DIR,
  DEFAULT_LICENSE,
  licenseForSource,
  deriveSourceUrl,
  parseCitation,
} from "./export-for-culturescrape.ts";
import { normalizeKey, normalizeQid } from "./reconciliation-report.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Gitignored output tree for the full entity-grounding snapshot (live corpus). */
export const GROUNDING_DIR = path.join(EXPORT_DIR, "entity-grounding");

/** Committed fixture snapshot (built from {@link FIXTURE_LEXICONS_DIR}). */
export const FIXTURE_SNAPSHOT_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "entity-grounding-snapshot.json",
);

/** Committed fixture lexicons the fixture snapshot is built from. */
export const FIXTURE_LEXICONS_DIR = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "entity-grounding-fixture",
);

/** Snapshot contract version — bump on any breaking shape change (consumer pins it). */
export const CONTRACT_VERSION = "1.0.0";

/**
 * Fixed `generatedAt` stamped on the committed fixture snapshot so it is fully
 * deterministic (the live-corpus CLI stamps the real wall-clock instead).
 */
export const FIXTURE_GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** Default allowed license *classes* (families, version-independent) — CC0 + CC-BY. */
export const DEFAULT_LICENSE_CLASSES: readonly string[] = ["CC0", "CC-BY"];

/** Reconciliation keys carried per entity (Analyzer's offline grounding cascade). */
export interface GroundingReconciliation {
  /** Normalized `wikidata_qid` (`Q…`), `""` when the row carries none. Cascade step 1. */
  readonly wikidataQid: string;
  /** Normalized `name` — the `(normalized name, entityType)` blocking key component. */
  readonly normalizedName: string;
  /** ISO 639-1 code — languages only, omitted when absent. */
  readonly iso639_1?: string;
  /** ISO 639-2/3 code — languages only, omitted when absent. */
  readonly iso639_2?: string;
  /** Glottolog code — languages only, omitted when absent. */
  readonly glottocode?: string;
}

/** Per-record provenance (canonical vocabulary; SPDX license carried separately). */
export interface GroundingProvenance {
  readonly source: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly confidence: number;
}

/** One grounded canonical entity (keys + names only — no bulk fields). */
export interface GroundingEntity {
  readonly csid: string;
  readonly entityType: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly reconciliation: GroundingReconciliation;
  readonly provenance: GroundingProvenance;
  /** SPDX license id (e.g. `CC-BY-4.0`). */
  readonly license: string;
}

/** The full snapshot envelope written to disk. */
export interface GroundingSnapshot {
  readonly contractVersion: string;
  readonly generatedAt: string;
  readonly source: string;
  /** The license classes this snapshot was filtered to (provenance of the filter). */
  readonly licenseClasses: readonly string[];
  /** The entity-type domains this snapshot was filtered to (`[]` = all domains). */
  readonly domains: readonly string[];
  readonly count: number;
  readonly entities: readonly GroundingEntity[];
}

/** Options controlling which entities land in the snapshot. */
export interface GroundingOptions {
  /** Allowed license classes; an entity outside them is excluded. Default {@link DEFAULT_LICENSE_CLASSES}. */
  readonly licenseClasses?: readonly string[];
  /** Allowed entity-type domains; empty/undefined = all domains. */
  readonly domains?: readonly string[];
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
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

/** Column index (in `headers`) for the lexicon column mapped to canonical `target`. */
function targetColIndex(file: string, headers: string[], target: string): number {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return -1;
  const col = mapping.columns.find((c) => c.target === target);
  return col ? headers.indexOf(col.column) : -1;
}

/** Case-insensitive exact-name header lookup, else -1. */
function headerIndex(headers: string[], name: string): number {
  const lower = name.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase() === lower);
}

/** First header matching `glottocode`/`glottolog`, else -1 (mirrors reconciliation-report). */
function glottocodeColIndex(headers: string[]): number {
  return headers.findIndex((h) => /glotto/i.test(h));
}

/**
 * Parse an `aliases`/`native_name` cell into a deduped, ordered list. Handles a JSON
 * array (`["Deutsch","Alemán"]`) and `;`/`|`-separated lists; commas are NOT split
 * (names contain them). A plain non-empty string yields a single-element list.
 */
export function parseAliases(value: string): string[] {
  const v = value.trim();
  if (v === "") return [];
  let parts: string[];
  if (v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v);
      parts = Array.isArray(parsed)
        ? parsed.filter((s): s is string => typeof s === "string")
        : [v];
    } catch {
      parts = [v];
    }
  } else {
    parts = v.split(/[;|]/);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (t !== "" && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * The license *class* of an SPDX id — the family without its version, so version
 * bumps don't change the filter (`CC-BY-4.0`→`CC-BY`, `CC-BY-SA-3.0`→`CC-BY-SA`,
 * `CC0-1.0`→`CC0`). A non-versioned/unknown id is its own class.
 */
export function licenseClass(spdx: string): string {
  return spdx.trim().replace(/-\d+(\.\d+)*$/, "");
}

/** Whether an SPDX license belongs to one of the allowed classes. */
export function licenseAllowed(
  spdx: string,
  allowedClasses: readonly string[],
): boolean {
  return allowedClasses.includes(licenseClass(spdx));
}

/**
 * Build every grounded entity from a lexicons directory (pure — no filesystem writes,
 * no wall-clock). Mirrors the export's node pass: dedupes by csid, mints QID-anchored
 * csids, forces `source = pinakes` (the reconciler anchor), and resolves an SPDX
 * license per record. A row-level `license` column wins over the source default (the
 * same precedence culture-scrape's adapter uses), so a mixed-license corpus grounds
 * with genuine per-record licenses. Entities are filtered by license class + domain
 * and returned csid-sorted.
 */
export function buildEntityGrounding(
  lexiconsDir: string = LEXICONS_DIR,
  options: GroundingOptions = {},
): GroundingEntity[] {
  const licenseClasses = options.licenseClasses ?? DEFAULT_LICENSE_CLASSES;
  const domains = options.domains ?? [];
  const domainSet = domains.length > 0 ? new Set(domains) : null;

  const entities: GroundingEntity[] = [];
  const seenCsids = new Set<string>();

  for (const { file, node } of nodeFiles()) {
    if (domainSet && !domainSet.has(node)) continue;
    const typeInfo = nodeTypeByName(node);
    if (typeInfo === undefined) continue;
    const { headers, rows } = readTsv(path.join(lexiconsDir, file));
    if (headers.length === 0) continue;

    const idIdx = targetColIndex(file, headers, "pinakes_id");
    const qidIdx = targetColIndex(file, headers, "wikidata_qid");
    const nameIdx = targetColIndex(file, headers, "name");
    const aliasIdx = targetColIndex(file, headers, "aliases");
    const confIdx = targetColIndex(file, headers, "confidence");
    const sourceUrlIdx = targetColIndex(file, headers, "source_url");
    const retrievedAtIdx = targetColIndex(file, headers, "retrieved_at");
    const citationIdx = targetColIndex(file, headers, "source");
    const licenseIdx = headerIndex(headers, "license");
    const isLanguage = node === "language";
    const iso1Idx = isLanguage ? headerIndex(headers, "iso639_1") : -1;
    const iso2Idx = isLanguage ? headerIndex(headers, "iso639_2") : -1;
    const glottoIdx = isLanguage ? glottocodeColIndex(headers) : -1;

    for (const row of rows) {
      const pinakesId = cell(row, idIdx);
      if (pinakesId === "") continue;
      const rawQid = cell(row, qidIdx);
      const csid = mintCsid(node, pinakesId, rawQid);
      if (seenCsids.has(csid)) continue;
      seenCsids.add(csid);

      // License: a row-level license cell wins; else the record's source default
      // (source is forced to pinakes → DEFAULT_LICENSE, matching the canonical export).
      const rowLicense = cell(row, licenseIdx);
      const license = rowLicense !== "" ? rowLicense : licenseForSource(EXPORT_SOURCE);
      if (!licenseAllowed(license, licenseClasses)) continue;

      const name = cell(row, nameIdx);
      const citation = citationIdx >= 0 ? parseCitation(cell(row, citationIdx)) : "";
      const rowSourceUrl = cell(row, sourceUrlIdx);

      const reconciliation: GroundingReconciliation = {
        wikidataQid: normalizeQid(rawQid),
        normalizedName: normalizeKey(name),
      };
      if (isLanguage) {
        const iso639_1 = cell(row, iso1Idx);
        const iso639_2 = cell(row, iso2Idx);
        const glottocode = cell(row, glottoIdx);
        if (iso639_1 !== "") (reconciliation as { iso639_1?: string }).iso639_1 = iso639_1;
        if (iso639_2 !== "") (reconciliation as { iso639_2?: string }).iso639_2 = iso639_2;
        if (glottocode !== "")
          (reconciliation as { glottocode?: string }).glottocode = glottocode;
      }

      entities.push({
        csid,
        entityType: node,
        name,
        aliases: parseAliases(cell(row, aliasIdx)),
        reconciliation,
        provenance: {
          source: EXPORT_SOURCE,
          sourceUrl: rowSourceUrl || deriveSourceUrl(citation),
          retrievedAt: cell(row, retrievedAtIdx),
          confidence: normaliseConfidence(cell(row, confIdx), DEFAULT_NODE_CONFIDENCE),
        },
        license,
      });
    }
  }

  entities.sort((a, b) => (a.csid < b.csid ? -1 : a.csid > b.csid ? 1 : 0));
  return entities;
}

/**
 * Wrap built entities in the snapshot envelope. `generatedAt` is the sole
 * non-deterministic field — the caller supplies it (the CLI stamps the wall-clock,
 * the fixture pins {@link FIXTURE_GENERATED_AT}).
 */
export function snapshotEnvelope(
  entities: readonly GroundingEntity[],
  opts: {
    generatedAt: string;
    licenseClasses?: readonly string[];
    domains?: readonly string[];
  },
): GroundingSnapshot {
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: opts.generatedAt,
    source: EXPORT_SOURCE,
    licenseClasses: [...(opts.licenseClasses ?? DEFAULT_LICENSE_CLASSES)],
    domains: [...(opts.domains ?? [])],
    count: entities.length,
    entities,
  };
}

/** Serialise a snapshot to its JSON form (trailing newline). */
export function snapshotJson(snapshot: GroundingSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + "\n";
}

/** Build the committed fixture snapshot (pinned timestamp) from the fixture lexicons. */
export function buildFixtureSnapshot(): GroundingSnapshot {
  const entities = buildEntityGrounding(FIXTURE_LEXICONS_DIR);
  return snapshotEnvelope(entities, {
    generatedAt: FIXTURE_GENERATED_AT,
    licenseClasses: DEFAULT_LICENSE_CLASSES,
    domains: [],
  });
}

/** Write a snapshot to `<GROUNDING_DIR>/snapshot.json` (gitignored). */
export function writeSnapshot(
  snapshot: GroundingSnapshot,
  outDir: string = GROUNDING_DIR,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "snapshot.json"), snapshotJson(snapshot));
}

/** Parse `--license-classes a,b` / `--domains a,b` / `--out dir` from argv. */
export function parseArgs(argv: readonly string[]): {
  licenseClasses: readonly string[];
  domains: readonly string[];
  outDir: string;
  emitFixture: boolean;
} {
  let licenseClasses: readonly string[] = DEFAULT_LICENSE_CLASSES;
  let domains: readonly string[] = [];
  let outDir = GROUNDING_DIR;
  let emitFixture = false;
  const list = (v: string) =>
    v.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--license-classes") licenseClasses = list(argv[++i] ?? "");
    else if (arg === "--domains") domains = list(argv[++i] ?? "");
    else if (arg === "--out") outDir = argv[++i] ?? outDir;
    else if (arg === "--emit-fixture") emitFixture = true;
  }
  return { licenseClasses, domains, outDir, emitFixture };
}

/**
 * Build + write the live-corpus snapshot. `generatedAt` defaults to the wall-clock
 * (idempotent modulo this field). Returns the written snapshot.
 */
export function runExport(
  opts: {
    lexiconsDir?: string;
    outDir?: string;
    licenseClasses?: readonly string[];
    domains?: readonly string[];
    generatedAt?: string;
  } = {},
): GroundingSnapshot {
  const entities = buildEntityGrounding(opts.lexiconsDir ?? LEXICONS_DIR, {
    licenseClasses: opts.licenseClasses,
    domains: opts.domains,
  });
  const snapshot = snapshotEnvelope(entities, {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    licenseClasses: opts.licenseClasses,
    domains: opts.domains,
  });
  writeSnapshot(snapshot, opts.outDir ?? GROUNDING_DIR);
  return snapshot;
}

// CLI entry — mirrors export-for-culturescrape.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const { licenseClasses, domains, outDir, emitFixture } = parseArgs(
    process.argv.slice(2),
  );
  if (emitFixture) {
    const snapshot = buildFixtureSnapshot();
    fs.writeFileSync(FIXTURE_SNAPSHOT_PATH, snapshotJson(snapshot));
    // eslint-disable-next-line no-console
    console.log(
      `Wrote fixture snapshot (${snapshot.count} entities) → ${FIXTURE_SNAPSHOT_PATH}`,
    );
  } else {
    const snapshot = runExport({ licenseClasses, domains, outDir });
    // eslint-disable-next-line no-console
    console.log(
      `Entity-grounding snapshot: ${snapshot.count} entities ` +
        `(licenseClasses=${snapshot.licenseClasses.join("+") || "all"}, ` +
        `domains=${snapshot.domains.join("+") || "all"}) → ${outDir}/snapshot.json`,
    );
  }
}
