/**
 * Canonical node/edge schema contract — the single data model both
 * pinakes-engine and pinakes target (US-001).
 *
 * The machine-readable source of truth is {@link ./canonical-schema.json}. This
 * module imports it, pins its shape with a `satisfies` check (so `npm run check`
 * fails if the JSON drifts from the contract type), and exposes typed accessors
 * the ingestion / export / QA code (US-002..US-008) build on.
 *
 * The column contracts mirror pinakes-engine's typed Neo4j-import headers
 * (`engine/src/pinakes_engine/schema/headers.py`) so exported
 * TSV is import-compatible with `neo4j-admin import` without transformation.
 *
 * The *vocabulary* — which node/edge types exist, their labels and `:TYPE`
 * tokens, the header rows — comes from `./generated/canonical-schema`, emitted
 * from the same JSON by `npm run gen:contracts` (40-contracts-codegen US-1). A
 * JSON import widens every string cell to `string`, so the literal unions below
 * cannot be recovered from `canonicalSchemaJson` at all; generating them is what
 * makes `CanonicalNodeTypeName` a real type on this side of the stack, and what
 * pairs it with the Python binding the engine imports.
 */
import canonicalSchemaJson from "./canonical-schema.json";
import {
  CANONICAL_EDGE_HEADER_ROW,
  CANONICAL_NODE_HEADER_ROW,
} from "./generated/canonical-schema";

export type {
  CanonicalEdgeField,
  CanonicalEdgeTypeName,
  CanonicalEdgeTypeToken,
  CanonicalNodeField,
  CanonicalNodeLabel,
  CanonicalNodeTypeName,
} from "./generated/canonical-schema";
export {
  CANONICAL_EDGE_HEADER_ROW,
  CANONICAL_EDGE_TYPE_NAMES,
  CANONICAL_EDGE_TYPE_TOKENS,
  CANONICAL_LABEL_BY_NODE_TYPE,
  CANONICAL_NODE_HEADER_ROW,
  CANONICAL_NODE_LABELS,
  CANONICAL_NODE_TYPE_NAMES,
  CANONICAL_SCHEMA_VERSION,
  CANONICAL_TOKEN_BY_EDGE_TYPE,
} from "./generated/canonical-schema";

/** A Neo4j-import property type; drives the header suffix (`""`/`:int`/`:float`). */
export type CanonicalColumnType = "string" | "int" | "float";

/** What a column *is* in the canonical model. */
export type CanonicalColumnRole =
  | "id" // node primary key (`csid:ID`)
  | "label" // node `:LABEL`
  | "start_id" // edge `:START_ID`
  | "end_id" // edge `:END_ID`
  | "type" // edge `:TYPE`
  | "core" // required/near-required identity + display columns
  | "dimension" // temporal / geographic / linguistic / genetic columns
  | "provenance" // source / trust columns
  | "alias"; // retained cross-project id (e.g. `pinakes_id`)

/** One column in a node or edge header row. */
export interface CanonicalColumn {
  /** Canonical field name (property name, or the structural token e.g. `:LABEL`). */
  readonly field: string;
  /** The exact TSV header cell, including any Neo4j type suffix. */
  readonly header: string;
  readonly type: CanonicalColumnType;
  readonly role: CanonicalColumnRole;
  /** Whether the column must be present in every exported file of this family. */
  readonly required: boolean;
}

