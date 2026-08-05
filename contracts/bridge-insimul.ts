/**
 * The **Pinakes ↔ Insimul bridge mapping** — Pinakes's own, in-repo, versioned answer to
 * koine's translation facet (`koine/docs/self-describing-participant.md` facet 4).
 *
 * Koine holds the SHAPE of a bridge mapping and nothing else; the mapping itself belongs
 * to the participant that performs the crossing, and travels with the code that performs
 * it. That is what this module is: the correspondences for the one integration whose every
 * endpoint is public — grounding packs / world seeds out (Bridge 1), converted worlds and
 * the SLM datasets distilled from them back (Bridge 2) — resolved against Pinakes's own
 * `contracts/canonical-schema.json` and nothing outside this repository.
 *
 * **It is a mapping, not a vocabulary.** No predicate string and no relation name is
 * authored here: each row names the vendored registry entry
 * (`contracts/predicate-mapping.json`, `projects.insimul`) that authorizes its predicates,
 * and {@link assertValidBridgeMapping} resolves it. A vocabulary gap is closed by
 * upstreaming a row to koine and re-vendoring, never by naming a predicate in this file —
 * the same rule `predicate-mapping.ts` documents, enforced one layer up.
 *
 * **A non-public far endpoint is absent, not redacted** ({@link assertPublicBridge}). A
 * redacted section still leaks the shape of the endpoint it hides; absence is the
 * representation, which is also why this module reads no external file.
 *
 * The machine-readable source of truth is {@link ./bridge-insimul.json}.
 */
import bridgeJson from "./bridge-insimul.json";
import { CANONICAL_SCHEMA, type CanonicalSchema } from "./canonical-schema";
import {
  PREDICATE_MAPPING,
  externalPredicates,
  type EgressClass,
  type PredicateMappingRegistry,
  type RelationMapping,
} from "./predicate-mapping";

/** Which leg of the bridge a row governs. */
export type BridgeDirection = "export" | "return";

/** The registry `canonicalKind`s a bridge row may carry. */
export type BridgeCanonicalKind = "node" | "edge" | "rule";

/** Whether a participant on this bridge is publicly reachable. */
export type BridgeVisibility = "public" | "non-public";

/** A pointer to where something lives — a path in *this* repo, and/or free-text context. */
export interface BridgeLocation {
  readonly path?: string;
  readonly url?: string;
  readonly note?: string;
}

/** One end of the bridge. Both ends must be `public` for the mapping to live here. */
export interface BridgeParticipant {
  readonly role: "local" | "remote";
  readonly id: string;
  readonly namespace: string;
  readonly visibility: BridgeVisibility;
  readonly location: BridgeLocation;
}

/** The id-space rule for one leg — how ids are minted and what they may be trusted for. */
export interface BridgeIdSpace {
  readonly form: string;
  readonly rule: string;
  readonly mintedBy: string;
  readonly mintedByNote?: string;
}

/** One leg of the bridge: which registry directions feed it, and what implements it. */
export interface BridgeDirectionSpec {
  readonly id: BridgeDirection;
  readonly summary: string;
  /** The `projects.insimul` entry directions a row on this leg may draw on. */
  readonly registryDirections: readonly string[];
  /** Pinned egress class, when the leg sends data outward. */
  readonly requiredEgress?: EgressClass;
  readonly implementedBy: readonly string[];
  readonly note?: string;
}

/** One correspondence: a registry entry and the canonical type(s) crossing under it. */
export interface BridgeRow {
  readonly direction: BridgeDirection;
  /** Entry id in `predicate-mapping.json` `projects.insimul.relations`. */
  readonly registryEntry: number;
  readonly canonicalKind: BridgeCanonicalKind;
  /** Canonical node/edge type names — empty for a kind that has none (`rule`). */
  readonly canonicalTypes: readonly string[];
  /**
   * Set when the leg reuses a canonical type the registry entry pairs with Insimul in the
   * OTHER direction — a node anchored on an existing type rather than a second predicate
   * crossing. Requires a `note` saying why, and is the only way past the direction check.
   */
  readonly typeReuseOnly?: boolean;
  readonly note: string;
}

