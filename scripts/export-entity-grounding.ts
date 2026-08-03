/**
 * Entity-grounding pack exporter — pinakes's producer on the KGP **knowledge data
 * plane** (`koine/specs/grounding-pack.md` §2), originally a media-analysis bridge's
 * snapshot exporter and **retargeted** (US-PKA3) onto the KGP GroundingPack envelope.
 *
 * Emits a compact, license-filtered JSON export of canonical entities + the
 * reconciliation keys an analyzer's enrichment step consumes **offline** to ground
 * per-file facts in real-world referents (the media-analysis bridge spec §4.2). Two files that
 * mention the same entity link through it and inherit pinakes's knowledge — that is
 * what turns per-file datapoints into a web *connecting* files.
 *
 * Shape (KGP envelope + the pinakes payload it already carried):
 *
 *   {
 *     kgp_version, pack_id, producer, worlds, kind, basis, dialect,   // KGP §2
 *     contractVersion, generatedAt, source, licenseClasses, domains,  // pinakes envelope
 *     count,
 *     entities: [{
 *       csid, entityType, name, aliases,
 *       reconciliation: { wikidataQid, normalizedName, iso639_1?, iso639_2?, glottocode? },
 *       provenance: { source, sourceUrl, retrievedAt, confidence },
 *       license,           // SPDX id
 *     }],
 *     assertions: [{ id, world, subject, relation, object, confidence, license, prov }],
 *     links: [],
 *     manifest: { counts, created, signing, license_policy }
 *   }
 *
 * The **entity records are unchanged** by the retarget — csid, reconciliation keys and
 * provenance are exactly what Bridge 1 shipped; the envelope around them is now KGP's.
 *
 * **Assertions are the reconciliation anchors.** Each QID-bearing entity yields one
 * `exact_match(pinakes:ent:<type>.<local>, wikidata:ent:<QID>)` claim whose `id` is
 * minted by the NORMATIVE KGP §3 normalization over the shared relation registry
 * (`@contracts/kgp`), so the same anchor asserted by another producer mints the same claim
 * id and merges. `links` stays empty: KINP's reserved equivalence/lifecycle relations
 * (`same_as`/`retracts`/…) are not what a grounding snapshot emits.
 *
 * **Size-conscious by design:** keys and names only — no `description`/bulk fields —
 * so the pack stays small enough to ship and diff.
 *
 * **Deterministic + reproducible:** entities are csid-sorted, assertions claim-id-sorted,
 * and neither carries a wall-clock, so two builds of the same corpus are byte-identical
 * *modulo* the envelope `generatedAt`/`manifest.created` timestamp — which is excluded
 * from the `pack_id` precisely so the same input yields the same content address. A
 * committed fixture snapshot (`scripts/data/entity-grounding-snapshot.json`, built from
 * `scripts/data/entity-grounding-fixture/`) pins the shape.
 *
 * **License-filterable:** `--license-classes CC0,CC-BY` (default) keeps only entities
 * whose SPDX license belongs to an allowed *class* (family, version-independent —
 * `CC-BY-4.0`→`CC-BY`, `CC0-1.0`→`CC0`). A share-alike source (`CC-BY-SA-*`) is
 * excluded by default; the applied filter is republished as the KGP §7.1
 * `manifest.license_policy`. **Domain-filterable:** `--domains language,culture` keeps
 * only those entity types. Both filters are pure over the built entity list.
 *
 * `buildEntityGrounding`/`buildAssertions` are pure over a lexicons directory (tests
 * drive them with fixtures); `buildGroundingPack`/`writeSnapshot`/`runExport` do the
 * wrapping + fs side.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CANONICAL_SCHEMA,
  nodeProvenanceColumns,
  nodeTypeByName,
} from "@contracts/canonical-schema";
import { nodeFiles, lexiconMappingByFile } from "@contracts/lexicon-mapping";
import { RESOLVER_IDENTITY, type KnowledgeDialect } from "@contracts/capability-manifest";
import {
  KGP_VERSION,
  KGP_PRODUCER,
  DEFAULT_DIALECT,
  PACK_WORLD,
  assertRelationAllowed,
  canonicalClaimArgs,
  csidToKinpCurie,
  licensePolicyFor,
  mintClaimId,
  mintPackId,
  wikidataEntityCurie,
  type Claim,
  type LicensePolicy,
  type PackElement,
  type PackKind,
} from "@contracts/kgp";
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
} from "./export-for-engine.ts";
import { normalizeKey, normalizeQid } from "./reconciliation-report.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "data", "source", "lexicons");

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

/**
 * Snapshot contract version — bump on any breaking shape change (consumer pins it).
 * **2.0.0** is the KGP retarget (US-PKA3): the entity records are untouched, the
 * envelope around them became a KGP GroundingPack.
 */
