/**
 * Generate the Python and TypeScript bindings for `contracts/` (40-contracts-codegen US-1).
 *
 * `contracts/*.json` is the **language-neutral source of truth**
 * (docs/UNIFIED-PROJECT-PLAN.md §10): the canonical schema plus the four registries. Both
 * halves of the stack have to agree on it, and until now each half reached for it its own
 * way — the TS side imports the JSON (whose string cells widen to `string`, so no literal
 * vocabulary survives), and the Python side either transcribed the values by hand
 * (`pinakes_engine.confidence`, `pinakes_engine.schema.headers`) or path-joined its way up
 * to the repo root. Both are copies that drift.
 *
 * This script emits ONE generated binding per source per language, from the JSON:
 *
 *   * `contracts/generated/*.ts` — literal-union vocabularies + derived constants the
 *     JSON import cannot express, re-exported through `contracts/generated/index.ts`.
 *   * `contracts/python/src/pinakes_contracts/*.py` — typed dataclasses, frozen literal
 *     tables and accessors for the `pinakes-contracts` workspace package that `engine`
 *     and `services/api` depend on.
 *
 * The generated Python **embeds** what it declares rather than reading the JSON at import
 * time, so an installed wheel needs no repo layout; the raw documents stay reachable
 * through `pinakes_contracts.contract_path` for the two places that genuinely want the
 * whole document (`pinakes_engine.datalog.schema_constraints`, the registry loaders).
 *
 * Same pure-core / thin-fs shape as the rest of `scripts/`: `buildBindings(documents)` is a
 * pure map of repo-relative path → content, and `writeBindings` / `runGen` / `runCheck` do
 * the filesystem side. Output is deterministic (no wall-clock, sources read in a fixed
 * order), so re-running on a clean tree is a no-op — which is what US-2's drift gate rests on.
 *
 * Run: `npm run gen:contracts` (write) / `npm run check:contracts` (read-only staleness).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The repo checkout this script lives in. */
export const REPO_ROOT = resolve(import.meta.dirname, "..");
/** The language-neutral contract sources. */
export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");

/** The one supported remedy every staleness message names. */
export const REGEN_REMEDY = "npm run gen:contracts";

/**
 * The neutral source documents, in generation order. Adding one means adding its emitter
 * below **and** its re-export in `contracts/generated/index.ts` (both are generated here).
 */
export const CONTRACT_SOURCES = [
  "canonical-schema.json",
  "capability-manifest.json",
  "confidence-rubric.json",
  "lexicon-mapping.json",
  "predicate-mapping.json",
] as const;

/** One of the neutral source file names. */
export type ContractSourceName = (typeof CONTRACT_SOURCES)[number];

/** The parsed source documents, keyed by file name. */
export type ContractDocuments = Readonly<Record<ContractSourceName, unknown>>;

// --- the shapes this script reads out of the sources -------------------------
// Deliberately partial: the generator only types what it emits, so an unrelated
// key added to a source needs no change here.

interface SchemaColumn {
  readonly field: string;
  readonly header: string;
  readonly type: string;
  readonly role: string;
  readonly required: boolean;
}

interface SchemaNodeType {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

interface SchemaEdgeType {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

interface CanonicalSchemaDoc {
  readonly version: string;
  readonly delimiter: string;
  readonly node: { readonly columns: readonly SchemaColumn[] };
  readonly edge: { readonly columns: readonly SchemaColumn[] };
  readonly provenanceColumns: {
    readonly node: readonly string[];
    readonly edge: readonly string[];
  };
  readonly nodeTypes: readonly SchemaNodeType[];
  readonly edgeTypes: readonly SchemaEdgeType[];
}

interface ConfidenceRubricDoc {
  readonly version: string;
  readonly order: readonly string[];
  readonly classes: Readonly<Record<string, { prior: number; rationale: string }>>;
}

interface CapabilityManifestDoc {
  readonly kcb_version: string;
  readonly identity: string;
  readonly capabilities: readonly { readonly name: string }[];
}

interface LexiconMappingDoc {
  readonly version: string;
  readonly files: readonly { readonly file: string; readonly kind: string }[];
}

interface PredicateMappingDoc {
  readonly registryVersion: string;
  readonly projects: Readonly<Record<string, unknown>>;
}

// --- literal rendering -------------------------------------------------------

/** A TS/Python string literal. JSON's escapes are a subset of both languages'. */
function str(value: string): string {
  return JSON.stringify(value);
}

/** A Python float literal — `1` must render as `1.0` or the prior stops being a float. */
function pyFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** An object key: bare when it is a plain identifier, quoted otherwise. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name);
}

