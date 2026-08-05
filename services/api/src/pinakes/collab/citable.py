"""Where a citable entity comes from: the four corpus domains that carry sources.

The port of `defaultFetchers()` in `server/routes/citations.ts`. Each fetcher
resolves an id against one lexicon TSV and returns a normalized
:class:`~pinakes.collab.citations.CitableEntity`, or ``None`` when the corpus has
no such row.

This is **not** the corpus storage layer. `server/tsv-storage.ts` parses ~60
files into fully-typed records; what a citation needs is five fields
(id, name, sources, year, region), so this module reads only the columns those
five come from, only for the four domains that have any sources to cite. The
general reader is its own port unit (`tasks/chief/63-port-entity-search.json`)
and this file is deliberately not a head start on it.

Two shapes of the TypeScript are reproduced rather than tidied, because they are
observable through the API:

* **Civilizations fall back to the boundary row for their year, and to 0.**
  A civilization with a blank `time_period_start` cites year 0, not no year —
  and `civilization-boundaries.tsv` is consulted first. Dropping either would
  change what a downloaded `.bib` says.
* **A site with no parseable coordinates does not exist.** `loadArchaeological
  Sites` filters those rows out before anything can find them, so their
  citations are a 404. That is a real (if odd) part of the contract.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, NamedTuple

from pinakes.collab.citations import CitableEntity, parse_entity_sources

_LINES = re.compile(r"\r?\n")


class MissingColumnError(RuntimeError):
    """A lexicon file is missing a column the reader requires.

    The TypeScript's `getIdx` threw here and the route answered 500; a corpus
    that has lost its `id` column is broken, not empty, and saying so is more
    useful than a 404 that reads like "no such entity".
    """


class CitationDomain(NamedTuple):
    """One citable domain: how to fetch it, and its stem in the client's URLs."""

    #: The client route stem the entity's canonical URL is built from — note it
    #: is **singular** where the domain key is plural (`deities` → `deity`).
    url_path: str
    fetch: Callable[[str, Path], CitableEntity | None]


# ── TSV reading, as `server/tsv-storage.ts` does it ──────────────────────────


def _read(lexicons: Path, filename: str) -> str | None:
    """A lexicon file's text, or ``None`` when it is not there.

    An absent file is an empty domain (every lookup 404s), never an error — the
    same `readFileIfExists` contract the TypeScript loaders were built on.
    """
    path = Path(lexicons) / filename
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def _parse_tsv(text: str) -> tuple[list[str], list[list[str]]]:
    """Split a TSV into its header and rows. Blank lines are dropped."""
    lines = [line for line in _LINES.split(text) if line.strip() != ""]
    if not lines:
        return [""], []
    return lines[0].split("\t"), [line.split("\t") for line in lines[1:]]


def _index(header: list[str], name: str) -> int:
    """A column's position, or ``-1``. For columns that may legitimately be absent."""
    return header.index(name) if name in header else -1


def _required(header: list[str], name: str) -> int:
    """A column's position, or raise. For the columns a record cannot do without."""
    position = _index(header, name)
    if position < 0:
        raise MissingColumnError(f"Missing column '{name}' in TSV header")
    return position


def _cell(row: list[str], index: int) -> str:
    """One cell. A short row reads as blank rather than raising.

    JavaScript hands back `undefined` for the same read, which is falsy
    everywhere the loaders test it — so blank is the same answer everywhere it
    is *tested*, and a defined answer where the TypeScript would have carried an
    `undefined` into a template string.
    """
    return row[index] if 0 <= index < len(row) else ""


def _array_cell(row: list[str], index: int) -> Any:
    """A JSON-array cell. Blank or unparseable is an empty list."""
    raw = _cell(row, index)
    if index < 0 or not raw:
        return []
    try:
        return json.loads(raw)
    except ValueError:
        return []


def _year(row: list[str], index: int) -> int | None:
    """A year column. Blank, the literal ``"null"``, or non-numeric is no year.

    The TypeScript's `parseInt` would yield `NaN` for a non-numeric cell and
    render it into the citation as the literal `NaN`; treating it as absent is
    the one deliberate deviation here, and no corpus row exercises it.
    """
    raw = _cell(row, index)
    if index < 0 or not raw or raw == "null":
        return None
    match = re.match(r"\s*[+-]?\d+", raw)
    return int(match.group(0)) if match else None


def _find(rows: list[list[str]], index: int, wanted: str) -> list[str] | None:
    """The first row whose *index* cell equals *wanted*."""
    for row in rows:
        if _cell(row, index) == wanted:
            return row
    return None


# ── The four fetchers ────────────────────────────────────────────────────────


