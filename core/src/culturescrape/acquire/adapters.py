"""Source adapter interface and registry.

Every acquisition source (Wikidata SPARQL, PetScan, raw wikitext, ...) is
exposed through one :class:`SourceAdapter` interface so the orchestrator can
drive them uniformly. Adapters register themselves under a stable id and
declare which category-spec ``source.type`` (see ``docs/data-model.md``) they
handle.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator

from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import RawRecord


class SourceAdapter(ABC):
    """Uniform interface every acquisition source implements.

    Subclasses set :attr:`name` (the registry id) and :attr:`source_type`
    (the category-spec ``source.type`` they consume), and implement
    :meth:`fetch`.
    """

    #: Stable adapter id, e.g. ``"wikidata-sparql"`` or ``"petscan"``.
    name: str
    #: The category-spec ``source.type`` this adapter handles.
    source_type: str

    @abstractmethod
    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield the raw rows produced for *category_spec*."""
        raise NotImplementedError


class UnknownAdapterError(KeyError):
    """Raised when no adapter is registered under a requested id."""


_REGISTRY: dict[str, type[SourceAdapter]] = {}


def register(adapter: type[SourceAdapter]) -> type[SourceAdapter]:
    """Register *adapter* under its :attr:`~SourceAdapter.name`.

    Usable as a class decorator. Raises :class:`ValueError` if the adapter
    declares no id or if a different adapter already owns that id.
    """
    name = getattr(adapter, "name", None)
    if not name:
        raise ValueError(f"{adapter.__name__} must declare a non-empty 'name'")
    existing = _REGISTRY.get(name)
    if existing is not None and existing is not adapter:
        raise ValueError(f"adapter id {name!r} is already registered")
    _REGISTRY[name] = adapter
    return adapter


def get_adapter(adapter_id: str) -> type[SourceAdapter]:
    """Look up a registered adapter class by id.

    Raises :class:`UnknownAdapterError` naming the known ids when *adapter_id*
    is not registered.
    """
    try:
        return _REGISTRY[adapter_id]
    except KeyError:
        known = ", ".join(sorted(_REGISTRY)) or "<none>"
        raise UnknownAdapterError(
            f"no source adapter registered for {adapter_id!r}; known ids: {known}"
        ) from None


def registered_ids() -> frozenset[str]:
    """Return the set of currently registered adapter ids."""
    return frozenset(_REGISTRY)