/** `export type Name = | "a" | "b";` — one member per line, so a diff names the member. */
function tsUnion(name: string, values: readonly string[], doc: string): string {
  const members = values.map((value) => `  | ${str(value)}`).join("\n");
  return `/** ${doc} */\nexport type ${name} =\n${members};\n`;
}

/** `export const NAME = [ ... ] as const;` — a readonly tuple of string literals. */
function tsTuple(name: string, values: readonly string[], doc: string): string {
  const members = values.map((value) => `  ${str(value)},`).join("\n");
  return `/** ${doc} */\nexport const ${name} = [\n${members}\n] as const;\n`;
}

/** `export const NAME = { ... } as const satisfies Readonly<Record<K, V>>;` */
function tsRecord(
  name: string,
  entries: readonly (readonly [string, string])[],
  satisfiesType: string,
  doc: string,
): string {
  const members = entries.map(([k, v]) => `  ${key(k)}: ${v},`).join("\n");
  return `/** ${doc} */\nexport const ${name} = {\n${members}\n} as const satisfies ${satisfiesType};\n`;
}

/** `Name = Literal[...]` — a Python literal-union type alias. */
function pyLiteral(name: string, values: readonly string[], doc: string): string {
  const members = values.map((value) => `    ${str(value)},`).join("\n");
  return `#: ${doc}\n${name} = Literal[\n${members}\n]\n`;
}

/** `NAME: Final[tuple[str, ...]] = (...)` — a frozen ordered vocabulary. */
function pyTuple(name: string, values: readonly string[], doc: string): string {
  const members = values.map((value) => `    ${str(value)},`).join("\n");
  return `#: ${doc}\n${name}: Final[tuple[str, ...]] = (\n${members}\n)\n`;
}

/** `NAME: Final[Mapping[str, str]] = MappingProxyType({...})` — a frozen lookup. */
function pyMapping(
  name: string,
  entries: readonly (readonly [string, string])[],
  doc: string,
): string {
  const members = entries.map(([k, v]) => `        ${str(k)}: ${v},`).join("\n");
  return `#: ${doc}\n${name}: Final[Mapping[str, str]] = MappingProxyType(\n    {\n${members}\n    }\n)\n`;
}

// --- banners -----------------------------------------------------------------

function tsBanner(source: ContractSourceName, what: string): string {
  return [
    `// @generated by scripts/gen-contract-bindings.ts from contracts/${source} — DO NOT EDIT.`,
    `// ${what}`,
    `// Change the JSON, then run \`${REGEN_REMEDY}\`. The drift gate fails a stale binding.`,
    "",
    "",
  ].join("\n");
}

function pyBanner(source: ContractSourceName, what: string): string {
  return [
    `"""${what}`,
    "",
    `@generated by scripts/gen-contract-bindings.ts from \`\`contracts/${source}\`\` — DO NOT EDIT.`,
    `Change the JSON, then run \`${REGEN_REMEDY}\`. The drift gate fails a stale binding.`,
    '"""',
    "",
    "from __future__ import annotations",
    "",
  ].join("\n");
}

// --- canonical schema --------------------------------------------------------