/** The in-repo bridge mapping. */
export interface BridgeMapping {
  readonly bridgeVersion: string;
  readonly bridge: string;
  readonly title: string;
  readonly description: string;
  readonly owner: string;
  readonly canonicalSchema: BridgeLocation;
  readonly registry: BridgeLocation & { readonly project: string; readonly canonicalHome?: string };
  readonly participants: readonly BridgeParticipant[];
  readonly publicOnly: { readonly rule: string; readonly note?: string };
  readonly idSpaces: Readonly<Record<BridgeDirection, BridgeIdSpace>>;
  readonly directions: readonly BridgeDirectionSpec[];
  readonly rows: readonly BridgeRow[];
}

// The JSON import widens every string cell to `string`, so the literal unions above need
// the assertion plus the runtime validator (the `canonical-schema` gotcha, same remedy).
/** The live mapping as authored in `bridge-insimul.json`. */
export const BRIDGE_INSIMUL = bridgeJson as unknown as BridgeMapping;

/** Where this mapping lives, repo-relative — what `participant.json` points at. */
export const BRIDGE_INSIMUL_PATH = "contracts/bridge-insimul.json";

/** The registry project section whose entries authorize every row. */
export const BRIDGE_REGISTRY_PROJECT = "insimul";

/** The two legs, in declaration order. */
export const BRIDGE_DIRECTIONS: readonly BridgeDirection[] = ["export", "return"];

/** The rows governing one leg. */
export function bridgeRows(
  direction: BridgeDirection,
  mapping: BridgeMapping = BRIDGE_INSIMUL,
): readonly BridgeRow[] {
  return mapping.rows.filter((row) => row.direction === direction);
}

/** The declaration for one leg, or `undefined`. */
export function bridgeDirection(
  direction: BridgeDirection,
  mapping: BridgeMapping = BRIDGE_INSIMUL,
): BridgeDirectionSpec | undefined {
  return mapping.directions.find((spec) => spec.id === direction);
}

/**
 * The row a canonical type crosses under on one leg, or `undefined`. This is the accessor
 * the exporter resolves its registry entry through — it never names an entry id itself.
 */
export function bridgeRowForCanonicalType(
  canonicalType: string,
  direction: BridgeDirection,
  mapping: BridgeMapping = BRIDGE_INSIMUL,
): BridgeRow | undefined {
  return bridgeRows(direction, mapping).find((row) => row.canonicalTypes.includes(canonicalType));
}

/** Every canonical type crossing on one leg, deduplicated, in row order. */
export function bridgedCanonicalTypes(
  direction: BridgeDirection,
  mapping: BridgeMapping = BRIDGE_INSIMUL,
): string[] {
  return [...new Set(bridgeRows(direction, mapping).flatMap((row) => row.canonicalTypes))];
}

/** The `projects.insimul` registry entry a row is authorized by, or `undefined`. */
export function registryEntryForRow(
  row: BridgeRow,
  registry: PredicateMappingRegistry = PREDICATE_MAPPING,
): RelationMapping | undefined {
  return registry.projects[BRIDGE_REGISTRY_PROJECT]?.relations.find((r) => r.id === row.registryEntry);
}

/** The predicates a row's registry entry names, as `name/arity`. */
export function bridgedPredicates(
  row: BridgeRow,
  registry: PredicateMappingRegistry = PREDICATE_MAPPING,
): string[] {
  const entry = registryEntryForRow(row, registry);
  return entry ? externalPredicates(entry).map((p) => `${p.name}/${p.arity}`) : [];
}

/** The canonical types a registry entry declares (`canonicalType` and/or `canonicalTypes`). */
function entryTypes(entry: RelationMapping): readonly string[] {
  return [...(entry.canonicalType ? [entry.canonicalType] : []), ...(entry.canonicalTypes ?? [])];
}

/**
 * Assert every participant on this bridge is public.
 *
 * Pinakes integrates with non-public services too; their mappings are absent from this
 * repository rather than redacted in it, because a redacted section still discloses the
 * shape of the far endpoint. This check is what makes "absent" an invariant rather than an
 * intention — a `non-public` participant appearing here fails the gate.
 */
