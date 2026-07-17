/**
 * Predicate-mapping registry — the machine-validated bridge contract between
 * pinakes's canonical node/edge vocabulary and the relation vocabularies of the
 * projects it bridges (Analyzer today; Insimul when `insimul-bridge` lands).
 *
 * The machine-readable source of truth is {@link ./predicate-mapping.json} — ONE
 * registry, versioned on `registryVersion`. This module imports it, pins its
 * shape with an `as` assertion (its enum string cells widen to `string` on JSON
 * import, so a plain `satisfies` cannot narrow them), and exposes typed accessors
 * the bridge code (grounding-snapshot exporter, the `analyzer` acquisition adapter,
 * the Datalog/Neo4j/GraphRAG layer) builds on. Structural drift in the JSON breaks
 * `npm run check`; enum-/totality-level drift is caught at runtime by
 * {@link assertValidPredicateMapping} (exercised by the vitest suite and wired
 * into the convergence-QA drift gate).
 *
 * The registry encodes the media-bridge mapping spec Appendix A: the Analyzer relations, the
 * `sha256:`/`cs:` id-space rules, the `local-only` portability class (the privacy
 * invariant — see {@link LOCAL_ONLY}), and the `t_start`/`t_end` ⇄
 * `time_start`/`time_end` temporal-field map. Consume via `@shared/predicate-mapping`;
 * never fork the JSON.
 */
import predicateMappingJson from "./predicate-mapping.json";
import { edgeTypeByName, nodeTypeByName } from "./canonical-schema";

/** What a relation's canonical side *is*. */
export type CanonicalMappingKind =
  | "node" // maps to a canonical node type
  | "node-property" // property of a canonical node type (not an edge)
  | "edge" // maps to a canonical edge type
  | "derived-rule" // a derived Horn rule, never a stored edge (e.g. co_occurs)
  | "rule" // a rules-registry entry + violation facts (cinematography)
  | "provenance" // maps to the canonical provenance columns
  | "temporal"; // temporal segmentation facts (endpoints via temporalFieldMap)

/** The direction a bridged relation crosses. */
export type MappingDirection = "AR->LS" | "LS->AR" | "both";

/** The `local-only` portability class — the privacy invariant this bridge introduces. */
export const LOCAL_ONLY = "local-only";

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
  /** The bridged project's predicate / relation as written in its Appendix A row. */
  readonly external: string;
  readonly canonicalKind: CanonicalMappingKind;
  /** The single canonical node/edge type this maps to (node/node-property/edge kinds). */
  readonly canonicalType?: string;
  /** Several canonical types, when the relation fans out (e.g. refers_to → depicts/mentions). */
  readonly canonicalTypes?: readonly string[];
  readonly direction: MappingDirection;
  /** Portability class ids (an entry may be e.g. both `horn-safe` and `local-only`). */
  readonly portability: readonly string[];
  /** Whether the canonical type is a declared-but-not-yet-added schema addition. */
  readonly pending: boolean;
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
  readonly direction: Readonly<Record<string, string>>;
  readonly pendingSchemaAdditions?: PendingSchemaAdditions;
  readonly relations: readonly RelationMapping[];
}

/** The whole machine-readable registry. */
export interface PredicateMappingRegistry {
  readonly registryVersion: string;
  readonly title: string;
  readonly description: string;
  readonly portabilityClasses: Readonly<Record<string, string>>;
  readonly idSpaces: readonly IdSpaceRule[];
  readonly temporalFieldMap: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, ProjectMapping>>;
}

/** The predicate-mapping registry. Structural drift in the JSON breaks `npm run check`. */
export const PREDICATE_MAPPING = predicateMappingJson as PredicateMappingRegistry;

const CANONICAL_MAPPING_KINDS: ReadonlySet<CanonicalMappingKind> = new Set([
  "node",
  "node-property",
  "edge",
  "derived-rule",
  "rule",
  "provenance",
  "temporal",
]);

const MAPPING_DIRECTIONS: ReadonlySet<MappingDirection> = new Set([
  "AR->LS",
  "LS->AR",
  "both",
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

/** Every portability class id the registry defines. */
export function portabilityClassIds(): string[] {
  return Object.keys(PREDICATE_MAPPING.portabilityClasses);
}

/** Whether a relation is `local-only` — must never leave the personal tier. */
export function isLocalOnly(relation: RelationMapping): boolean {
  return relation.portability.includes(LOCAL_ONLY);
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

/** The canonical temporal field an Analyzer temporal field maps to (`t_start` → `time_start`). */
export function canonicalTemporalField(argosField: string): string | undefined {
  return PREDICATE_MAPPING.temporalFieldMap[argosField];
}

/** The canonical types a relation references (single + fan-out), deduped. */
function referencedTypes(relation: RelationMapping): string[] {
  const types = [
    ...(relation.canonicalType ? [relation.canonicalType] : []),
    ...(relation.canonicalTypes ?? []),
  ];
  return [...new Set(types)];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Assert the registry is well-formed and canonical-type-total. Throws {@link Error}
 * on the first violation. Runtime counterpart to the compile-time shape check on
 * {@link PREDICATE_MAPPING}. Checks:
 *
 *  - top-level metadata (`registryVersion`/`title`/`description`) and at least one
 *    portability class, id-space rule, temporal-field pair, and project;
 *  - each id-space rule carries a prefix/form/description and a known `canonicalKind`;
 *  - each relation: unique id per project, non-empty `external`, a known
 *    `canonicalKind`/`direction`, every `portability` entry a defined class, and a
 *    boolean `pending`;
 *  - **canonical-type totality** — a `node`/`node-property`/`edge` relation names at
 *    least one canonical type, and each type either resolves in
 *    `shared/canonical-schema.json` (when `pending: false`) or is a declared
 *    `pendingSchemaAdditions` type that does NOT yet resolve (when `pending: true`).
 *    So the `pending` flag stays a live checklist: flipping it without the schema
 *    change — or vice-versa — fails here.
 */
export function assertValidPredicateMapping(
  registry: PredicateMappingRegistry = PREDICATE_MAPPING,
): void {
  for (const key of ["registryVersion", "title", "description"] as const) {
    if (!isNonEmptyString(registry[key])) {
      throw new Error(`predicate-mapping: ${key} must be a non-empty string`);
    }
  }
  const portabilityIds = new Set(Object.keys(registry.portabilityClasses));
  if (portabilityIds.size === 0) {
    throw new Error("predicate-mapping: at least one portability class required");
  }
  for (const [id, desc] of Object.entries(registry.portabilityClasses)) {
    if (!isNonEmptyString(desc)) {
      throw new Error(`predicate-mapping: portability class "${id}" needs a description`);
    }
  }
  if (!portabilityIds.has(LOCAL_ONLY)) {
    throw new Error(`predicate-mapping: the "${LOCAL_ONLY}" portability class must be defined`);
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
      // The asset id-space's node type is a pending v1.3 addition until US-003; allow a
      // declared pending node type in any project so the id-space rule can be authored now.
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
      if (!Array.isArray(rel.portability)) {
        throw new Error(`predicate-mapping: ${where} portability must be an array`);
      }
      for (const p of rel.portability) {
        if (!portabilityIds.has(p)) {
          throw new Error(`predicate-mapping: ${where} references unknown portability class "${p}"`);
        }
      }
      if (!isNonEmptyString(rel.notes)) {
        throw new Error(`predicate-mapping: ${where} needs notes`);
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