/** The Neo4j property type a column declares, as a `PropertyType`-shaped token. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function canonicalSchemaTs(doc: CanonicalSchemaDoc): string {
  const nodeNames = doc.nodeTypes.map((t) => t.name);
  const nodeLabels = doc.nodeTypes.map((t) => t.label);
  const edgeNames = doc.edgeTypes.map((t) => t.name);
  const edgeTokens = doc.edgeTypes.map((t) => t.type);
  const nodeHeader = doc.node.columns.map((c) => c.header).join(doc.delimiter);
  const edgeHeader = doc.edge.columns.map((c) => c.header).join(doc.delimiter);

  return [
    tsBanner(
      "canonical-schema.json",
      "The canonical vocabulary as literal types — what `import … from './canonical-schema.json'` widens away.",
    ),
    `/** The schema \`version\` these bindings were generated from. */\nexport const CANONICAL_SCHEMA_VERSION = ${str(doc.version)};\n`,
    `/** The canonical TSV column delimiter. */\nexport const CANONICAL_DELIMITER_TOKEN = ${str(doc.delimiter)};\n`,
    tsUnion("CanonicalNodeTypeName", nodeNames, "A declared canonical node type `name`."),
    tsTuple("CANONICAL_NODE_TYPE_NAMES", nodeNames, "Every node type `name`, in schema order."),
    tsUnion("CanonicalNodeLabel", nodeLabels, "A declared node `:LABEL`."),
    tsTuple("CANONICAL_NODE_LABELS", nodeLabels, "Every node `:LABEL`, in schema order."),
    tsRecord(
      "CANONICAL_LABEL_BY_NODE_TYPE",
      doc.nodeTypes.map((t) => [t.name, str(t.label)] as const),
      "Readonly<Record<CanonicalNodeTypeName, CanonicalNodeLabel>>",
      "Node type `name` → its Neo4j `:LABEL`.",
    ),
    tsUnion("CanonicalEdgeTypeName", edgeNames, "A declared canonical edge type `name`."),
    tsTuple("CANONICAL_EDGE_TYPE_NAMES", edgeNames, "Every edge type `name`, in schema order."),
    tsUnion("CanonicalEdgeTypeToken", edgeTokens, "A declared edge `:TYPE` token."),
    tsTuple("CANONICAL_EDGE_TYPE_TOKENS", edgeTokens, "Every edge `:TYPE` token, in schema order."),
    tsRecord(
      "CANONICAL_TOKEN_BY_EDGE_TYPE",
      doc.edgeTypes.map((t) => [t.name, str(t.type)] as const),
      "Readonly<Record<CanonicalEdgeTypeName, CanonicalEdgeTypeToken>>",
      "Edge type `name` → its Neo4j `:TYPE` token.",
    ),
    tsUnion("CanonicalNodeField", doc.node.columns.map((c) => c.field), "A declared node column `field`."),
    tsUnion("CanonicalEdgeField", doc.edge.columns.map((c) => c.field), "A declared edge column `field`."),
    tsTuple("CANONICAL_NODE_PROVENANCE_COLUMNS", doc.provenanceColumns.node, "Provenance fields required on every node row."),
    tsTuple("CANONICAL_EDGE_PROVENANCE_COLUMNS", doc.provenanceColumns.edge, "Provenance fields required on every edge row."),
    `/** The ordered node header row (\`csid:ID\\t:LABEL\\t…\`). */\nexport const CANONICAL_NODE_HEADER_ROW = ${str(nodeHeader)};\n`,
    `/** The ordered edge header row (\`:START_ID\\t:END_ID\\t:TYPE\\t…\`). */\nexport const CANONICAL_EDGE_HEADER_ROW = ${str(edgeHeader)};\n`,
  ].join("\n");
}

function canonicalColumnPy(column: SchemaColumn): string {
  return (
    `    CanonicalColumn(field=${str(column.field)}, header=${str(column.header)}, ` +
    `type=${str(column.type)}, role=${str(column.role)}, required=${column.required ? "True" : "False"}),`
  );
}

function canonicalSchemaPy(doc: CanonicalSchemaDoc): string {
  const columns = [...doc.node.columns, ...doc.edge.columns];
  const nodeHeader = doc.node.columns.map((c) => c.header).join(doc.delimiter);
  const edgeHeader = doc.edge.columns.map((c) => c.header).join(doc.delimiter);

  const nodeTypes = doc.nodeTypes
    .map(
      (t) =>
        `    CanonicalNodeType(name=${str(t.name)}, label=${str(t.label)}, description=${str(t.description)}),`,
    )
    .join("\n");
  const edgeTypes = doc.edgeTypes
    .map((t) => {
      const from = t.from.map(str).join(", ");
      const to = t.to.map(str).join(", ");
      return (
        `    CanonicalEdgeType(name=${str(t.name)}, type=${str(t.type)}, description=${str(t.description)}, ` +
        `from_types=(${from ? `${from},` : ""}), to_types=(${to ? `${to},` : ""})),`
      );
    })
    .join("\n");

  return [
    pyBanner(
      "canonical-schema.json",
      "The canonical node/edge schema — the one data model pinakes_engine and the service share.",
    ),
    [
      "from collections.abc import Mapping",
      "from dataclasses import dataclass",
      "from types import MappingProxyType",
      "from typing import Final, Literal",
      "",
    ].join("\n"),
    pyLiteral("ColumnType", distinct(columns.map((c) => c.type)), "A Neo4j-import property type; drives the header suffix."),
    pyLiteral("ColumnRole", distinct(columns.map((c) => c.role)), "What a column *is* in the canonical model."),
    pyLiteral("NodeTypeName", doc.nodeTypes.map((t) => t.name), "A declared canonical node type ``name``."),
    pyLiteral("NodeLabel", doc.nodeTypes.map((t) => t.label), "A declared node ``:LABEL``."),
    pyLiteral("EdgeTypeName", doc.edgeTypes.map((t) => t.name), "A declared canonical edge type ``name``."),
    pyLiteral("EdgeTypeToken", doc.edgeTypes.map((t) => t.type), "A declared edge ``:TYPE`` token."),
    [
      "@dataclass(frozen=True)",
      "class CanonicalColumn:",
      '    """One column of a node or edge header row."""',
      "",
      "    #: Canonical field name (property name, or a structural token e.g. ``:LABEL``).",
      "    field: str",
      "    #: The exact TSV header cell, including any Neo4j type suffix.",
      "    header: str",
      "    type: ColumnType",
      "    role: ColumnRole",
      "    #: Whether every exported file of this family must carry the column.",
      "    required: bool",
      "",
    ].join("\n"),
    [
      "@dataclass(frozen=True)",
      "class CanonicalNodeType:",
      '    """A canonical node type and its Neo4j ``:LABEL``."""',
      "",
      "    name: str",
      "    label: str",
      "    description: str",
      "",
    ].join("\n"),
    [
      "@dataclass(frozen=True)",
      "class CanonicalEdgeType:",
      '    """A canonical edge type and its Neo4j ``:TYPE`` token.',
      "",
      "    ``from``/``to`` are Python keywords, so the endpoint constraints are",
      "    ``from_types``/``to_types`` here. An empty tuple means unconstrained.",
      '    """',
      "",
      "    name: str",
      "    type: str",
      "    description: str",
      "    from_types: tuple[str, ...]",
      "    to_types: tuple[str, ...]",
      "",
    ].join("\n"),
    `#: The schema \`\`version\`\` these bindings were generated from.\nVERSION: Final = ${str(doc.version)}\n`,
    `#: The canonical TSV column delimiter.\nDELIMITER: Final = ${str(doc.delimiter)}\n`,
    `#: The node header columns, in schema order.\nNODE_COLUMNS: Final[tuple[CanonicalColumn, ...]] = (\n${doc.node.columns.map(canonicalColumnPy).join("\n")}\n)\n`,
    `#: The edge header columns, in schema order.\nEDGE_COLUMNS: Final[tuple[CanonicalColumn, ...]] = (\n${doc.edge.columns.map(canonicalColumnPy).join("\n")}\n)\n`,
    pyTuple("NODE_PROVENANCE_COLUMNS", doc.provenanceColumns.node, "Provenance fields required on every node row."),
    pyTuple("EDGE_PROVENANCE_COLUMNS", doc.provenanceColumns.edge, "Provenance fields required on every edge row."),
    `#: Every declared node type, in schema order.\nNODE_TYPES: Final[tuple[CanonicalNodeType, ...]] = (\n${nodeTypes}\n)\n`,
    `#: Every declared edge type, in schema order.\nEDGE_TYPES: Final[tuple[CanonicalEdgeType, ...]] = (\n${edgeTypes}\n)\n`,
    pyTuple("NODE_TYPE_NAMES", doc.nodeTypes.map((t) => t.name), "Every node type ``name``, in schema order."),
    pyTuple("NODE_LABELS", doc.nodeTypes.map((t) => t.label), "Every node ``:LABEL``, in schema order."),
    pyTuple("EDGE_TYPE_NAMES", doc.edgeTypes.map((t) => t.name), "Every edge type ``name``, in schema order."),
    pyTuple("EDGE_TYPE_TOKENS", doc.edgeTypes.map((t) => t.type), "Every edge ``:TYPE`` token, in schema order."),
    pyMapping(
      "LABEL_BY_NODE_TYPE",
      doc.nodeTypes.map((t) => [t.name, str(t.label)] as const),
      "Node type ``name`` -> its Neo4j ``:LABEL``.",
    ),
    pyMapping(
      "TOKEN_BY_EDGE_TYPE",
      doc.edgeTypes.map((t) => [t.name, str(t.type)] as const),
      "Edge type ``name`` -> its Neo4j ``:TYPE`` token.",
    ),
    `#: The ordered node header row (\`\`csid:ID<TAB>:LABEL<TAB>...\`\`).\nNODE_HEADER_ROW: Final = ${str(nodeHeader)}\n`,
    `#: The ordered edge header row (\`\`:START_ID<TAB>:END_ID<TAB>:TYPE<TAB>...\`\`).\nEDGE_HEADER_ROW: Final = ${str(edgeHeader)}\n`,
    [
      "_NODE_TYPE_BY_NAME: Final[Mapping[str, CanonicalNodeType]] = MappingProxyType(",
      "    {node_type.name: node_type for node_type in NODE_TYPES}",
      ")",
      "_EDGE_TYPE_BY_NAME: Final[Mapping[str, CanonicalEdgeType]] = MappingProxyType(",
      "    {edge_type.name: edge_type for edge_type in EDGE_TYPES}",
      ")",
      "_EDGE_TYPE_BY_TOKEN: Final[Mapping[str, CanonicalEdgeType]] = MappingProxyType(",
      "    {edge_type.type: edge_type for edge_type in EDGE_TYPES}",
      ")",
      "",
      "",
      "def node_type_by_name(name: str) -> CanonicalNodeType | None:",
      '    """The node type declared under *name*, or ``None``."""',
      "    return _NODE_TYPE_BY_NAME.get(name)",
      "",
      "",
      "def edge_type_by_name(name: str) -> CanonicalEdgeType | None:",
      '    """The edge type declared under *name*, or ``None``."""',
      "    return _EDGE_TYPE_BY_NAME.get(name)",
      "",
      "",
      "def edge_type_by_token(token: str) -> CanonicalEdgeType | None:",
      '    """The edge type whose Neo4j ``:TYPE`` token is *token*, or ``None``."""',
      "    return _EDGE_TYPE_BY_TOKEN.get(token)",
      "",
    ].join("\n"),
  ].join("\n");
}