export function assertPublicBridge(mapping: BridgeMapping = BRIDGE_INSIMUL): void {
  const roles = new Set<string>();
  for (const participant of mapping.participants) {
    if (participant.visibility !== "public") {
      throw new Error(
        `bridge-insimul: participant "${participant.id}" is ${participant.visibility} — ` +
          "a bridge with a non-public endpoint is not represented in this repository at all",
      );
    }
    if (participant.role !== "local" && participant.role !== "remote") {
      throw new Error(`bridge-insimul: participant "${participant.id}" has unknown role "${participant.role}"`);
    }
    if (roles.has(participant.role)) {
      throw new Error(`bridge-insimul: two participants claim the "${participant.role}" role`);
    }
    roles.add(participant.role);
  }
  if (!roles.has("local") || !roles.has("remote")) {
    throw new Error("bridge-insimul: a bridge needs both a local and a remote participant");
  }
}

/**
 * Validate the mapping's shape and — the part that matters — resolve every reference it
 * makes, so a row can never name a canonical type Pinakes does not have or a registry
 * entry that does not authorize it. Throws on the first violation:
 *
 *  - every `canonicalTypes` cell resolves in `canonical-schema.json` for its `canonicalKind`
 *    (the check the story calls "fails on an unmapped type"); a `rule` row carries none;
 *  - every `registryEntry` exists in `projects.insimul.relations` and covers the row's
 *    canonical types;
 *  - the entry crosses in a direction this leg draws on — unless the row declares
 *    `typeReuseOnly` with a note, which is how an ingested node anchors on a type the
 *    registry pairs with Insimul in the other direction;
 *  - the entry's egress matches a leg that pins one (`export` sends data outward, so a
 *    `local-only` entry may never appear on it);
 *  - no entry is `pending` on an unlanded canonical schema addition;
 *  - both participants are public ({@link assertPublicBridge}).
 */
