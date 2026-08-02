/**
 * Predicate-mapping registry — the machine-validated bridge contract between
 * pinakes's canonical node/edge vocabulary and the relation vocabularies of the
 * projects it bridges.
 *
 * **This file's JSON is a generated mirror, not a source.** The authoritative copy
 * lives in koine (`registry/predicate-mapping.json`, the `canonicalHome` block the
 * document itself declares); {@link ./predicate-mapping.json} is byte-derived from it
 * and must never be hand-edited — a correction is upstreamed to koine (bumping its
 * `registryVersion`) and re-vendored here, so the registry cannot fork. The drift gate
 * in `predicate-mapping.test.ts` compares the two byte-for-byte whenever a koine
 * checkout is present (`KOINE_ROOT`, else `~/Development/koine`), and skips when it
 * is not.
 *
 * This module imports the mirror, pins its shape with an `as` assertion (its enum
 * string cells widen to `string` on JSON import, so a plain `satisfies` cannot narrow
 * them), and exposes typed accessors the bridge code (grounding-pack exporter, the
 * per-project acquisition adapters, the Datalog/Neo4j/GraphRAG layer) builds on.
 * Structural drift in the JSON breaks `npm run check`; enum-/totality-level drift is
 * caught at runtime by {@link assertValidPredicateMapping} (exercised by the vitest
 * suite and wired into the convergence-QA drift gate).
 *
 * The registry encodes each bridged project's sync-plan Appendix A,
 * the `sha256:`/`cs:` id-space rules, and the `t_start`/`t_end` ⇄ `time_start`/`time_end`
 * temporal-field map. Since registryVersion 0.3.0 the old single `portabilityClasses`
 * enum is split into the two orthogonal axes KGP 0.4.0 ruled distinct — **dialect**
 * (what a consumer may evaluate, {@link KnowledgeDialect}) and **egress** (whether
 * knowledge may leave at all, {@link EgressClass}); `local-only` is an egress class, NOT
 * a fourth dialect tier (see {@link LOCAL_ONLY}). Consume via `@contracts/predicate-mapping`;
 * never fork the JSON.
 */
import predicateMappingJson from "./predicate-mapping.json";
import { edgeTypeByName, nodeTypeByName } from "./canonical-schema";
import { KGP_RELATION_DOMAINS, relationSignature } from "./kgp";
import type { KnowledgeDialect } from "./capability-manifest";

/** What a relation's canonical side *is*. */
export type CanonicalMappingKind =
  | "node" // maps to a canonical node type
  | "node-property" // property of a canonical node type (not an edge)
  | "edge" // maps to a canonical edge type
  | "derived-rule" // a derived Horn rule, never a stored edge (e.g. co_occurs)
  | "rule" // a rules-registry entry + violation facts (cinematography, world rules)
  | "provenance" // maps to the canonical provenance columns
  | "temporal" // temporal segmentation facts (endpoints via temporalFieldMap)
  | "none"; // maps to nothing canonical — catalogued only so egress has a rule for it

/** The direction a bridged relation crosses (`none` = it crosses in neither). */
export type MappingDirection =
  | "AR->LS"
  | "LS->AR"
  | "IN->LS"
  | "LS->IN"
  | "both"
  | "none";

/** Whether knowledge may leave its originating tier at all (KGP §7.2). */
export type EgressClass = "exportable" | "local-only";

/**
 * The `local-only` **egress** class — the privacy invariant this bridge introduces.
 * Not a dialect tier: a producer filters these out at pack construction and a consumer
 * rejects-and-reports a pack that still carries them.
 */
export const LOCAL_ONLY: EgressClass = "local-only";

/** Kinds that cross as a KGP claim, so they must name their registry relation(s). */
const CLAIM_KINDS: ReadonlySet<CanonicalMappingKind> = new Set([
  "edge",
  "derived-rule",
]);

/** One id-space rule (prefix → what the id denotes). */
export interface IdSpaceRule {
  readonly prefix: string;
  readonly form: string;
  /** `node` (a graph node), `entity` (a csid), or `provenance` (fact provenance only). */
  readonly canonicalKind: "node" | "entity" | "provenance";
  /** The canonical node type an id in this space denotes (only for `canonicalKind: "node"`). */
  readonly nodeType?: string;
  readonly description: string;
}