// --- confidence rubric -------------------------------------------------------

function confidenceRubricTs(doc: ConfidenceRubricDoc): string {
  return [
    tsBanner(
      "confidence-rubric.json",
      "The provenance-class vocabulary and its priors as literal types.",
    ),
    `/** The rubric \`version\` these bindings were generated from. */\nexport const CONFIDENCE_RUBRIC_VERSION = ${str(doc.version)};\n`,
    tsUnion("ConfidenceClassName", doc.order, "A declared provenance class."),
    tsTuple("CONFIDENCE_CLASS_ORDER", doc.order, "Provenance classes ranked most- to least-trusted."),
    tsRecord(
      "CONFIDENCE_PRIORS",
      doc.order.map((name) => [name, String(doc.classes[name].prior)] as const),
      "Readonly<Record<ConfidenceClassName, number>>",
      "Provenance class → its numeric prior in `[0, 1]`.",
    ),
  ].join("\n");
}

function confidenceRubricPy(doc: ConfidenceRubricDoc): string {
  const classes = doc.order
    .map(
      (name) =>
        `        ${str(name)}: ConfidenceClassEntry(prior=${pyFloat(doc.classes[name].prior)}, rationale=${str(doc.classes[name].rationale)}),`,
    )
    .join("\n");
  const priors = doc.order
    .map((name) => `        ${str(name)}: ${pyFloat(doc.classes[name].prior)},`)
    .join("\n");

  return [
    pyBanner(
      "confidence-rubric.json",
      "Per-provenance-class confidence priors — the single source of truth for what a ``confidence`` number means.",
    ),
    [
      "from collections.abc import Mapping",
      "from dataclasses import dataclass",
      "from types import MappingProxyType",
      "from typing import Final, Literal",
      "",
    ].join("\n"),
    pyLiteral("ConfidenceClass", doc.order, "A declared provenance class."),
    [
      "@dataclass(frozen=True)",
      "class ConfidenceClassEntry:",
      '    """One provenance class: its numeric prior in ``[0, 1]`` and the rationale."""',
      "",
      "    prior: float",
      "    rationale: str",
      "",
    ].join("\n"),
    `#: The rubric \`\`version\`\` these bindings were generated from.\nVERSION: Final = ${str(doc.version)}\n`,
    pyTuple("CLASS_ORDER", doc.order, "Provenance classes ranked most- to least-trusted."),
    `#: Every declared class, ordered most- to least-trusted.\nCLASSES: Final[Mapping[str, ConfidenceClassEntry]] = MappingProxyType(\n    {\n${classes}\n    }\n)\n`,
    `#: Provenance class -> its numeric prior in \`\`[0, 1]\`\`.\nCONFIDENCE_PRIORS: Final[Mapping[str, float]] = MappingProxyType(\n    {\n${priors}\n    }\n)\n`,
    [
      "def confidence_for(provenance_class: str) -> float:",
      '    """The confidence prior for *provenance_class*.',
      "",
      "    Raises :class:`KeyError` for an unknown class so a typo fails loudly rather",
      "    than silently stamping a wrong number.",
      '    """',
      "    try:",
      "        return CONFIDENCE_PRIORS[provenance_class]",
      "    except KeyError as exc:",
      "        raise KeyError(",
      '            f"confidence-rubric: unknown provenance class {provenance_class!r}"',
      "        ) from exc",
      "",
    ].join("\n"),
  ].join("\n");
}

