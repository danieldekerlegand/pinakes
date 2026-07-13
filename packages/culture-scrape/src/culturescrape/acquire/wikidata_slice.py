"""Assemble a real, bounded Wikidata slice in bulk-dump format.

The bulk-dump stack (:mod:`wikidata_dump` reader, :mod:`wikidata_dump_index`,
:mod:`wikidata_hydration`, :mod:`wikidata_enrich`) is proven only against a 10 KB
committed fixture. To exercise it on *real* Wikidata data we need a real dump on
disk — but the full ``latest-all.json.gz`` is ~90 GB compressed, and even a
streamed ``wikibase-dump-filter`` pass reads the whole thing off the wire. That
full-scale path is the operator's job (see ``docs/wikidata-dump-runbook.md``); it
is not something to kick off from a routine build.

This module offers the **polite, bounded** alternative: it resolves the member
QIDs of the blueprint classes via the Wikidata Query Service (bounded per class),
fetches their full entity JSON via the ``wbgetentities`` API in batches, and
writes them in the **exact** ``latest-all`` array-per-line framing the reader
accepts. The result is genuine Wikidata data — real labels, claims, sitelinks —
not a synthetic fixture, small enough to build in-session without hammering
Wikimedia. Every request goes through the shared :class:`HttpClient`, so it is
rate-limited, retried, cached, and identifies the project per the Wikimedia
User-Agent policy.

The written file is transparent about its origin: the sidecar manifest records
``source: wikidata-api-composed`` and the exact classes + counts it holds, so no
one mistakes an API-composed slice for a byte-slice of the official dump. Both
answer the same schema question — *does the dump stack work on real data?* — and
the reader treats them identically.
"""

from __future__ import annotations

import bz2
import gzip
import json
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

import yaml

from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.wikidata import WIKIDATA_SPARQL_ENDPOINT
from culturescrape.acquire.wikidata_dump_index import dump_version

#: The ``wbgetentities`` REST endpoint that returns full entity JSON by QID.
WIKIDATA_API_ENDPOINT = "https://www.wikidata.org/w/api.php"
#: Max QIDs ``wbgetentities`` accepts per request (Wikimedia limit for anons).
WBGETENTITIES_BATCH = 50
#: Entity parts to fetch — the keys the dump reader/hydration actually use.
ENTITY_PROPS = "labels|descriptions|aliases|claims|sitelinks"
#: Marks the sidecar JSON as a slice manifest (guards against unrelated files).
MANIFEST_FORMAT = "culture-scrape/wikidata-slice-manifest"
#: On-disk manifest schema version.
MANIFEST_VERSION = 1
#: Records that this slice was composed from the live APIs, not sliced from an
#: official dump — so provenance never overstates what it is.
SLICE_SOURCE = "wikidata-api-composed"


class WikidataSliceError(RuntimeError):
    """Raised when slice inputs are invalid or an API response is unusable."""


@dataclass(frozen=True)
class SliceClass:
    """One blueprint class to draw members from.

    Attributes:
        qid: The class QID (e.g. ``Q10943`` for *cheese*).
        label: Human label for the manifest (the blueprint's ``name``).
        domain: The blueprint id the class came from (e.g. ``food-drink``).
        transitive: Select ``P31/P279*`` (the class and every subclass) when
            true, else direct ``P31`` instances only.
    """

    qid: str
    label: str
    domain: str
    transitive: bool = True


@dataclass
class ClassMembership:
    """The members resolved for one :class:`SliceClass`.

    Attributes:
        source: The class the members were drawn from.
        requested: The per-class cap applied to the WDQS query.
        member_qids: The member QIDs returned (bounded by *requested*).
    """

    source: SliceClass
    requested: int
    member_qids: list[str] = field(default_factory=list)


@dataclass
class SliceManifest:
    """Provenance for a built slice, written beside it as ``<slice>.manifest.json``.

    Records what the slice is (API-composed, not an official dump), which dump
    version its file name carries, and the exact classes + counts it holds so a
    reviewer can audit coverage without opening the (gitignored) slice.
    """

    built_at: str
    dump_name: str
    dump_version: str
    transitive: bool
    limit_per_class: int
    entity_total: int
    wdqs_endpoint: str
    api_endpoint: str
    memberships: list[ClassMembership]
    source: str = SLICE_SOURCE

    def as_dict(self) -> dict[str, Any]:
        by_domain: dict[str, list[dict[str, Any]]] = {}
        for m in self.memberships:
            by_domain.setdefault(m.source.domain, []).append(
                {
                    "class": m.source.qid,
                    "label": m.source.label,
                    "requested": m.requested,
                    "obtained": len(m.member_qids),
                }
            )
        return {
            "format": MANIFEST_FORMAT,
            "version": MANIFEST_VERSION,
            "source": self.source,
            "built_at": self.built_at,
            "dump_name": self.dump_name,
            "dump_version": self.dump_version,
            "transitive": self.transitive,
            "limit_per_class": self.limit_per_class,
            "entity_total": self.entity_total,
            "wdqs_endpoint": self.wdqs_endpoint,
            "api_endpoint": self.api_endpoint,
            "domains": {
                domain: {
                    "classes": classes,
                    "obtained": sum(c["obtained"] for c in classes),
                }
                for domain, classes in sorted(by_domain.items())
            },
        }


