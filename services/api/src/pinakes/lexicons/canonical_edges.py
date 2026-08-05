"""Canonical edge extraction — the port of `server/services/canonical-edges.ts`.

Pinakes stores relationships two ways: as dedicated *edge tables*
(`cultural-lineages.tsv`, `etymology-relations.tsv`, …) and as *embedded
foreign-key columns* on node tables (`languages.family_id`, …). This module
reads both and emits first-class :class:`CanonicalEdge` records, so a caller
gets real relationships instead of dangling id strings.

Which columns carry edges is **not** hard-coded: it is driven by
``pinakes_contracts.lexicon_mapping`` — edge tables declare their structural
columns via `target` dispositions (`:START_ID`/`:END_ID`/`:TYPE`/…), node tables
declare embedded relationships via `edge` dispositions. The only per-file
knowledge kept locally is :data:`EDGE_TYPE_VALUE_MAPS`, the free-text →
canonical vocabulary alignment the declarative mapping cannot express.

**One caller, one use.** `/api/relationships/{edge,suggestions}` reads this for
*dedup*: the existing `(source, target, type)` triples an authored edge must not
collide with. The canonical **export** — `scripts/export-for-engine.ts`, which
consumes the same dispositions to write `build/corpus/` — is still a TypeScript
job and still owns `server/services/canonical-edges.ts`; the two are pinned to
each other by :mod:`tests.test_canonical_edges`, not merged.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from pinakes_contracts.canonical_schema import CanonicalEdgeType, edge_type_by_name
from pinakes_contracts.confidence_rubric import confidence_for
from pinakes_contracts.lexicon_mapping import document as lexicon_mapping_document

from pinakes.analytics import tsv

#: Confidence an edge gets when its source row carries none — the
#: `legacy-curated` rubric prior ("unknown, neither trusted nor distrusted").
DEFAULT_EDGE_CONFIDENCE: Final[float] = confidence_for("legacy-curated")

#: Provenance fields the lexicons do not carry per row. They are required on the
#: canonical edge family, so they are emitted blank.
UNKNOWN_SOURCE_URL: Final = ""
UNKNOWN_RETRIEVED_AT: Final = ""

#: Per-edge-table translation from the file's free-text relationship vocabulary
#: to a canonical edge-type *name*. ``None`` means "recognised but has no
#: canonical home" (skipped on purpose); a token absent from the map is unknown
#: (also skipped, reported as ``unmapped-type``).
EDGE_TYPE_VALUE_MAPS: Final[dict[str, dict[str, str | None]]] = {
    "cultural-lineages.tsv": {
        "split-from": "split-from",
        "evolved-into": "descended-from",
        "gave-rise-to": "descended-from",
        "influenced": "influenced-by",
        # Temporal precedence / vague association have no canonical edge type.
        "preceded-by": None,
        "associated-with": None,
        "possibly-associated": None,
    },
    "etymology-relations.tsv": {
        "borrowed_from": "borrowed-from",
        "calque": "borrowed-from",  # a loan translation — a form of borrowing
        "cognate": "cognate-with",
        "derived_from": "derived-from",
        "etymology": None,  # generic marker, no specific relation
    },
    "language-contacts.tsv": {
        # All contact strata are directional influence between the languages.
        "substrate": "influenced-by",
        "superstrate": "influenced-by",
        "adstrate": "influenced-by",
    },
    "art-style-evolutions.tsv": {
        "direct_evolution": "derived-from",
        "influence": "influenced-by",
        "revival": "derived-from",
    },
}

#: Placeholder tokens some lexicons write to mean "no id" — `writing-systems.tsv`
#: stores a literal ``"null"`` in `parent_system_id` for a root script. Treated
#: as a blank endpoint, never a real node id.
BLANK_ID_SENTINELS: Final[frozenset[str]] = frozenset(
    {"null", "none", "n/a", "undefined"}
)


@dataclass(frozen=True, slots=True)
class EdgeProvenance:
    """Provenance attached to every emitted edge."""

    source: str
    source_url: str
    retrieved_at: str
    confidence: float


@dataclass(frozen=True, slots=True)
class CanonicalEdge:
    """A single canonical relationship extracted from a lexicon."""

    start_id: str
    end_id: str
    type: str
    edge_name: str
    time_start: int | None
    time_end: int | None
    provenance: EdgeProvenance
    pinakes_id: str | None
    source_file: str


@dataclass(frozen=True, slots=True)
class SkippedEdge:
    """A source row that produced no edge, with a machine-readable reason."""

    source_file: str
    reason: str
    value: str | None = None


@dataclass(frozen=True, slots=True)
class FileExtraction:
    """Result of extracting one file (or the whole corpus)."""

    edges: list[CanonicalEdge]
    skipped: list[SkippedEdge]


def _cell(row: list[str], index: int) -> str:
    """Read a cell, trimming whitespace; out-of-range indices yield ``""``."""
    if index < 0 or index >= len(row):
        return ""
    return row[index].strip()


def is_blank_id(value: str) -> bool:
    """True when an id cell is empty or a placeholder standing in for "no value"."""
    return value == "" or value.lower() in BLANK_ID_SENTINELS


def _index_for_target(mapping: dict[str, Any], header: list[str], target: str) -> int:
    """Column index of the file's single column carrying a given canonical target."""
    for column in mapping.get("columns", []):
        if column.get("target") == target:
            return tsv.index_of(header, str(column.get("column", "")))
    return -1


