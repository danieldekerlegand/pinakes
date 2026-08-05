/**
 * KGP — the Koine Grounding-Pack Protocol contract (`koine/specs/grounding-pack.md`,
 * spec 0.4.0): the **knowledge data plane** Pinakes emits on.
 *
 * This module is the pinakes-side implementation of the two normative pieces a
 * producer must get byte-exact, plus the vocabularies they depend on:
 *
 * - **§3 claim normalization (NORMATIVE)** — {@link claimHashInput} reduces a claim to
 *   the one byte string every project must agree on, and {@link mintClaimId} hashes it.
 *   Cross-producer dedup works *only* if this is exact: the same fact asserted by two
 *   producers with different confidence/provenance mints the same `claim` id and merges.
 *   Confidence, embeddings, valid-time and all of `prov` are therefore **excluded** from
 *   the hash (§3.1) — they are metadata *about* the claim, not its identity.
 * - **§2.1 pack identity** — {@link mintPackId} content-addresses a whole pack, so two
 *   builds of the same knowledge emit the same `pack_id`.
 * - the **shared relation registry** ({@link KGP_CORE_RELATIONS} +
 *   {@link KGP_DOMAIN_RELATIONS}, vendored from koine `registry/relations.tsv` and the
 *   `registry/relations/<domain>.tsv` extensions pinakes speaks) which fixes each
 *   relation's arity, argument order, symmetry
 *   and dialect tier — a relation's signature is immutable once published, because
 *   changing it would silently change every dependent claim id;
 * - the **KINP identifier forms** ({@link csidToKinpCurie}, {@link curieToIri}) —
 *   `csid` *is* a KINP entity CURIE, per `docs/canonical-schema.md` §3.1;
 * - the **§7.1 license-class policy** ({@link licensePolicyFor}) — the admission
 *   allowlist a pack manifest carries. KGP 0.3.0 adopted this policy *from* pinakes, so
 *   the names here are the spec's, mapped onto the SPDX ids the corpus already stamps.
 *
 * **Pure and hasher-injected.** Everything here is a string function; `sha256` is passed
 * in ({@link Sha256Hex}) so `contracts/` stays free of node builtins and this module is
 * importable from client, server, and `scripts/` alike. The exporter
 * (`scripts/export-entity-grounding.ts`) supplies `node:crypto`.
 */
import { DEFAULT_WORLD, type KnowledgeDialect } from "./capability-manifest";
import { EGRESS_POLICY } from "./egress-policy";

/** The KGP spec version this module implements. */
export const KGP_VERSION = "0.4.0";

/** Pinakes's KINP namespace — the `producer` of every pack emitted here. */
export const KGP_PRODUCER = "pinakes";

/**
 * The lowest (and default) dialect tier: ground facts + confidence, no rules (§5).
 * Read from `contracts/egress-policy.json`, which is Pinakes's single in-repo
 * declaration of the dialect its knowledge ports emit — not a second copy of it.
 */
export const DEFAULT_DIALECT: KnowledgeDialect = EGRESS_POLICY.knowledgeDialect;

/** The KINP IRI root (`identity.md` §3.1; production root TBD). */
export const KINP_IRI_ROOT = "https://id.koine.example";

/** Snapshot vs delta (§6). A delta is scoped to a `basis` pack id. */
export type PackKind = "snapshot" | "delta";

/** Dialect tiers ordered by what a consumer must be able to evaluate (§5). */
const DIALECT_RANK: Readonly<Record<KnowledgeDialect, number>> = {
  "grounding-only": 0,
  "horn-safe": 1,
  "full-prolog": 2,
};

/** A relation's immutable signature in the shared registry. */
export interface RelationSignature {
  /** Number of arguments; fixed by the registry, so argument order is not producer-dependent. */
  readonly arity: number;
  /** Semantic role of each argument, in order. */
  readonly argRoles: readonly string[];
  /** Symmetric relations sort their operands before hashing (§3.2 rule 2). */
  readonly symmetric: boolean;
  /** The dialect tier a consumer needs to evaluate it (§5). */
  readonly tier: KnowledgeDialect;
}