def blueprint_classes(path: Path | str, *, transitive: bool = True) -> list[SliceClass]:
    """Read a ``blueprints/<domain>.yml`` and return its selectable classes.

    Extracts each ``categories`` stub that names a ``wikidata_class`` (direct
    ``P31``) or ``subclass_of`` (transitive taxonomy); the blueprint's file stem
    is the ``domain``. Stubs naming a raw ``query``/``petscan`` selector carry no
    single class QID and are skipped.

    Raises:
        WikidataSliceError: If the file cannot be read or is not a blueprint with
            a ``categories`` list.
    """
    blueprint = Path(path)
    try:
        raw = yaml.safe_load(blueprint.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise WikidataSliceError(f"cannot read blueprint {blueprint}: {exc}") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("categories"), list):
        raise WikidataSliceError(
            f"blueprint {blueprint} has no 'categories' list"
        )
    domain = blueprint.stem
    classes: list[SliceClass] = []
    for stub in raw["categories"]:
        if not isinstance(stub, dict):
            continue
        qid = stub.get("wikidata_class") or stub.get("subclass_of")
        if not isinstance(qid, str) or not qid.startswith("Q"):
            continue
        # A bare ``subclass_of`` is inherently transitive; a ``wikidata_class``
        # honours the caller's choice.
        stub_transitive = transitive or "subclass_of" in stub
        classes.append(
            SliceClass(
                qid=qid,
                label=str(stub.get("name", qid)),
                domain=domain,
                transitive=stub_transitive,
            )
        )
    if not classes:
        raise WikidataSliceError(
            f"blueprint {blueprint} names no wikidata_class/subclass_of stubs"
        )
    return classes


def member_query(qid: str, *, transitive: bool, limit: int) -> str:
    """Build the WDQS query selecting up to *limit* members of class *qid*."""
    path = "wdt:P31/wdt:P279*" if transitive else "wdt:P31"
    return f"SELECT ?item WHERE {{ ?item {path} wd:{qid} }} LIMIT {limit}"


def resolve_members(
    http: HttpClient,
    classes: Sequence[SliceClass],
    *,
    limit_per_class: int,
    endpoint: str = WIKIDATA_SPARQL_ENDPOINT,
) -> list[ClassMembership]:
    """Resolve each class's member QIDs from WDQS (bounded by *limit_per_class*).

    Raises:
        WikidataSliceError: If a request fails or returns an unparseable body.
    """
    memberships: list[ClassMembership] = []
    for cls in classes:
        query = member_query(
            cls.qid, transitive=cls.transitive, limit=limit_per_class
        )
        response = http.get(endpoint, {"query": query, "format": "json"})
        if response.status_code >= 400:
            raise WikidataSliceError(
                f"WDQS request for {cls.qid} failed with status "
                f"{response.status_code}"
            )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise WikidataSliceError(
                f"WDQS returned a non-JSON body for {cls.qid}: {exc}"
            ) from exc
        bindings = payload.get("results", {}).get("bindings", [])
        qids: list[str] = []
        for row in bindings:
            uri = row.get("item", {}).get("value", "")
            tail = uri.rsplit("/", 1)[-1]
            if tail.startswith("Q"):
                qids.append(tail)
        memberships.append(
            ClassMembership(
                source=cls, requested=limit_per_class, member_qids=qids
            )
        )
    return memberships