export const CONTRACT_VERSION = "2.0.0";

/** The dialect every pinakes pack ships at — ground facts + confidence, no rules (KGP §5). */
export const PACK_DIALECT: KnowledgeDialect = DEFAULT_DIALECT;

/** The registry relation a reconciliation anchor is asserted with (grounding-only tier). */
export const ANCHOR_RELATION = "exact_match";

/** W3C-PROV `activity` for every assertion this exporter mints (no run id — packs stay reproducible). */
export const PACK_ACTIVITY = "pinakes:src:export-entity-grounding";

/** W3C-PROV `method`: the QID anchor *is* reconciliation cascade step 1. */
export const ANCHOR_METHOD = "wikidata-qid-anchor";

/** Signing shape shared with the KCB manifest (KGP §9.3) — unsigned until a key is provisioned. */
export const PACK_SIGNING = { key_id: null, alg: "ed25519" } as const;

/**
 * Fixed `generatedAt` stamped on the committed fixture snapshot so it is fully
 * deterministic (the live-corpus CLI stamps the real wall-clock instead).
 */
export const FIXTURE_GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** Default allowed license *classes* (families, version-independent) — CC0 + CC-BY. */
export const DEFAULT_LICENSE_CLASSES: readonly string[] = ["CC0", "CC-BY"];

/** Reconciliation keys carried per entity (the analyzer's offline grounding cascade). */
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

/** W3C-PROV shape carried by an assertion (KINP §7.1); the SPDX license rides beside it. */
export interface AssertionProvenance {
  readonly agent: string;
  readonly activity: string;
  /** Transaction time — the row's `retrieved_at` (never a wall-clock, so packs reproduce). */
  readonly asserted: string;
  readonly method: string;
  readonly source_url: string;
}

/** One KINP assertion envelope (§7.1) whose `id` is the KGP §3 content hash of the claim. */
export interface GroundingAssertion {
  /** `sha256-…` claim id — the same fact from any producer mints this same id. */
  readonly id: string;
  readonly world: string;
  readonly subject: string;
  readonly relation: string;
  readonly object: string;
  readonly confidence: number;
  /** SPDX id — license rides on records, never in the claim hash (KGP §7.1). */
  readonly license: string;
  readonly prov: AssertionProvenance;
}

/** The pack manifest (KGP §2): counts, emission time, signing shape, license policy. */
export interface PackManifest {
  readonly counts: {
    readonly entities: number;
    readonly assertions: number;
    readonly links: number;
  };
  readonly created: string;
  readonly signing: { readonly key_id: string | null; readonly alg: string };
  readonly license_policy: LicensePolicy;
}

/**
 * The full KGP GroundingPack written to disk. The `kgp_*`/`producer`/`worlds`/`kind`/
 * `basis`/`dialect`/`manifest` fields are the spec's (§2, spec-named so the document is
 * servable verbatim); `contractVersion`/`generatedAt`/`source`/`licenseClasses`/
 * `domains`/`count` are the pinakes envelope Bridge 1's consumer already pins.
 */
