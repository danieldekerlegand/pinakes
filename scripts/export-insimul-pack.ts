/**
 * Insimul grounding-pack exporter — **Bridge 1** of the Insimul bridge spec §4.2: domain-filtered
 * slices of the canonical corpus rendered as world seeds Insimul can import (real cultures,
 * settlements with real coordinates, languages, deities, cuisines) with cited provenance and
 * an SPDX license on every record.
 *
 * **This is a projection, not a second corpus reader.** `scripts/export-entity-grounding.ts`
 * already reads the lexicons and emits the KGP GroundingPack (`koine/specs/grounding-pack.md`,
 * US-PKA3) — the authoritative envelope. This module re-uses its entity builder verbatim and
 * projects the result into the *consumer's* envelope: `@insimul/core`'s
 * `groundingPackSchema` (`insimul-babylon/packages/core/src/schemas/grounding.schema.ts`,
 * US-CE7), which pins `contractVersion: "insimul-grounding-v1"` and `source: "linguascrape"`
 * as literals — so the two envelopes cannot be the same document, and the KGP pack's
 * `pack_id` is carried across in `x_pinakes.kgpPackId` instead.
 *
 * (`linguascrape` is this project's former name — the const is what Insimul's shipped zod
 * literal requires, so it is emitted verbatim rather than "corrected" into a pack the
 * consumer would reject. See the sync-plan banner: "LinguaScrape = Pinakes".)
 *
 * Three things the KGP pack deliberately does NOT carry, and this one does:
 *
 *  1. **`fields`** — the seed payload (settlement lat/lon, a culture's government type and
 *     founding year, a language's ISO/Glottolog codes). The KGP pack is keys-and-names only
 *     by design; a world seed needs the domain data.
 *  2. **`prologFacts`** — ground facts in *Insimul's* predicate vocabulary, emitted strictly
 *     through the US-001 predicate-mapping registry: {@link SEED_MAPPINGS} may only name a
 *     predicate its registry entry's `external` cell names, and only entries that cross
 *     `LS->IN`, are `exportable`, and are not `pending` may be used at all
 *     ({@link assertSeedMappingsRegistered}, asserted by the test suite *and* at build time).
 *     The registry is the contract; this table is its executable half.
 *  3. **`licenseManifest`** — what the `--license-classes` filter kept *and dropped*, per
 *     SPDX id and per KGP §7.1 class, so a consumer can audit a share-alike exclusion.
 *
 * Deterministic + idempotent: entities are csid-sorted (inherited), facts are emitted in
 * entity × table order, and `generatedAt` is the only wall-clock field — excluded from
 * `packId`, so the same corpus slice always mints the same content address. The committed
 * fixture pack (`scripts/data/insimul-grounding-pack.json`, built from the same fixture
 * lexicons as the KGP snapshot) pins the shape.
 *
 * CLI: `npm run insimul-pack -- [--domains culture,place,language] [--license-classes CC0,CC-BY]
 * [--out <dir>] [--emit-fixture]`.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { nodeFiles } from "@contracts/lexicon-mapping";
import {
  licensePolicyFor,
  mintPackId,
  type LicensePolicy,
  type PackElement,
} from "@contracts/kgp";
import {
  PREDICATE_MAPPING,
  externalPredicates,
  relationsForProject,
  type RelationMapping,
} from "@contracts/predicate-mapping";
import {
  EXPORT_DIR,
  mintCsid,
  parseCoordinates,
} from "./export-for-engine.ts";
import {
  assertLicenseColumn,
  buildEntityGrounding,
  buildGroundingPack,
  cell,
  headerIndex,
  licenseAllowed,
  licenseClass,
  readTsv,
  targetColIndex,
  DEFAULT_LICENSE_CLASSES,
  FIXTURE_GENERATED_AT,
  FIXTURE_LEXICONS_DIR,
  type GroundingEntity,
} from "./export-entity-grounding.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const LEXICONS_DIR = path.join(REPO_ROOT, "lexicons");

/** Gitignored output tree for the live-corpus Insimul pack. */
export const INSIMUL_PACK_DIR = path.join(EXPORT_DIR, "insimul-grounding");

/** Committed fixture pack (built from the shared entity-grounding fixture lexicons). */
export const FIXTURE_PACK_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "insimul-grounding-pack.json",
);

