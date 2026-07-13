"""Wikidata bulk-dump source adapter.

Turns a category whose ``source.type`` is ``wikidata-dump`` into raw rows by
selecting entities **by class membership over a local Wikidata JSON dump**,
rather than by running a live SPARQL query against the Query Service. A category
like *"every Peruvian dish"* is expressed not as SPARQL text but as a class QID:
the adapter streams the dump (via
:func:`~culturescrape.acquire.wikidata_dump.iter_entities`) and keeps every
entity that is an ``instance of`` (P31) that class — optionally also instances
of any of its ``subclass of`` (P279) descendants, mirroring the common SPARQL
``wdt:P31/wdt:P279*`` idiom.

The point of the adapter is **parity**: each kept entity becomes a
:class:`~culturescrape.acquire.records.RawRecord` carrying exactly the fields the
:class:`~culturescrape.acquire.wikidata.WikidataSparqlAdapter` produces for the
same class — the item URI (``item``), its QID (``qid``), and its label
(``itemLabel``) — so a category can switch ``source.type`` between
``wikidata-sparql`` and ``wikidata-dump`` with no change to downstream
normalization, linking, or export.

Acquisition stays explicit about where bytes come from: the dump is a **local**
path the reader never downloads. On top of the label-only parity rows the adapter
also offers **opt-in rich hydration**: when a category sets
``source.params['hydrate']`` to a profile name, every kept entity's statements,
qualifiers, and multilingual labels are extracted — declaratively, per
:mod:`culturescrape.acquire.wikidata_hydration` — into the canonical fields the
mapper and ontology linkers read, so a dump-sourced node carries far more than a
label and image.

For large classes, the membership scan can be precomputed once into an on-disk
index (see :mod:`culturescrape.acquire.wikidata_dump_index`). When an index is
present — named explicitly via ``source.params['index']`` or found at the
conventional sidecar path beside the dump — the adapter resolves class membership
from it (no rescan, and no extra pass for the transitive ``P279*`` closure),
falling back to a full scan when it is absent. Results are identical either way;
an index built from a different dump is rejected with a clear message.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.acquire.wikidata_dump import (
    INSTANCE_OF,
    SUBCLASS_OF,
    claim_entity_ids,
    iter_entities,
)
from culturescrape.acquire.wikidata_dump_index import (
    DumpIndex,
    default_index_path,
    dump_version,
    load_index,
)
from culturescrape.acquire.wikidata_hydration import (
    HydrationProfile,
    get_profile,
    hydrate_entity,
    merge_languages,
    split_languages,
)

#: URI prefix the Query Service binds an ``?item`` to; reused so the dump
#: adapter's ``item`` field is byte-identical to the SPARQL adapter's.
WIKIDATA_ENTITY_PREFIX = "http://www.wikidata.org/entity/"

#: ``source.params`` values that read as boolean true.
_TRUE_TOKENS = frozenset({"1", "true", "yes", "on"})


class WikidataDumpAdapterError(RuntimeError):
    """Raised when a ``wikidata-dump`` category spec is incomplete."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class WikidataDumpAdapter(SourceAdapter):
    """Select entities by class membership from a local Wikidata dump.

    The dump path comes from ``source.params['path']`` (falling back to
    ``source.query``). The class to select is ``source.params['class']`` — one
    or more ``;``-separated QIDs. Set ``source.params['transitive']`` truthy to
    also keep instances of the class's ``P279`` subclasses (the
    ``P31/P279*`` idiom); ``source.params['language']`` picks the label language
    (default ``en``). ``source.params['hydrate']`` opts into rich attribute
    extraction by naming a profile (``'default'`` or ``'language'``), and
    ``source.params['hydrate_languages']`` adds ``;``-separated languages whose
    labels/aliases are collected into ``aliases``. ``source.params['index']``
    points at a prebuilt membership index for fast class resolution; absent it,
    the conventional sidecar (``<dump>.index.sqlite3``) is used when present and a
    full scan otherwise.

    Args:
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "wikidata-dump"
    source_type = "wikidata-dump"

    def __init__(
        self,
        *,
        confidence: float = 1.0,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per dump entity that is a member of the class."""
        params = category_spec.source.params
        raw_path = (params.get("path") or category_spec.source.query or "").strip()
        if not raw_path:
            raise WikidataDumpAdapterError(
                f"category {category_spec.id!r} has no dump path "
                "(source.params.path or source.query) to read"
            )
        roots = tuple(
            qid.strip() for qid in params.get("class", "").split(";") if qid.strip()
        )
        if not roots:
            raise WikidataDumpAdapterError(
                f"category {category_spec.id!r} has no source.params.class "
                "(the class QID whose instances to select)"
            )
        transitive = (params.get("transitive") or "").strip().lower() in _TRUE_TOKENS
        language = (params.get("language") or "en").strip()
        profile = self._profile(params)
        alias_languages = merge_languages(
            language, split_languages(params.get("hydrate_languages"))
        )
        dump_path = Path(raw_path)
        index = self._load_index(dump_path, params.get("index"))
        retrieved_at = self._now().isoformat()
        return self._iter_records(
            dump_path,
            roots,
            transitive,
            language,
            retrieved_at,
            profile,
            alias_languages,
            index,
        )

    @staticmethod
    def _load_index(dump_path: Path, index_param: str | None) -> DumpIndex | None:
        """Load the membership index to use, or ``None`` for a full scan.

        An explicit ``source.params['index']`` is loaded (and verified against
        the dump); without one, the conventional sidecar beside the dump is used
        when it exists. An index built from a different dump raises rather than
        silently answering for the wrong data.
        """
        explicit = (index_param or "").strip()
        if explicit:
            return load_index(Path(explicit), dump_path)
        sidecar = default_index_path(dump_path)
        return load_index(sidecar, dump_path) if sidecar.exists() else None

    @staticmethod
    def _profile(params: Any) -> HydrationProfile | None:
        """The hydration profile a category opts into, or ``None`` for none.

        Hydration is opt-in so a plain ``wikidata-dump`` category stays at SPARQL
        parity (label-only); ``source.params['hydrate']`` names the profile
        (``'default'`` for the shared cross-domain set).
        """
        name = (params.get("hydrate") or "").strip()
        return get_profile(name) if name else None

    def _iter_records(
        self,
        path: Path,
        roots: tuple[str, ...],
        transitive: bool,
        language: str,
        retrieved_at: str,
        profile: HydrationProfile | None,
        alias_languages: tuple[str, ...],
        index: DumpIndex | None,
    ) -> Iterator[RawRecord]:
        is_member = self._membership_test(path, roots, transitive, index)
        descriptor = _selection_descriptor(roots, transitive, path)
        for entity in iter_entities(path):
            if not is_member(entity):
                continue
            qid = entity["id"]
            uri = f"{WIKIDATA_ENTITY_PREFIX}{qid}"
            fields = {"item": uri, "qid": qid}
            label = _label(entity, language)
            if label is not None:
                fields["itemLabel"] = label
            if profile is not None:
                hydrated = hydrate_entity(
                    entity,
                    profile,
                    alias_languages=alias_languages,
                    exclude_alias=label,
                )
                # Selection fields (item/qid/itemLabel) are authoritative; a
                # profile only adds attributes, never overwrites them.
                for field, value in hydrated.items():
                    fields.setdefault(field, value)
            provenance = Provenance(
                source="wikidata",
                source_url=uri,
                source_query=descriptor,
                retrieved_at=retrieved_at,
                confidence=self._confidence,
            )
            yield RawRecord(fields=fields, provenance=provenance)

    def _membership_test(
        self,
        path: Path,
        roots: tuple[str, ...],
        transitive: bool,
        index: DumpIndex | None,
    ) -> Callable[[dict[str, Any]], bool]:
        """Return a predicate deciding whether a dump entity is a member.

        With an *index*, membership is the precomputed *class → member QIDs* set
        (an O(1) lookup, and no extra dump pass for the ``P279*`` closure).
        Without one, it falls back to intersecting each entity's ``P31`` classes
        with the class closure — built from the same statements, so the two paths
        select exactly the same entities.
        """
        if index is not None:
            member_qids = index.member_qids(roots, transitive)
            return lambda entity: entity["id"] in member_qids
        member_classes = self._membership_classes(path, roots, transitive)
        return lambda entity: not member_classes.isdisjoint(
            claim_entity_ids(entity, INSTANCE_OF)
        )

    def _membership_classes(
        self, path: Path, roots: tuple[str, ...], transitive: bool
    ) -> set[str]:
        """Return the set of classes whose instances count as members.

        For a direct query that is just *roots*; for a transitive one it also
        includes every ``P279`` descendant of a root, computed in one extra pass
        over the dump (an index replaces this scan with a lookup).
        """
        if not transitive:
            return set(roots)
        children: dict[str, set[str]] = {}
        for entity in iter_entities(path):
            child = entity["id"]
            for parent in claim_entity_ids(entity, SUBCLASS_OF):
                children.setdefault(parent, set()).add(child)
        closure = set(roots)
        stack = list(roots)
        while stack:
            for child in children.get(stack.pop(), ()):
                if child not in closure:
                    closure.add(child)
                    stack.append(child)
        return closure


def _label(entity: dict[str, Any], language: str) -> str | None:
    """Return the entity's label in *language*, or ``None`` if it has none."""
    entry = entity.get("labels", {}).get(language)
    if isinstance(entry, dict):
        value = entry.get("value")
        if isinstance(value, str):
            return value
    return None


def _selection_descriptor(
    roots: tuple[str, ...], transitive: bool, dump_path: Path
) -> str:
    """Render the class-membership selection for ``provenance.source_query``.

    The descriptor stamps the *dump's identity* — its file name and the
    ``YYYYMMDD`` version parsed from that name (or ``unknown``) — alongside the
    class selection, so every dump-sourced row carries which dump it came from
    and the corpus can be reproduced against that exact dump.
    """
    selector = f"{INSTANCE_OF}/{SUBCLASS_OF}*" if transitive else INSTANCE_OF
    selection = f"{selector} {' '.join(roots)}"
    return f"{selection} [wikidata-dump {dump_path.name} @ {dump_version(dump_path)}]"