/** One bridged relation ⇄ canonical mapping. */
export interface RelationMapping {
  readonly id: number;
  /** The Appendix-A row this entry derives from (`—` when it has no row); registry-local ids. */
  readonly sourceRow?: number | string;
  /** The bridged project's predicate(s) as the producer actually emits them. */
  readonly external: string;
  readonly canonicalKind: CanonicalMappingKind;
  /** The single canonical node/edge type this maps to (node/node-property/edge kinds). */
  readonly canonicalType?: string;
  /** Several canonical types, when the relation fans out (e.g. refers_to → depicts/mentions). */
  readonly canonicalTypes?: readonly string[];
  readonly direction: MappingDirection;
  /** Dialect tier a consumer needs to evaluate it; `null` when the entry declares none. */
  readonly dialect: KnowledgeDialect | null;
  readonly egress: EgressClass;
  /** koine registry relation(s) this normalizes to — non-empty iff it crosses as a claim. */
  readonly koineRelations: readonly string[];
  /** Whether the canonical type is a declared-but-not-yet-added schema addition. */
  readonly pending: boolean;
  /** Per-field temporal map for `temporal` entries (`null` = no canonical counterpart). */
  readonly temporalFields?: Readonly<Record<string, readonly string[] | null>>;
  readonly notes: string;
}

/** Canonical schema additions a project's mappings depend on but the schema has not landed yet. */
export interface PendingSchemaAdditions {
  readonly targetVersion: string;
  readonly note: string;
  readonly nodeTypes: readonly string[];
  readonly edgeTypes: readonly string[];
}

/** One bridged project's section of the registry. */
export interface ProjectMapping {
  readonly title: string;
  readonly sourceDoc: string;
  /** The `registryVersion` this project's section was added at (absent for the originally-lifted section). */
  readonly addedAt?: string;
  readonly direction: Readonly<Record<string, string>>;
  /** Prose about project-local entry fields (e.g. insimul's `sourceRow`). */
  readonly entryFields?: Readonly<Record<string, string>>;
  /** The project's own id space, when its ids are not canonical (e.g. world-scoped Mongo ids). */
  readonly idSpace?: Readonly<Record<string, unknown>>;
  readonly pendingSchemaAdditions?: PendingSchemaAdditions;
  /** Vocabulary collisions resolved here rather than silently reconciled in an entry. */
  readonly collisions?: Readonly<Record<string, unknown>>;
  readonly relations: readonly RelationMapping[];
}

/** Where the authoritative copy of the registry lives (koine). */
export interface CanonicalHome {
  readonly repo: string;
  readonly path: string;
  readonly decidedBy: readonly string[];
  readonly tooling: string;
  readonly rule: string;
}

/** A declared mirror of the registry — this repo's copy is one. */
export interface RegistryMirror {
  readonly project: string;
  readonly path: string;
  readonly mode: string;
  readonly note: string;
}

/** Where the relation vocabulary itself lives (koine TSVs — this file does not coin names). */
export interface RelationRegistryRef {
  readonly core: string;
  readonly domains: readonly string[];
  readonly rule: string;
  readonly spec: string;
}

/** The whole machine-readable registry (registryVersion 0.4.0 shape). */
export interface PredicateMappingRegistry {
  readonly registryVersion: string;
  readonly title: string;
  readonly description: string;
  readonly canonicalHome: CanonicalHome;
  readonly mirrors: readonly RegistryMirror[];
  readonly relationRegistry: RelationRegistryRef;
  readonly signaturePolicy: Readonly<Record<string, unknown>>;
  readonly axes: Readonly<Record<string, string>>;
  readonly dialectTiers: {
    readonly axis: string;
    readonly spec: string;
    readonly default: string;
    readonly nests: readonly string[];
    readonly rule: string;
    readonly classes: Readonly<Record<string, string>>;
  };
  readonly egressClasses: {
    readonly axis: string;
    readonly spec: string;
    readonly default: string;
    readonly rule: string;
    readonly hashing: string;
    readonly enforcedBy: string;
    readonly classes: Readonly<Record<string, string>>;
  };
  readonly trustTiers: Readonly<Record<string, unknown>>;
  readonly idSpaces: readonly IdSpaceRule[];
  readonly temporalFieldMap: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, ProjectMapping>>;
}

/** The predicate-mapping registry. Structural drift in the JSON breaks `npm run check`. */
export const PREDICATE_MAPPING = predicateMappingJson as unknown as PredicateMappingRegistry;

/** The pinakes copy is a generated mirror of this path inside the koine repo. */
export const KOINE_REGISTRY_PATH = "registry/predicate-mapping.json";

const CANONICAL_MAPPING_KINDS: ReadonlySet<CanonicalMappingKind> = new Set([
  "node",
  "node-property",
  "edge",
  "derived-rule",
  "rule",
  "provenance",
  "temporal",
  "none",
]);

