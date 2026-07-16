"""Tests for reconciling an acquired node corpus against a pinakes lexicon.

Network-free: both sides are tiny on-disk TSV fixtures written to ``tmp_path``.
Covers the two loaders (header-suffix stripping, ``:LABEL`` wrapping, overflow
drop; lexicon csid minting + region key), the outcome roll-up, and the stricter
cross-source fuzzy threshold that keeps look-alike names apart.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape.schema import LocalOutcome
from culturescrape.schema.lexicon_reconcile import (
    read_corpus_nodes,
    read_lexicon_nodes,
    reconcile_corpus_against_lexicon,
    render_markdown,
    summarize,
)
from culturescrape.schema.reconcile import reconcile_pinakes

_CORPUS_HEADER = (
    "csid:ID\t:LABEL\tname\twikidata_qid\tconfidence:float\tsource\textra"
)


def _write(path: Path, header: str, rows: list[str]) -> Path:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path


def test_read_corpus_nodes_strips_suffixes_and_drops_overflow(tmp_path: Path) -> None:
    # The overflow (`extra`) cell holds raw merge JSON that is not re-parseable in
    # isolation; the loader must drop it, not carry it onto the reconciler row.
    path = _write(
        tmp_path / "culture.tsv",
        _CORPUS_HEADER,
        ['cs:culture:Q1\tCulture\tRoman Empire\tQ1\t1.0\twikidata\t{"merge": bad}'],
    )
    rows = read_corpus_nodes(path)
    assert len(rows) == 1
    row = rows[0]
    assert row["csid"] == "cs:culture:Q1"
    assert row[":LABEL"] == ["Culture"]
    assert row["name"] == "Roman Empire"
    assert row["confidence"] == "1.0"  # `confidence:float` header → `confidence`
    assert "extra" not in row  # overflow dropped
    # An empty cell is dropped so blocking keys see "" uniformly.
    assert "getty_id" not in row


def test_read_lexicon_nodes_mints_csid_and_region(tmp_path: Path) -> None:
    path = _write(
        tmp_path / "civilizations.tsv",
        "id\tname\torigin_region",
        ["roman-empire\tRoman Empire\tMediterranean", "\t\t"],
    )
    rows = read_lexicon_nodes(
        path, label="Culture", node_type="culture", region_column="origin_region"
    )
    # The blank-name row is skipped.
    assert len(rows) == 1
    row = rows[0]
    assert row["csid"] == "cs:culture:roman-empire"
    assert row[":LABEL"] == ["Culture"]
    assert row["name"] == "Roman Empire"
    assert '"region": "Mediterranean"' in str(row["extra"])


def test_end_to_end_matched_new_and_summary(tmp_path: Path) -> None:
    corpus = _write(
        tmp_path / "culture.tsv",
        _CORPUS_HEADER,
        [
            "cs:culture:Q1\tCulture\tRoman Empire\tQ1\t1.0\twikidata\t",
            "cs:culture:Q2\tCulture\tKingdom of Aksum\tQ2\t1.0\twikidata\t",
        ],
    )
    lexicon = _write(
        tmp_path / "civilizations.tsv",
        "id\tname",
        ["roman-empire\tRoman Empire"],
    )
    report, summary = reconcile_corpus_against_lexicon(
        corpus, lexicon, domain="civilizations", label="Culture", node_type="culture"
    )
    outcomes = {r.name: r.outcome for r in report.results}
    assert outcomes["Roman Empire"] is LocalOutcome.MATCHED
    assert outcomes["Kingdom of Aksum"] is LocalOutcome.NEW

    assert summary.incoming_total == 2
    assert summary.existing_total == 1
    assert summary.matched == 1
    assert summary.new == 1
    assert summary.ambiguous == 0
    assert summary.union_distinct == 2  # 1 existing + 1 new
    md = render_markdown(summary)
    assert "# Reconciliation report — civilizations" in md
    assert "| **union distinct** | **2** |" in md


def test_stricter_fuzzy_keeps_lookalikes_apart(tmp_path: Path) -> None:
    # "German Empire" vs "Roman Empire" fuzzes ~0.88 — matched at the library
    # default (0.85) but kept `new` at the conservative cross-source default.
    incoming = read_corpus_nodes(
        _write(
            tmp_path / "culture.tsv",
            _CORPUS_HEADER,
            ["cs:culture:Q3\tCulture\tGerman Empire\tQ3\t1.0\twikidata\t"],
        )
    )
    existing = read_lexicon_nodes(
        _write(tmp_path / "lex.tsv", "id\tname", ["roman-empire\tRoman Empire"]),
        label="Culture",
        node_type="culture",
    )
    loose = reconcile_pinakes(incoming, existing, fuzzy_threshold=0.85)
    strict = reconcile_pinakes(incoming, existing, fuzzy_threshold=0.93)
    assert loose.results[0].outcome is LocalOutcome.MATCHED
    assert strict.results[0].outcome is LocalOutcome.NEW


def test_summarize_bounds_samples(tmp_path: Path) -> None:
    corpus = _write(
        tmp_path / "culture.tsv",
        _CORPUS_HEADER,
        [
            f"cs:culture:Q{i}\tCulture\tPolity {i:03d}\tQ{i}\t1.0\twikidata\t"
            for i in range(10)
        ],
    )
    lexicon = _write(tmp_path / "lex.tsv", "id\tname", [])
    report, _ = reconcile_corpus_against_lexicon(
        corpus, lexicon, domain="civilizations", label="Culture", node_type="culture"
    )
    summary = summarize(report, domain="civilizations", existing_total=0, sample=3)
    assert summary.new == 10
    assert len(summary.new_samples) == 3  # bounded