export interface GroundingPack {
  readonly kgp_version: string;
  /** Content address of this pack (KGP §2.1) — same knowledge in ⇒ same id out. */
  readonly pack_id: string;
  readonly producer: string;
  readonly worlds: readonly string[];
  readonly kind: PackKind;
  /** For a delta: the `pack_id` it applies against; `null` for a snapshot (KGP §6). */
  readonly basis: string | null;
  readonly dialect: KnowledgeDialect;
  readonly contractVersion: string;
  readonly generatedAt: string;
  readonly source: string;
  /** The license classes this pack was filtered to (provenance of the filter). */
  readonly licenseClasses: readonly string[];
  /** The entity-type domains this pack was filtered to (`[]` = all domains). */
  readonly domains: readonly string[];
  readonly count: number;
  readonly entities: readonly GroundingEntity[];
  readonly assertions: readonly GroundingAssertion[];
  /** KINP reserved equivalence/lifecycle relations — a grounding snapshot emits none. */
  readonly links: readonly GroundingAssertion[];
  readonly manifest: PackManifest;
}

/** Options controlling which entities land in the snapshot. */
export interface GroundingOptions {
  /**
   * Allowed license classes; an entity outside them is excluded. Default
   * {@link DEFAULT_LICENSE_CLASSES}. `null` disables the filter entirely — used by the
   * Insimul projection to count what the filter *excluded*, never to emit a pack.
   */
  readonly licenseClasses?: readonly string[] | null;
  /** Allowed entity-type domains; empty/undefined = all domains. */
  readonly domains?: readonly string[];
}

/**
 * Assert the canonical schema declares the per-record `license` column (schema v1.1,
 * `scale-ready-conversion` US-003). License *filtering* is meaningless without it — a
 * pack built against a v1.0 schema would silently admit share-alike records — so both
 * this exporter and the Insimul projection fail loudly rather than emit an unfiltered
 * pack. Throws with the remedy in the message. The column list is a parameter so the check
 * itself is testable without stubbing the live schema.
 */
export function assertLicenseColumn(
  provenanceColumns: readonly string[] = nodeProvenanceColumns(),
): void {
  if (!provenanceColumns.includes("license")) {
    throw new Error(
      "grounding-pack: canonical schema v" +
        CANONICAL_SCHEMA.version +
        ' declares no per-record "license" provenance column, so license-class filtering' +
        " cannot be enforced. Upgrade contracts/canonical-schema.json to v1.1+ (the" +
        " scale-ready-conversion US-003 SPDX column) before exporting a grounding pack.",
    );
  }
}

/** Read a cell, trimming whitespace; out-of-range indices yield `""`. */
export function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/** Parse a TSV file into `{ headers, rows }`; missing files yield empties. */
export function readTsv(filePath: string): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/** Column index (in `headers`) for the lexicon column mapped to canonical `target`. */
export function targetColIndex(file: string, headers: string[], target: string): number {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) return -1;
  const col = mapping.columns.find((c) => c.target === target);
  return col ? headers.indexOf(col.column) : -1;
}

