"""The canonical header is ``contracts/canonical-schema.json``'s, not a fork.

``docs/canonical-schema.md`` names ``contracts/canonical-schema.json`` the single
data contract and says not to fork it, but :mod:`pinakes_engine.schema.headers`
transcribes the column tuples rather than loading them — the contract lives at
the monorepo root, outside this package, and a standalone checkout still has to
know its own schema. This module is what makes the transcription safe: it pins
:meth:`NodeSchema.canonical` / :meth:`EdgeSchema.canonical` to the contract
column-for-column, so a drift in either direction fails here instead of silently
at the export boundary.

That boundary is now load-bearing. The embedded agora translation engine
(``agora:60-translation-engine-rust``, reached through
:mod:`pinakes_engine.translation`) renders the *contract's* header, so a
pinakes-engine header that has drifted from it produces different bytes for the
same graph. The last two tests assert the engine and the header module agree,
which is the property every byte-parity test in the suite rests on.

Both halves skip in a standalone checkout, where the monorepo root is absent —
the same guard ``test_datalog_schema_constraints.py`` uses.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from pinakes_engine.schema.headers import (
    PARENT_CODE_KEY,
    EdgeSchema,
    NodeSchema,
    render_edge_header,
    render_node_header,
)
from pinakes_engine.schema.mapper import OVERFLOW_KEY, node_schema

#: The monorepo's shared contract, absent in a standalone pinakes-engine checkout.
CANONICAL_SCHEMA_JSON = (
    Path(__file__).resolve().parents[2] / "contracts" / "canonical-schema.json"
)

_needs_contract = pytest.mark.skipif(
    not CANONICAL_SCHEMA_JSON.exists(),
    reason="contracts/canonical-schema.json not present (standalone checkout)",
)


def _contract() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        CANONICAL_SCHEMA_JSON.read_text(encoding="utf-8")
    )
    return data


def _contract_headers(family: str) -> list[str]:
    """The contract's declared header cells for ``node`` / ``edge``, in order."""
    return [column["header"] for column in _contract()[family]["columns"]]


# --- the header module vs the contract --------------------------------------


@_needs_contract
def test_node_header_is_the_contract_header() -> None:
    assert render_node_header(NodeSchema.canonical()).split("\t") == (
        _contract_headers("node")
    )


@_needs_contract
def test_edge_header_is_the_contract_header() -> None:
    assert render_edge_header(EdgeSchema.canonical()).split("\t") == (
        _contract_headers("edge")
    )


@_needs_contract
def test_the_contract_delimiter_is_ours() -> None:
    from pinakes_engine.schema.headers import DELIMITER

    assert _contract()["delimiter"] == DELIMITER


@_needs_contract
def test_pinakes_id_is_the_contract_alias_column() -> None:
    """``pinakes_id`` is canonical on both families, not an appended extension."""
    alias = _contract()["idScheme"]["aliasColumn"]
    assert alias in _contract_headers("node")
    assert alias in _contract_headers("edge")


# --- pinakes-engine's extensions stay outside the canonical tuple ------------


def test_acquisition_extensions_hang_off_the_canonical_prefix() -> None:
    """``node_schema()`` is the canonical header *followed by* our extensions.

    ``parent_code`` (the linguistic linker's ancestor ref) and ``extra`` (the
    unmapped-field overflow) are pinakes-engine's, not the contract's. Keeping
    them strictly after the canonical columns is what lets a canonical-only
    consumer — the translation engine — read the prefix unchanged.
    """
    canonical = render_node_header(NodeSchema.canonical()).split("\t")
    acquisition = render_node_header(node_schema()).split("\t")

    assert acquisition[: len(canonical)] == canonical
    assert acquisition[len(canonical) :] == [PARENT_CODE_KEY, OVERFLOW_KEY]


def test_canonical_node_header_carries_no_extension_column() -> None:
    canonical = render_node_header(NodeSchema.canonical()).split("\t")
    assert PARENT_CODE_KEY not in canonical
    assert OVERFLOW_KEY not in canonical


# --- the header module vs the embedded engine -------------------------------


def _engine_tsv_headers() -> tuple[str, str]:
    """The engine's rendered header rows for an empty canonical graph."""
    from pinakes_engine.translation import graph_json, to_tsv

    rendered = to_tsv(graph_json([], []))
    return rendered["nodes"].splitlines()[0], rendered["edges"].splitlines()[0]


def test_engine_node_header_matches_ours() -> None:
    engine_nodes, _ = _engine_tsv_headers()
    assert engine_nodes == render_node_header(NodeSchema.canonical())


def test_engine_edge_header_matches_ours() -> None:
    _, engine_edges = _engine_tsv_headers()
    assert engine_edges == render_edge_header(EdgeSchema.canonical())