const MAPPING_DIRECTIONS: ReadonlySet<MappingDirection> = new Set([
  "AR->LS",
  "LS->AR",
  "IN->LS",
  "LS->IN",
  "both",
  "none",
]);

/** Kinds whose canonical side is a concrete node/edge type subject to the totality check. */
const TYPED_KINDS: ReadonlySet<CanonicalMappingKind> = new Set([
  "node",
  "node-property",
  "edge",
]);

/** The bridged project section, or `undefined` if the name is not registered. */
export function predicateMappingProject(
  name: string,
): ProjectMapping | undefined {
  return PREDICATE_MAPPING.projects[name];
}

/** Every relation mapping for a project (empty if unregistered). */
export function relationsForProject(name: string): readonly RelationMapping[] {
  return predicateMappingProject(name)?.relations ?? [];
}

/** Every dialect tier id the registry defines, lowest first (the tiers nest). */
export function dialectTierIds(): string[] {
  return [...PREDICATE_MAPPING.dialectTiers.nests];
}

/** Every egress class id the registry defines. */
export function egressClassIds(): string[] {
  return Object.keys(PREDICATE_MAPPING.egressClasses.classes);
}

/** Whether a relation is `local-only` — must never leave the personal tier. */
export function isLocalOnly(relation: RelationMapping): boolean {
  return relation.egress === LOCAL_ONLY;
}

/** Every `local-only` relation in a project (the personal-tier containment set). */
export function localOnlyRelations(name: string): RelationMapping[] {
  return relationsForProject(name).filter(isLocalOnly);
}

/** The id-space rule an id-reference belongs to (by longest matching prefix), or `undefined`. */
export function idSpaceForRef(ref: string): IdSpaceRule | undefined {
  return [...PREDICATE_MAPPING.idSpaces]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((s) => ref.startsWith(s.prefix));
}

/** The canonical temporal field a bridged temporal field maps to (`t_start` → `time_start`). */
export function canonicalTemporalField(externalField: string): string | undefined {
  return PREDICATE_MAPPING.temporalFieldMap[externalField];
}

/** The canonical types a relation references (single + fan-out), deduped. */
function referencedTypes(relation: RelationMapping): string[] {
  const types = [
    ...(relation.canonicalType ? [relation.canonicalType] : []),
    ...(relation.canonicalTypes ?? []),
  ];
  return [...new Set(types)];
}

/** One `name/arity` predicate parsed out of a relation's `external` cell. */
export interface ExternalPredicate {
  readonly name: string;
  readonly arity: number;
  /** The relation entry it was named by. */
  readonly relationId: number;
}

const PREDICATE_RE = /\b([a-z][a-z0-9_]*)\/(\d+)/g;

/**
 * The `name/arity` predicates a relation's `external` cell names. Cells that are prose
 * (e.g. "religion truths / backstory templates") simply yield none — the registry
 * documents them as mappings, not as callable predicates.
 */
export function externalPredicates(
  relation: RelationMapping,
): ExternalPredicate[] {
  const found: ExternalPredicate[] = [];
  for (const match of relation.external.matchAll(PREDICATE_RE)) {
    found.push({ name: match[1], arity: Number(match[2]), relationId: relation.id });
  }
  return found;
}

/** Every `name/arity` predicate a project's entries name, in registry order. */
export function externalPredicatesForProject(name: string): ExternalPredicate[] {
  return relationsForProject(name).flatMap(externalPredicates);
}

/**
 * The predicates a project's entries name that a producer's own catalog does NOT
 * declare — **allowed, but unverified**. The registry is authored partly from a design
 * document, so it may name a predicate the producer has not shipped (or has renamed);
 * that is a flag for a human, never a validation failure, so this is a query and
 * {@link assertValidPredicateMapping} never consults it. `catalog` holds the producer's
 * own `name/arity` signatures (e.g. parsed from Insimul's `predicate-schema.ts`).
 */