// --- the three registries ----------------------------------------------------
//
// Python models these as a version pin + the key vocabulary + a `document()` loader:
// their bodies are deeply nested prose the Python half consumes whole, never field by
// field, so a generated dataclass tree would be bulk with no reader.

function registryDocumentPy(source: ContractSourceName): string {
  return [
    "",
    `#: The neutral source document these bindings were generated from.\nDOCUMENT_NAME: Final = ${str(source)}\n`,
    [
      "def document() -> dict[str, Any]:",
      '    """The whole parsed source document.',
      "",
      "    Read from ``contracts/`` at call time (see",
      "    :func:`pinakes_contracts.contract_path`) — the constants above are embedded,",
      "    the document is not, so this needs the repo checkout.",
      '    """',
      "    return load_document(DOCUMENT_NAME)",
      "",
    ].join("\n"),
  ].join("\n");
}

function capabilityManifestTs(doc: CapabilityManifestDoc): string {
  const names = doc.capabilities.map((c) => c.name);
  return [
    tsBanner("capability-manifest.json", "The Koine capability-bus manifest's identity + capability vocabulary."),
    `/** The \`kcb_version\` the manifest declares. */\nexport const CAPABILITY_MANIFEST_KCB_VERSION = ${str(doc.kcb_version)};\n`,
    `/** The authority provider identity Pinakes publishes under. */\nexport const CAPABILITY_PROVIDER_IDENTITY = ${str(doc.identity)};\n`,
    tsUnion("CapabilityName", names, "A capability the manifest advertises."),
    tsTuple("CAPABILITY_NAMES", names, "Every advertised capability, in manifest order."),
  ].join("\n");
}

