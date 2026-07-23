"""Tests for the source-adapter interface and registry."""

from collections.abc import Iterator

import pytest

from culturescrape.acquire import (
    CategorySpec,
    RawRecord,
    SourceAdapter,
    UnknownAdapterError,
    get_adapter,
    register,
    registered_ids,
)
from culturescrape.acquire import adapters as adapters_module


@pytest.fixture(autouse=True)
def _isolate_registry() -> Iterator[None]:
    """Snapshot and restore the global registry around each test."""
    snapshot = dict(adapters_module._REGISTRY)
    try:
        yield
    finally:
        adapters_module._REGISTRY.clear()
        adapters_module._REGISTRY.update(snapshot)


class _StubAdapter(SourceAdapter):
    name = "wikidata-sparql"
    source_type = "wikidata-sparql"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        return iter(())


def test_register_then_lookup_returns_class() -> None:
    register(_StubAdapter)
    assert get_adapter("wikidata-sparql") is _StubAdapter
    assert "wikidata-sparql" in registered_ids()


def test_register_returns_adapter_for_decorator_use() -> None:
    assert register(_StubAdapter) is _StubAdapter


def test_adapter_declares_name_and_source_type() -> None:
    assert _StubAdapter.name == "wikidata-sparql"
    assert _StubAdapter.source_type == "wikidata-sparql"


def test_lookup_unknown_id_raises_clear_error() -> None:
    with pytest.raises(UnknownAdapterError, match="petscan"):
        get_adapter("petscan")


def test_unknown_error_lists_known_ids() -> None:
    register(_StubAdapter)
    with pytest.raises(UnknownAdapterError, match="wikidata-sparql"):
        get_adapter("petscan")


def test_unknown_adapter_error_is_keyerror() -> None:
    assert issubclass(UnknownAdapterError, KeyError)


def test_register_rejects_missing_name() -> None:
    class _Nameless(SourceAdapter):
        def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
            return iter(())

    with pytest.raises(ValueError, match="non-empty 'name'"):
        register(_Nameless)


def test_register_rejects_duplicate_id() -> None:
    register(_StubAdapter)

    class _Other(SourceAdapter):
        name = "wikidata-sparql"
        source_type = "wikidata-sparql"

        def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
            return iter(())

    with pytest.raises(ValueError, match="already registered"):
        register(_Other)


def test_source_adapter_cannot_be_instantiated() -> None:
    with pytest.raises(TypeError):
        SourceAdapter()  # type: ignore[abstract]
