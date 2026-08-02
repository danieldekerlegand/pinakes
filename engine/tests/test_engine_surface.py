"""The agora engine's *surface* blocker stays visible instead of going latent.

``agora:60-translation-engine-rust`` ships exactly eight **whole-graph document
renderers**: it takes a canonical graph as JSON and returns rendered documents.
It has no parsing direction, no fact-level API, no schema parameterization and no
rule-aware entry point. That is why several surfaces in this package stay
hand-written Python — see ``docs/REMOVED_FEATURES.md`` for the full table.

Note that "the engine does not render X" does **not** always mean "X cannot
delegate": the rule-bearing export composes the engine's whole document back into
fact clauses and supplies only the structure around them, so every fact clause on
that path is the engine's despite there being no rule-aware entry point. Read a
row below as *this capability is absent*, never as *that surface is unreachable*.

The upstream story is **complete and retired**, so this is not "pending a
decision": closing these gaps is a new agora story. Five separate iterations of
this migration re-derived the same ``dir(translation_py)`` by hand before
concluding that. This module is the tripwire that ends that loop:

* :func:`test_engine_surface_is_still_document_level_only` fails the day agora
  adds *anything* to the surface — naming what each new capability would unblock.
* :func:`test_missing_capability_is_still_missing` fails per-capability, so a
  partial upstream ship (say, a parser but no rule-aware API) points at exactly
  the criteria that just became completable.

Nothing here asserts the engine is deficient as a value judgement; it asserts the
*facts the surrounding hand-written code is justified by* are still true.
"""

from __future__ import annotations

import pytest

from pinakes_engine import translation

#: The engine's entire public surface as shipped by agora:60 — eight functions,
#: each ``(graph JSON) -> rendered document(s)``.
DOCUMENT_RENDERERS = frozenset(
    {
        "to_csv",
        "to_cypher",
        "to_datalog",
        "to_neo4j_export",
        "to_problog",
        "to_prolog",
        "to_souffle",
        "to_tsv",
    }
)

#: Capability this package needs but agora:60 does not expose, mapped to a probe
#: of plausible upstream names and the pinakes:50 criteria it would unblock.
MISSING_CAPABILITIES = {
    "parsing (document -> canonical graph JSON)": (
        ("from_tsv", "parse_tsv", "read_tsv", "from_csv", "parse", "load"),
        "US-1 AC-1 for schema/tsvio.py read_rows/read_edge_rows",
    ),
    "schema-parameterized writing (honour extension columns)": (
        ("to_tsv_with_schema", "to_csv_with_schema", "set_schema", "with_schema"),
        "US-1 AC-1 for tsvio.write_rows and neo4j load_csv/admin_import",
    ),
    "fact-level rendering (single atom/fact, Dialect quoting, W:: weights)": (
        ("render_atom", "render_fact", "to_atom", "to_fact"),
        "US-1 AC-2 for datalog/__init__.py",
    ),
    "rule-aware rendering (directives over facts + rules)": (
        ("to_prolog_with_rules", "to_souffle_with_rules", "to_datalog_with_rules"),
        "the re-composition seam on the --rules path (translation."
        "program_fact_clauses plus the rendered_facts/rendered_shards arguments), "
        "which could then be deleted — the fact clauses themselves already delegate",
    ),
}


def _engine_surface() -> frozenset[str]:
    """Public names on the ``translation_py`` extension module itself."""
    engine = translation._engine  # noqa: SLF001 — the adapter owns the guarded import
    return frozenset(
        name
        for name in dir(engine)
        if not name.startswith("_") and name != "translation_py"
    )


def test_engine_surface_is_still_document_level_only() -> None:
    """agora:60 exposes the eight whole-graph renderers and nothing else.

    Fails on any addition — deliberately. A wider surface means some of the
    hand-written emitters ``docs/REMOVED_FEATURES.md`` justifies can now delegate.
    """
    surface = _engine_surface()

    missing = DOCUMENT_RENDERERS - surface
    assert not missing, (
        f"the agora engine LOST entry points: {sorted(missing)}. "
        "pinakes_engine.translation delegates to these — check the vendored wheel."
    )

    added = surface - DOCUMENT_RENDERERS
    assert not added, (
        f"the agora engine GAINED entry points: {sorted(added)}. Re-read "
        "docs/REMOVED_FEATURES.md: the hand-written Python emitters it lists may "
        "now be able to delegate. Update this test once you have re-checked them."
    )


@pytest.mark.parametrize(
    ("capability", "names", "unblocks"),
    [(cap, names, unblocks) for cap, (names, unblocks) in MISSING_CAPABILITIES.items()],
    ids=list(MISSING_CAPABILITIES),
)
def test_missing_capability_is_still_missing(
    capability: str, names: tuple[str, ...], unblocks: str
) -> None:
    """Each individually-blocking gap is still a gap.

    Split out from the surface check so a *partial* upstream ship fails only the
    rows it fixes, and the failure message says what to go finish.
    """
    surface = _engine_surface()
    found = sorted(surface & frozenset(names))
    assert not found, (
        f"the agora engine now offers {capability} via {found}. "
        f"This unblocks {unblocks} — wire it up and drop this row."
    )