/** Case-insensitive exact-name header lookup, else -1. */
export function headerIndex(headers: string[], name: string): number {
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
 * same precedence pinakes-engine's adapter uses), so a mixed-license corpus grounds
 * with genuine per-record licenses. Entities are filtered by license class + domain
 * and returned csid-sorted.
 */
export function buildEntityGrounding(
  lexiconsDir: string = LEXICONS_DIR,
  options: GroundingOptions = {},
): GroundingEntity[] {
  assertLicenseColumn();
  const licenseClasses =
    options.licenseClasses === undefined ? DEFAULT_LICENSE_CLASSES : options.licenseClasses;
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
      if (licenseClasses !== null && !licenseAllowed(license, licenseClasses)) continue;

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

/** SHA-256 → lowercase hex, the hasher KGP §3.2 rule 7 mandates for claims and packs. */
const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/**
 * Mint the identity-anchor assertions: one `exact_match` claim per QID-bearing entity,
 * linking the pinakes entity CURIE to its Wikidata anchor (KINP §4.4 — the primary
 * real-world anchor, and reconciliation cascade step 1).
 *
 * The claim `id` comes from the NORMATIVE KGP §3 normalization, so it is independent of
 * confidence/provenance: another producer asserting the same anchor mints the same id
 * and the two merge with both provenance records retained. `subject`/`object` are read
 * back from {@link canonicalClaimArgs} so the record's operand order is the one that was
 * hashed (`exact_match` is symmetric — §3.2 rule 2 sorts its operands).
 *
 * Pure: no filesystem, no wall-clock. Assertions come back claim-id-sorted and deduped.
 */
export function buildAssertions(
  entities: readonly GroundingEntity[],
  world: string = PACK_WORLD,
): GroundingAssertion[] {
  assertRelationAllowed(ANCHOR_RELATION, PACK_DIALECT);
  const assertions: GroundingAssertion[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    const qid = entity.reconciliation.wikidataQid;
    if (qid === "") continue;
    const claim: Claim = {
      world,
      relation: ANCHOR_RELATION,
      args: [
        { kind: "id", curie: csidToKinpCurie(entity.csid) },
        { kind: "id", curie: wikidataEntityCurie(qid) },
      ],
    };
    const id = mintClaimId(claim, sha256Hex);
    if (seen.has(id)) continue;
    seen.add(id);
    const [subject, object] = canonicalClaimArgs(claim);
    assertions.push({
      id,
      world,
      subject,
      relation: ANCHOR_RELATION,
      object,
      confidence: entity.provenance.confidence,
      license: entity.license,
      prov: {
        agent: RESOLVER_IDENTITY,
        activity: PACK_ACTIVITY,
        asserted: entity.provenance.retrievedAt,
        method: ANCHOR_METHOD,
        source_url: entity.provenance.sourceUrl,
      },
    });
  }
  assertions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return assertions;
}

/**
 * Wrap built entities in the KGP GroundingPack envelope (§2), minting the content
 * address (§2.1) over the pack's knowledge.
 *
 * `generatedAt` is the sole non-deterministic field — the caller supplies it (the CLI
 * stamps the wall-clock, the fixture pins {@link FIXTURE_GENERATED_AT}) — and it is
 * **excluded from `pack_id`** along with `signing`, exactly as §3.1 excludes `prov` from
 * a claim id: they describe the emission, not the knowledge. That exclusion is what
 * makes "same input ⇒ same `pack_id`" hold across builds.
 */
export function buildGroundingPack(
  entities: readonly GroundingEntity[],
  opts: {
    generatedAt: string;
    licenseClasses?: readonly string[];
    domains?: readonly string[];
    /** Snapshot (default) or delta; a delta MUST name the `basis` pack it applies against. */
    kind?: PackKind;
    basis?: string | null;
  },
): GroundingPack {
  const kind = opts.kind ?? "snapshot";
  const basis = opts.basis ?? null;
  if (kind === "delta" && !basis) {
    throw new Error("grounding-pack: a delta must name the basis pack_id it applies against (KGP §6)");
  }
  if (kind === "snapshot" && basis) {
    throw new Error("grounding-pack: a snapshot is complete for its worlds and carries no basis (KGP §6)");
  }

  const licenseClasses = [...(opts.licenseClasses ?? DEFAULT_LICENSE_CLASSES)];
  const domains = [...(opts.domains ?? [])];
  const assertions = buildAssertions(entities);
  const links: readonly GroundingAssertion[] = [];
  const licensePolicy = licensePolicyFor(licenseClasses);

  const counts = {
    entities: entities.length,
    assertions: assertions.length,
    links: links.length,
  };
  // The identity-bearing manifest: everything that describes *what knowledge this is*,
  // and nothing that varies build to build (`created`, `signing`).
  const identityManifest = {
    kgp_version: KGP_VERSION,
    producer: KGP_PRODUCER,
    worlds: [PACK_WORLD],
    kind,
    basis,
    dialect: PACK_DIALECT,
    contractVersion: CONTRACT_VERSION,
    source: EXPORT_SOURCE,
    licenseClasses,
    domains,
    counts,
    license_policy: licensePolicy,
  };
  const element = (record: GroundingEntity | GroundingAssertion, id: string): PackElement => ({
    id,
    record,
  });
  const packId = mintPackId(
    {
      manifest: identityManifest,
      entities: entities.map((e) => element(e, e.csid)),
      assertions: assertions.map((a) => element(a, a.id)),
      links: links.map((l) => element(l, l.id)),
    },
    sha256Hex,
  );

  return {
    kgp_version: KGP_VERSION,
    pack_id: packId,
    producer: KGP_PRODUCER,
    worlds: [PACK_WORLD],
    kind,
    basis,
    dialect: PACK_DIALECT,
    contractVersion: CONTRACT_VERSION,
    generatedAt: opts.generatedAt,
    source: EXPORT_SOURCE,
    licenseClasses,
    domains,
    count: entities.length,
    entities,
    assertions,
    links,
    manifest: {
      counts,
      created: opts.generatedAt,
      signing: { ...PACK_SIGNING },
      license_policy: licensePolicy,
    },
  };
}

/** Serialise a pack to its JSON form (trailing newline). */
export function snapshotJson(pack: GroundingPack): string {
  return JSON.stringify(pack, null, 2) + "\n";
}

/** Build the committed fixture pack (pinned timestamp) from the fixture lexicons. */
export function buildFixtureSnapshot(): GroundingPack {
  const entities = buildEntityGrounding(FIXTURE_LEXICONS_DIR);
  return buildGroundingPack(entities, {
    generatedAt: FIXTURE_GENERATED_AT,
    licenseClasses: DEFAULT_LICENSE_CLASSES,
    domains: [],
  });
}

/** File name a pack of `kind` is written under (KGP §6 names the two directions). */
export function packFileName(kind: PackKind): string {
  return kind === "delta" ? "delta.json" : "snapshot.json";
}

/** Write a pack to `<GROUNDING_DIR>/<snapshot|delta>.json` (gitignored). */
export function writeSnapshot(pack: GroundingPack, outDir: string = GROUNDING_DIR): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, packFileName(pack.kind)), snapshotJson(pack));
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
 * Build + write the live-corpus snapshot pack. `generatedAt` defaults to the wall-clock
 * (which does not enter `pack_id`, so re-running yields the same content address).
 * Returns the written pack.
 */