export function assertValidBridgeMapping(
  mapping: BridgeMapping = BRIDGE_INSIMUL,
  schema: CanonicalSchema = CANONICAL_SCHEMA,
  registry: PredicateMappingRegistry = PREDICATE_MAPPING,
): void {
  if (!/^\d+\.\d+\.\d+$/.test(mapping.bridgeVersion ?? "")) {
    throw new Error(`bridge-insimul: bridgeVersion must be semver, got "${mapping.bridgeVersion}"`);
  }
  if (mapping.registry.project !== BRIDGE_REGISTRY_PROJECT) {
    throw new Error(
      `bridge-insimul: registry.project must be "${BRIDGE_REGISTRY_PROJECT}", got "${mapping.registry.project}"`,
    );
  }
  if (registry.projects[BRIDGE_REGISTRY_PROJECT] === undefined) {
    throw new Error(
      `bridge-insimul: the predicate-mapping registry has no "${BRIDGE_REGISTRY_PROJECT}" project section`,
    );
  }
  assertPublicBridge(mapping);

  for (const direction of BRIDGE_DIRECTIONS) {
    const spec = bridgeDirection(direction, mapping);
    if (spec === undefined) {
      throw new Error(`bridge-insimul: no declaration for the "${direction}" leg`);
    }
    if (spec.registryDirections.length === 0) {
      throw new Error(`bridge-insimul: the "${direction}" leg draws on no registry direction`);
    }
    if (spec.implementedBy.length === 0) {
      throw new Error(
        `bridge-insimul: the "${direction}" leg names no implementation — a mapping travels with the code that performs the crossing`,
      );
    }
    for (const path of spec.implementedBy) {
      assertRepoRelative(path, `directions.${direction}.implementedBy`);
    }
    if (mapping.idSpaces[direction] === undefined) {
      throw new Error(`bridge-insimul: the "${direction}" leg declares no id-space rule`);
    }
    if (bridgeRows(direction, mapping).length === 0) {
      throw new Error(`bridge-insimul: the "${direction}" leg has no rows`);
    }
  }
  assertRepoRelative(mapping.canonicalSchema.path, "canonicalSchema.path");
  assertRepoRelative(mapping.registry.path, "registry.path");

  const seen = new Set<string>();
  mapping.rows.forEach((row, i) => {
    const where = `bridge-insimul: rows[${i}] (${row.direction} #${row.registryEntry})`;
    const spec = bridgeDirection(row.direction, mapping);
    if (spec === undefined) {
      throw new Error(`${where} has unknown direction "${row.direction}"`);
    }
    if (!["node", "edge", "rule"].includes(row.canonicalKind)) {
      throw new Error(`${where} has unknown canonicalKind "${row.canonicalKind}"`);
    }
    if (!row.note) {
      throw new Error(`${where} has no note — a correspondence nobody explained is one nobody can check`);
    }

    // --- the canonical types resolve in Pinakes's own schema ------------------
    if (row.canonicalKind === "rule") {
      if (row.canonicalTypes.length > 0) {
        throw new Error(`${where} is a rule row but names canonical types — rules have none`);
      }
    } else if (row.canonicalTypes.length === 0) {
      throw new Error(`${where} names no canonical type`);
    }
    for (const type of row.canonicalTypes) {
      // Read the schema PASSED IN, never the module-level live one — an accessor that
      // closed over `CANONICAL_SCHEMA` would silently validate the live doc instead of
      // the clone under test (the same trap `capability-manifest.ts` documents).
      if (!schemaDeclares(schema, row.canonicalKind, type)) {
        throw new Error(
          `${where} maps canonical ${row.canonicalKind} type "${type}", which ${mapping.canonicalSchema.path} does not declare`,
        );
      }
      const key = `${row.direction} ${type}`;
      if (seen.has(key)) {
        throw new Error(`${where} maps "${type}" a second time on the same leg`);
      }
      seen.add(key);
    }

    // --- the registry entry authorizes it ------------------------------------
    const entry = registryEntryForRow(row, registry);
    if (entry === undefined) {
      throw new Error(`${where} names no entry in projects.${BRIDGE_REGISTRY_PROJECT}`);
    }
    if (entry.canonicalKind !== row.canonicalKind) {
      throw new Error(
        `${where} declares kind "${row.canonicalKind}" but its registry entry is a "${entry.canonicalKind}"`,
      );
    }
    const covered = entryTypes(entry);
    for (const type of row.canonicalTypes) {
      if (!covered.includes(type)) {
        throw new Error(
          `${where} maps "${type}", which its registry entry does not cover (entry covers ${covered.join(", ") || "none"})`,
        );
      }
    }
    if (entry.pending) {
      throw new Error(`${where} uses an entry pending an unlanded canonical schema addition`);
    }
    if (!spec.registryDirections.includes(entry.direction)) {
      if (row.typeReuseOnly !== true) {
        throw new Error(
          `${where} uses a "${entry.direction}" entry, which does not cross on the ${row.direction} leg ` +
            `(that leg draws on ${spec.registryDirections.join(", ")}). Declare typeReuseOnly with a note if the ` +
            "leg only reuses the canonical type rather than crossing a predicate.",
        );
      }
    } else if (row.typeReuseOnly === true) {
      throw new Error(
        `${where} declares typeReuseOnly but its entry already crosses "${entry.direction}" — drop the flag`,
      );
    }
    if (spec.requiredEgress !== undefined && entry.egress !== spec.requiredEgress) {
      throw new Error(
        `${where} uses a "${entry.egress}" entry on a leg pinned to "${spec.requiredEgress}" — it may not leave the machine`,
      );
    }
  });
}

/** Whether the schema itself declares a type — the accessors read the live doc, this reads *this* one. */
function schemaDeclares(schema: CanonicalSchema, kind: BridgeCanonicalKind, type: string): boolean {
  const types = kind === "node" ? schema.nodeTypes : schema.edgeTypes;
  return types.some((t) => t.name === type);
}

/** ADR-0007 decision 4: a pointer names something in THIS repo, never a sibling checkout. */
function assertRepoRelative(path: string | undefined, where: string): void {
  if (path === undefined || path.length === 0) {
    throw new Error(`bridge-insimul: ${where} is required`);
  }
  if (path.startsWith("/") || path.startsWith("..") || path.includes("://")) {
    throw new Error(
      `bridge-insimul: ${where} "${path}" must be relative to this repo's root — the mapping resolves nothing outside it`,
    );
  }
}
