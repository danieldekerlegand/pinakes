"""`server/services/graph-resolver.test.ts` — the alias/fuzzy resolver.

What matters here is not that it resolves, but the two ways it **refuses**: an
ambiguous match resolves to ``None`` rather than guessing, because a wrong csid
merges two entities into one search result. Both refusals are graded below.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pinakes_contracts import contracts_dir

from pinakes.search import graph_resolver as gr

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"


def entry(
    csid: str, pinakes_id: str, node_type: str, name: str, region: str = ""
) -> gr.AliasEntry:
    return gr.AliasEntry(
        csid=csid, pinakes_id=pinakes_id, node_type=node_type, name=name, region=region
    )


SUMERIAN = entry("cs:language:sux", "sux", "language", "Sumerian")


# ── Normalization and similarity (pure) ──────────────────────────────────────


def test_normalization_is_nfkc_whitespace_collapsed_and_lowercased() -> None:
    assert gr.normalize_name("  Old   Church\tSlavonic ") == "old church slavonic"
    assert gr.normalize_name("ﬁre") == "fire"  # NFKC decomposes the ligature


def test_lower_not_casefold() -> None:
    """``toLowerCase`` leaves ``ß`` alone; ``casefold`` would make it ``ss``."""
    assert gr.normalize_name("Straße") == "straße"


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("sumerian", "sumerian", 1.0),
        ("", "", 0.0),
        ("a", "a", 1.0),
        ("a", "b", 0.0),  # nothing shorter than two chars has a bigram
        ("night", "nacht", 0.25),
    ],
)
def test_dice_similarity(left: str, right: str, expected: float) -> None:
    assert gr.name_similarity(left, right) == pytest.approx(expected)


def test_the_minted_csid_is_the_export_format() -> None:
    assert gr.mint_csid("language", "sux") == "cs:language:sux"


# ── Resolution ───────────────────────────────────────────────────────────────


def test_an_exact_type_and_id_resolves_by_alias_at_full_confidence() -> None:
    resolver = gr.create_graph_resolver([SUMERIAN])
    resolved = resolver.resolve(gr.EntityRef(type="language", id="sux"))
    assert resolved == gr.ResolvedCsid(
        csid="cs:language:sux", confidence=1.0, method="alias"
    )


def test_an_explicit_csid_column_wins_over_the_minted_one() -> None:
    resolver = gr.create_graph_resolver(
        [entry("cs:written-back", "sux", "language", "Sumerian")]
    )
    resolved = resolver.resolve(gr.EntityRef(type="language", id="sux"))
    assert resolved is not None and resolved.csid == "cs:written-back"


def test_one_type_and_id_mapping_to_two_csids_refuses_rather_than_guesses() -> None:
    resolver = gr.create_graph_resolver(
        [
            entry("cs:language:sux", "sux", "language", "Sumerian"),
            entry("cs:language:other", "sux", "language", "Sumerian"),
        ]
    )
    assert resolver.resolve(gr.EntityRef(type="language", id="sux")) is None


def test_an_unindexed_id_falls_back_to_the_mint_only_when_that_node_exists() -> None:
    resolver = gr.create_graph_resolver(
        [entry("cs:language:sux", "", "language", "Sumerian")]
    )
    hit = resolver.resolve(gr.EntityRef(type="language", id="sux"))
    assert hit is not None and hit.method == "alias"
    assert resolver.resolve(gr.EntityRef(type="language", id="nope")) is None


def test_a_name_resolves_fuzzily_when_the_id_does_not() -> None:
    resolver = gr.create_graph_resolver([SUMERIAN])
    resolved = resolver.resolve(gr.EntityRef(type="language", name="Sumerien"))
    assert resolved is not None
    assert resolved.method == "fuzzy"
    assert 0.6 <= resolved.confidence < 1.0


def test_two_distinct_csids_tying_the_best_fuzzy_score_refuse() -> None:
    resolver = gr.create_graph_resolver(
        [
            entry("cs:language:a", "a", "language", "Sumerian"),
            entry("cs:language:b", "b", "language", "Sumerian"),
        ]
    )
    assert resolver.resolve(gr.EntityRef(type="language", name="Sumerian")) is None


def test_a_region_narrows_the_fuzzy_pool_and_breaks_the_tie() -> None:
    resolver = gr.create_graph_resolver(
        [
            entry("cs:language:a", "a", "language", "Sumerian", "Mesopotamia"),
            entry("cs:language:b", "b", "language", "Sumerian", "Elsewhere"),
        ]
    )
    resolved = resolver.resolve(
        gr.EntityRef(type="language", name="Sumerian", region="Mesopotamia")
    )
    assert resolved is not None and resolved.csid == "cs:language:a"


def test_a_score_below_the_threshold_is_no_match() -> None:
    resolver = gr.create_graph_resolver([SUMERIAN])
    assert resolver.resolve(gr.EntityRef(type="language", name="Nahuatl")) is None


def test_a_blank_csid_is_never_indexed() -> None:
    resolver = gr.create_graph_resolver([entry("", "sux", "language", "Sumerian")])
    assert resolver.size == 0


def test_reverse_lookup_returns_the_first_entry_for_a_csid() -> None:
    resolver = gr.create_graph_resolver(
        [entry("cs:language:sux", "sux", "language", "Sumerian", "Iraq")]
    )
    assert resolver.reverse("cs:language:sux") == gr.EntityRef(
        type="language", id="sux", name="Sumerian", region="Iraq"
    )
    assert resolver.reverse("cs:nope") is None


# ── The live corpus ──────────────────────────────────────────────────────────


def test_the_live_corpus_indexes_every_node_file_the_contract_declares() -> None:
    entries = gr.load_alias_entries(LIVE_LEXICONS)
    assert len(entries) > 3000
    types = {item.node_type for item in entries}
    # The mapping collapses several files onto one node type — `civilizations`
    # and `culture-profiles` are both `culture`, three files are `art-tradition`
    # — so this is a floor on breadth, not a file count.
    assert {"language", "culture", "place", "art-tradition"} <= types


def test_a_live_language_resolves_to_its_minted_csid() -> None:
    resolver = gr.graph_resolver(LIVE_LEXICONS)
    resolved = resolver.resolve(
        gr.EntityRef(type="language", id="sux", name="Sumerian")
    )
    assert resolved is not None and resolved.csid == "cs:language:sux"


def test_the_app_entity_types_search_passes_do_not_all_reach_a_node_type() -> None:
    """`civilization` is `culture` and `archaeological-site` is `place`.

    So those domains never dedup against the graph. That is the Express
    behaviour and narrowing it here would make the two backends disagree about
    which results are duplicates during the cutover.
    """
    resolver = gr.graph_resolver(LIVE_LEXICONS)
    assert resolver.resolve(gr.EntityRef(type="culture", id="sumerian")) is not None
    assert resolver.resolve(gr.EntityRef(type="civilization", id="sumerian")) is None


def test_the_resolver_is_memoised_on_the_directory_it_indexes(tmp_path: Path) -> None:
    gr.reset_graph_resolver()
    first = gr.graph_resolver(LIVE_LEXICONS)
    assert gr.graph_resolver(LIVE_LEXICONS) is first
    # A different directory is a different index, never the cached one.
    assert gr.graph_resolver(tmp_path) is not first
    gr.reset_graph_resolver()
