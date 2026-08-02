"""Generate idempotent ``LOAD CSV`` Cypher to update a live Neo4j graph.

Bulk seeding a *fresh* database is ``neo4j-admin import`` (see
``admin_import.py``); keeping an *existing* graph current — adding new entities,
refreshing properties — is incremental ``LOAD CSV``. This module turns a
canonical TSV dataset (``docs/data-model.md``) into parameterized Cypher that
re-imports node and edge files **idempotently**:

* nodes are ``MERGE``\\ d on ``csid`` (never ``CREATE``\\ d), so re-running the
  same file updates rather than duplicates;
* relationships are merged on ``(:START_ID, :END_ID, :TYPE)`` via
  ``apoc.merge.relationship`` — core Cypher cannot ``MERGE`` a relationship whose
  type is data-driven, so APOC supplies the equivalent merge semantics.

Each statement reads its file through a ``$file`` parameter
(``LOAD CSV WITH HEADERS FROM $file AS row FIELDTERMINATOR '\\t'``) and coerces
every typed property column to ``int``/``float``/``string`` per its header suffix
— ``LOAD CSV`` itself reads every cell as a string, unlike ``neo4j-admin``, so the
coercion (``toInteger`` / ``toFloat``) is generated explicitly. The emitted
script binds ``$file`` to each file's ``file://`` URL in turn (nodes before
edges, so relationships find their endpoints) and is runnable with
``cypher-shell``. No live database is required to generate it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pinakes_engine.neo4j import connect
from pinakes_engine.neo4j.admin_import import (
    AdminImportError,
    discover_dataset,
)

if TYPE_CHECKING:
    from neo4j import Driver
from pinakes_engine.neo4j.constraints import (
    ENTITY_LABEL,
    all_constraint_statements,
    apply_constraints,
)
from pinakes_engine.schema.headers import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
    SchemaError,
    parse_edge_header,
    parse_node_header,
)
from pinakes_engine.schema.tsvio import MULTI_VALUE_KEYS

#: Array-element separator inside multi-value cells (matches the TSV writer).
ARRAY_DELIMITER = ";"

#: Cypher parameter naming the CSV file URL each statement reads.
FILE_PARAM = "file"

#: Field separator passed to ``LOAD CSV`` (the literal escape ``\\t``).
FIELD_TERMINATOR = "\\t"

#: Filename of the emitted Cypher script.
SCRIPT_NAME = "neo4j-load-csv.cypher"


@dataclass(frozen=True)
class CypherStatement:
    """One ``LOAD CSV`` statement plus the file URL it should be run against."""

    kind: str  # "node" or "edge"
    file: Path
    file_url: str
    cypher: str


@dataclass(frozen=True)
class LoadCsvPlan:
    """A resolved set of idempotent ``LOAD CSV`` statements for a dataset."""

    statements: tuple[CypherStatement, ...]
    script_path: Path | None = None

    def render_script(self) -> str:
        """Render the statements as a runnable ``cypher-shell`` script."""
        return render_script(self.statements)


def _property_expr(column: PropertyColumn) -> str:
    """The Cypher expression reading *column* from ``row``, type-coerced.

    ``LOAD CSV`` yields every cell as a string, so typed columns are wrapped in
    ``toInteger`` / ``toFloat`` per the header suffix and multi-value columns
    (``aliases``) are split back into a list on the array delimiter.
    """
    ref = f"row.`{column.header}`"
    if column.name in MULTI_VALUE_KEYS:
        return f"split({ref}, '{ARRAY_DELIMITER}')"
    if column.type is PropertyType.INT:
        return f"toInteger({ref})"
    if column.type is PropertyType.FLOAT:
        return f"toFloat({ref})"
    return ref


def _props_map(columns: tuple[PropertyColumn, ...]) -> str:
    """Render *columns* as a Cypher map literal of coerced property values."""
    if not columns:
        return "{}"
    items = ",\n  ".join(f"`{c.name}`: {_property_expr(c)}" for c in columns)
    return "{\n  " + items + "\n}"


def _load_csv_prelude() -> str:
    """The shared ``LOAD CSV`` opening line every statement starts with."""
    return (
        f"LOAD CSV WITH HEADERS FROM ${FILE_PARAM} AS row "
        f"FIELDTERMINATOR '{FIELD_TERMINATOR}'"
    )


def node_cypher(schema: NodeSchema) -> str:
    """Build idempotent ``MERGE``-on-``csid`` Cypher for a node *schema*.

    The node is keyed on its ``:ID`` column under the shared
    :data:`~pinakes_engine.neo4j.constraints.ENTITY_LABEL` label, so the
    ``csid`` uniqueness constraint backs the ``MERGE`` as an index lookup and
    re-importing the same row updates it in place. Properties are coerced and
    applied with ``SET n +=``, and the ``;``-separated ``:LABEL`` cell is
    reattached with ``apoc.create.addLabels``.
    """
    id_col = next(c for c in schema.columns if isinstance(c, IdColumn))
    props = tuple(c for c in schema.columns if isinstance(c, PropertyColumn))
    return (
        f"{_load_csv_prelude()}\n"
        f"MERGE (n:{ENTITY_LABEL} {{`{id_col.name}`: row.`{id_col.header}`}})\n"
        f"SET n += {_props_map(props)}\n"
        f"WITH n, row\n"
        f"CALL apoc.create.addLabels(n, split(row.`:LABEL`, '{ARRAY_DELIMITER}')) "
        f"YIELD node\n"
        f"RETURN count(node);"
    )


def edge_cypher(schema: EdgeSchema) -> str:
    """Build idempotent merge Cypher for an edge *schema*.

    Endpoints are matched by ``csid`` and the relationship is merged on
    ``(:START_ID, :END_ID, :TYPE)`` via ``apoc.merge.relationship`` — the
    data-driven ``:TYPE`` rules out a core-Cypher ``MERGE`` — with coerced
    properties applied on both create and match so a re-run refreshes them.
    """
    props = _props_map(
        tuple(c for c in schema.columns if isinstance(c, PropertyColumn))
    )
    return (
        f"{_load_csv_prelude()}\n"
        f"MATCH (start {{csid: row.`:START_ID`}})\n"
        f"MATCH (end {{csid: row.`:END_ID`}})\n"
        f"CALL apoc.merge.relationship(\n"
        f"  start, row.`:TYPE`, {{}}, {props}, end, {props}\n"
        f") YIELD rel\n"
        f"RETURN count(rel);"
    )


def _read_header(path: Path) -> str:
    """Return the first physical line of *path* (its header row)."""
    with path.open("r", encoding="utf-8") as handle:
        return handle.readline().rstrip("\n")


def _statement(path: Path, kind: str) -> CypherStatement:
    """Build the :class:`CypherStatement` for the file at *path*.

    Raises:
        AdminImportError: If *path*'s header is not a valid node/edge header.
    """
    header = _read_header(path)
    try:
        if kind == "node":
            cypher = node_cypher(parse_node_header(header))
        else:
            cypher = edge_cypher(parse_edge_header(header))
    except SchemaError as exc:
        raise AdminImportError(
            f"{path} is not a valid neo4j-admin {kind} header: {exc}"
        ) from exc
    resolved = path.resolve()
    return CypherStatement(
        kind=kind, file=resolved, file_url=resolved.as_uri(), cypher=cypher
    )


def build_statements(directory: str | Path) -> tuple[CypherStatement, ...]:
    """Build a ``LOAD CSV`` statement for every node and edge file under *directory*.

    Node statements come first so that, when run in order, relationship
    statements find their endpoints already present.
    """
    node_files, edge_files = discover_dataset(directory)
    statements = [_statement(path, "node") for path in node_files]
    statements += [_statement(path, "edge") for path in edge_files]
    return tuple(statements)


def render_script(statements: tuple[CypherStatement, ...]) -> str:
    """Render *statements* as a runnable ``cypher-shell`` script.

    Each statement is preceded by a ``:param`` line binding ``$file`` to its
    file's URL, so the whole script can be piped to ``cypher-shell -f``.
    """
    blocks: list[str] = []
    for stmt in statements:
        url = stmt.file_url.replace("'", "\\'")
        blocks.append(
            f"// {stmt.kind}: {stmt.file.name}\n"
            f":param {FILE_PARAM} => '{url}';\n"
            f"{stmt.cypher}"
        )
    return (
        "// Generated by pinakes_engine: incrementally MERGE canonical TSV into "
        "Neo4j.\n"
        "// Idempotent — re-running does not duplicate nodes or relationships.\n"
        "// Requires the APOC plugin. Run with: cypher-shell -f "
        f"{SCRIPT_NAME}\n\n" + "\n\n".join(blocks) + "\n"
    )


def generate_load_script(
    directory: str | Path,
    *,
    out_dir: str | Path | None = None,
    script_path: str | Path | None = None,
) -> LoadCsvPlan:
    """Generate idempotent ``LOAD CSV`` Cypher for *directory* and emit a script.

    Discovers ``nodes/*.tsv`` and ``edges/*.tsv``, verifies every header is a
    valid node/edge header, builds one ``MERGE``-based statement per file, and
    writes them to a runnable ``cypher-shell`` script. No live database is
    touched.

    Args:
        directory: Dataset root holding ``nodes/`` and ``edges/`` subdirectories.
        out_dir: Where the script is written (default: *directory*).
        script_path: Explicit script path (default: ``<out_dir>/<SCRIPT_NAME>``).

    Returns:
        The :class:`LoadCsvPlan`, with ``script_path`` set to the emitted file.
    """
    directory = Path(directory)
    out_path = Path(out_dir) if out_dir is not None else directory

    statements = build_statements(directory)

    script = Path(script_path) if script_path is not None else out_path / SCRIPT_NAME
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(render_script(statements), encoding="utf-8")

    return LoadCsvPlan(statements=statements, script_path=script)


def apply_load_csv(
    directory: str | Path,
    *,
    config: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
) -> tuple[CypherStatement, ...]:
    """Run *directory*'s idempotent ``LOAD CSV`` statements against a live DB.

    Builds the same statements as :func:`generate_load_script` and executes each
    in turn (nodes before edges), binding ``$file`` to the file's URL, so a live
    graph is updated in place. ``MERGE`` semantics make re-running safe. When
    *driver* is given it is used as-is (and left open for the caller); otherwise
    a driver is opened from *config*/*env* via
    :func:`pinakes_engine.neo4j.connect` and closed before returning.

    Returns:
        The statements that were executed, in order.
    """
    statements = build_statements(directory)
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        with handle.session() as session:
            for stmt in statements:
                params: dict[str, Any] = {FILE_PARAM: stmt.file_url}
                session.run(stmt.cypher, **params)
    finally:
        if owned:
            handle.close()
    return statements


@dataclass(frozen=True)
class LoadReport:
    """What a :func:`load_corpus` run applied against the live database."""

    constraints: tuple[str, ...]
    statements: tuple[CypherStatement, ...]


def load_corpus(
    directory: str | Path,
    *,
    config: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
    constraints: bool = True,
) -> LoadReport:
    """Load *directory* into Neo4j, optionally applying constraints/indexes first.

    Opens a single driver (or reuses the caller's), applies the global **and**
    per-label ``csid`` constraints + lookup indexes
    (:func:`~pinakes_engine.neo4j.constraints.all_constraint_statements`) when
    *constraints* is true so the ``MERGE``-based load lands as index lookups, then
    runs the idempotent ``LOAD CSV`` statements (:func:`apply_load_csv`). The
    constraint statements and the load are ``IF NOT EXISTS`` / ``MERGE`` so the
    whole flow is safe to re-run without duplicating nodes. When *driver* is given
    it is used as-is (left open for the caller); otherwise a driver is opened from
    *config*/*env* and closed before returning.

    Returns:
        A :class:`LoadReport` of the constraint statements and the load
        statements that were executed.
    """
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        applied: tuple[str, ...] = ()
        if constraints:
            applied = apply_constraints(
                driver=handle, statements=all_constraint_statements(directory)
            )
        statements = apply_load_csv(directory, driver=handle)
    finally:
        if owned:
            handle.close()
    return LoadReport(constraints=applied, statements=statements)


__all__ = [
    "ARRAY_DELIMITER",
    "FIELD_TERMINATOR",
    "FILE_PARAM",
    "SCRIPT_NAME",
    "CypherStatement",
    "LoadCsvPlan",
    "LoadReport",
    "apply_load_csv",
    "load_corpus",
    "build_statements",
    "edge_cypher",
    "generate_load_script",
    "node_cypher",
    "render_script",
]