/**
 * Vendored copy of Insimul's shipped `grounding-pack.schema.json` (`@insimul/core`
 * US-CE7). Byte-derived from the sibling checkout, never hand-edited — the test
 * drift-checks the two whenever `INSIMUL_ROOT` resolves, exactly like the koine
 * predicate-mapping mirror.
 */
export const INSIMUL_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "data",
  "insimul-grounding-pack.schema.json",
);

/** Path of the authoritative schema inside an Insimul (`insimul-babylon`) checkout. */
export const INSIMUL_SCHEMA_REPO_PATH = path.join(
  "packages",
  "engine",
  "schemas",
  "grounding-pack.schema.json",
);

/** Insimul's interchange contract version (`z.literal` — a pack with any other value is rejected). */
export const INSIMUL_CONTRACT_VERSION = "insimul-grounding-v1";

/** The `source` literal Insimul's schema pins — this project's former name (see the header). */
export const INSIMUL_SOURCE = "linguascrape";

/** The registry project section whose entries authorize every emitted predicate. */
export const INSIMUL_PROJECT = "insimul";

/** `WorldLanguage.kind` for a real-world language (`'real' | 'constructed'` in Insimul's core). */
export const REAL_LANGUAGE_KIND = "real";

// ---------------------------------------------------------------------------
// Seed mapping table — the executable half of the US-001 registry
// ---------------------------------------------------------------------------

/** Where a fact's second argument comes from. */
export type FactArg =
  | { readonly kind: "name" }
  | { readonly kind: "field"; readonly key: string }
  | { readonly kind: "const"; readonly value: string }
  /** A foreign key into another node type; emitted only when it resolves *inside the pack*. */
  | { readonly kind: "ref"; readonly key: string };

/** One emitted ground fact. `arity` 1 facts name the entity alone. */
export interface FactSpec {
  /** `name/arity` — MUST be named by the mapping's registry entry. */
  readonly predicate: string;
  readonly arg?: FactArg;
  /** How a `field` argument is rendered (`atom` default; `number` skips non-numeric cells). */
  readonly render?: "atom" | "number";
}

/** One published seed field: the first non-blank of `columns`, under `key`. */
export interface SeedFieldSpec {
  readonly key: string;
  readonly columns: readonly string[];
  /** Coerce to a JSON number (a non-numeric cell is dropped, not stringified). */
  readonly numeric?: boolean;
  /** The node type this cell references — collected as a ref, not published as a field. */
  readonly refTo?: string;
}

/** How one canonical node type seeds an Insimul world. */
export interface SeedMapping {
  /** Canonical node type (`contracts/canonical-schema.json`). */
  readonly nodeType: string;
  /** The `projects.insimul` registry entry that authorizes this mapping's predicates. */
  readonly relationId: number;
  readonly fields: readonly SeedFieldSpec[];
  readonly facts: readonly FactSpec[];
}

/**
 * Canonical node type → Insimul world seed. Every `predicate` here is checked against the
 * registry entry named by `relationId` (see {@link assertSeedMappingsRegistered}), so this
 * table can never drift into a predicate the bridge contract does not sanction.
 *
 * Registry entries 4 (deity/religion) and 6 (myth-motif) carry *prose* `external` cells —
 * they seed truth/backstory templates at ground time rather than crossing as predicates —
 * so `deity` maps fields only, and myth-motifs ride as bare entity records.
 */
