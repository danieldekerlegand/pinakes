"""Culture stewardship — the "adopt a culture" ownership model.

The port of `server/services/stewardship.ts`. A steward claims a **cultural
domain** (a culture id, a region, or an entity type) and thereby carries extra
weight in the multi-confirmation flow: a steward of a contribution's domain can
verify it single-handedly, where three unrelated reviewers would otherwise be
needed.

Two things distinguish this store from its neighbours in :mod:`pinakes.collab`:

* **One file, not one per record.** Every adoption lives in a single
  `stewards.json` array, because the whole set is read on every question anyone
  asks of it ("is this reviewer a steward of that domain?") and it is small. The
  JSON-per-record :class:`~pinakes.collab.entities.RecordStore` would buy
  nothing here.
* **A record is identified by a pair, not an id.** ``(steward, domain)`` is the
  key: adopting is idempotent on it, and releasing is a filter over it. Steward
  identity compares case-insensitively (`stewardKey`) while the *stored* name
  keeps its original casing, so "Expert" and "expert" are one steward and the
  attribution still reads the way they typed it.

Every rule is a pure function over a list of adoptions, taking ``now`` as an
argument; :class:`StewardshipStore` only supplies the filesystem and the clock.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, NamedTuple

from pinakes.contributions.store import iso_now
from pinakes.paths import stewardship_dir

#: One adoption, as it is stored and served. A plain dict for the same reason
#: the other collaborative records are: the on-disk shape is the TypeScript
#: writer's, and both servers read this file during the cutover.
Adoption = dict[str, Any]

#: The single file every adoption lives in, under the stewardship directory.
STEWARDS_FILE = "stewards.json"

_SEPARATORS = re.compile(r"[\s_]+")
_DISALLOWED = re.compile(r"[^a-z0-9-]")
_RUNS = re.compile(r"-+")


def normalize_domain(domain: str) -> str:
    """A domain string reduced to its stable key: lowercase kebab.

    "Roman Empire", "roman_empire" and "  ROMAN-EMPIRE  " are one domain. The
    normalized form is what is *stored*, so a claim made under one spelling is
    found under any of them.
    """
    text = _SEPARATORS.sub("-", domain.strip().lower())
    text = _DISALLOWED.sub("", text)
    return _RUNS.sub("-", text).strip("-")


def steward_key(steward: str) -> str:
    """A steward name reduced for identity comparison. Never stored."""
    return steward.strip().lower()


def _same(adoption: Adoption, steward: str, domain: str) -> bool:
    """Is *adoption* this steward's claim on this domain?"""
    return steward_key(str(adoption.get("steward", ""))) == steward_key(
        steward
    ) and adoption.get("domain") == normalize_domain(domain)


class AdoptResult(NamedTuple):
    """The outcome of an adoption: what to persist, and what to answer with."""

    adoptions: list[Adoption]
    adoption: Adoption
    already_owned: bool


def adopt_domain(
    adoptions: list[Adoption],
    *,
    steward: str,
    domain: str,
    now: str,
    note: str | None = None,
) -> AdoptResult:
    """Claim a domain for a steward. Pure.

    **Idempotent**: re-adopting an owned domain returns the *existing* adoption
    with ``already_owned`` set and the list untouched, so a double-click does not
    mint a second claim with a later `adoptedAt`.
    """
    normalized = normalize_domain(domain)
    for existing in adoptions:
        if _same(existing, steward, normalized):
            return AdoptResult(adoptions, existing, True)

    adoption: Adoption = {
        "steward": steward.strip(),
        "domain": normalized,
        "adoptedAt": now,
    }
    # Absent, not null: `JSON.stringify` writes no key for the `undefined` the
    # TypeScript builder leaves, and both servers read this file.
    if note is not None:
        adoption["note"] = note
    return AdoptResult([*adoptions, adoption], adoption, False)


def release_domain(
    adoptions: list[Adoption], steward: str, domain: str
) -> tuple[list[Adoption], bool]:
    """Drop a steward's claim on a domain. Returns the list and whether it moved."""
    remaining = [a for a in adoptions if not _same(a, steward, domain)]
    return remaining, len(remaining) != len(adoptions)


def stewards_for_domain(adoptions: list[Adoption], domain: str) -> list[str]:
    """Steward names holding *domain*, in their original casing."""
    key = normalize_domain(domain)
    return [str(a["steward"]) for a in adoptions if a.get("domain") == key]


def domains_for_steward(adoptions: list[Adoption], steward: str) -> list[str]:
    """Normalized domains a steward holds."""
    key = steward_key(steward)
    return [
        str(a["domain"])
        for a in adoptions
        if steward_key(str(a.get("steward", ""))) == key
    ]


def is_steward_of(adoptions: list[Adoption], steward: str, domain: str) -> bool:
    """Does this steward hold this domain? The question the confirm flow asks."""
    return any(_same(a, steward, domain) for a in adoptions)


class StewardshipStore:
    """The filesystem half: one `stewards.json` under an injectable directory."""

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self.file = self.directory / STEWARDS_FILE

    def read(self) -> list[Adoption]:
        """Every adoption. A missing, unparseable or non-array file is empty.

        Unlike the JSON-per-record stores this **swallows** a malformed file,
        because the TypeScript did: a broken `stewards.json` degrades to "nobody
        is a steward", which costs a steward their shortcut rather than costing
        every reviewer the endpoint. Losing a *collection* silently would be
        worse than a 500; losing a claim that can be re-made is not.
        """
        if not self.file.is_file():
            return []
        try:
            parsed = json.loads(self.file.read_text(encoding="utf-8"))
        except ValueError:
            return []
        return parsed if isinstance(parsed, list) else []

    def _write(self, adoptions: list[Adoption]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(adoptions, indent=2), encoding="utf-8")

    def list_all(self) -> list[Adoption]:
        """Every adoption, in the order they were made."""
        return self.read()

    def list_for_domain(self, domain: str) -> list[Adoption]:
        """Adoptions of one domain, matched on its normalized key."""
        key = normalize_domain(domain)
        return [a for a in self.read() if a.get("domain") == key]

    def adopt(
        self,
        *,
        steward: str,
        domain: str,
        note: str | None = None,
        now: str | None = None,
    ) -> AdoptResult:
        """Claim a domain, persisting only when something actually changed."""
        result = adopt_domain(
            self.read(),
            steward=steward,
            domain=domain,
            note=note,
            now=now if now is not None else iso_now(),
        )
        if not result.already_owned:
            self._write(result.adoptions)
        return result

    def release(self, steward: str, domain: str) -> bool:
        """Drop a claim. Returns whether there was one to drop."""
        remaining, released = release_domain(self.read(), steward, domain)
        if released:
            self._write(remaining)
        return released

    def is_steward(self, steward: str, domain: str) -> bool:
        return is_steward_of(self.read(), steward, domain)


def store(directory: Path | None = None) -> StewardshipStore:
    """The stewardship store this process serves.

    Built per call from :func:`pinakes.paths.stewardship_dir`, which re-reads its
    environment override every time — the same no-singleton rule the rest of the
    service follows, and for the same two reasons: Express still reads this file
    for the confirm flow, and a test redirects it by setting one variable.
    """
    return StewardshipStore(
        directory if directory is not None else stewardship_dir()
    )