export function unverifiedPredicates(
  project: string,
  catalog: Iterable<string>,
): ExternalPredicate[] {
  const known = new Set(catalog);
  return externalPredicatesForProject(project).filter(
    (p) => !known.has(`${p.name}/${p.arity}`),
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Assert the registry is well-formed, canonical-type-total, and relation-total against
 * the koine vocabulary. Throws {@link Error} on the first violation. Runtime counterpart
 * to the compile-time shape check on {@link PREDICATE_MAPPING}. Checks:
 *
 *  - top-level metadata (`registryVersion`/`title`/`description`), the `canonicalHome`
 *    + `mirrors` provenance block, and at least one dialect tier, egress class,
 *    id-space rule, temporal-field pair, and project;
 *  - each id-space rule carries a prefix/form/description and a known `canonicalKind`;
 *  - each relation: unique id per project, non-empty `external`, a known
 *    `canonicalKind`/`direction`, a declared `dialect` (or `null`) and `egress` class,
 *    and a boolean `pending`;
 *  - **relation totality** — a `edge`/`derived-rule` entry crosses as a KGP claim, so it
 *    must name ≥1 koine relation, and every other kind must name none. Each named
 *    relation must resolve in the vendored koine vocabulary (`relationSignature` — the
 *    core TSV plus the domain extensions pinakes speaks). The registry never coins
 *    relation names: a gap is closed by adding the relation to koine's TSV;
 *  - **canonical-type totality** — a `node`/`node-property`/`edge` relation names at
 *    least one canonical type, and each type either resolves in
 *    `contracts/canonical-schema.json` (when `pending: false`) or is a declared
 *    `pendingSchemaAdditions` type that does NOT yet resolve (when `pending: true`).
 *    So the `pending` flag stays a live checklist: flipping it without the schema
 *    change — or vice-versa — fails here.
 *
 * A bridged predicate the producer's own catalog does not declare is deliberately NOT
 * a failure — see {@link unverifiedPredicates}.
 */
export function assertValidPredicateMapping(
  registry: PredicateMappingRegistry = PREDICATE_MAPPING,
): void {
  for (const key of ["registryVersion", "title", "description"] as const) {
    if (!isNonEmptyString(registry[key])) {
      throw new Error(`predicate-mapping: ${key} must be a non-empty string`);
    }
  }
  if (!isNonEmptyString(registry.canonicalHome?.repo) || !isNonEmptyString(registry.canonicalHome?.path)) {
    throw new Error("predicate-mapping: canonicalHome must name the authoritative repo + path");
  }
  if (!registry.mirrors.some((m) => m.project === "pinakes")) {
    throw new Error("predicate-mapping: this copy must be declared as a pinakes mirror");
  }

  const dialectIds = new Set(registry.dialectTiers?.nests ?? []);
  if (dialectIds.size === 0) {
    throw new Error("predicate-mapping: at least one dialect tier required");
  }
  for (const id of dialectIds) {
    if (!isNonEmptyString(registry.dialectTiers.classes[id])) {
      throw new Error(`predicate-mapping: dialect tier "${id}" needs a description`);
    }
  }
  const egressIds = new Set(Object.keys(registry.egressClasses?.classes ?? {}));
  if (!egressIds.has(LOCAL_ONLY)) {
    throw new Error(`predicate-mapping: the "${LOCAL_ONLY}" egress class must be defined`);
  }
  for (const [id, desc] of Object.entries(registry.egressClasses.classes)) {
    if (!isNonEmptyString(desc)) {
      throw new Error(`predicate-mapping: egress class "${id}" needs a description`);
    }
  }

  if (!isNonEmptyString(registry.relationRegistry?.core)) {
    throw new Error("predicate-mapping: relationRegistry must name the core relation TSV");
  }

  if (registry.idSpaces.length === 0) {
    throw new Error("predicate-mapping: at least one id-space rule required");
  }
  for (const rule of registry.idSpaces) {
    if (!isNonEmptyString(rule.prefix) || !isNonEmptyString(rule.form) || !isNonEmptyString(rule.description)) {
      throw new Error(`predicate-mapping: id-space rule "${rule.prefix}" is missing prefix/form/description`);
    }
    if (!["node", "entity", "provenance"].includes(rule.canonicalKind)) {
      throw new Error(`predicate-mapping: id-space rule "${rule.prefix}" has unknown canonicalKind "${rule.canonicalKind}"`);
    }
    if (rule.canonicalKind === "node" && !nodeTypeByName(rule.nodeType ?? "")) {
      // Allow a declared pending node type in any project so an id-space rule can be
      // authored before the canonical schema addition lands.
      const declaredPending = Object.values(registry.projects).some((p) =>
        (p.pendingSchemaAdditions?.nodeTypes ?? []).includes(rule.nodeType ?? ""),
      );
      if (!declaredPending) {
        throw new Error(`predicate-mapping: id-space "${rule.prefix}" nodeType "${rule.nodeType}" is neither a canonical node type nor a declared pending addition`);
      }
    }
  }
  const temporalPairs = Object.entries(registry.temporalFieldMap);
  if (temporalPairs.length === 0) {
    throw new Error("predicate-mapping: temporalFieldMap must map at least one field");
  }
  for (const [from, to] of temporalPairs) {
    if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
      throw new Error(`predicate-mapping: temporalFieldMap entry "${from}" → "${to}" must be non-empty`);
    }
  }

  const projectNames = Object.keys(registry.projects);
  if (projectNames.length === 0) {
    throw new Error("predicate-mapping: at least one bridged project required");
  }
  for (const [projectName, project] of Object.entries(registry.projects)) {
    if (!isNonEmptyString(project.title) || !isNonEmptyString(project.sourceDoc)) {
      throw new Error(`predicate-mapping: project "${projectName}" needs a title and sourceDoc`);
    }
    const pendingNodes = new Set(project.pendingSchemaAdditions?.nodeTypes ?? []);
    const pendingEdges = new Set(project.pendingSchemaAdditions?.edgeTypes ?? []);
    const seenIds = new Set<number>();
    for (const rel of project.relations) {
      const where = `project "${projectName}" relation #${rel.id} (${rel.external})`;
      if (typeof rel.id !== "number" || seenIds.has(rel.id)) {
        throw new Error(`predicate-mapping: ${where} has a missing or duplicate id`);
      }
      seenIds.add(rel.id);
      if (!isNonEmptyString(rel.external)) {
        throw new Error(`predicate-mapping: ${where} needs a non-empty external relation`);
      }
      if (!CANONICAL_MAPPING_KINDS.has(rel.canonicalKind)) {
        throw new Error(`predicate-mapping: ${where} has unknown canonicalKind "${rel.canonicalKind}"`);
      }
      if (!MAPPING_DIRECTIONS.has(rel.direction)) {
        throw new Error(`predicate-mapping: ${where} has unknown direction "${rel.direction}"`);
      }
      if (typeof rel.pending !== "boolean") {
        throw new Error(`predicate-mapping: ${where} needs a boolean pending flag`);
      }
      if (rel.dialect !== null && !dialectIds.has(rel.dialect)) {
        throw new Error(`predicate-mapping: ${where} references unknown dialect tier "${rel.dialect}"`);
      }
      if (!egressIds.has(rel.egress)) {
        throw new Error(`predicate-mapping: ${where} references unknown egress class "${rel.egress}"`);
      }
      if (!isNonEmptyString(rel.notes)) {
        throw new Error(`predicate-mapping: ${where} needs notes`);
      }

      // Relation totality against the koine vocabulary.
      if (!Array.isArray(rel.koineRelations)) {
        throw new Error(`predicate-mapping: ${where} koineRelations must be an array`);
      }
      if (CLAIM_KINDS.has(rel.canonicalKind)) {
        if (rel.koineRelations.length === 0) {
          throw new Error(`predicate-mapping: ${where} crosses as a claim but names no koine relation`);
        }
      } else if (rel.koineRelations.length > 0) {
        throw new Error(`predicate-mapping: ${where} is kind "${rel.canonicalKind}" and must not name a koine relation`);
      }
      for (const relation of rel.koineRelations) {
        if (!relationSignature(relation)) {
          throw new Error(`predicate-mapping: ${where} names koine relation "${relation}" that is not in the shared vocabulary (koine ${registry.relationRegistry.core} + ${registry.relationRegistry.domains.join(", ")}; pinakes speaks the ${KGP_RELATION_DOMAINS.join("/")} domains)`);
        }
      }

      // Canonical-type totality.
      if (TYPED_KINDS.has(rel.canonicalKind)) {
        const types = referencedTypes(rel);
        if (types.length === 0) {
          throw new Error(`predicate-mapping: ${where} is kind "${rel.canonicalKind}" but names no canonical type`);
        }
        const isEdge = rel.canonicalKind === "edge";
        for (const type of types) {
          const resolves = isEdge ? Boolean(edgeTypeByName(type)) : Boolean(nodeTypeByName(type));
          const declaredPending = (isEdge ? pendingEdges : pendingNodes).has(type);
          if (rel.pending) {
            if (resolves) {
              throw new Error(`predicate-mapping: ${where} is marked pending but canonical type "${type}" already resolves — flip pending to false`);
            }
            if (!declaredPending) {
              throw new Error(`predicate-mapping: ${where} is pending on canonical type "${type}" not listed in pendingSchemaAdditions`);
            }
          } else if (!resolves) {
            throw new Error(`predicate-mapping: ${where} names canonical type "${type}" that does not resolve in the canonical schema`);
          }
        }
      } else if (rel.canonicalType !== undefined || rel.canonicalTypes !== undefined) {
        throw new Error(`predicate-mapping: ${where} is kind "${rel.canonicalKind}" and must not name a canonical type`);
      }
    }
  }
}