export function runExport(
  opts: {
    lexiconsDir?: string;
    outDir?: string;
    licenseClasses?: readonly string[];
    domains?: readonly string[];
    generatedAt?: string;
  } = {},
): GroundingPack {
  const entities = buildEntityGrounding(opts.lexiconsDir ?? LEXICONS_DIR, {
    licenseClasses: opts.licenseClasses,
    domains: opts.domains,
  });
  const pack = buildGroundingPack(entities, {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    licenseClasses: opts.licenseClasses,
    domains: opts.domains,
  });
  writeSnapshot(pack, opts.outDir ?? GROUNDING_DIR);
  return pack;
}

// CLI entry — mirrors export-for-engine.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const { licenseClasses, domains, outDir, emitFixture } = parseArgs(
    process.argv.slice(2),
  );
  if (emitFixture) {
    const pack = buildFixtureSnapshot();
    fs.writeFileSync(FIXTURE_SNAPSHOT_PATH, snapshotJson(pack));
    // eslint-disable-next-line no-console
    console.log(
      `Wrote fixture pack (${pack.count} entities, ${pack.assertions.length} assertions, ` +
        `${pack.pack_id}) → ${FIXTURE_SNAPSHOT_PATH}`,
    );
  } else {
    const pack = runExport({ licenseClasses, domains, outDir });
    // eslint-disable-next-line no-console
    console.log(
      `Entity-grounding pack ${pack.pack_id}: ${pack.count} entities, ` +
        `${pack.assertions.length} assertions ` +
        `(dialect=${pack.dialect}, kind=${pack.kind}, ` +
        `licenseClasses=${pack.licenseClasses.join("+") || "all"}, ` +
        `domains=${pack.domains.join("+") || "all"}) → ${outDir}/${packFileName(pack.kind)}`,
    );
  }
}