/**
 * The **core** relation vocabulary, vendored verbatim from koine
 * `registry/relations.tsv` (the unqualified names every project loads; domain
 * extensions live in `registry/relations/<domain>.tsv`).
 *
 * Vendored rather than fetched because a claim id depends on it: pinakes must be able
 * to mint conformant ids offline. Keep it in lockstep with the registry — a signature
 * is immutable once published, so a *change* upstream means a new relation name, and
 * new rows are additive.
 */
export const KGP_CORE_RELATIONS: Readonly<Record<string, RelationSignature>> = {
  // @generated:begin core-relations - koine registry/relations.tsv - regen: npm run regen:registry-mirror; do not hand-edit
  same_as: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" },
  based_on: { arity: 2, argRoles: ["derived", "source"], symmetric: false, tier: "grounding-only" },
  exact_match: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" },
  part_of: { arity: 2, argRoles: ["part", "whole"], symmetric: false, tier: "horn-safe" },
  instance_of: { arity: 2, argRoles: ["instance", "class"], symmetric: false, tier: "horn-safe" },
  co_occurs: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" },
  derived_from: { arity: 2, argRoles: ["derived", "source"], symmetric: false, tier: "grounding-only" },
  retracts: { arity: 2, argRoles: ["retraction", "target"], symmetric: false, tier: "grounding-only" },
  supersedes: { arity: 2, argRoles: ["newer", "older"], symmetric: false, tier: "grounding-only" },
  retrains: { arity: 2, argRoles: ["newer", "older"], symmetric: false, tier: "grounding-only" },
  located_in: { arity: 2, argRoles: ["entity", "place"], symmetric: false, tier: "horn-safe" },
  descended_from: { arity: 2, argRoles: ["descendant", "ancestor"], symmetric: false, tier: "horn-safe" },
  caused_by: { arity: 2, argRoles: ["effect", "cause"], symmetric: false, tier: "horn-safe" },
  // @generated:end core-relations
};

/**
 * The **domain-extension** relation vocabularies pinakes speaks, vendored verbatim from
 * koine `registry/relations/<domain>.tsv`. Domain relation names are qualified with the
 * domain prefix the TSV's `domain` column declares — which is *not* the file stem
 * (`relations/cinematography.tsv` declares `cine:`), so the prefix is only knowable from
 * the rows themselves.
 *
 * A project loads only the domains it speaks: `cine:`/`media:` for a media-analysis
 * producer and `soc:` for the Insimul bridge (person-level kinship, employment and
 * residence).
 * Vendored for the same reason as {@link KGP_CORE_RELATIONS} — a claim id depends on the
 * signature, so it must be mintable offline — and additive for the same reason: a
 * published signature is immutable, so an upstream *change* arrives as a new name.
 */