function capabilityManifestPy(doc: CapabilityManifestDoc): string {
  return [
    pyBanner("capability-manifest.json", "The Koine capability-bus manifest Pinakes publishes."),
    ["from typing import Any, Final, Literal", "", "from pinakes_contracts._documents import load_document", ""].join("\n"),
    pyLiteral("CapabilityName", doc.capabilities.map((c) => c.name), "A capability the manifest advertises."),
    `#: The \`\`kcb_version\`\` the manifest declares.\nKCB_VERSION: Final = ${str(doc.kcb_version)}\n`,
    `#: The authority provider identity Pinakes publishes under.\nPROVIDER_IDENTITY: Final = ${str(doc.identity)}\n`,
    pyTuple("CAPABILITY_NAMES", doc.capabilities.map((c) => c.name), "Every advertised capability, in manifest order."),
    registryDocumentPy("capability-manifest.json"),
  ].join("\n");
}

function lexiconMappingTs(doc: LexiconMappingDoc): string {
  const files = doc.files.map((f) => f.file);
  const byKind = (kind: string) => doc.files.filter((f) => f.kind === kind).map((f) => f.file);
  return [
    tsBanner("lexicon-mapping.json", "The lexicon → canonical file vocabulary."),
    `/** The mapping \`version\` these bindings were generated from. */\nexport const LEXICON_MAPPING_VERSION = ${str(doc.version)};\n`,
    tsUnion("LexiconFileName", files, "A mapped `data/source/lexicons/*.tsv` file."),
    tsTuple("LEXICON_FILES", files, "Every mapped lexicon file, in mapping order."),
    tsTuple("LEXICON_NODE_FILES", byKind("node"), "Lexicon files that project canonical nodes."),
    tsTuple("LEXICON_EDGE_FILES", byKind("edge"), "Lexicon files that project canonical edges."),
  ].join("\n");
}

