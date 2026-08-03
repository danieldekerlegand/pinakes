"""pinakes canonical nodes/edges export adapter.

`pinakes <../../../../docs/engine-integration.md>`_ exports its
lexicons in the shared canonical shape (``docs/data-model.md``): a directory of
typed, Neo4j-import-compatible TSVs, one file per node type under ``nodes/`` and
one per edge type under ``edges/``. This adapter reads such an export *from local
disk* and emits one :class:`~pinakes_engine.acquire.records.RawRecord` per row so
pinakes becomes a first-class acquisition source alongside Wikidata, Getty,
and PetScan — no bespoke transform, just the canonical export the two projects
already agree on.

The export path comes from ``source.query`` (falling back to
``source.params['path']``) and names the export *root*; the adapter walks its
``nodes/*.tsv`` and ``edges/*.tsv`` in a deterministic (sorted) order. Each file's
header is parsed with :mod:`pinakes_engine.schema.headers`, so a file that is not
a canonical node/edge export is rejected loudly rather than mis-ingested. Node
rows carry their ``csid`` / ``:LABEL`` and the ``pinakes_id`` round-trip
alias; edge rows carry ``:START_ID`` / ``:END_ID`` / ``:TYPE`` — the structural
columns downstream uses to tell the two apart.

Every row's provenance columns (``source``, ``source_url``, ``source_query``,
``retrieved_at``, ``confidence``, and — canonical schema v1.1 / US-003 — the
per-record SPDX ``license``) are lifted out of the field map into the record's
:class:`~pinakes_engine.acquire.records.Provenance` (that is where
:func:`pinakes_engine.schema.mapper.map_record` reads them). The ``source`` is
stamped :data:`PINAKES_SOURCE` — the acquisition-source id the reconciler
keys on — regardless of what the file carries, and ``retrieved_at`` is stamped
with the ingestion clock when the export leaves it blank (pinakes records no
retrieval timestamp). A row-level ``license`` cell takes precedence over the
export-level ``license`` param.

Configuration (all under ``source.params`` unless noted):

* ``adapter`` — ``pinakes-export`` (disambiguates the shared ``dump`` type);
* ``path`` — the export root, when not given as ``source.query``;
* ``source`` — the provenance source name (default :data:`PINAKES_SOURCE`);
* ``license`` — a distribution licence stamped on every record (default none).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.confidence import confidence_for
from pinakes_engine.schema.headers import (
    DELIMITER,
    Column,
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    SchemaError,
    StructuralColumn,
    parse_edge_header,
    parse_node_header,
)

#: Provenance ``source`` id stamped on every pinakes-origin row. This is the
#: acquisition-source id reconciliation keys on, not a bibliographic citation.
PINAKES_SOURCE = "pinakes"

#: Confidence stamped when a row carries no (or a non-numeric) ``confidence`` cell.
#: A pinakes lexicon row is QID-anchored identity, so a silent cell inherits
#: the ``qid-anchored`` rubric prior (1.0), grandfathered pre-rubric (US-001).
DEFAULT_CONFIDENCE = confidence_for("qid-anchored")

#: The provenance columns lifted out of ``fields`` into :class:`Provenance` —
#: :func:`pinakes_engine.schema.mapper.map_record` reads provenance from there, so
#: leaving these in ``fields`` would duplicate them into the overflow column.
_PROVENANCE_COLUMNS = frozenset(
    {
        "source",
        "source_url",
        "source_query",
        "retrieved_at",
        "confidence",
        "license",
    }
)


class PinakesExportError(RuntimeError):
    """Raised when a pinakes export is missing, malformed, or misconfigured."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PinakesExportAdapter(SourceAdapter):
    """Read a local pinakes canonical export and yield one record per row.

    Args:
        now: Clock returning a UTC timestamp for a row's ``retrieved_at`` when the
            export leaves it blank (injectable for deterministic tests).
    """

    name = "pinakes-export"
    source_type = "dump"

    def __init__(self, *, now: Callable[[], datetime] = _utc_now) -> None:
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per row of the configured export."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise PinakesExportError(
                f"category {category_spec.id!r} has no export path "
                "(source.query or source.params.path) to read"
            )
        root = Path(raw_path)
        if not root.is_dir():
            raise PinakesExportError(
                f"pinakes export root {root} is not a directory"
            )
        nodes_dir = root / "nodes"
        edges_dir = root / "edges"
        if not nodes_dir.is_dir() and not edges_dir.is_dir():
            raise PinakesExportError(
                f"{root} is not a pinakes export: it has no nodes/ or edges/"
            )

        source_name = params.get("source") or PINAKES_SOURCE
        license_ = params.get("license")
        retrieved_at = self._now().isoformat()
        return self._iter_records(
            nodes_dir, edges_dir, source_name, license_, retrieved_at
        )

    def _iter_records(
        self,
        nodes_dir: Path,
        edges_dir: Path,
        source_name: str,
        license_: str | None,
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        for path in _sorted_tsv(nodes_dir):
            yield from self._read_file(
                path, parse_node_header, source_name, license_, retrieved_at
            )
        for path in _sorted_tsv(edges_dir):
            yield from self._read_file(
                path, parse_edge_header, source_name, license_, retrieved_at
            )

    def _read_file(
        self,
        path: Path,
        parse_header: Callable[[str], NodeSchema | EdgeSchema],
        source_name: str,
        license_: str | None,
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:  # pragma: no cover - glob already found the file
            raise PinakesExportError(f"cannot read {path}: {exc}") from exc
        if not lines:
            return
        try:
            schema = parse_header(lines[0])
        except SchemaError as exc:
            raise PinakesExportError(
                f"{path} has an invalid canonical header: {exc}"
            ) from exc
        names = [_column_field(column) for column in schema.columns]

        for number, line in enumerate(lines[1:], start=2):
            if not line:
                continue
            cells = line.split(DELIMITER)
            if len(cells) != len(names):
                raise PinakesExportError(
                    f"{path}:{number} has {len(cells)} columns, "
                    f"header has {len(names)}"
                )
            yield self._record(
                dict(zip(names, cells, strict=True)),
                source_name,
                license_,
                retrieved_at,
            )

    def _record(
        self,
        row: Mapping[str, str],
        source_name: str,
        license_: str | None,
        retrieved_at: str,
    ) -> RawRecord:
        fields = {
            key: value
            for key, value in row.items()
            if value != "" and key not in _PROVENANCE_COLUMNS
        }
        provenance = Provenance(
            source=source_name,
            source_url=row.get("source_url", ""),
            source_query=row.get("source_query", ""),
            retrieved_at=row.get("retrieved_at") or retrieved_at,
            confidence=_confidence(row.get("confidence")),
            # Canonical schema v1.1 (US-003) carries a per-record SPDX license; a
            # row-level `license` cell wins, else the export-level default (params).
            license=(row.get("license") or "").strip() or license_,
        )
        return RawRecord(fields=fields, provenance=provenance)


def _column_field(column: Column) -> str:
    """Return the field name a header *column* stores its cell under.

    Typed and ``:ID`` suffixes are dropped (``confidence:float`` → ``confidence``,
    ``csid:ID`` → ``csid``); the nameless structural columns keep their canonical
    ``:LABEL`` / ``:START_ID`` / ``:END_ID`` / ``:TYPE`` key.
    """
    if isinstance(column, IdColumn):
        return column.name
    if isinstance(column, StructuralColumn):
        return column.field
    if isinstance(column, PropertyColumn):
        return column.name
    raise PinakesExportError(  # pragma: no cover - Column is a closed union
        f"unexpected header column {column!r}"
    )


def _sorted_tsv(directory: Path) -> Sequence[Path]:
    """Every ``*.tsv`` under *directory* in sorted order (empty if it is absent)."""
    if not directory.is_dir():
        return ()
    return sorted(directory.glob("*.tsv"))


def _confidence(raw: str | None) -> float:
    """Parse a ``confidence`` cell to a float, defaulting when blank/non-numeric."""
    if not raw:
        return DEFAULT_CONFIDENCE
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_CONFIDENCE
