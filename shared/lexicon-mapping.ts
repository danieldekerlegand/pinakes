/**
 * Pinakes lexicon → canonical node/edge mapping (US-002).
 *
 * The machine-readable source of truth is {@link ./lexicon-mapping.json}. This
 * module imports it, pins its shape, and exposes typed accessors the
 * edge-extraction / export / QA code (US-003..US-008) build on. Every
 * `lexicons/*.tsv` is mapped to a canonical `kind`/node type and every source
 * column is given exactly one disposition (canonical field target, embedded
 * edge, retained property, or documented drop).
 *
 * Validity (totality over files, real column names, real canonical targets) is
 * enforced against the live TSVs and {@link ./canonical-schema} by
 * `shared/lexicon-mapping.test.ts`. {@link assertValidLexiconMapping} performs
 * the schema-only (no-filesystem) checks reusable at runtime.
 */
import lexiconMappingJson from "./lexicon-mapping.json";
import {
  CANONICAL_SCHEMA,
  edgeTypeByName,
  nodeTypeByName,
} from "./canonical-schema.ts";

/** How a whole lexicon file maps into the canonical model. */
export type LexiconFileKind = "node" | "edge" | "attribute" | "excluded";

/** One source column's disposition. Exactly one of the optional fields is set. */
export interface LexiconColumnMapping {
  /** The exact source TSV header cell. */
  readonly column: string;
  /** Canonical field the column maps to (node field for node files, edge field for edge files). */
  readonly target?: string;
  /** Canonical edge type name this column's embedded relationship becomes. */
  readonly edge?: string;
  /** Retained as an extra property with no dedicated canonical field. */
  readonly property?: boolean;
  /** Not carried into the canonical model; `reason` explains why. */
  readonly drop?: boolean;
  /** Required when `drop` is set. */
  readonly reason?: string;
  /** Optional reviewer note. */
  readonly note?: string;
}

/** The mapping for a single `lexicons/*.tsv`. */
export interface LexiconFileMapping {
  /** Base filename, e.g. `languages.tsv`. */
  readonly file: string;
  readonly kind: LexiconFileKind;
  /** Canonical node type name for `kind === "node"`, else `null`. */
  readonly node: string | null;
  readonly note?: string;
  readonly columns: readonly LexiconColumnMapping[];
}

/** The whole lexicon-mapping document. */
export interface LexiconMapping {
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly kinds: Readonly<Record<string, string>>;
  readonly dispositions: Readonly<Record<string, string>>;
  readonly files: readonly LexiconFileMapping[];
}

/**
 * The lexicon mapping. String cells widen to `string` on JSON import so the
 * literal-union fields (`kind`) cannot be narrowed by `satisfies`; structural
 * drift still breaks `npm run check`, and enum-level drift is caught by
 * {@link assertValidLexiconMapping}.
 */
export const LEXICON_MAPPING = lexiconMappingJson as LexiconMapping;

const FILE_KINDS: ReadonlySet<string> = new Set([
  "node",
  "edge",
  "attribute",
  "excluded",
]);

/** Canonical field names a column `target` may reference (node ∪ edge fields). */
function canonicalFieldNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const c of CANONICAL_SCHEMA.node.columns) names.add(c.field);
  for (const c of CANONICAL_SCHEMA.edge.columns) names.add(c.field);
  return names;
}

/** Look up the mapping for a lexicon file by base name. */
export function lexiconMappingByFile(
  file: string,
): LexiconFileMapping | undefined {
  return LEXICON_MAPPING.files.find((f) => f.file === file);
}

/** Base names of every mapped lexicon file. */
export function mappedFiles(): string[] {
  return LEXICON_MAPPING.files.map((f) => f.file);
}

/** Mapped files that become canonical nodes, with their node type name. */
export function nodeFiles(): { file: string; node: string }[] {
  return LEXICON_MAPPING.files
    .filter((f) => f.kind === "node" && f.node !== null)
    .map((f) => ({ file: f.file, node: f.node as string }));
}

/** Mapped files that become canonical edges. */
export function edgeFiles(): string[] {
  return LEXICON_MAPPING.files
    .filter((f) => f.kind === "edge")
    .map((f) => f.file);
}

/**
 * Assert the mapping is well-formed *against the canonical schema* (no
 * filesystem access): known `kind`s, node type present iff `kind === "node"`,
 * every column carries exactly one disposition, and every `target`/`edge`
 * resolves to a real canonical field / edge type. Totality over the actual
 * TSVs and real-column-name checks are covered by the vitest suite (which reads
 * the live headers). Throws {@link Error} on the first violation.
 */
export function assertValidLexiconMapping(
  mapping: LexiconMapping = LEXICON_MAPPING,
): void {
  const fields = canonicalFieldNames();
  const seenFiles = new Set<string>();
  for (const f of mapping.files) {
    if (seenFiles.has(f.file)) {
      throw new Error(`lexicon-mapping: duplicate file entry ${f.file}`);
    }
    seenFiles.add(f.file);

    if (!FILE_KINDS.has(f.kind)) {
      throw new Error(`lexicon-mapping: ${f.file} has unknown kind ${f.kind}`);
    }
    if (f.kind === "node") {
      if (f.node === null || nodeTypeByName(f.node) === undefined) {
        throw new Error(
          `lexicon-mapping: ${f.file} is a node file but node type ${f.node} is not canonical`,
        );
      }
    } else if (f.node !== null) {
      throw new Error(
        `lexicon-mapping: ${f.file} (${f.kind}) must set node: null`,
      );
    }

    const seenColumns = new Set<string>();
    for (const c of f.columns) {
      if (seenColumns.has(c.column)) {
        throw new Error(
          `lexicon-mapping: ${f.file} maps column ${c.column} more than once`,
        );
      }
      seenColumns.add(c.column);

      const dispositions = [c.target, c.edge, c.property, c.drop].filter(
        (d) => d !== undefined && d !== false,
      );
      if (dispositions.length !== 1) {
        throw new Error(
          `lexicon-mapping: ${f.file} column ${c.column} must carry exactly one disposition (has ${dispositions.length})`,
        );
      }
      if (c.target !== undefined && !fields.has(c.target)) {
        throw new Error(
          `lexicon-mapping: ${f.file} column ${c.column} targets unknown canonical field ${c.target}`,
        );
      }
      if (c.edge !== undefined && edgeTypeByName(c.edge) === undefined) {
        throw new Error(
          `lexicon-mapping: ${f.file} column ${c.column} references unknown edge type ${c.edge}`,
        );
      }
      if (c.drop === true && !c.reason) {
        throw new Error(
          `lexicon-mapping: ${f.file} drops column ${c.column} without a reason`,
        );
      }
    }
  }
}
