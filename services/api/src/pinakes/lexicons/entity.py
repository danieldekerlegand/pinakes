"""Canonical per-entity URLs — `server/services/entity-resolver.ts`, ported.

Every major entity type has ONE permanent URL, `/entity/<domain>/<id>`,
independent of whichever view happens to render it. This module is the pure
system-of-record for that scheme — the domain registry, the id ⇄ path mapping,
and the descriptor a resolution answers with — plus the per-domain corpus
fetchers that were the route file's half of it (:data:`FETCHERS`).

Three things are contract rather than convenience:

* **The domain keys are singular and app-native**, matching the storage
  vocabulary — but ``citationDomain`` is **plural** and different
  (`deity` → `deities`). A client that passed `domain` to `/api/citations`
  would 404 on every one of the four citable domains.
* **The graph `entityType` is not the domain.** Both `civilization` and
  `culture-profile` mint `cs:culture:<id>`, and an archaeological site mints
  `cs:place:<id>`, because the csid names the canonical *node* type the shared
  graph uses — that is what lets a collection item and a graph node line up.
* **A record is fetched for four fields and no more** (id, name, region, year).
  The full record is `/api/summaries/<domain>/<id>`'s job; a resolution is a
  redirect target with enough on it to render a landing card.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import quote, unquote

from pinakes.lexicons import storage

#: The client route stem every canonical entity URL shares.
CANONICAL_ENTITY_PREFIX = "/entity"

#: The canonical path template, for self-documenting contracts. Express-style
#: `:param` because it is a *client* route, not a server one.
CANONICAL_PATH_TEMPLATE = f"{CANONICAL_ENTITY_PREFIX}/:domain/:id"


class EntityDomainSpec(NamedTuple):
    """One entity domain's routing metadata."""

    label: str
    """Human label, e.g. ``"Civilization"``."""

    entity_type: str
    """Canonical graph node type for the ``cs:<type>:<id>`` stable id."""

    citation_domain: str | None = None
    """The `/api/citations` segment when citable — ``None`` means not citable."""

    view_path: Callable[[str], str] | None = None
    """A richer id-specific view when the domain has a real detail page."""

    @property
    def citable(self) -> bool:
        return self.citation_domain is not None


#: The entity domains that own a canonical URL, in registry order — which is the
#: order `GET /api/entities` lists them in.
ENTITY_DOMAINS: dict[str, EntityDomainSpec] = {
    "language": EntityDomainSpec("Language", "language"),
    "language-family": EntityDomainSpec("Language Family", "language-family"),
    "civilization": EntityDomainSpec("Civilization", "culture", "civilizations"),
    "culture-profile": EntityDomainSpec(
        "Culture Profile",
        "culture",
        "culture-profiles",
        lambda identifier: f"/culture-profile/{quote(identifier, safe='')}/report",
    ),
    "archaeological-site": EntityDomainSpec(
        "Archaeological Site", "place", "archaeological-sites"
    ),
    "deity": EntityDomainSpec("Deity", "deity", "deities"),
    "religion": EntityDomainSpec("Religion", "religion"),
    "cuisine": EntityDomainSpec("Cuisine", "cuisine"),
    "trade-good": EntityDomainSpec("Trade Good", "trade-good"),
    "writing-system": EntityDomainSpec("Writing System", "writing-system"),
    "battle": EntityDomainSpec("Battle", "battle"),
    "urheimat-hypothesis": EntityDomainSpec(
        "Urheimat Hypothesis", "urheimat-hypothesis"
    ),
}


def entity_domains() -> list[str]:
    """Every supported entity domain, in registry order."""
    return list(ENTITY_DOMAINS)


def is_entity_domain(value: object) -> bool:
    """Is *value* a known entity domain?"""
    return isinstance(value, str) and value in ENTITY_DOMAINS


def canonical_entity_path(domain: str, identifier: str) -> str:
    """``/entity/<domain>/<id>`` — the permanent, view-independent path.

    The id is percent-encoded with **no safe characters**, matching
    `encodeURIComponent`, so an id containing a slash still round-trips through
    :func:`parse_canonical_entity_path`.
    """
    return f"{CANONICAL_ENTITY_PREFIX}/{domain}/{quote(identifier, safe='')}"


def entity_api_path(domain: str, identifier: str) -> str:
    """The JSON resolver endpoint for an entity."""
    return f"/api/entity/{domain}/{quote(identifier, safe='')}"


def stable_entity_id(domain: str, identifier: str) -> str:
    """``cs:<entityType>:<id>`` — the same csid the shared graph mints."""
    return f"cs:{ENTITY_DOMAINS[domain].entity_type}:{identifier}"


_ORIGIN = re.compile(r"^[a-z][a-z0-9+.-]*://[^/]+", re.IGNORECASE)
_CANONICAL = re.compile(r"^/entity/([^/]+)/([^/]+)/?$")


def parse_canonical_entity_path(path: str) -> tuple[str, str] | None:
    """``/entity/<domain>/<id>`` → ``(domain, id)``, or ``None``.

    Tolerates a leading origin, a trailing slash and a query/hash. Returns
    ``None`` — never raises — for an unknown domain, the wrong shape, or an
    empty id, so a caller can 404 gracefully.
    """
    if not isinstance(path, str) or not path:
        return None
    rest = _ORIGIN.sub("", path)
    rest = re.split(r"[?#]", rest)[0]
    match = _CANONICAL.match(rest)
    if match is None:
        return None
    domain = match.group(1)
    if domain not in ENTITY_DOMAINS:
        return None
    identifier = unquote(match.group(2))
    if not identifier:
        return None
    return domain, identifier