def fetch_culture_profile(entity_id: str, lexicons: Path) -> CitableEntity | None:
    text = _read(lexicons, "culture-profiles.tsv")
    if text is None:
        return None
    header, rows = _parse_tsv(text)
    id_index = _required(header, "id")
    name_index = _required(header, "name")
    row = _find(rows, id_index, entity_id)
    if row is None:
        return None
    return CitableEntity(
        entity_type="culture-profile",
        id=_cell(row, id_index),
        name=_cell(row, name_index),
        sources=parse_entity_sources(_array_cell(row, _index(header, "sources"))),
        year=_year(row, _index(header, "time_period_start")),
        region=_cell(row, _index(header, "region")),
    )


def _boundary_years(text: str | None) -> dict[str, int]:
    """Each civilization's start year according to `civilization-boundaries.tsv`.

    Only rows carrying a parseable `geometry` count, because that is the filter
    the boundary loader applies before it records anything — a boundary row with
    no shape is not a boundary. A later row for the same civilization wins.
    """
    if text is None:
        return {}
    header, rows = _parse_tsv(text)
    civ_index = _required(header, "civilization_id")
    geometry_index = _required(header, "geometry")
    start_index = _index(header, "time_period_start")

    starts: dict[str, int] = {}
    for row in rows:
        geometry = _cell(row, geometry_index)
        if not geometry:
            continue
        try:
            json.loads(geometry)
        except ValueError:
            continue
        start = _year(row, start_index)
        starts[_cell(row, civ_index)] = start if start is not None else 0
    return starts


def fetch_civilization(entity_id: str, lexicons: Path) -> CitableEntity | None:
    civilizations = _read(lexicons, "civilizations.tsv")
    boundaries = _read(lexicons, "civilization-boundaries.tsv")
    if civilizations is None and boundaries is None:
        return None
    starts = _boundary_years(boundaries)
    if civilizations is None:
        return None

    header, rows = _parse_tsv(civilizations)
    id_index = _required(header, "id")
    name_index = _required(header, "name")
    row = _find(rows, id_index, entity_id)
    if row is None:
        return None

    start = _year(row, _index(header, "time_period_start"))
    return CitableEntity(
        entity_type="civilization",
        id=_cell(row, id_index),
        name=_cell(row, name_index),
        sources=parse_entity_sources(_array_cell(row, _index(header, "sources"))),
        # Not `None`: an undated civilization cites year 0, because the loader
        # this is read off defaults its time period to zero rather than leaving
        # it unset.
        year=start if start is not None else starts.get(entity_id, 0),
        region=None,
    )


def fetch_deity(entity_id: str, lexicons: Path) -> CitableEntity | None:
    text = _read(lexicons, "deities.tsv")
    if text is None:
        return None
    header, rows = _parse_tsv(text)
    id_index = _required(header, "id")
    name_index = _required(header, "name")
    row = _find(rows, id_index, entity_id)
    if row is None:
        return None

    # `mythology`, else the older `pantheon` spelling — both are live in the
    # corpus and the loader reads whichever it finds.
    mythology_index = _index(header, "mythology")
    if mythology_index < 0:
        mythology_index = _index(header, "pantheon")

    return CitableEntity(
        entity_type="deity",
        id=_cell(row, id_index),
        name=_cell(row, name_index),
        sources=parse_entity_sources(_array_cell(row, _index(header, "sources"))),
        year=_year(row, _index(header, "time_origin")),
        # A deity's "region" is its mythology — the pantheon it belongs to says
        # more about where it was worshipped than any coordinate would.
        region=_cell(row, mythology_index),
    )


def fetch_archaeological_site(entity_id: str, lexicons: Path) -> CitableEntity | None:
    text = _read(lexicons, "archaeological-sites.tsv")
    if text is None:
        return None
    header, rows = _parse_tsv(text)
    id_index = _required(header, "id")
    name_index = _required(header, "name")
    coordinates_index = _required(header, "coordinates")
    _required(header, "site_type")

    row = _find(rows, id_index, entity_id)
    if row is None:
        return None
    coordinates = _cell(row, coordinates_index).strip()
    if not coordinates:
        return None
    try:
        json.loads(coordinates)
    except ValueError:
        return None

    start = _year(row, _index(header, "time_period_start"))
    return CitableEntity(
        entity_type="archaeological-site",
        id=_cell(row, id_index),
        name=_cell(row, name_index),
        sources=parse_entity_sources(_array_cell(row, _index(header, "sources"))),
        year=start if start is not None else 0,
        region=None,
    )


#: The citable domains, in the order `GET /api/citations` lists them. The keys
#: are **plural** and differ from the singular entity-domain names used by
#: `/api/entity/...`; the client passes `citationDomain`, not `domain`.
DOMAINS: dict[str, CitationDomain] = {
    "culture-profiles": CitationDomain("culture-profile", fetch_culture_profile),
    "civilizations": CitationDomain("civilization", fetch_civilization),
    "deities": CitationDomain("deity", fetch_deity),
    "archaeological-sites": CitationDomain(
        "archaeological-site", fetch_archaeological_site
    ),
}