export const KGP_DOMAIN_RELATIONS: Readonly<Record<string, RelationSignature>> = {
  // @generated:begin domain-relations - koine registry/relations/{cinematography,media,social}.tsv - regen: npm run regen:registry-mirror; do not hand-edit
  "cine:shows": { arity: 2, argRoles: ["shot", "subject"], symmetric: false, tier: "grounding-only" },
  "cine:scene_of": { arity: 2, argRoles: ["shot", "scene"], symmetric: false, tier: "grounding-only" },
  "cine:says": { arity: 2, argRoles: ["speaker", "utterance"], symmetric: false, tier: "grounding-only" },
  "cine:reads": { arity: 2, argRoles: ["frame", "text"], symmetric: false, tier: "grounding-only" },
  "cine:commands": { arity: 2, argRoles: ["commander", "force"], symmetric: false, tier: "grounding-only" },
  "media:derived_from": { arity: 2, argRoles: ["derived", "source"], symmetric: false, tier: "grounding-only" },
  "media:variant_of": { arity: 2, argRoles: ["variant", "source"], symmetric: false, tier: "grounding-only" },
  "media:excerpt_of": { arity: 2, argRoles: ["excerpt", "source"], symmetric: false, tier: "grounding-only" },
  "media:perceptual_match": { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" },
  "media:mentions": { arity: 2, argRoles: ["asset", "entity"], symmetric: false, tier: "grounding-only" },
  "soc:parent_of": { arity: 2, argRoles: ["parent", "child"], symmetric: false, tier: "horn-safe" },
  "soc:spouse_of": { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "horn-safe" },
  "soc:employed_by": { arity: 2, argRoles: ["employee", "employer"], symmetric: false, tier: "horn-safe" },
  "soc:resides_in": { arity: 2, argRoles: ["resident", "residence"], symmetric: false, tier: "horn-safe" },
  // @generated:end domain-relations
};

/** The domain prefixes {@link KGP_DOMAIN_RELATIONS} covers (`cine`, `media`, `soc`). */
export const KGP_RELATION_DOMAINS: readonly string[] = [
  ...new Set(Object.keys(KGP_DOMAIN_RELATIONS).map((name) => name.slice(0, name.indexOf(":")))),
];

/**
 * KINP's reserved equivalence + lifecycle relations (`identity.md` §4.2/§4.3). An
 * assertion using one of these belongs in a pack's `links` rather than its `assertions`
 * (§2). `exact_match` is deliberately **not** in this set — it anchors to an external
 * authority id, it is not one of KINP's reserved relations.
 */
export const RESERVED_LINK_RELATIONS: readonly string[] = [
  "same_as",
  "based_on",
  "part_of",
  "instance_of",
  "retracts",
  "supersedes",
];

/** Whether a relation belongs in a pack's `links` (§2) rather than its `assertions`. */
export function isLinkRelation(relation: string): boolean {
  return RESERVED_LINK_RELATIONS.includes(relation);
}

/**
 * The registry signature of a relation, or `undefined` when it is in neither the core
 * vocabulary nor a domain extension pinakes speaks.
 */
export function relationSignature(relation: string): RelationSignature | undefined {
  return KGP_CORE_RELATIONS[relation] ?? KGP_DOMAIN_RELATIONS[relation];
}

/**
 * Assert a relation may travel in a pack of `dialect` — "a producer must ship the lowest
 * tier that carries the needed content" (§5), so a `horn-safe` relation may not ride in a
 * `grounding-only` pack.
 */
export function assertRelationAllowed(relation: string, dialect: KnowledgeDialect): void {
  const signature = relationSignature(relation);
  if (!signature) {
    throw new Error(
      `kgp: relation "${relation}" is not in the shared relation registry (koine registry/relations.tsv + registry/relations/<domain>.tsv)`,
    );
  }
  if (DIALECT_RANK[signature.tier] > DIALECT_RANK[dialect]) {
    throw new Error(
      `kgp: relation "${relation}" is ${signature.tier} — it cannot travel in a ${dialect} pack`,
    );
  }
}

// ---------------------------------------------------------------------------
// KINP identifier forms (identity.md §3; docs/canonical-schema.md §3.1)
// ---------------------------------------------------------------------------

/** Percent-encode one character as lowercase `%XX` of its UTF-8 bytes. */
function percentEncode(char: string): string {
  return Array.from(new TextEncoder().encode(char), (b) => `%${b.toString(16).padStart(2, "0")}`).join("");
}

/**
 * Derive a KINP `<local-id>` (`[a-z0-9][a-z0-9._-]*`, KINP §3.1) from a csid part:
 * lowercase ASCII, then percent-encode everything outside `[a-z0-9._-]` — which is what
 * handles the `:` an alias-anchored local may itself contain. One-way by design
 * (`docs/canonical-schema.md` §3.1): the verbatim csid always travels with the record.
 */
export function kinpLocal(part: string): string {
  return Array.from(part.toLowerCase(), (char) =>
    /[a-z0-9._-]/.test(char) ? char : percentEncode(char),
  ).join("");
}

/**
 * `cs:<type>:<local>` → the KINP entity CURIE `pinakes:ent:<type>.<kinp-local>`. The
 * `<type>.` prefix keeps csids of different node types disjoint inside the single flat
 * `pinakes` entity namespace.
 */
export function csidToKinpCurie(csid: string): string {
  const match = /^cs:([^:]+):(.+)$/.exec(csid);
  if (!match) {
    throw new Error(`kgp: "${csid}" is not a csid (expected cs:<type>:<local>)`);
  }
  return `${KGP_PRODUCER}:ent:${kinpLocal(match[1])}.${kinpLocal(match[2])}`;
}

/**
 * An entity CURIE for an id minted by an **external** authority (KINP §3.4/§4.4) — the
 * local id is the authority's own and is NOT case-folded (`wikidata:ent:Q150`); only the
 * namespace and kind are lowercased (§3.2 rule 3).
 */
export function externalEntityCurie(namespace: string, localId: string): string {
  return `${namespace.toLowerCase()}:ent:${localId}`;
}

/** The Wikidata anchor CURIE for a QID — the primary real-world anchor (KINP §4.4). */
export function wikidataEntityCurie(qid: string): string {
  return externalEntityCurie("wikidata", qid);
}

/** Canonicalize a CURIE: lowercase namespace + kind, NFC the local id (§3.2 rule 3). */
export function canonicalCurie(curie: string): string {
  const parts = curie.split(":");
  if (parts.length < 3 || parts.some((p, i) => i < 2 && p === "")) {
    throw new Error(`kgp: "${curie}" is not a CURIE (expected <namespace>:<kind>:<local-id>)`);
  }
  const [namespace, kind, ...local] = parts;
  return `${namespace.toLowerCase()}:${kind.toLowerCase()}:${local.join(":").normalize("NFC")}`;
}

/** `<ns>:<kind>:<local>` → the canonical IRI `https://id.koine.example/<kind>/<ns>/<local>` (KINP §3.1/§3.2). */
export function curieToIri(curie: string): string {
  const [namespace, kind, ...local] = canonicalCurie(curie).split(":");
  return `${KINP_IRI_ROOT}/${kind}/${namespace}/${local.join(":")}`;
}

// ---------------------------------------------------------------------------
// §3 Claim normalization (NORMATIVE)
// ---------------------------------------------------------------------------

/** A typed claim argument — an identifier reference or a canonicalized literal (§3.2 rule 5). */
export type ClaimArg =
  | { readonly kind: "id"; readonly curie: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "decimal"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "datetime"; readonly value: string };

/** The identity-bearing content of a claim — everything the `claim` id hashes (§3.1). */
export interface Claim {
  /** The claim's world as a CURIE; a producer with no explicit world uses its default (§3.2 rule 4). */
  readonly world: string;
  /** A `snake_case` name from the shared relation registry. */
  readonly relation: string;
  /** Arguments in the registry's semantic order. */
  readonly args: readonly ClaimArg[];
}

/** *string*: NFC, wrapped in `"`, inner `"` and `\` backslash-escaped; no other escapes. */
function canonicalString(value: string): string {
  return `"${value.normalize("NFC").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** *integer*: base-10, no leading zeros, no leading `+`, `-0` → `0`. */
function canonicalInteger(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`kgp: integer literal must be a safe integer, got ${value}`);
  }
  // `String` renders every safe integer in plain base-10 and folds `-0` to `"0"`.
  return String(value);
}

/** *decimal*: shortest round-tripping base-10, no trailing zeros, no exponent unless |exp| ≥ 16. */
function canonicalDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`kgp: decimal literal must be finite, got ${value}`);
  }
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (Math.abs(exponent) >= 16) {
    const [mantissa, exp] = value.toExponential().split("e");
    return `${mantissa}e${Number(exp)}`;
  }
  const plain = String(value);
  if (!plain.includes("e")) return plain;
  // JS switches to exponent form below 1e-6, which is inside the no-exponent band — expand it.
  return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

/** *date/time*: ISO-8601 in UTC, `Z` suffix, millisecond precision fixed. */
function canonicalDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`kgp: datetime literal "${value}" is not an ISO-8601 instant`);
  }
  return new Date(parsed).toISOString();
}

/** Canonicalize one argument to its hash-input byte form (§3.2 rule 3 + rule 5). */
export function canonicalArg(arg: ClaimArg): string {
  switch (arg.kind) {
    case "id":
      return canonicalCurie(arg.curie);
    case "string":
      return canonicalString(arg.value);
    case "integer":
      return canonicalInteger(arg.value);
    case "decimal":
      return canonicalDecimal(arg.value);
    case "boolean":
      return arg.value ? "true" : "false";
    case "datetime":
      return canonicalDateTime(arg.value);
    default:
      throw new Error(`kgp: unknown claim-argument kind "${(arg as ClaimArg).kind}"`);
  }
}

/**
 * The claim's arguments **as emitted**: canonicalized, and — for a symmetric relation —
 * sorted ascending so `same_as(a,b)` and `same_as(b,a)` hash identically (§3.2 rule 2).
 * An envelope's `subject`/`object` must be taken from here, so the record agrees with
 * the id it carries.
 */
export function canonicalClaimArgs(claim: Claim): string[] {
  const signature = relationSignature(claim.relation);
  if (!signature) {
    throw new Error(
      `kgp: relation "${claim.relation}" is not in the shared relation registry (koine registry/relations.tsv)`,
    );
  }
  if (claim.args.length !== signature.arity) {
    throw new Error(
      `kgp: relation "${claim.relation}" has arity ${signature.arity}, got ${claim.args.length} argument(s)`,
    );
  }
  const args = claim.args.map(canonicalArg);
  return signature.symmetric ? [...args].sort() : args;
}

/**
 * The NORMATIVE §3.1 hash input:
 * `world_curie · "|" · relation · "(" · arg1 · "," · arg2 · … · ")"`, with no
 * insignificant whitespace anywhere.
 */
export function claimHashInput(claim: Claim): string {
  const args = canonicalClaimArgs(claim);
  return `${canonicalCurie(claim.world)}|${claim.relation}(${args.join(",")})`;
}

/** A SHA-256 → lowercase-hex function (`node:crypto` at the call site; §3.2 rule 7). */
export type Sha256Hex = (input: string) => string;

/** `claim_id := "sha256-" · lowerhex(SHA-256(UTF8(HASH_INPUT)))` (§3.1). */
export function mintClaimId(claim: Claim, sha256: Sha256Hex): string {
  return `sha256-${sha256(claimHashInput(claim)).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// §2.1 Pack identity
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted, `undefined` dropped, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** One content-bearing pack element: the id §2.1 sorts by, plus the record itself. */
export interface PackElement {
  readonly id: string;
  readonly record: unknown;
}

/** The four content sections a `pack_id` is computed over. */
export interface PackHashParts {
  /**
   * The identity-bearing manifest fields only. A producer MUST leave out anything that
   * varies between two builds of the same knowledge — `created` and `signing` are
   * emission metadata, the same way §3.1 excludes `prov` from a claim id — or packs stop
   * being byte-reproducible.
   */
  readonly manifest: unknown;
  readonly entities: readonly PackElement[];
  readonly assertions: readonly PackElement[];
  readonly links: readonly PackElement[];
}

function section(elements: readonly PackElement[]): string {
  return [...elements]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((element) => canonicalJson(element.record))
    .join("\n");
}

/** `canonical(manifest ⊕ sorted(entities) ⊕ sorted(assertions) ⊕ sorted(links))` (§2.1). */
export function packHashInput(parts: PackHashParts): string {
  return [
    canonicalJson(parts.manifest),
    section(parts.entities),
    section(parts.assertions),
    section(parts.links),
  ].join("\n");
}

/** `pack_id = "sha256-" · lowerhex(SHA-256(...))` — content-addressed, byte-reproducible (§2.1). */
export function mintPackId(parts: PackHashParts, sha256: Sha256Hex): string {
  return `sha256-${sha256(packHashInput(parts)).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// §7.1 License-class policy
// ---------------------------------------------------------------------------

/** The KGP §7.1 license classes, most-permissive first. */
export type LicenseClass =
  | "public-domain"
  | "permissive"
  | "attribution"
  | "share-alike"
  | "non-commercial"
  | "proprietary";

/** Every license class, in admission order. */
export const ALL_LICENSE_CLASSES: readonly LicenseClass[] = [
  "public-domain",
  "permissive",
  "attribution",
  "share-alike",
  "non-commercial",
  "proprietary",
];

/** The §7.1 default allowlist — what a consumer admits when it declares no policy. */
export const DEFAULT_LICENSE_POLICY_CLASSES: readonly LicenseClass[] = [
  "public-domain",
  "permissive",
  "attribution",
];

/**
 * Classify an SPDX id — or an SPDX *family* as pinakes filters on (`CC-BY`, `CC0`) —
 * into its KGP §7.1 class. The stricter constraint wins, so a `CC-BY-NC-SA` is
 * `non-commercial`, not `share-alike`.
 */
export function licensePolicyClass(spdx: string): LicenseClass {
  const id = spdx.trim().toUpperCase();
  if (id === "") return "proprietary";
  if (/^(CC0|PDDL)/.test(id) || id === "UNLICENSE" || id === "CC-PDDL") return "public-domain";
  if (/(^|-)NC(-|$)/.test(id)) return "non-commercial";
  if (/(^|-)SA(-|$)/.test(id) || /^(GPL|AGPL|LGPL|MPL|EPL|ODBL|OSL)/.test(id)) return "share-alike";
  if (/^CC-BY/.test(id)) return "attribution";
  if (/^(MIT|APACHE|BSD|ISC|ZLIB|POSTGRESQL|PYTHON)/.test(id)) return "permissive";
  return "proprietary";
}

/** The admission allowlist a pack manifest carries (§7.1). */
export interface LicensePolicy {
  /** KGP §7.1 classes admitted, in {@link ALL_LICENSE_CLASSES} order. */
  readonly allowed_classes: readonly LicenseClass[];
  /** The SPDX families the producer actually filtered on (pinakes's `licenseClasses`). */
  readonly allowed_spdx_classes: readonly string[];
  /** What a consumer does with a record outside the allowlist — never silently drop it. */
  readonly on_violation: "reject-with-report";
}

/**
 * Map pinakes's SPDX-family filter (`CC0`, `CC-BY`, …) onto the KGP §7.1 policy. KGP
 * 0.3.0 adopted this policy *from* pinakes/insimul (ADR-0002 reverse flow), so this is a
 * name alignment, not a re-invention: the default `CC0`+`CC-BY` filter is exactly the
 * spec's default `public-domain`+`permissive`+`attribution` minus the permissive
 * families the corpus does not carry.
 */
export function licensePolicyFor(spdxClasses: readonly string[]): LicensePolicy {
  const classes = new Set(spdxClasses.map(licensePolicyClass));
  return {
    allowed_classes: ALL_LICENSE_CLASSES.filter((c) => classes.has(c)),
    allowed_spdx_classes: [...spdxClasses],
    on_violation: "reject-with-report",
  };
}

/** The default world every pinakes pack is scoped to — real-world consensus reality (KINP §5). */
export const PACK_WORLD = DEFAULT_WORLD;