@dataclass(frozen=True, slots=True)
class EntityRecordLite:
    """The minimal record a domain fetcher yields, before URL normalization."""

    id: str
    name: str
    region: str | None = None
    year: float | int | None = None


def describe_entity(
    domain: str, record: EntityRecordLite, origin: str = ""
) -> dict[str, Any]:
    """The descriptor `GET /api/entity/<domain>/<id>` answers with."""
    spec = ENTITY_DOMAINS[domain]
    path = canonical_entity_path(domain, record.id)
    return {
        "domain": domain,
        "id": record.id,
        "name": record.name,
        "entityType": spec.entity_type,
        "label": spec.label,
        "stableId": stable_entity_id(domain, record.id),
        "canonicalPath": path,
        "canonicalUrl": f"{origin}{path}" if origin else path,
        "apiPath": entity_api_path(domain, record.id),
        "citable": spec.citable,
        "citationDomain": spec.citation_domain,
        "viewPath": spec.view_path(record.id) if spec.view_path else None,
        "region": record.region,
        "year": record.year,
    }


# ── The per-domain fetchers ──────────────────────────────────────────────────
#
# `defaultFetchers()` in `server/routes/entity-resolver.ts`. Each reads one
# corpus table and projects the four descriptor fields off the row. The flat
# domains read their fields directly; the two GeoJSON ones read `.properties`
# under a type-specific id key — the same normalization boundary
# `pinakes.collab.citable` crosses.

Fetcher = Callable[[str, Path], EntityRecordLite | None]


def _text(record: storage.Record, key: str) -> str | None:
    """A display string, or ``None`` when it is absent or blank.

    ``typeof value === "string" && value.length > 0``: a blank region reads as
    no region, not as an empty one.
    """
    value = record.get(key)
    return value if isinstance(value, str) and value else None


def _year(record: storage.Record, key: str) -> float | int | None:
    """A finite number, or ``None``. Booleans are not numbers, in either language."""
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _name(record: storage.Record, identifier: str, *keys: str) -> str:
    """The first name field the record *has*, falling back to the id.

    Nullish (``??``), not truthy: a row that declares a blank name keeps it.
    `UrheimatHypothesis` calls its display field `hypothesisName`, so the caller
    passes the keys in the order the TypeScript coalesced them.
    """
    for key in keys:
        value = record.get(key)
        if value is not None:
            return str(value)
    return identifier


def _flat(
    load: Callable[[Path], list[storage.Record]],
    *,
    region: str | None = None,
    year: str | None = None,
    name: tuple[str, ...] = ("name",),
) -> Fetcher:
    """A fetcher over a flat table: find the row by id, project four fields."""

    def fetch(identifier: str, lexicons: Path) -> EntityRecordLite | None:
        record = storage.find_by_id(load(lexicons), identifier)
        if record is None:
            return None
        return EntityRecordLite(
            id=str(record.get("id") or identifier),
            name=_name(record, identifier, *name),
            region=_text(record, region) if region else None,
            year=_year(record, year) if year else None,
        )

    return fetch


def _feature(
    load: Callable[[Path], list[storage.Feature]], id_key: str
) -> Fetcher:
    """A fetcher over a GeoJSON layer, keyed on a property rather than `id`."""

    def fetch(identifier: str, lexicons: Path) -> EntityRecordLite | None:
        for feature in load(lexicons):
            properties = feature.get("properties") or {}
            if properties.get(id_key) != identifier:
                continue
            period = properties.get("timePeriod") or {}
            return EntityRecordLite(
                id=identifier,
                name=str(properties.get("name") or ""),
                year=_year(period, "start"),
            )
        return None

    return fetch


#: Domain → the fetcher that resolves an id against the corpus.
FETCHERS: dict[str, Fetcher] = {
    "language": _flat(storage.load_languages, region="region"),
    "language-family": _flat(storage.load_language_families),
    "civilization": _feature(storage.load_civilizations, "civilizationId"),
    "culture-profile": _flat(
        storage.load_culture_profiles, region="region", year="timePeriodStart"
    ),
    "archaeological-site": _feature(storage.load_archaeological_sites, "siteId"),
    "deity": _flat(storage.load_deities, region="mythology", year="timeOrigin"),
    # No region — and that is the TypeScript, not an omission. The religion
    # fetcher reads `region`, which a `Religion` record does not have (it calls
    # the field `originRegion`), so every religion has always resolved with a
    # null region. Reproduced rather than fixed: correcting it here would make
    # the two backends disagree mid-cutover about the same entity.
    "religion": _flat(storage.load_religions),
    "cuisine": _flat(storage.load_cuisines, region="region"),
    "trade-good": _flat(storage.load_trade_goods),
    "writing-system": _flat(storage.load_writing_systems),
    "battle": _flat(storage.load_battles),
    "urheimat-hypothesis": _flat(
        storage.load_urheimat_hypotheses,
        region="proposedRegion",
        name=("hypothesisName", "name"),
    ),
}