function lexiconMappingPy(doc: LexiconMappingDoc): string {
  const files = doc.files.map((f) => f.file);
  const byKind = (kind: string) => doc.files.filter((f) => f.kind === kind).map((f) => f.file);
  return [
    pyBanner("lexicon-mapping.json", "The lexicon -> canonical mapping: which source TSV becomes which canonical family."),
    ["from typing import Any, Final, Literal", "", "from pinakes_contracts._documents import load_document", ""].join("\n"),
    pyLiteral("LexiconFileName", files, "A mapped ``data/source/lexicons/*.tsv`` file."),
    `#: The mapping \`\`version\`\` these bindings were generated from.\nVERSION: Final = ${str(doc.version)}\n`,
    pyTuple("LEXICON_FILES", files, "Every mapped lexicon file, in mapping order."),
    pyTuple("NODE_FILES", byKind("node"), "Lexicon files that project canonical nodes."),
    pyTuple("EDGE_FILES", byKind("edge"), "Lexicon files that project canonical edges."),
    registryDocumentPy("lexicon-mapping.json"),
  ].join("\n");
}

function predicateMappingTs(doc: PredicateMappingDoc): string {
  const projects = Object.keys(doc.projects);
  return [
    tsBanner(
      "predicate-mapping.json",
      "The vendored koine registry's version + bridged-project vocabulary (the JSON itself is a MIRROR — re-vendor, never hand-edit).",
    ),
    `/** The koine \`registryVersion\` the vendored mirror is at. */\nexport const PREDICATE_REGISTRY_VERSION = ${str(doc.registryVersion)};\n`,
    tsUnion("PredicateMappingProject", projects, "A project the registry bridges."),
    tsTuple("PREDICATE_MAPPING_PROJECTS", projects, "Every bridged project, in registry order."),
  ].join("\n");
}

function predicateMappingPy(doc: PredicateMappingDoc): string {
  const projects = Object.keys(doc.projects);
  return [
    pyBanner(
      "predicate-mapping.json",
      "The vendored koine predicate registry. The JSON is a MIRROR of koine's authoritative copy -- re-vendor it with ``npm run regen:registry-mirror``, never hand-edit.",
    ),
    ["from typing import Any, Final, Literal", "", "from pinakes_contracts._documents import load_document", ""].join("\n"),
    pyLiteral("ProjectName", projects, "A project the registry bridges."),
    `#: The koine \`\`registryVersion\`\` the vendored mirror is at.\nREGISTRY_VERSION: Final = ${str(doc.registryVersion)}\n`,
    pyTuple("PROJECTS", projects, "Every bridged project, in registry order."),
    registryDocumentPy("predicate-mapping.json"),
  ].join("\n");
}

// --- the aggregate entry points ---------------------------------------------

function generatedIndexTs(): string {
  const modules = [
    "canonical-schema",
    "capability-manifest",
    "confidence-rubric",
    "lexicon-mapping",
    "predicate-mapping",
  ];
  return [
    "// @generated by scripts/gen-contract-bindings.ts — DO NOT EDIT.",
    "// The generated TypeScript bindings for the language-neutral contract sources.",
    `// Change a \`contracts/*.json\`, then run \`${REGEN_REMEDY}\`.`,
    "",
    ...modules.map((module) => `export * from "./${module}";`),
    "",
  ].join("\n");
}

function pythonInitPy(): string {
  return [
    '"""Generated Python bindings for the language-neutral `contracts/` sources.',
    "",
    "@generated by scripts/gen-contract-bindings.ts — DO NOT EDIT.",
    `Change a \`contracts/*.json\`, then run \`${REGEN_REMEDY}\`.`,
    '"""',
    "",
    "from __future__ import annotations",
    "",
    "from pinakes_contracts import (",
    "    canonical_schema,",
    "    capability_manifest,",
    "    confidence_rubric,",
    "    lexicon_mapping,",
    "    predicate_mapping,",
    ")",
    "from pinakes_contracts._documents import (",
    "    CONTRACT_DOCUMENTS,",
    "    CONTRACTS_DIR_ENV,",
    "    ContractDocumentError,",
    "    contract_path,",
    "    contracts_dir,",
    "    load_document,",
    ")",
    "",
    "__all__ = [",
    '    "CONTRACTS_DIR_ENV",',
    '    "CONTRACT_DOCUMENTS",',
    '    "ContractDocumentError",',
    '    "canonical_schema",',
    '    "capability_manifest",',
    '    "confidence_rubric",',
    '    "contract_path",',
    '    "contracts_dir",',
    '    "lexicon_mapping",',
    '    "load_document",',
    '    "predicate_mapping",',
    "]",
    "",
  ].join("\n");
}

/** Where the generated TypeScript bindings live, relative to the repo root. */
export const TS_OUT_DIR = "contracts/generated";
/** Where the generated Python bindings live, relative to the repo root. */
export const PY_OUT_DIR = "contracts/python/src/pinakes_contracts";

