"""Content-fingerprinted diff of two Wikidata dump slices (US-006).

A living corpus should not be rebuilt from scratch every time a handful of
entities change upstream. The MERGE-on-``csid`` Neo4j load is already idempotent
(``docs/data-model.md``; :mod:`culturescrape.neo4j.load_csv`), so an incremental
*upsert* is architecturally cheap — the only missing piece is knowing **which**
entities changed. This module answers that by diffing two dump slices keyed on
QID: the slice the corpus was last built from (*old*) and a fresher one (*new*).

Each entity is reduced to a **content fingerprint** — a stable hash over exactly
the parts hydration and class selection read (labels, descriptions, aliases,
claims, sitelinks), deliberately excluding volatile revision metadata
(``lastrevid``, ``modified``, ``pageid``) so a no-op re-export of the *same*
knowledge does not register as a change. Comparing the two fingerprint maps yields
the QIDs that were **added**, **changed**, or **removed** — the upsert set the
incremental path re-hydrates and re-exports (:mod:`culturescrape.orchestrate.
incremental`).

:func:`diff_dumps` produces the :class:`DumpDiff`; :func:`write_delta_dump` carves
the changed entities out of the new slice into a small dump (in the same
``latest-all`` framing the reader accepts) so the ordinary dump adapter re-hydrates
only them.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from culturescrape.acquire.wikidata_dump import iter_entities
from culturescrape.acquire.wikidata_slice import write_dump

#: Entity keys whose content the corpus derives from — hydration reads
#: labels/descriptions/aliases/claims and the dump adapter reads claims/labels;
#: sitelinks travel with the entity. Everything else a dump entity carries
#: (``lastrevid``/``modified``/``pageid``/``ns``/``title``/``type``) is revision
#: metadata that churns without changing the knowledge, so it is excluded from the
#: fingerprint — a re-export of identical facts must not read as a change.
_CONTENT_KEYS = ("labels", "descriptions", "aliases", "claims", "sitelinks")


def entity_fingerprint(entity: dict[str, Any]) -> str:
    """Return a stable content hash for *entity* (SHA-256 hex).

    Hashes a canonical JSON projection of the :data:`_CONTENT_KEYS` — sorted keys,
    no incidental whitespace — so two dicts carrying the same knowledge hash
    identically regardless of key order or serialisation, while any change to a
    label, claim, qualifier, or sitelink flips the hash.
    """
    payload = {key: entity.get(key) for key in _CONTENT_KEYS}
    canonical = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def fingerprint_dump(path: Path | str) -> dict[str, str]:
    """Stream the dump at *path* into a ``{qid: content fingerprint}`` map.

    Memory is bounded by the map (one short hash per entity), not the dump: the
    reader yields one entity at a time. A later duplicate id overwrites an earlier
    one, matching the reader's last-wins semantics.
    """
    return {entity["id"]: entity_fingerprint(entity) for entity in iter_entities(path)}


@dataclass(frozen=True)
class DumpDiff:
    """The QID-keyed delta between an old and a new dump slice.

    Attributes:
        added: QIDs present in the new slice but not the old, sorted.
        changed: QIDs present in both whose content fingerprint differs, sorted.
        removed: QIDs present in the old slice but not the new, sorted.
        unchanged: Count of QIDs present in both with an identical fingerprint.
    """

    added: tuple[str, ...]
    changed: tuple[str, ...]
    removed: tuple[str, ...]
    unchanged: int

    @property
    def upsert_qids(self) -> tuple[str, ...]:
        """The QIDs to re-hydrate and re-export: everything added or changed."""
        return tuple(sorted(set(self.added) | set(self.changed)))

    @property
    def has_changes(self) -> bool:
        """Whether anything was added, changed, or removed."""
        return bool(self.added or self.changed or self.removed)

    @property
    def summary(self) -> str:
        """A one-line gloss of the delta."""
        return (
            f"{len(self.added)} added, {len(self.changed)} changed, "
            f"{len(self.removed)} removed, {self.unchanged} unchanged"
        )


def diff_dumps(old_path: Path | str, new_path: Path | str) -> DumpDiff:
    """Diff the slice at *new_path* against the one at *old_path*, keyed on QID.

    Returns a :class:`DumpDiff` classifying every QID as added / changed / removed
    / unchanged by comparing content fingerprints (:func:`entity_fingerprint`).
    """
    old = fingerprint_dump(old_path)
    new = fingerprint_dump(new_path)
    old_ids, new_ids = old.keys(), new.keys()
    both = old_ids & new_ids
    added = sorted(new_ids - old_ids)
    removed = sorted(old_ids - new_ids)
    changed = sorted(qid for qid in both if old[qid] != new[qid])
    return DumpDiff(
        added=tuple(added),
        changed=tuple(changed),
        removed=tuple(removed),
        unchanged=len(both) - len(changed),
    )


def write_delta_dump(
    new_path: Path | str, qids: Iterable[str], out_path: Path | str
) -> int:
    """Write the entities of *qids* from *new_path* into a delta dump at *out_path*.

    Streams the new slice and keeps only the requested QIDs, writing them in the
    exact ``latest-all`` framing :func:`~culturescrape.acquire.wikidata_dump.
    iter_entities` reads (compression by extension). Returns the number of entities
    written — which can be fewer than ``len(qids)`` if a requested QID is absent
    from the new slice (a *removed* entity should never be requested here).
    """
    wanted = frozenset(qids)
    entities = (
        entity for entity in iter_entities(new_path) if entity["id"] in wanted
    )
    return write_dump(entities, out_path)


__all__ = [
    "DumpDiff",
    "diff_dumps",
    "entity_fingerprint",
    "fingerprint_dump",
    "write_delta_dump",
]
