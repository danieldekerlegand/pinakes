"""Select and construct the source adapter a category's spec calls for.

The category spec names a ``source.type`` (see ``docs/data-model.md``); this
module maps that type to the concrete :class:`SourceAdapter` that handles it and
returns a ready-to-use instance. Network-backed adapters are given a shared
:class:`~culturescrape.acquire.http.HttpClient` (built lazily, so a local dump
run never creates one); dump adapters take none.

When a ``source.type`` is handled by more than one adapter (``dump`` is served
by both Getty and Pleiades), the spec disambiguates via
``source.params.adapter``, naming the adapter's :attr:`~SourceAdapter.name`.
"""

from __future__ import annotations

from collections.abc import Callable

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.getty import GettyDumpAdapter
from culturescrape.acquire.html import HtmlScrapeAdapter
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.insimul import InsimulWorldAdapter
from culturescrape.acquire.kaikki import KaikkiAdapter
from culturescrape.acquire.petscan import PetScanAdapter
from culturescrape.acquire.pinakes import PinakesExportAdapter
from culturescrape.acquire.pleiades import PleiadesDumpAdapter
from culturescrape.acquire.tabular import TabularDumpAdapter
from culturescrape.acquire.wikidata import WikidataSparqlAdapter
from culturescrape.acquire.wikidata_dump_adapter import WikidataDumpAdapter
from culturescrape.acquire.wikitext import WikitextAdapter


class AdapterSelectionError(ValueError):
    """Raised when no single adapter can be chosen for a category spec."""


#: Builds each adapter from an :class:`HttpClient` (ignored by dump adapters).
_BUILDERS: dict[str, Callable[[HttpClient | None], SourceAdapter]] = {
    WikidataSparqlAdapter.name: lambda http: WikidataSparqlAdapter(_require(http)),
    WikidataDumpAdapter.name: lambda http: WikidataDumpAdapter(),
    PetScanAdapter.name: lambda http: PetScanAdapter(_require(http)),
    WikitextAdapter.name: lambda http: WikitextAdapter(_require(http)),
    HtmlScrapeAdapter.name: lambda http: HtmlScrapeAdapter(_require(http)),
    GettyDumpAdapter.name: lambda http: GettyDumpAdapter(),
    PleiadesDumpAdapter.name: lambda http: PleiadesDumpAdapter(),
    TabularDumpAdapter.name: lambda http: TabularDumpAdapter(),
    KaikkiAdapter.name: lambda http: KaikkiAdapter(),
    PinakesExportAdapter.name: lambda http: PinakesExportAdapter(),
    InsimulWorldAdapter.name: lambda http: InsimulWorldAdapter(),
}

#: Adapter ids that need an :class:`HttpClient` to reach a remote endpoint.
_NEEDS_HTTP = frozenset(
    {
        WikidataSparqlAdapter.name,
        PetScanAdapter.name,
        WikitextAdapter.name,
        HtmlScrapeAdapter.name,
    }
)

#: ``source.type`` → the adapter ids that handle it.
_BY_SOURCE_TYPE: dict[str, tuple[str, ...]] = {}
for _cls in (
    WikidataSparqlAdapter,
    WikidataDumpAdapter,
    PetScanAdapter,
    WikitextAdapter,
    HtmlScrapeAdapter,
    GettyDumpAdapter,
    PleiadesDumpAdapter,
    TabularDumpAdapter,
    KaikkiAdapter,
    PinakesExportAdapter,
    InsimulWorldAdapter,
):
    _BY_SOURCE_TYPE[_cls.source_type] = (
        *_BY_SOURCE_TYPE.get(_cls.source_type, ()),
        _cls.name,
    )


def build_adapter(
    spec: CategorySpec, *, http_factory: Callable[[], HttpClient]
) -> SourceAdapter:
    """Return the adapter that handles *spec*, ready to :meth:`fetch`.

    The adapter is chosen from ``spec.source.type`` — or from
    ``spec.source.params.adapter`` when one type maps to several adapters.
    *http_factory* is invoked only when the chosen adapter needs network access.

    Raises:
        AdapterSelectionError: If no adapter handles the source type, if the
            type is ambiguous and ``source.params.adapter`` is unset or unknown,
            or if a named adapter does not handle the declared source type.
    """
    adapter_id = _select_id(spec)
    http = http_factory() if adapter_id in _NEEDS_HTTP else None
    return _BUILDERS[adapter_id](http)


def _select_id(spec: CategorySpec) -> str:
    source_type = spec.source.type
    candidates = _BY_SOURCE_TYPE.get(source_type, ())
    if not candidates:
        raise AdapterSelectionError(
            f"no source adapter handles source.type {source_type!r}"
        )

    explicit = spec.source.params.get("adapter")
    if explicit:
        if explicit not in _BUILDERS:
            known = ", ".join(sorted(_BUILDERS))
            raise AdapterSelectionError(
                f"unknown adapter {explicit!r}; known adapters: {known}"
            )
        if explicit not in candidates:
            raise AdapterSelectionError(
                f"adapter {explicit!r} does not handle source.type "
                f"{source_type!r}; handled by: {', '.join(candidates)}"
            )
        return explicit

    if len(candidates) > 1:
        raise AdapterSelectionError(
            f"source.type {source_type!r} is handled by multiple adapters "
            f"({', '.join(candidates)}); set source.params.adapter to choose"
        )
    return candidates[0]


def _require(http: HttpClient | None) -> HttpClient:
    if http is None:  # pragma: no cover - guarded by _NEEDS_HTTP
        raise AdapterSelectionError("a network adapter was built without an HttpClient")
    return http