/**
 * Build every generated binding from the parsed sources — pure, deterministic, and the
 * whole contract of this script. Keys are repo-relative paths; values are file contents.
 */
export function buildBindings(documents: ContractDocuments): Map<string, string> {
  const schema = documents["canonical-schema.json"] as CanonicalSchemaDoc;
  const rubric = documents["confidence-rubric.json"] as ConfidenceRubricDoc;
  const manifest = documents["capability-manifest.json"] as CapabilityManifestDoc;
  const lexicon = documents["lexicon-mapping.json"] as LexiconMappingDoc;
  const predicate = documents["predicate-mapping.json"] as PredicateMappingDoc;

  return new Map<string, string>([
    [`${TS_OUT_DIR}/canonical-schema.ts`, canonicalSchemaTs(schema)],
    [`${TS_OUT_DIR}/capability-manifest.ts`, capabilityManifestTs(manifest)],
    [`${TS_OUT_DIR}/confidence-rubric.ts`, confidenceRubricTs(rubric)],
    [`${TS_OUT_DIR}/lexicon-mapping.ts`, lexiconMappingTs(lexicon)],
    [`${TS_OUT_DIR}/predicate-mapping.ts`, predicateMappingTs(predicate)],
    [`${TS_OUT_DIR}/index.ts`, generatedIndexTs()],
    [`${PY_OUT_DIR}/canonical_schema.py`, canonicalSchemaPy(schema)],
    [`${PY_OUT_DIR}/capability_manifest.py`, capabilityManifestPy(manifest)],
    [`${PY_OUT_DIR}/confidence_rubric.py`, confidenceRubricPy(rubric)],
    [`${PY_OUT_DIR}/lexicon_mapping.py`, lexiconMappingPy(lexicon)],
    [`${PY_OUT_DIR}/predicate_mapping.py`, predicateMappingPy(predicate)],
    [`${PY_OUT_DIR}/__init__.py`, pythonInitPy()],
  ]);
}

/** Read + parse the neutral sources from *dir* (default `contracts/`), failing fast. */
export function readContractDocuments(dir: string = CONTRACTS_DIR): ContractDocuments {
  const entries = CONTRACT_SOURCES.map((name) => {
    const abs = join(dir, name);
    if (!existsSync(abs)) {
      throw new Error(`gen-contract-bindings: contract source not found: ${abs}`);
    }
    return [name, JSON.parse(readFileSync(abs, "utf8")) as unknown] as const;
  });
  return Object.fromEntries(entries) as ContractDocuments;
}

/** The generated files whose committed content differs from a fresh generation. */
export function staleBindings(
  bindings: Map<string, string> = buildBindings(readContractDocuments()),
  root: string = REPO_ROOT,
): string[] {
  const stale: string[] = [];
  for (const [relPath, content] of bindings) {
    const abs = join(root, relPath);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current !== content) stale.push(relPath);
  }
  return stale;
}

/** Write every generated binding, creating directories as needed; returns what changed. */
export function writeBindings(
  bindings: Map<string, string> = buildBindings(readContractDocuments()),
  root: string = REPO_ROOT,
): string[] {
  const changed = staleBindings(bindings, root);
  for (const [relPath, content] of bindings) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return changed;
}

/** CLI: regenerate the bindings and print a summary. */
export function runGen(): void {
  const changed = writeBindings();
  console.log(`gen-contract-bindings: generated from ${CONTRACTS_DIR}`);
  console.log(
    changed.length === 0
      ? "  all bindings already up to date (git status clean)."
      : `  updated:\n${changed.map((p) => `    ${p}`).join("\n")}`,
  );
}

/**
 * Read-only CLI (`--check` / `npm run check:contracts`): report whether any committed
 * binding is stale against `contracts/*.json` WITHOUT writing, returning the exit code.
 */
export function runCheck(): number {
  const stale = staleBindings();
  if (stale.length === 0) {
    console.log("check:contracts: generated bindings are in sync with contracts/*.json.");
    return 0;
  }
  console.error(
    `check:contracts: stale generated binding(s):\n${stale.map((p) => `  ${p}`).join("\n")}\n` +
      `Run \`${REGEN_REMEDY}\` and commit the result. Never hand-edit a generated binding — ` +
      "the neutral `contracts/*.json` is the source of truth for both languages.",
  );
  return 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  try {
    const exitCode = process.argv.includes("--check") ? runCheck() : (runGen(), 0);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