export const SEED_MAPPINGS: readonly SeedMapping[] = [
  {
    nodeType: "culture",
    relationId: 1,
    fields: [
      { key: "governmentType", columns: ["political_structure"] },
      { key: "capital", columns: ["capital"] },
      { key: "foundedYear", columns: ["time_period_start"], numeric: true },
      { key: "endedYear", columns: ["time_period_end"], numeric: true },
      { key: "region", columns: ["region"] },
    ],
    facts: [
      { predicate: "country/1" },
      { predicate: "country_name/2", arg: { kind: "name" } },
      {
        predicate: "government_type/2",
        arg: { kind: "field", key: "governmentType" },
      },
      {
        predicate: "country_founded/2",
        arg: { kind: "field", key: "foundedYear" },
        render: "number",
      },
    ],
  },
  {
    nodeType: "place",
    relationId: 2,
    fields: [
      { key: "settlementType", columns: ["type", "site_type"] },
      { key: "region", columns: ["region"] },
      { key: "foundedYear", columns: ["founded_year"], numeric: true },
      { key: "population", columns: ["peak_population"], numeric: true },
      { key: "countryId", columns: ["civilization_id"], refTo: "culture" },
    ],
    facts: [
      { predicate: "settlement/1" },
      { predicate: "settlement_name/2", arg: { kind: "name" } },
      {
        predicate: "settlement_of_country/2",
        arg: { kind: "ref", key: "countryId" },
      },
    ],
  },
  {
    nodeType: "language",
    relationId: 3,
    fields: [
      { key: "realCode", columns: ["iso639_1", "iso639_2"] },
      { key: "glottocode", columns: ["glottocode"] },
      { key: "region", columns: ["region"] },
      { key: "status", columns: ["endangerment_status", "status"] },
      { key: "parentId", columns: ["parent_language_id"], refTo: "language" },
    ],
    facts: [
      { predicate: "language/1" },
      { predicate: "language_name/2", arg: { kind: "name" } },
      {
        predicate: "language_kind/2",
        arg: { kind: "const", value: REAL_LANGUAGE_KIND },
      },
      { predicate: "language_parent/2", arg: { kind: "ref", key: "parentId" } },
      {
        predicate: "language_real_code/2",
        arg: { kind: "field", key: "realCode" },
      },
    ],
  },
  {
    nodeType: "cuisine",
    relationId: 5,
    fields: [{ key: "region", columns: ["region"] }],
    facts: [
      { predicate: "item/1" },
      { predicate: "item_name/2", arg: { kind: "name" } },
      { predicate: "item_category/2", arg: { kind: "const", value: "cuisine" } },
    ],
  },
  {
    nodeType: "ingredient",
    relationId: 5,
    fields: [
      { key: "region", columns: ["origin_region"] },
      { key: "foodType", columns: ["food_type"] },
      { key: "cuisineId", columns: ["cuisine_id"], refTo: "cuisine" },
    ],
    facts: [
      { predicate: "item/1" },
      { predicate: "item_name/2", arg: { kind: "name" } },
      {
        predicate: "item_category/2",
        arg: { kind: "const", value: "ingredient" },
      },
      { predicate: "item_type/2", arg: { kind: "field", key: "foodType" } },
    ],
  },
  {
    // Registry entry 4 is prose (religion truths / backstory templates): seeds, no predicates.
    nodeType: "deity",
    relationId: 4,
    fields: [
      { key: "pantheon", columns: ["pantheon"] },
      { key: "domain", columns: ["domain"] },
    ],
    facts: [],
  },
];

/** The seed mapping for a canonical node type, or `undefined`. */
export function seedMappingFor(nodeType: string): SeedMapping | undefined {
  return SEED_MAPPINGS.find((m) => m.nodeType === nodeType);
}

/** The `projects.insimul` registry entry a seed mapping is authorized by. */
export function registryEntryFor(mapping: SeedMapping): RelationMapping | undefined {
  return relationsForProject(INSIMUL_PROJECT).find((r) => r.id === mapping.relationId);
}

/**
 * Assert every seed mapping is sanctioned by the US-001 predicate-mapping registry. Throws
 * on the first violation:
 *
 *  - the named registry entry exists and targets this canonical node type;
 *  - it crosses towards Insimul (`LS->IN` or `both`) — a Bridge-2-only entry must not seed;
 *  - its egress class is `exportable` (a `local-only` entry may never leave the machine);
 *  - it is not `pending` on an unlanded canonical schema addition;
 *  - **every emitted predicate is named by the entry's `external` cell** — the registry does
 *    not coin predicates and neither does this table. A gap is closed by upstreaming the
 *    predicate to koine `registry/predicate-mapping.json` and re-vendoring, never by
 *    emitting it here (registryVersion 0.4.1 added `country_name/2`, `settlement_name/2`
 *    and `item_name/2` exactly that way — a nameless seed is unusable).
 */
