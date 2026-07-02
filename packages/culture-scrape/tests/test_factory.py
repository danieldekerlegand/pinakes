"""Tests for adapter selection/construction from a category spec."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from culturescrape.acquire import (
    AdapterSelectionError,
    CategorySpec,
    GettyDumpAdapter,
    PleiadesDumpAdapter,
    SourceSpec,
    WikidataDumpAdapter,
    WikidataSparqlAdapter,
    build_adapter,
)
from culturescrape.acquire.http import HttpClient


def _spec(source: SourceSpec) -> CategorySpec:
    return CategorySpec(
        id="c",
        label="Dish",
        description="d",
        source=source,
        dimensions=(),
    )


def _http_factory(tmp_path: Path) -> Callable[[], HttpClient]:
    def factory() -> HttpClient:
        return HttpClient(cache_dir=str(tmp_path))

    return factory


def _exploding_factory() -> HttpClient:
    raise AssertionError("http_factory must not be called for a dump adapter")


def test_unambiguous_source_type_builds_its_adapter(tmp_path: Path) -> None:
    spec = _spec(SourceSpec(type="wikidata-sparql", query="SELECT 1"))
    adapter = build_adapter(spec, http_factory=_http_factory(tmp_path))
    assert isinstance(adapter, WikidataSparqlAdapter)


def test_wikidata_dump_is_built_without_calling_http_factory() -> None:
    spec = _spec(SourceSpec(type="wikidata-dump", params={"class": "Q746549"}))
    adapter = build_adapter(spec, http_factory=_exploding_factory)
    assert isinstance(adapter, WikidataDumpAdapter)


def test_dump_adapter_is_built_without_calling_http_factory() -> None:
    spec = _spec(SourceSpec(type="dump", params={"adapter": "pleiades-dump"}))
    adapter = build_adapter(spec, http_factory=_exploding_factory)
    assert isinstance(adapter, PleiadesDumpAdapter)


def test_params_adapter_disambiguates_dump() -> None:
    spec = _spec(SourceSpec(type="dump", params={"adapter": "getty-dump"}))
    assert isinstance(
        build_adapter(spec, http_factory=_exploding_factory), GettyDumpAdapter
    )


def test_ambiguous_source_type_without_adapter_param_errors() -> None:
    spec = _spec(SourceSpec(type="dump"))
    with pytest.raises(AdapterSelectionError, match="multiple adapters"):
        build_adapter(spec, http_factory=_exploding_factory)


def test_named_adapter_must_handle_the_source_type() -> None:
    spec = _spec(SourceSpec(type="dump", params={"adapter": "petscan"}))
    with pytest.raises(AdapterSelectionError, match="does not handle"):
        build_adapter(spec, http_factory=_exploding_factory)


def test_unknown_named_adapter_errors() -> None:
    spec = _spec(SourceSpec(type="dump", params={"adapter": "nope"}))
    with pytest.raises(AdapterSelectionError, match="unknown adapter"):
        build_adapter(spec, http_factory=_exploding_factory)