/** A canonical node type and its Neo4j `:LABEL`. */
export interface CanonicalNodeType {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

/** A canonical edge type and its Neo4j `:TYPE` token. */
export interface CanonicalEdgeType {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  /** Node type names this edge may originate from (`[]` = unconstrained). */
  readonly from: readonly string[];
  /** Node type names this edge may point to (`[]` = unconstrained). */
  readonly to: readonly string[];
}

/** The identity / reconciliation scheme. */
export interface CanonicalIdScheme {
  readonly primaryKey: string;
  readonly format: string;
  readonly notes: string;
  readonly anchors: {
    readonly all: readonly string[];
    readonly language: readonly string[];
    readonly place: readonly string[];
  };
  readonly aliasColumn: string;
  readonly aliasNote: string;
}

/** The whole machine-readable canonical schema. */
export interface CanonicalSchema {
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly delimiter: string;
  readonly idScheme: CanonicalIdScheme;
  readonly node: { readonly columns: readonly CanonicalColumn[] };
  readonly edge: { readonly columns: readonly CanonicalColumn[] };
  readonly provenanceColumns: {
    readonly node: readonly string[];
    readonly edge: readonly string[];
  };
  readonly nodeTypes: readonly CanonicalNodeType[];
  readonly edgeTypes: readonly CanonicalEdgeType[];
}

/**
 * The canonical schema. The JSON import is asserted to {@link CanonicalSchema}
 * (its `type`/`role` string cells widen to `string` on import, so a plain
 * `satisfies` cannot narrow them to the literal unions). Structural drift in
 * `canonical-schema.json` — missing top-level keys or an incompatibly-shaped
 * column — still breaks `npm run check`; enum-level drift is caught at runtime
 * by {@link assertValidCanonicalSchema} (exercised by the US-002+ vitest tests).
 */
export const CANONICAL_SCHEMA = canonicalSchemaJson as CanonicalSchema;

const COLUMN_TYPES: ReadonlySet<string> = new Set(["string", "int", "float"]);
const COLUMN_ROLES: ReadonlySet<string> = new Set([
  "id",
  "label",
  "start_id",
  "end_id",
  "type",
  "core",
  "dimension",
  "provenance",
  "alias",
]);

/**
 * Assert `schema` is well-formed: every column carries a known `type`/`role`,
 * node/edge families expose their structural columns, and each provenance name
 * resolves to a real column. Throws {@link Error} on the first violation.
 * Runtime counterpart to the compile-time shape check on {@link CANONICAL_SCHEMA}.
 */
export function assertValidCanonicalSchema(
  schema: CanonicalSchema = CANONICAL_SCHEMA,
): void {
  const check = (family: "node" | "edge") => {
    const columns = schema[family].columns;
    const fields = new Set(columns.map((c) => c.field));
    for (const column of columns) {
      if (!COLUMN_TYPES.has(column.type)) {
        throw new Error(
          `canonical-schema: ${family} column ${column.field} has unknown type ${column.type}`,
        );
      }
      if (!COLUMN_ROLES.has(column.role)) {
        throw new Error(
          `canonical-schema: ${family} column ${column.field} has unknown role ${column.role}`,
        );
      }
    }
    for (const prov of schema.provenanceColumns[family]) {
      if (!fields.has(prov)) {
        throw new Error(
          `canonical-schema: ${family} provenance column ${prov} is not a declared column`,
        );
      }
    }
  };
  check("node");
  check("edge");
  if (!schema.node.columns.some((c) => c.role === "id")) {
    throw new Error("canonical-schema: node family requires an :ID column");
  }
  for (const role of ["start_id", "end_id", "type"] as const) {
    if (!schema.edge.columns.some((c) => c.role === role)) {
      throw new Error(`canonical-schema: edge family requires a ${role} column`);
    }
  }
}

/** Column delimiter for the canonical TSV family (tab). */
export const CANONICAL_DELIMITER = CANONICAL_SCHEMA.delimiter;

/**
 * Ordered node header row (`csid:ID\t:LABEL\tname\t…`) — the generated constant,
 * so the exact bytes the Python side's `NODE_HEADER_ROW` carries.
 */
export function nodeHeaderRow(): string {
  return CANONICAL_NODE_HEADER_ROW;
}

/** Ordered edge header row (`:START_ID\t:END_ID\t:TYPE\t…`). */
export function edgeHeaderRow(): string {
  return CANONICAL_EDGE_HEADER_ROW;
}

/** Provenance field names required on every node row. */
export function nodeProvenanceColumns(): readonly string[] {
  return CANONICAL_SCHEMA.provenanceColumns.node;
}

/** Provenance field names required on every edge row. */
export function edgeProvenanceColumns(): readonly string[] {
  return CANONICAL_SCHEMA.provenanceColumns.edge;
}

/** Look up a canonical node type by its kebab-case `name`. */
export function nodeTypeByName(name: string): CanonicalNodeType | undefined {
  return CANONICAL_SCHEMA.nodeTypes.find((t) => t.name === name);
}

/** Look up a canonical edge type by its kebab-case `name`. */
export function edgeTypeByName(name: string): CanonicalEdgeType | undefined {
  return CANONICAL_SCHEMA.edgeTypes.find((t) => t.name === name);
}

/** Every valid node `:LABEL` in the canonical model. */
export function nodeLabels(): string[] {
  return CANONICAL_SCHEMA.nodeTypes.map((t) => t.label);
}

/** Every valid edge `:TYPE` token in the canonical model. */
export function edgeTypeTokens(): string[] {
  return CANONICAL_SCHEMA.edgeTypes.map((t) => t.type);
}
