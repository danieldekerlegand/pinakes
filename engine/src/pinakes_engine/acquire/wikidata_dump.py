"""Streaming reader for the Wikidata JSON dump.

Wikidata publishes its full knowledge base as a single bulk JSON file —
``latest-all.json.gz`` (or ``.bz2``) — at multiple gigabytes compressed and far
larger expanded. The file is **one big JSON array printed one entity per line**::

    [
    {"type":"item","id":"Q1",...},
    {"type":"item","id":"Q2",...},
    ...
    {"type":"item","id":"Q999",...}
    ]

The first line is a bare ``[``, the last a bare ``]``, and every entity line but
the final one ends in a trailing comma. That framing lets the whole array be
consumed *one record at a time* without parsing — or holding — the array as a
whole. This module does exactly that: :func:`iter_entities` opens the dump
(transparently handling gzip/bzip2/plain by extension) and yields each entity as
a parsed ``dict`` carrying its ``id``, ``labels``, ``claims`` (statements), and
``sitelinks``.

Acquisition stays explicit about where bytes come from: the reader is pointed at
a **local** path and never downloads the dump itself. A line that fails to parse
is counted and skipped (a warning, not a crash) so a single corrupt record never
aborts a multi-million-entity scan; the running tally lives in
:class:`DumpReadStats`.
"""

from __future__ import annotations

import bz2
import gzip
import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any

logger = logging.getLogger(__name__)

#: Property mapping an entity to the class(es) it is an instance of (``P31``).
INSTANCE_OF = "P31"
#: Property mapping a class to its superclass(es) (``P279``); walked transitively
#: for the ``P31/P279*`` membership idiom.
SUBCLASS_OF = "P279"


class WikidataDumpError(RuntimeError):
    """Raised when the dump path is missing or cannot be opened."""


@dataclass
class DumpReadStats:
    """Running counts gathered while streaming a dump.

    Attributes:
        entities: Entities successfully parsed and yielded.
        skipped: Lines skipped because they could not be parsed into an entity
            (malformed JSON, or valid JSON that is not an entity object).
    """

    entities: int = 0
    skipped: int = 0


def open_dump(path: Path) -> IO[str]:
    """Open a Wikidata dump for line-oriented text reading.

    Compression is chosen from the file extension: ``.gz`` → gzip, ``.bz2`` →
    bzip2, anything else → plain text. The handle decodes UTF-8 and is the
    caller's to close (:func:`iter_entities` manages it via ``with``).

    Raises:
        WikidataDumpError: If *path* does not exist or cannot be opened.
    """
    if not path.exists():
        raise WikidataDumpError(f"Wikidata dump not found: {path}")
    suffix = path.suffix.lower()
    try:
        if suffix == ".gz":
            return gzip.open(path, mode="rt", encoding="utf-8")
        if suffix == ".bz2":
            return bz2.open(path, mode="rt", encoding="utf-8")
        return path.open(mode="rt", encoding="utf-8")
    except OSError as exc:  # pragma: no cover - exercised via missing-path test
        raise WikidataDumpError(f"cannot open Wikidata dump {path}: {exc}") from exc


def iter_entities(
    path: Path | str, *, stats: DumpReadStats | None = None
) -> Iterator[dict[str, Any]]:
    """Stream entities from a local Wikidata JSON dump, one record at a time.

    Opens *path* (gzip/bzip2/plain, by extension), walks the array line by line,
    and yields each entity as a parsed ``dict``. The array framing (``[`` / ``]``
    lines) and per-line trailing commas are stripped before parsing. A line that
    does not parse into an entity object is skipped with a counted warning rather
    than raising, so one corrupt record cannot abort the scan.

    Memory use is bounded by a single line: the array is never materialised whole.

    Args:
        path: Local path to the dump (``latest-all.json.gz``/``.bz2`` or the
            uncompressed ``.json``). Never fetched — bytes must already be on disk.
        stats: Optional :class:`DumpReadStats` to accumulate into; a fresh one is
            created when omitted. Inspect it after iterating for the skip tally.

    Yields:
        Each entity as a ``dict`` with the dump's native keys, notably ``id``,
        ``labels``, ``claims``, and ``sitelinks``.

    Raises:
        WikidataDumpError: If the dump path is missing or cannot be opened.
    """
    if stats is None:
        stats = DumpReadStats()
    dump_path = Path(path)
    handle = open_dump(dump_path)
    with handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.strip()
            # Array framing: the opening "[" and closing "]" carry no entity.
            if not line or line == "[" or line == "]":
                continue
            # Every entity line but the last ends in a trailing comma.
            if line.endswith(","):
                line = line[:-1].rstrip()
            if not line:
                continue
            try:
                entity = json.loads(line)
            except json.JSONDecodeError as exc:
                stats.skipped += 1
                logger.warning(
                    "skipping malformed Wikidata dump line %d: %s", number, exc
                )
                continue
            if not isinstance(entity, dict) or not isinstance(entity.get("id"), str):
                stats.skipped += 1
                logger.warning(
                    "skipping non-entity Wikidata dump line %d (no string id)",
                    number,
                )
                continue
            stats.entities += 1
            yield entity


def claim_entity_ids(entity: dict[str, Any], prop: str) -> list[str]:
    """Return the QIDs an entity's *prop* statements point at (value snaks only).

    Each Wikidata statement wraps a ``mainsnak``; an entity-valued one carries
    its target QID at ``datavalue.value.id``. Non-value snaks (``novalue`` /
    ``somevalue``) and non-entity datatypes are skipped. Shared by the dump
    adapter (class membership) and the on-disk index builder.
    """
    ids: list[str] = []
    statements = entity.get("claims", {}).get(prop, [])
    if not isinstance(statements, list):
        return ids
    for statement in statements:
        snak = statement.get("mainsnak", {}) if isinstance(statement, dict) else {}
        if snak.get("snaktype") != "value":
            continue
        datavalue = snak.get("datavalue", {})
        if datavalue.get("type") != "wikibase-entityid":
            continue
        qid = datavalue.get("value", {}).get("id")
        if isinstance(qid, str):
            ids.append(qid)
    return ids