def _parse_year(value: str) -> int | None:
    """``parseInt(value, 10)``; ``None`` for empty / non-numeric cells."""
    if value == "":
        return None
    parsed = tsv.js_parse_int(value)
    return None if math.isnan(parsed) else int(parsed)


def _normalise_confidence(value: str) -> float:
    """Normalise a raw confidence cell to ``[0, 1]``.

    The corpus mixes 0–100 (`cultural-lineages`, `archaeological-cultures`) and
    0–1 scales, so a value above 1 is read as a percentage.
    """
    if value == "":
        return DEFAULT_EDGE_CONFIDENCE
    parsed = tsv.js_parse_float(value)
    if math.isnan(parsed):
        return DEFAULT_EDGE_CONFIDENCE
    scaled = parsed / 100 if parsed > 1 else parsed
    return min(1.0, max(0.0, scaled))


def _parse_source_cell(value: str, fallback: str) -> str:
    """A source cell as one citation string.

    Many lexicons store `sources` as a JSON array; those are joined with
    ``"; "``. A plain string comes back as-is.
    """
    if value == "":
        return fallback
    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except ValueError:
            return value
        if isinstance(parsed, list):
            joined = "; ".join(
                item for item in parsed if isinstance(item, str) and item.strip() != ""
            )
            return fallback if joined == "" else joined
    return value


def _split_id_list(value: str) -> list[str]:
    """Split an id-list cell: a JSON array, else `[,;]`-separated scalars."""
    if value == "":
        return []
    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except ValueError:
            parsed = None
        if isinstance(parsed, list):
            return [
                item.strip()
                for item in parsed
                if isinstance(item, str) and not is_blank_id(item.strip())
            ]
    return [
        part.strip()
        for part in value.replace(";", ",").split(",")
        if not is_blank_id(part.strip())
    ]


def _build_edge(
    *,
    file: str,
    start_id: str,
    end_id: str,
    edge_type: CanonicalEdgeType,
    time_start: int | None,
    time_end: int | None,
    provenance: EdgeProvenance,
    pinakes_id: str | None,
) -> CanonicalEdge:
    return CanonicalEdge(
        start_id=start_id,
        end_id=end_id,
        type=edge_type.type,
        edge_name=edge_type.name,
        time_start=time_start,
        time_end=time_end,
        provenance=provenance,
        pinakes_id=pinakes_id,
        source_file=file,
    )


def _extract_edge_table(
    file: str, mapping: dict[str, Any], header: list[str], rows: list[list[str]]
) -> FileExtraction:
    """Extract edges from a dedicated edge table (``kind == "edge"``)."""
    edges: list[CanonicalEdge] = []
    skipped: list[SkippedEdge] = []

    start_index = _index_for_target(mapping, header, ":START_ID")
    end_index = _index_for_target(mapping, header, ":END_ID")
    type_index = _index_for_target(mapping, header, ":TYPE")
    time_start_index = _index_for_target(mapping, header, "time_start")
    time_end_index = _index_for_target(mapping, header, "time_end")
    confidence_index = _index_for_target(mapping, header, "confidence")
    source_index = _index_for_target(mapping, header, "source")
    alias_index = _index_for_target(mapping, header, "pinakes_id")
    value_map = EDGE_TYPE_VALUE_MAPS.get(file, {})

    for row in rows:
        start_id = _cell(row, start_index)
        end_id = _cell(row, end_index)
        if is_blank_id(start_id) or is_blank_id(end_id):
            skipped.append(SkippedEdge(source_file=file, reason="missing-endpoint"))
            continue
        if start_id == end_id:
            skipped.append(
                SkippedEdge(source_file=file, reason="self-reference", value=start_id)
            )
            continue

        raw_type = _cell(row, type_index)
        if raw_type not in value_map:
            skipped.append(
                SkippedEdge(source_file=file, reason="unmapped-type", value=raw_type)
            )
            continue
        edge_name = value_map[raw_type]
        if edge_name is None:
            skipped.append(
                SkippedEdge(source_file=file, reason="skipped-type", value=raw_type)
            )
            continue
        edge_type = edge_type_by_name(edge_name)
        if edge_type is None:
            skipped.append(
                SkippedEdge(
                    source_file=file, reason="unknown-edge-type", value=edge_name
                )
            )
            continue

        edges.append(
            _build_edge(
                file=file,
                start_id=start_id,
                end_id=end_id,
                edge_type=edge_type,
                time_start=_parse_year(_cell(row, time_start_index)),
                time_end=_parse_year(_cell(row, time_end_index)),
                provenance=EdgeProvenance(
                    source=_parse_source_cell(_cell(row, source_index), file),
                    source_url=UNKNOWN_SOURCE_URL,
                    retrieved_at=UNKNOWN_RETRIEVED_AT,
                    confidence=_normalise_confidence(_cell(row, confidence_index)),
                ),
                pinakes_id=(
                    (_cell(row, alias_index) or None) if alias_index >= 0 else None
                ),
            )
        )

    return FileExtraction(edges=edges, skipped=skipped)


