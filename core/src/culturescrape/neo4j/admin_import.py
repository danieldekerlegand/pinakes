"""Derive a ``neo4j-admin database import`` command from a canonical TSV dataset.

Bulk-seeding a fresh Neo4j database is one ``neo4j-admin database import full``
invocation that consumes our node/edge TSV files directly — the data model
adopts Neo4j's CSV header conventions (``docs/data-model.md``) precisely so this
is near-free. This module discovers the ``nodes/*.tsv`` and ``edges/*.tsv`` of a
dataset, *verifies* every header is already a valid ``neo4j-admin`` header, and
emits the import command to a runnable script — without ever touching a live DB.

Two delimiters are pinned to match our TSV escape (``schema/tsvio.py``):
``--delimiter='\\t'`` (tab between fields) and ``--array-delimiter=';'`` (the
multi-value separator). The only header adjustment needed for a *faithful*
import is typing multi-value string properties (``aliases``) as arrays so
``neo4j-admin`` splits them on the array delimiter rather than importing one
joined string; ``:LABEL`` is split natively and needs no change. Such
adjustments are written to *transformed copies* under ``<out>/neo4j-import/``;
the originals are never mutated.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path

from culturescrape.schema.headers import (
    DELIMITER,
    EdgeSchema,
    NodeSchema,
    PropertyColumn,
    PropertyType,
    SchemaError,
    parse_edge_header,
    parse_node_header,
)
from culturescrape.schema.tsvio import MULTI_VALUE_KEYS

#: Array-element separator, matching ``schema/tsvio.MULTI_DELIMITER``.
ARRAY_DELIMITER = ";"

#: ``--delimiter`` value naming the tab field separator (``neo4j-admin`` reads
#: the literal escape ``\\t``).
TAB_DELIMITER_ARG = "\\t"

#: Default target database for a fresh seed.
DEFAULT_DATABASE = "neo4j"

#: Filename of the emitted import script.
SCRIPT_NAME = "neo4j-admin-import.sh"

#: Subdirectory (under the output dir) holding transformed header copies.
TRANSFORMED_DIRNAME = "neo4j-import"


class AdminImportError(ValueError):
    """Raised when a dataset cannot yield a valid ``neo4j-admin`` command."""


@dataclass(frozen=True)
class ImportPlan:
    """A resolved ``neo4j-admin`` bulk-import command and what it references."""

    database: str
    command: tuple[str, ...]
    node_files: tuple[Path, ...]
    edge_files: tuple[Path, ...]
    transformed: tuple[Path, ...]
    script_path: Path | None = None

    def render_script(self) -> str:
        """Render the command as a self-contained, runnable bash script."""
        return render_script(self.command, self.database)


def discover_dataset(directory: str | Path) -> tuple[list[Path], list[Path]]:
    """Return the sorted ``nodes/*.tsv`` and ``edges/*.tsv`` under *directory*.

    Raises:
        AdminImportError: If *directory* is not a directory or holds no node
            files (``neo4j-admin import`` requires at least one node source).
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise AdminImportError(f"{directory} is not a directory")
    node_files = sorted((directory / "nodes").glob("*.tsv"))
    edge_files = sorted((directory / "edges").glob("*.tsv"))
    if not node_files:
        raise AdminImportError(f"{directory} holds no nodes/*.tsv to import")
    return node_files, edge_files


def _read_header(path: Path) -> str:
    """Return the first physical line of *path* (its header row)."""
    with path.open("r", encoding="utf-8") as handle:
        header = handle.readline()
    return header.rstrip("\n")


def _verified_schema(path: Path, header: str, kind: str) -> NodeSchema | EdgeSchema:
    """Parse and validate *header* as a ``neo4j-admin`` node/edge header.

    Raises:
        AdminImportError: If the header is not a valid header for *kind*.
    """
    try:
        if kind == "node":
            return parse_node_header(header)
        return parse_edge_header(header)
    except SchemaError as exc:
        raise AdminImportError(
            f"{path} is not a valid neo4j-admin {kind} header: {exc}"
        ) from exc


def _transformed_header(
    schema: NodeSchema | EdgeSchema, header: str
) -> str | None:
    """Return a transformed *header* if a faithful import needs one, else ``None``.

    The sole transformation is typing a multi-value string property (e.g.
    ``aliases``) as a ``:string[]`` array so ``neo4j-admin`` splits it on the
    array delimiter. ``:LABEL`` is multi-value too but is split natively.
    """
    cells = header.split(DELIMITER)
    out: list[str] = []
    changed = False
    for column, cell in zip(schema.columns, cells, strict=True):
        if (
            isinstance(column, PropertyColumn)
            and column.name in MULTI_VALUE_KEYS
            and column.type is PropertyType.STRING
        ):
            out.append(f"{column.name}:string[]")
            changed = True
        else:
            out.append(cell)
    return DELIMITER.join(out) if changed else None


def _emit_transformed_copy(src: Path, dest: Path, new_header: str) -> None:
    """Write *src* to *dest* with its header replaced by *new_header*.

    Only the header line changes; data rows are copied verbatim, so the original
    file is never mutated.
    """
    text = src.read_text(encoding="utf-8")
    newline = text.find("\n")
    body = text[newline:] if newline != -1 else "\n"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(new_header + body, encoding="utf-8")


def _resolve_reference(
    path: Path, kind: str, transform_dir: Path
) -> tuple[Path, Path | None]:
    """Verify *path*'s header and return the file to reference plus any copy.

    When a transformation is needed, a copy is written under *transform_dir* and
    returned as the second element; otherwise the original is referenced and the
    second element is ``None``.
    """
    header = _read_header(path)
    schema = _verified_schema(path, header, kind)
    transformed = _transformed_header(schema, header)
    if transformed is None:
        return path.resolve(), None
    dest = (transform_dir / f"{kind}s" / path.name).resolve()
    _emit_transformed_copy(path, dest, transformed)
    return dest, dest


def build_command(
    database: str, node_files: tuple[Path, ...], edge_files: tuple[Path, ...]
) -> tuple[str, ...]:
    """Build the ``neo4j-admin database import full`` argv for the given files."""
    argv = [
        "neo4j-admin",
        "database",
        "import",
        "full",
        database,
        f"--delimiter={TAB_DELIMITER_ARG}",
        f"--array-delimiter={ARRAY_DELIMITER}",
        "--overwrite-destination",
    ]
    argv += [f"--nodes={path}" for path in node_files]
    argv += [f"--relationships={path}" for path in edge_files]
    return tuple(argv)


def render_script(command: tuple[str, ...], database: str) -> str:
    """Render *command* as a runnable bash script.

    The ``neo4j-admin database import full <db>`` base stays on the first line;
    each flag follows on its own continued line for readability.
    """
    base = " ".join(shlex.quote(arg) for arg in command[:5])
    flags = "".join(f" \\\n  {shlex.quote(arg)}" for arg in command[5:])
    return (
        "#!/usr/bin/env bash\n"
        f"# Generated by culturescrape: bulk-seed Neo4j database {database!r}\n"
        "# from canonical TSV. No live database is required to generate this.\n"
        "set -euo pipefail\n\n"
        f"{base}{flags}\n"
    )


def generate_import_script(
    directory: str | Path,
    *,
    out_dir: str | Path | None = None,
    database: str = DEFAULT_DATABASE,
    script_path: str | Path | None = None,
) -> ImportPlan:
    """Generate the bulk-import command for *directory* and emit it to a script.

    Discovers ``nodes/*.tsv`` and ``edges/*.tsv``, verifies every header is a
    valid ``neo4j-admin`` header (writing transformed copies under
    ``<out_dir>/neo4j-import/`` where a faithful import needs them, never
    mutating originals), builds the command, and writes it to a runnable script.

    Args:
        directory: Dataset root holding ``nodes/`` and ``edges/`` subdirectories.
        out_dir: Where transformed copies and the script are written
            (default: *directory*).
        database: Target database name (default: ``neo4j``).
        script_path: Explicit script path (default: ``<out_dir>/<SCRIPT_NAME>``).

    Returns:
        The :class:`ImportPlan`, with ``script_path`` set to the emitted file.
    """
    directory = Path(directory)
    out_path = Path(out_dir) if out_dir is not None else directory
    transform_dir = out_path / TRANSFORMED_DIRNAME

    raw_nodes, raw_edges = discover_dataset(directory)
    transformed: list[Path] = []
    node_refs: list[Path] = []
    for path in raw_nodes:
        ref, copy = _resolve_reference(path, "node", transform_dir)
        node_refs.append(ref)
        if copy is not None:
            transformed.append(copy)
    edge_refs: list[Path] = []
    for path in raw_edges:
        ref, copy = _resolve_reference(path, "edge", transform_dir)
        edge_refs.append(ref)
        if copy is not None:
            transformed.append(copy)

    command = build_command(database, tuple(node_refs), tuple(edge_refs))

    script = Path(script_path) if script_path is not None else out_path / SCRIPT_NAME
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(render_script(command, database), encoding="utf-8")
    script.chmod(0o755)

    return ImportPlan(
        database=database,
        command=command,
        node_files=tuple(node_refs),
        edge_files=tuple(edge_refs),
        transformed=tuple(transformed),
        script_path=script,
    )


__all__ = [
    "ARRAY_DELIMITER",
    "DEFAULT_DATABASE",
    "SCRIPT_NAME",
    "TAB_DELIMITER_ARG",
    "TRANSFORMED_DIRNAME",
    "AdminImportError",
    "ImportPlan",
    "build_command",
    "discover_dataset",
    "generate_import_script",
    "render_script",
]