export function assertSeedMappingsRegistered(
  mappings: readonly SeedMapping[] = SEED_MAPPINGS,
): void {
  for (const mapping of mappings) {
    const where = `insimul-pack: seed mapping "${mapping.nodeType}" (registry #${mapping.relationId})`;
    const entry = registryEntryFor(mapping);
    if (entry === undefined) {
      throw new Error(`${where} names no registry entry in projects.${INSIMUL_PROJECT}`);
    }
    const types = [
      ...(entry.canonicalType ? [entry.canonicalType] : []),
      ...(entry.canonicalTypes ?? []),
    ];
    if (!types.includes(mapping.nodeType)) {
      throw new Error(
        `${where} maps a canonical type the entry does not (entry covers ${types.join(", ") || "none"})`,
      );
    }
    if (entry.direction !== "LS->IN" && entry.direction !== "both") {
      throw new Error(`${where} uses a "${entry.direction}" entry — it does not cross to Insimul`);
    }
    if (entry.egress !== "exportable") {
      throw new Error(`${where} uses a "${entry.egress}" entry — it may not leave the machine`);
    }
    if (entry.pending) {
      throw new Error(`${where} uses an entry pending an unlanded canonical schema addition`);
    }
    const allowed = new Set(externalPredicates(entry).map((p) => `${p.name}/${p.arity}`));
    for (const fact of mapping.facts) {
      if (!allowed.has(fact.predicate)) {
        throw new Error(
          `${where} emits "${fact.predicate}", which its registry entry does not name ` +
            `(entry names: ${[...allowed].join(", ") || "none"}). Upstream the predicate to ` +
            "koine registry/predicate-mapping.json and re-vendor — never widen this table alone.",
        );
      }
    }
    const keys = new Set(mapping.fields.map((f) => f.key));
    for (const fact of mapping.facts) {
      const arg = fact.arg;
      if ((arg?.kind === "field" || arg?.kind === "ref") && !keys.has(arg.key)) {
        throw new Error(`${where} emits "${fact.predicate}" from unknown seed field "${arg.key}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seed extraction
// ---------------------------------------------------------------------------

/** A seed payload + its unresolved foreign keys, keyed by csid. */
export interface SeedRow {
  readonly fields: Record<string, string | number>;
  /** Seed-field key → `{ nodeType, id }` the cell references (resolved against the pack). */
  readonly refs: Record<string, { nodeType: string; id: string }>;
}

/** Every seed row plus the `nodeType\0pinakesId → csid` index foreign keys resolve through. */
export interface SeedIndex {
  readonly seeds: ReadonlyMap<string, SeedRow>;
  readonly idIndex: ReadonlyMap<string, string>;
}

/** Index key for a foreign key: `<nodeType>\0<pinakesId>` (escaped, so this file stays greppable). */
export const seedRefKey = (nodeType: string, id: string): string =>
  `${nodeType}\u0000${id}`;

/**
 * Read the seed fields (and foreign keys) for every node lexicon row, keyed by the SAME csid
 * `buildEntityGrounding` mints — `mintCsid` is imported, never re-implemented, so the two
 * passes can't diverge. Pure over a lexicons directory; no license/domain filtering happens
 * here (the entity list does that, and this map is only ever read through it).
 *
 * Coordinates are handled uniformly rather than per node type: a row with `latitude` +
 * `longitude` columns yields numeric `lat`/`lon`, else a combined `*coordinates` JSON cell is
 * split by the export's own {@link parseCoordinates}. That is what carries real settlement
 * coordinates into the pack — Insimul lays out lots and streets procedurally around them.
 */
export function buildSeedIndex(lexiconsDir: string = LEXICONS_DIR): SeedIndex {
  const seeds = new Map<string, SeedRow>();
  const idIndex = new Map<string, string>();

  for (const { file, node } of nodeFiles()) {
    const { headers, rows } = readTsv(path.join(lexiconsDir, file));
    if (headers.length === 0) continue;
    const mapping = seedMappingFor(node);

    const idIdx = targetColIndex(file, headers, "pinakes_id");
    const qidIdx = targetColIndex(file, headers, "wikidata_qid");
    const latIdx = headerIndex(headers, "latitude");
    const lonIdx = headerIndex(headers, "longitude");
    const coordIdx = headers.findIndex((h) => /coordinates$/i.test(h));

    for (const row of rows) {
      const pinakesId = cell(row, idIdx);
      if (pinakesId === "") continue;
      const csid = mintCsid(node, pinakesId, cell(row, qidIdx));
      if (!idIndex.has(seedRefKey(node, pinakesId))) idIndex.set(seedRefKey(node, pinakesId), csid);
      if (seeds.has(csid)) continue;

      const fields: Record<string, string | number> = {};
      const refs: Record<string, { nodeType: string; id: string }> = {};

      for (const spec of mapping?.fields ?? []) {
        const value = spec.columns
          .map((column) => cell(row, headerIndex(headers, column)))
          .find((v) => v !== "");
        if (value === undefined || value === "") continue;
        if (spec.refTo !== undefined) {
          refs[spec.key] = { nodeType: spec.refTo, id: value };
        } else if (spec.numeric) {
          const num = Number(value);
          if (Number.isFinite(num)) fields[spec.key] = num;
        } else {
          fields[spec.key] = value;
        }
      }

      const lat = Number(cell(row, latIdx));
      const lon = Number(cell(row, lonIdx));
      if (Number.isFinite(lat) && Number.isFinite(lon) && latIdx >= 0 && lonIdx >= 0) {
        fields.lat = lat;
        fields.lon = lon;
      } else {
        const coords = parseCoordinates(cell(row, coordIdx));
        if (coords !== null) {
          fields.lat = coords.lat;
          fields.lon = coords.lon;
        }
      }

      seeds.set(csid, { fields, refs });
    }
  }

  return { seeds, idIndex };
}

// ---------------------------------------------------------------------------
// Prolog fact emission
// ---------------------------------------------------------------------------

const BARE_ATOM_RE = /^[a-z][a-zA-Z0-9_]*$/;

/**
 * Render a value as an ISO-Prolog atom: bare when it already is one, else single-quoted with
 * `\` and `'` escaped (tau/Trealla both read `\'`). Never emitted for an empty value.
 */
export function prologAtom(value: string): string {
  if (BARE_ATOM_RE.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
  return `'${escaped}'`;
}

/** One ground fact, terminated. Arguments are already rendered terms. */
function fact(predicate: string, args: readonly string[]): string {
  const name = predicate.split("/")[0];
  return `${name}(${args.join(", ")}).`;
}

/**
 * Emit the pack's ground facts in Insimul's predicate vocabulary. One `<type>/1` fact plus the
 * registry-sanctioned property facts per entity, in entity (csid) order then table order —
 * deterministic without a sort. A fact is skipped, never faked, when its source cell is blank,
 * non-numeric, or (for a foreign key) points outside the pack: a dangling
 * `settlement_of_country/2` would seed a world with a country that was license-filtered away.
 */
export function buildPrologFacts(
  entities: readonly GroundingEntity[],
  index: SeedIndex,
): string[] {
  assertSeedMappingsRegistered();
  const inPack = new Set(entities.map((e) => e.csid));
  const facts: string[] = [];

  for (const entity of entities) {
    const mapping = seedMappingFor(entity.entityType);
    if (mapping === undefined) continue;
    const seed = index.seeds.get(entity.csid);
    const subject = prologAtom(entity.csid);

    for (const spec of mapping.facts) {
      if (spec.arg === undefined) {
        facts.push(fact(spec.predicate, [subject]));
        continue;
      }
      let term: string | undefined;
      switch (spec.arg.kind) {
        case "name": {
          if (entity.name !== "") term = prologAtom(entity.name);
          break;
        }
        case "const": {
          term = prologAtom(spec.arg.value);
          break;
        }
        case "field": {
          const value = seed?.fields[spec.arg.key];
          if (value === undefined) break;
          if (spec.render === "number") {
            term = typeof value === "number" ? String(value) : undefined;
          } else {
            term = prologAtom(String(value));
          }
          break;
        }
        case "ref": {
          const ref = seed?.refs[spec.arg.key];
          if (ref === undefined) break;
          const target = index.idIndex.get(seedRefKey(ref.nodeType, ref.id));
          if (target !== undefined && inPack.has(target)) term = prologAtom(target);
          break;
        }
      }
      if (term !== undefined) facts.push(fact(spec.predicate, [subject, term]));
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

/** One grounded entity in Insimul's envelope (`fields` is the seed payload). */
export interface InsimulEntity {
  readonly csid: string;
  readonly entityType: string;
  readonly fields: Readonly<Record<string, string | number | readonly string[]>>;
  readonly provenance: GroundingEntity["provenance"];
  readonly license: string;
}

/** What the license filter kept / dropped, per SPDX id and per KGP §7.1 class. */
export interface LicenseTally {
  readonly count: number;
  readonly byLicense: Readonly<Record<string, number>>;
  readonly byClass: Readonly<Record<string, number>>;
}

/** The §7.1 policy plus the audit trail of what it excluded. */
export interface InsimulLicenseManifest {
  readonly allowedSpdxClasses: readonly string[];
  readonly policy: LicensePolicy;
  readonly included: LicenseTally;
  readonly excluded: LicenseTally;
}

/** Pinakes-side provenance carried as a passthrough extension (Insimul's schema allows it). */
export interface InsimulPackExtension {
  /** The KGP GroundingPack content address for the same corpus slice (US-PKA3). */
  readonly kgpPackId: string;
  readonly producer: string;
  /** The predicate-mapping registry version every emitted predicate was sanctioned by. */
  readonly registryVersion: string;
  /** Registry entry id → the predicates this pack emitted through it. */
  readonly predicateProvenance: Readonly<Record<string, readonly string[]>>;
}

/** A grounding pack in Insimul's envelope (`@insimul/core` `groundingPackSchema`). */
export interface InsimulGroundingPack {
  readonly contractVersion: string;
  readonly packId: string;
  readonly generatedAt: string;
  readonly source: string;
  readonly domains: readonly string[];
  readonly entities: readonly InsimulEntity[];
  readonly prologFacts: readonly string[];
  readonly licenseManifest: InsimulLicenseManifest;
  readonly x_pinakes: InsimulPackExtension;
}

/** Options for {@link buildInsimulPack}. */
export interface InsimulPackOptions {
  readonly lexiconsDir?: string;
  /** The sole non-deterministic field; excluded from `packId`. */
  readonly generatedAt: string;
  readonly licenseClasses?: readonly string[];
  readonly domains?: readonly string[];
}

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/** Tally a set of entities by SPDX id and by license class. */
function tally(entities: readonly GroundingEntity[]): LicenseTally {
  const byLicense: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  for (const entity of entities) {
    byLicense[entity.license] = (byLicense[entity.license] ?? 0) + 1;
    const cls = licenseClass(entity.license);
    byClass[cls] = (byClass[cls] ?? 0) + 1;
  }
  const sorted = (record: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { count: entities.length, byLicense: sorted(byLicense), byClass: sorted(byClass) };
}

/** Which predicates each registry entry actually sanctioned in this build. */
function predicateProvenance(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const mapping of SEED_MAPPINGS) {
    if (mapping.facts.length === 0) continue;
    const key = String(mapping.relationId);
    out[key] = [...new Set([...(out[key] ?? []), ...mapping.facts.map((f) => f.predicate)])].sort();
  }
  return out;
}

/**
 * Build the Insimul grounding pack for a lexicons directory. The license filter is applied
 * *here* (the entity builder runs unfiltered) so the manifest can report what it dropped.
 */
export function buildInsimulPack(options: InsimulPackOptions): InsimulGroundingPack {
  assertLicenseColumn();
  assertSeedMappingsRegistered();

  const lexiconsDir = options.lexiconsDir ?? LEXICONS_DIR;
  const licenseClasses = [...(options.licenseClasses ?? DEFAULT_LICENSE_CLASSES)];
  const domains = [...(options.domains ?? [])];

  const all = buildEntityGrounding(lexiconsDir, { domains, licenseClasses: null });
  const included = all.filter((e) => licenseAllowed(e.license, licenseClasses));
  const excluded = all.filter((e) => !licenseAllowed(e.license, licenseClasses));

  const index = buildSeedIndex(lexiconsDir);
  const prologFacts = buildPrologFacts(included, index);

  const entities: InsimulEntity[] = included.map((entity) => {
    const seed = index.seeds.get(entity.csid);
    const fields: Record<string, string | number | readonly string[]> = { name: entity.name };
    if (entity.aliases.length > 0) fields.aliases = entity.aliases;
    if (entity.reconciliation.wikidataQid !== "") {
      fields.wikidataQid = entity.reconciliation.wikidataQid;
    }
    for (const [key, value] of Object.entries(seed?.fields ?? {})) fields[key] = value;
    return {
      csid: entity.csid,
      entityType: entity.entityType,
      fields,
      provenance: entity.provenance,
      license: entity.license,
    };
  });

  const licenseManifest: InsimulLicenseManifest = {
    allowedSpdxClasses: licenseClasses,
    policy: licensePolicyFor(licenseClasses),
    included: tally(included),
    excluded: tally(excluded),
  };

  // The KGP pack for the same slice — its content address ties the two envelopes together.
  const kgpPack = buildGroundingPack(included, {
    generatedAt: options.generatedAt,
    licenseClasses,
    domains,
  });

  const extension: InsimulPackExtension = {
    kgpPackId: kgpPack.pack_id,
    producer: "pinakes",
    registryVersion: PREDICATE_MAPPING.registryVersion,
    predicateProvenance: predicateProvenance(),
  };

  // §2.1-style content address over this envelope's own knowledge: `generatedAt` is excluded,
  // so re-running against an unchanged corpus mints the same `packId`.
  const element = (record: unknown, id: string): PackElement => ({ id, record });
  const packId = mintPackId(
    {
      manifest: {
        contractVersion: INSIMUL_CONTRACT_VERSION,
        source: INSIMUL_SOURCE,
        domains,
        licenseManifest,
        counts: { entities: entities.length, prologFacts: prologFacts.length },
        x_pinakes: extension,
      },
      entities: entities.map((e) => element(e, e.csid)),
      assertions: prologFacts.map((f) => element(f, f)),
      links: [],
    },
    sha256Hex,
  );

  const pack: InsimulGroundingPack = {
    contractVersion: INSIMUL_CONTRACT_VERSION,
    packId,
    generatedAt: options.generatedAt,
    source: INSIMUL_SOURCE,
    domains,
    entities,
    prologFacts,
    licenseManifest,
    x_pinakes: extension,
  };
  assertMatchesInsimulSchema(pack);
  return pack;
}

// ---------------------------------------------------------------------------
// Consumer-schema validation
// ---------------------------------------------------------------------------

/** The JSON-Schema keywords {@link validateJsonSchema} understands (Insimul's schema uses no others). */
interface JsonSchemaNode {
  readonly $ref?: string;
  readonly type?: string;
  readonly const?: unknown;
  readonly minLength?: number;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly definitions?: Readonly<Record<string, JsonSchemaNode>>;
}

/**
 * Validate a value against the draft-07 subset Insimul's `grounding-pack.schema.json` uses
 * (`$ref` into `definitions`, `type`, `const`, `minLength`, `properties`, `required`, `items`,
 * `additionalProperties`). Returns the list of violations as `path: reason` strings — empty
 * means valid.
 *
 * Hand-rolled on purpose: the repo carries no JSON-Schema runtime, and a 60-line checker over
 * the exact keyword set the contract uses is a smaller dependency surface than adding one for
 * a single consumer document. Anything the consumer later adds that is NOT in this subset
 * surfaces as an `unsupported keyword` violation rather than passing silently.
 */
export function validateJsonSchema(
  value: unknown,
  schema: JsonSchemaNode,
  root: JsonSchemaNode = schema,
  path = "$",
): string[] {
  if (schema.$ref !== undefined) {
    const name = schema.$ref.replace("#/definitions/", "");
    const target = root.definitions?.[name];
    if (target === undefined) return [`${path}: unresolvable $ref "${schema.$ref}"`];
    return validateJsonSchema(value, target, root, path);
  }

  const errors: string[] = [];
  const typeOf = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type !== undefined) {
    const ok = schema.type === "number" ? typeOf === "number" : typeOf === schema.type;
    if (!ok) return [`${path}: expected ${schema.type}, got ${typeOf}`];
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.items !== undefined && Array.isArray(value)) {
    value.forEach((item, i) => {
      errors.push(...validateJsonSchema(item, schema.items as JsonSchemaNode, root, `${path}[${i}]`));
    });
  }
  if (typeOf === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in object) {
        errors.push(...validateJsonSchema(object[key], child, root, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!(key in (schema.properties ?? {}))) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }
  return errors;
}

/** Read the vendored copy of Insimul's grounding-pack schema. */
export function loadInsimulSchema(schemaPath: string = INSIMUL_SCHEMA_PATH): JsonSchemaNode {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8")) as JsonSchemaNode;
}

/**
 * Assert a pack satisfies the consumer's contract before it is written. Every pack this
 * module emits goes through it — an artifact Insimul's zod schema would reject must never
 * reach disk, because the failure would otherwise surface a repo away.
 */
export function assertMatchesInsimulSchema(
  pack: InsimulGroundingPack,
  schemaPath: string = INSIMUL_SCHEMA_PATH,
): void {
  const errors = validateJsonSchema(JSON.parse(JSON.stringify(pack)), loadInsimulSchema(schemaPath));
  if (errors.length > 0) {
    throw new Error(
      `insimul-pack: pack does not satisfy ${path.basename(schemaPath)} (@insimul/core groundingPackSchema):\n  ` +
        errors.join("\n  "),
    );
  }
}

/** Serialise a pack to its JSON form (trailing newline). */
export function packJson(pack: InsimulGroundingPack): string {
  return JSON.stringify(pack, null, 2) + "\n";
}

/** Build the committed fixture pack (pinned timestamp) from the shared fixture lexicons. */
export function buildFixturePack(): InsimulGroundingPack {
  return buildInsimulPack({
    lexiconsDir: FIXTURE_LEXICONS_DIR,
    generatedAt: FIXTURE_GENERATED_AT,
  });
}

/** Write the pack to `<outDir>/grounding-pack.json`. */
export function writeInsimulPack(
  pack: InsimulGroundingPack,
  outDir: string = INSIMUL_PACK_DIR,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "grounding-pack.json"), packJson(pack));
}

/** Parse `--domains a,b` / `--license-classes a,b` / `--out dir` / `--emit-fixture`. */
export function parseArgs(argv: readonly string[]): {
  licenseClasses: readonly string[];
  domains: readonly string[];
  outDir: string;
  emitFixture: boolean;
} {
  let licenseClasses: readonly string[] = DEFAULT_LICENSE_CLASSES;
  let domains: readonly string[] = [];
  let outDir = INSIMUL_PACK_DIR;
  let emitFixture = false;
  const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--license-classes") licenseClasses = list(argv[++i] ?? "");
    else if (arg === "--domains") domains = list(argv[++i] ?? "");
    else if (arg === "--out") outDir = argv[++i] ?? outDir;
    else if (arg === "--emit-fixture") emitFixture = true;
  }
  return { licenseClasses, domains, outDir, emitFixture };
}

/** Build + write the live-corpus pack. */
export function runExport(
  opts: {
    lexiconsDir?: string;
    outDir?: string;
    licenseClasses?: readonly string[];
    domains?: readonly string[];
    generatedAt?: string;
  } = {},
): InsimulGroundingPack {
  const pack = buildInsimulPack({
    lexiconsDir: opts.lexiconsDir,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    licenseClasses: opts.licenseClasses,
    domains: opts.domains,
  });
  writeInsimulPack(pack, opts.outDir ?? INSIMUL_PACK_DIR);
  return pack;
}

// CLI entry — mirrors export-for-engine.ts's main-module guard.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  const { licenseClasses, domains, outDir, emitFixture } = parseArgs(process.argv.slice(2));
  if (emitFixture) {
    const pack = buildFixturePack();
    fs.writeFileSync(FIXTURE_PACK_PATH, packJson(pack));
    // eslint-disable-next-line no-console
    console.log(
      `Wrote fixture Insimul pack (${pack.entities.length} entities, ` +
        `${pack.prologFacts.length} facts, ${pack.packId}) → ${FIXTURE_PACK_PATH}`,
    );
  } else {
    const pack = runExport({ licenseClasses, domains, outDir });
    // eslint-disable-next-line no-console
    console.log(
      `Insimul grounding pack ${pack.packId}: ${pack.entities.length} entities, ` +
        `${pack.prologFacts.length} prolog facts ` +
        `(licenseClasses=${pack.licenseManifest.allowedSpdxClasses.join("+") || "all"}, ` +
        `excluded=${pack.licenseManifest.excluded.count}, ` +
        `domains=${pack.domains.join("+") || "all"}) → ${outDir}/grounding-pack.json`,
    );
  }
}