def _extract_embedded_edges(
    file: str, mapping: dict[str, Any], header: list[str], rows: list[list[str]]
) -> FileExtraction:
    """Extract edges from a node table's embedded FK columns (`edge` dispositions)."""
    edges: list[CanonicalEdge] = []
    skipped: list[SkippedEdge] = []

    id_index = _index_for_target(mapping, header, "pinakes_id")
    source_index = _index_for_target(mapping, header, "source")
    confidence_index = _index_for_target(mapping, header, "confidence")

    edge_columns = [
        (
            tsv.index_of(header, str(column.get("column", ""))),
            edge_type_by_name(str(column["edge"])),
            str(column["edge"]),
        )
        for column in mapping.get("columns", [])
        if column.get("edge") is not None
    ]
    if not edge_columns:
        return FileExtraction(edges=edges, skipped=skipped)

    for row in rows:
        start_id = _cell(row, id_index)
        if start_id == "":
            continue
        provenance = EdgeProvenance(
            source=_parse_source_cell(_cell(row, source_index), file),
            source_url=UNKNOWN_SOURCE_URL,
            retrieved_at=UNKNOWN_RETRIEVED_AT,
            confidence=_normalise_confidence(_cell(row, confidence_index)),
        )

        for column_index, edge_type, edge_name in edge_columns:
            if edge_type is None:
                skipped.append(
                    SkippedEdge(
                        source_file=file, reason="unknown-edge-type", value=edge_name
                    )
                )
                continue
            for end_id in _split_id_list(_cell(row, column_index)):
                if end_id == start_id:
                    skipped.append(
                        SkippedEdge(
                            source_file=file, reason="self-reference", value=start_id
                        )
                    )
                    continue
                edges.append(
                    _build_edge(
                        file=file,
                        start_id=start_id,
                        end_id=end_id,
                        edge_type=edge_type,
                        time_start=None,
                        time_end=None,
                        provenance=provenance,
                        pinakes_id=None,
                    )
                )

    return FileExtraction(edges=edges, skipped=skipped)


def _mapping_by_file() -> dict[str, dict[str, Any]]:
    document = lexicon_mapping_document()
    files: list[dict[str, Any]] = document.get("files", [])
    return {str(entry["file"]): entry for entry in files}


def extract_edges_from_lexicon(
    file: str, header: list[str], rows: list[list[str]]
) -> FileExtraction:
    """Extract canonical edges from one lexicon's parsed rows.

    Dispatches on the file's mapping ``kind``. A file with no edge information —
    or none the mapping knows about — yields an empty extraction. Pure (no
    filesystem), so it can be driven with inline fixtures.
    """
    mapping = _mapping_by_file().get(file)
    if mapping is None:
        return FileExtraction(edges=[], skipped=[])
    if mapping.get("kind") == "edge":
        return _extract_edge_table(file, mapping, header, rows)
    return _extract_embedded_edges(file, mapping, header, rows)


def edge_bearing_files() -> list[str]:
    """Base names of every lexicon that carries edges (edge tables + embedded FKs)."""
    document = lexicon_mapping_document()
    return [
        str(entry["file"])
        for entry in document.get("files", [])
        if entry.get("kind") == "edge"
        or any(column.get("edge") is not None for column in entry.get("columns", []))
    ]


def extract_all_canonical_edges(lexicons: Path) -> FileExtraction:
    """Read every edge-bearing lexicon from disk and extract all canonical edges.

    Results are concatenated across files, in mapping order. An absent file is
    an empty domain, never an error (`analytics.tsv.read_tsv`).
    """
    edges: list[CanonicalEdge] = []
    skipped: list[SkippedEdge] = []
    for file in edge_bearing_files():
        parsed = tsv.read_tsv(lexicons, file)
        if parsed is None:
            continue
        header, rows = parsed
        if not header or header == [""]:
            continue
        # `readTsv` in the TypeScript trims each header cell before `indexOf`;
        # `analytics.tsv.parse_tsv` (which mirrors `parseTsv`, the *storage*
        # reader) does not. A trailing space on a header would otherwise make
        # every column of that file read as absent.
        extraction = extract_edges_from_lexicon(
            file, [name.strip() for name in header], rows
        )
        edges.extend(extraction.edges)
        skipped.extend(extraction.skipped)
    return FileExtraction(edges=edges, skipped=skipped)


__all__ = [
    "BLANK_ID_SENTINELS",
    "DEFAULT_EDGE_CONFIDENCE",
    "EDGE_TYPE_VALUE_MAPS",
    "CanonicalEdge",
    "EdgeProvenance",
    "FileExtraction",
    "SkippedEdge",
    "edge_bearing_files",
    "extract_all_canonical_edges",
    "extract_edges_from_lexicon",
    "is_blank_id",
]