def _batched(items: Sequence[str], size: int) -> Iterator[Sequence[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def fetch_entities(
    http: HttpClient,
    qids: Sequence[str],
    *,
    endpoint: str = WIKIDATA_API_ENDPOINT,
    batch_size: int = WBGETENTITIES_BATCH,
    props: str = ENTITY_PROPS,
) -> Iterator[dict[str, Any]]:
    """Yield full entity dicts for *qids* via ``wbgetentities``, in order.

    Entities are fetched *batch_size* at a time. A QID that resolves to a missing
    entity (or one lacking a string ``id``) is skipped — the reader requires a
    string id — so a redirected/deleted QID never corrupts the slice.

    Raises:
        WikidataSliceError: If a request fails or returns an unparseable body.
    """
    for batch in _batched(qids, batch_size):
        response = http.get(
            endpoint,
            {
                "action": "wbgetentities",
                "ids": "|".join(batch),
                "props": props,
                "format": "json",
            },
        )
        if response.status_code >= 400:
            raise WikidataSliceError(
                f"wbgetentities request failed with status {response.status_code}"
            )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise WikidataSliceError(
                f"wbgetentities returned a non-JSON body: {exc}"
            ) from exc
        entities = payload.get("entities", {})
        if not isinstance(entities, dict):
            raise WikidataSliceError("wbgetentities response has no 'entities' map")
        for qid in batch:
            entity = entities.get(qid)
            if not isinstance(entity, dict):
                continue
            if "missing" in entity or not isinstance(entity.get("id"), str):
                continue
            yield entity


def _open_write(path: Path) -> IO[str]:
    """Open *path* for text writing, compressing by extension (gz/bz2/plain)."""
    suffix = path.suffix.lower()
    if suffix == ".gz":
        return gzip.open(path, mode="wt", encoding="utf-8")
    if suffix == ".bz2":
        return bz2.open(path, mode="wt", encoding="utf-8")
    return path.open(mode="wt", encoding="utf-8")


def format_dump_line(entity: dict[str, Any]) -> str:
    """Serialise one entity as a dump line (compact, UTF-8 preserved)."""
    return json.dumps(entity, ensure_ascii=False, separators=(",", ":"))


def write_dump(entities: Iterable[dict[str, Any]], path: Path | str) -> int:
    """Write *entities* to *path* in ``latest-all`` array-per-line framing.

    The output is the exact shape :func:`wikidata_dump.iter_entities` reads: a
    bare ``[`` line, one entity object per line (every line but the last ending
    in a trailing comma), and a bare ``]`` line. Compression follows the
    extension. A one-entity lookahead lets it stream an unbounded iterable
    without materialising the array. Returns the number of entities written.
    """
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with _open_write(out) as handle:
        handle.write("[\n")
        prev: dict[str, Any] | None = None
        for entity in entities:
            if prev is not None:
                handle.write(format_dump_line(prev) + ",\n")
            prev = entity
            count += 1
        if prev is not None:
            handle.write(format_dump_line(prev) + "\n")
        handle.write("]\n")
    return count


def _utc_now() -> datetime:
    return datetime.now(UTC)


def build_slice(
    http: HttpClient,
    classes: Sequence[SliceClass],
    out_path: Path | str,
    *,
    limit_per_class: int,
    wdqs_endpoint: str = WIKIDATA_SPARQL_ENDPOINT,
    api_endpoint: str = WIKIDATA_API_ENDPOINT,
    now: Callable[[], datetime] = _utc_now,
) -> SliceManifest:
    """Resolve, fetch, and write a real Wikidata slice; return its manifest.

    Member QIDs are resolved per class (deduped across classes, first class
    wins for the manifest), their full entity JSON is fetched, and the slice is
    written to *out_path* in dump framing with a ``<out_path>.manifest.json``
    sidecar. The dump version is parsed from *out_path*'s name (name it with a
    ``YYYYMMDD`` so provenance records which day's data it holds).

    Raises:
        WikidataSliceError: On invalid inputs or an unusable API response.
    """
    out = Path(out_path)
    memberships = resolve_members(
        http, classes, limit_per_class=limit_per_class, endpoint=wdqs_endpoint
    )
    # Dedupe across classes, preserving first-seen order, so an entity that is an
    # instance of two blueprint classes is fetched and written once.
    ordered: list[str] = []
    seen: set[str] = set()
    for membership in memberships:
        for qid in membership.member_qids:
            if qid not in seen:
                seen.add(qid)
                ordered.append(qid)
    entities = fetch_entities(http, ordered, endpoint=api_endpoint)
    total = write_dump(entities, out)
    transitive = any(c.transitive for c in classes)
    manifest = SliceManifest(
        built_at=now().isoformat(),
        dump_name=out.name,
        dump_version=dump_version(out),
        transitive=transitive,
        limit_per_class=limit_per_class,
        entity_total=total,
        wdqs_endpoint=wdqs_endpoint,
        api_endpoint=api_endpoint,
        memberships=list(memberships),
    )
    manifest_path = out.with_name(out.name + ".manifest.json")
    manifest_path.write_text(
        json.dumps(manifest.as_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest
