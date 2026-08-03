"""Tests for the ``wikidata-dump`` source adapter and its SPARQL parity.

The adapter selects entities by class membership over a committed slice of the
Wikidata JSON dump under ``tests/fixtures/wikidata/`` — entirely offline. The
parity test resolves the *same* class via a stubbed SPARQL response and via the
fixture dump and asserts the two yield equivalent rows (same QIDs and names), so
a category can switch ``source.type`` with no downstream change.
"""

from __future__ import annotations

import shutil
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    RawRecord,
    SourceSpec,
    WikidataDumpAdapter,
    WikidataDumpAdapterError,
    WikidataSparqlAdapter,
)
from pinakes_engine.acquire.wikidata_dump_adapter import WIKIDATA_ENTITY_PREFIX
from pinakes_engine.acquire.wikidata_dump_index import (
    DumpIndexError,
    build_index,
    default_index_path,
)

_FIXTURES = Path(__file__).parent / "fixtures"
_DUMP = _FIXTURES / "wikidata" / "peruvian_dishes_dump.json"
_SPARQL_FIXTURE = _FIXTURES / "sparql" / "peruvian_dishes.json"
_FIXED_NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)

#: The class the fixture dishes are instances of (Peruvian dish).
_DISH_CLASS = "Q746549"


def _adapter() -> WikidataDumpAdapter:
    return WikidataDumpAdapter(now=lambda: _FIXED_NOW)


def _spec(**params: str) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-dump", params={"path": str(_DUMP), **params}),
        dimensions=("geographic",),
    )


def _fetch(**params: str) -> list[RawRecord]:
    return list(_adapter().fetch(_spec(**params)))


def _qid_name(records: list[RawRecord]) -> set[tuple[str, str | None]]:
    return {(r.fields["qid"], r.fields.get("itemLabel")) for r in records}


def test_selects_instances_of_the_class() -> None:
    assert _qid_name(_fetch(**{"class": _DISH_CLASS})) == {
        ("Q207058", "ceviche"),
        ("Q2734670", "lomo saltado"),
    }


def test_non_members_are_excluded() -> None:
    qids = {r.fields["qid"] for r in _fetch(**{"class": _DISH_CLASS})}
    assert "Q42" not in qids  # a human, not a dish
    assert _DISH_CLASS not in qids  # the class node itself is not an instance


def _by_qid(records: list[RawRecord], qid: str) -> RawRecord:
    return next(r for r in records if r.fields["qid"] == qid)


def test_record_shape_matches_sparql_adapter() -> None:
    record = _by_qid(_fetch(**{"class": _DISH_CLASS}), "Q207058")
    assert record.fields["item"] == f"{WIKIDATA_ENTITY_PREFIX}Q207058"
    assert record.fields["qid"] == "Q207058"
    assert record.fields["itemLabel"] == "ceviche"
    prov = record.provenance
    assert prov.source == "wikidata"
    assert prov.source_url == f"{WIKIDATA_ENTITY_PREFIX}Q207058"
    # The selection plus the dump's identity (name + parsed YYYYMMDD version, here
    # 'unknown' for the undated fixture) so a row records which dump it came from.
    assert prov.source_query == (
        "P31 Q746549 [wikidata-dump peruvian_dishes_dump.json @ unknown]"
    )
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
    assert prov.confidence == 1.0


def test_label_language_is_configurable() -> None:
    record = _by_qid(_fetch(**{"class": _DISH_CLASS, "language": "es"}), "Q207058")
    assert record.fields["itemLabel"] == "cebiche"


def test_entity_without_label_in_language_omits_it() -> None:
    # lomo saltado has only an en label; asking for fr yields a row with no name.
    record = _by_qid(_fetch(**{"class": _DISH_CLASS, "language": "fr"}), "Q2734670")
    assert "itemLabel" not in record.fields


def test_transitive_includes_subclass_instances() -> None:
    # tiradito is an instance of "Peruvian raw-fish dish", a P279 subclass.
    direct = {r.fields["qid"] for r in _fetch(**{"class": _DISH_CLASS})}
    assert "Q3037464" not in direct
    transitive = {
        r.fields["qid"] for r in _fetch(**{"class": _DISH_CLASS, "transitive": "true"})
    }
    assert "Q3037464" in transitive
    assert direct < transitive


def test_transitive_descriptor_reflects_p279_walk() -> None:
    record = _fetch(**{"class": _DISH_CLASS, "transitive": "true"})[0]
    assert record.provenance.source_query == (
        "P31/P279* Q746549 [wikidata-dump peruvian_dishes_dump.json @ unknown]"
    )


def test_missing_class_raises() -> None:
    with pytest.raises(WikidataDumpAdapterError, match="source.params.class"):
        _fetch()


def test_missing_path_raises() -> None:
    spec = CategorySpec(
        id="c",
        label="Dish",
        description="d",
        source=SourceSpec(type="wikidata-dump", params={"class": _DISH_CLASS}),
        dimensions=(),
    )
    with pytest.raises(WikidataDumpAdapterError, match="dump path"):
        list(_adapter().fetch(spec))


def test_adapter_declares_registry_metadata() -> None:
    assert WikidataDumpAdapter.name == "wikidata-dump"
    assert WikidataDumpAdapter.source_type == "wikidata-dump"


# --- rich hydration ------------------------------------------------------------


def test_hydration_is_opt_in_so_default_stays_label_only() -> None:
    # No hydrate param: the record carries only the parity fields.
    record = _by_qid(_fetch(**{"class": _DISH_CLASS}), "Q207058")
    assert set(record.fields) == {"item", "qid", "itemLabel"}


def test_hydrate_default_profile_adds_canonical_fields() -> None:
    record = _by_qid(
        _fetch(**{"class": _DISH_CLASS, "hydrate": "default"}), "Q207058"
    )
    assert record.fields["time_start_iso"] == "1535"
    assert record.fields["place_qid"] == "Q419"  # country of origin (P495)
    assert record.fields["coordinates"] == "-12.05, -77.05"


def test_hydrate_collects_multilingual_aliases() -> None:
    record = _by_qid(
        _fetch(
            **{"class": _DISH_CLASS, "hydrate": "default", "hydrate_languages": "es"}
        ),
        "Q207058",
    )
    # The es label ("cebiche") and en alias ("seviche") are gathered; the primary
    # display name ("ceviche") is not repeated as its own alias.
    assert record.fields["aliases"] == "seviche;cebiche"


def test_hydrate_never_overwrites_selection_fields() -> None:
    record = _by_qid(
        _fetch(**{"class": _DISH_CLASS, "hydrate": "default"}), "Q207058"
    )
    assert record.fields["qid"] == "Q207058"
    assert record.fields["itemLabel"] == "ceviche"


def test_hydrate_unknown_profile_raises() -> None:
    from pinakes_engine.acquire.wikidata_hydration import UnknownProfileError

    with pytest.raises(UnknownProfileError, match="default"):
        _fetch(**{"class": _DISH_CLASS, "hydrate": "bogus"})


# --- SPARQL parity -------------------------------------------------------------


class _FakeTransport:
    """Transport that replays a recorded SPARQL JSON body."""

    def __init__(self, body: str) -> None:
        self._body = body

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        return HttpResponse(url=url, status_code=200, text=self._body, headers={})


def _sparql_rows(tmp_path: Path) -> list[RawRecord]:
    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        transport=_FakeTransport(_SPARQL_FIXTURE.read_text(encoding="utf-8")),
        sleep=lambda _: None,
    )
    adapter = WikidataSparqlAdapter(client, now=lambda: _FIXED_NOW)
    spec = CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-sparql", query="SELECT ?item ?itemLabel"),
        dimensions=("geographic",),
    )
    return list(adapter.fetch(spec))


def test_dump_and_sparql_yield_equivalent_rows(tmp_path: Path) -> None:
    """The same class resolved both ways yields the same QIDs and names."""
    sparql = _qid_name(_sparql_rows(tmp_path))
    dump = _qid_name(_fetch(**{"class": _DISH_CLASS}))
    assert dump == sparql


# --- prebuilt class-membership index -------------------------------------------


def _dump_copy(tmp_path: Path, name: str = "dump.json") -> Path:
    dest = tmp_path / name
    shutil.copyfile(_DUMP, dest)
    return dest


def _fetch_path(dump: Path, **params: str) -> list[RawRecord]:
    spec = CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(
            type="wikidata-dump", params={"path": str(dump), **params}
        ),
        dimensions=("geographic",),
    )
    return list(_adapter().fetch(spec))


@pytest.mark.parametrize("transitive", ["", "true"])
def test_indexed_results_match_full_scan(tmp_path: Path, transitive: str) -> None:
    """An explicit index yields exactly the rows a full scan does."""
    dump = _dump_copy(tmp_path)
    index_path = tmp_path / "dishes.index.sqlite3"
    build_index(dump, index_path)
    params = {"class": _DISH_CLASS, "transitive": transitive}
    scanned = _qid_name(_fetch_path(dump, **params))
    indexed = _qid_name(_fetch_path(dump, index=str(index_path), **params))
    assert indexed == scanned
    # Sanity: the transitive run really does pull in the subclass instance.
    if transitive:
        assert "Q3037464" in {q for q, _ in indexed}


def test_sidecar_index_is_used_automatically(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    build_index(dump)  # writes the conventional <dump>.index.sqlite3 sidecar
    assert default_index_path(dump).exists()
    # No index param: the sidecar is picked up, same rows as a scan.
    assert _qid_name(_fetch_path(dump, **{"class": _DISH_CLASS})) == {
        ("Q207058", "ceviche"),
        ("Q2734670", "lomo saltado"),
    }


def test_full_scan_when_no_index_present(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    assert not default_index_path(dump).exists()
    assert _qid_name(_fetch_path(dump, **{"class": _DISH_CLASS})) == {
        ("Q207058", "ceviche"),
        ("Q2734670", "lomo saltado"),
    }


def test_index_built_from_a_different_dump_is_rejected(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    index_path = tmp_path / "dishes.index.sqlite3"
    build_index(dump, index_path)
    # A second dump of a different size must not be served by the first's index.
    other = tmp_path / "other.json"
    other.write_text(dump.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(DumpIndexError, match="different dump"):
        _fetch_path(other, index=str(index_path), **{"class": _DISH_CLASS})


def test_missing_explicit_index_is_rejected(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    with pytest.raises(DumpIndexError, match="not found"):
        _fetch_path(
            dump, index=str(tmp_path / "absent.index.sqlite3"), **{"class": _DISH_CLASS}
        )
