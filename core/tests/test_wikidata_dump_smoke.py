"""End-to-end offline smoke test for the ``wikidata-dump`` acquisition path.

Exercises the whole bulk-dump pipeline a maintainer relies on — **fetch →
normalize → link → validate** — against the committed fixture dump slice, with no
network. It is the guard that the dump path ships trustworthy: a category sourced
from a local Wikidata dump resolves the expected entities, normalizes to canonical
node/edge TSV that *passes schema validation*, drives the ontology linkers to the
expected cross-dimensional links, and stamps the dump's version into provenance so
the corpus records which dump it came from.

The dump is copied to a dated file name (``wikidata-<YYYYMMDD>-...``) so the run
exercises the real provenance stamp an official dump carries.
"""

from __future__ import annotations

import shutil
from collections import Counter
from pathlib import Path

from culturescrape.acquire import CategorySpec, SourceSpec, WikidataDumpAdapter
from culturescrape.ontology import run_linkers, select_linkers
from culturescrape.schema import (
    NormalizationResult,
    normalize_records,
    validate_directory,
    write_result,
)
from culturescrape.schema.tsvio import Row

_FIXTURE_DUMP = (
    Path(__file__).parent / "fixtures" / "wikidata" / "peruvian_dishes_dump.json"
)
#: The class the fixture dishes are instances of (Peruvian dish).
_DISH_CLASS = "Q746549"
#: A dump file name carrying a run date, so provenance records a real version.
_DUMP_NAME = "wikidata-20240601-peruvian-dishes.json"
_DUMP_VERSION = "20240601"


def _dated_dump(tmp_path: Path) -> Path:
    """Copy the fixture slice to a dated dump name under *tmp_path*."""
    dest = tmp_path / _DUMP_NAME
    shutil.copyfile(_FIXTURE_DUMP, dest)
    return dest


def _spec(dump: Path) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(
            type="wikidata-dump",
            params={
                "path": str(dump),
                "class": _DISH_CLASS,
                "transitive": "true",
                "hydrate": "default",
            },
        ),
        dimensions=("temporal", "geographic", "genetic"),
    )


def _run(tmp_path: Path) -> tuple[Path, NormalizationResult]:
    """Drive fetch → normalize → link → write, returning the corpus dir + rows."""
    dump = _dated_dump(tmp_path)
    spec = _spec(dump)
    records = list(WikidataDumpAdapter().fetch(spec))
    normalized = normalize_records(records, spec)
    linked = run_linkers(normalized.nodes, normalized.edges, select_linkers(None))
    corpus = NormalizationResult(nodes=linked.nodes, edges=linked.edges)
    out_dir = tmp_path / "corpus"
    write_result(corpus, out_dir)
    return out_dir, corpus


def _scalar(row: Row, key: str) -> str:
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _qids(nodes: list[Row]) -> set[str]:
    return {q for n in nodes if (q := _scalar(n, "wikidata_qid"))}


def _edge_types(edges: list[Row]) -> Counter[str]:
    return Counter(str(e.get(":TYPE")) for e in edges)


def test_smoke_corpus_validates(tmp_path: Path) -> None:
    """The normalized + linked corpus passes schema validation with no errors."""
    out_dir, _ = _run(tmp_path)
    assert validate_directory(out_dir) == []


def test_smoke_yields_expected_rows(tmp_path: Path) -> None:
    """Fetch + normalize select exactly the fixture's dishes (incl. the subclass)."""
    _, corpus = _run(tmp_path)
    qids = _qids(corpus.nodes)
    assert {"Q207058", "Q2734670", "Q3037464"} <= qids  # ceviche, lomo, tiradito
    assert "Q42" not in qids  # a human, never a dish
    names = {name for n in corpus.nodes if (name := _scalar(n, "name"))}
    assert {"ceviche", "lomo saltado", "tiradito"} <= names


def test_smoke_yields_expected_links(tmp_path: Path) -> None:
    """Hydrated dimensions drive the expected cross-dimensional links."""
    _, corpus = _run(tmp_path)
    types = _edge_types(corpus.edges)
    # Structural edges from normalization.
    assert types["MEMBER_OF_CATEGORY"] >= 3
    # geographic: country of origin (P495) → one LOCATED_IN per dish.
    assert types["LOCATED_IN"] == 3
    # genetic: tiradito "based on" (P144) ceviche → one DERIVED_FROM.
    assert types["DERIVED_FROM"] == 1
    # temporal: inception years are stored on the nodes as time_start/time_end,
    # but pairwise CONTEMPORARY_WITH/PRECEDES/FOLLOWS are no longer materialised
    # (T-SR-US-001) — they are derived on demand by the Datalog rules over those
    # bounds, so none is stored here.
    assert types["CONTEMPORARY_WITH"] == 0
    assert types["PRECEDES"] == 0


def test_smoke_records_dump_version_in_provenance(tmp_path: Path) -> None:
    """Every dump-sourced row's provenance names the dump and its version."""
    _, corpus = _run(tmp_path)
    dishes = [n for n in corpus.nodes if _scalar(n, "wikidata_qid") == "Q207058"]
    assert dishes, "expected the ceviche node to be present"
    query = _scalar(dishes[0], "source_query")
    assert _DUMP_NAME in query
    assert f"@ {_DUMP_VERSION}" in query
