"""Citation export — an entity's `sources[]` rendered as BibTeX, RIS or CSL-JSON.

The port of `server/services/citation-export.ts`, and pure in the same way: a
normalized :class:`CitableEntity` in, text out. Where the entity comes from is
:mod:`pinakes.collab.citable`'s problem; streaming it is
:mod:`pinakes.routers.citations`'.

Two properties of the corpus shape the whole module:

* **Source strings are free text.** A cell may be `"Kuijt 2002"`, a bare
  descriptor like `"Archaeological evidence"`, or a URL. :func:`parse_source_string`
  recovers an author/year/url where it can and falls back to a title-only entry —
  it **never drops a source**, because a citation that quietly omits half its
  provenance is worse than an untidy one.
* **An entity may have no sources at all.** Every export therefore leads with a
  *record entry* citing the pinakes record itself, so the answer is always a
  usable citation rather than an empty document.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Literal, NamedTuple

CitationFormat = Literal["bibtex", "ris", "csljson"]

#: Every supported format, in the order the index endpoint lists them.
CITATION_FORMATS: tuple[str, ...] = ("bibtex", "ris", "csljson")

#: What a record entry attributes to — this dataset, not an outside author.
DATASET_PUBLISHER = "pinakes cultural dataset"

_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)

#: A trailing " 2002" / " (2002)" style year at the END of a citation. The
#: leading `[\s(]` is what stops it eating the last four digits of a title.
_TRAILING_YEAR = re.compile(r"[\s(](\d{3,4})\)?\s*$")

_NON_SLUG = re.compile(r"[^a-z0-9]+")
_SLUG_EDGES = re.compile(r"^-+|-+$")
_SLUG_RUNS = re.compile(r"-{2,}")
_BIBTEX_SPECIALS = re.compile(r"([&%$#_])")
_BIBTEX_BRACES = re.compile(r"[{}]")
_TRAILING_PUNCTUATION = re.compile(r"[,(]\s*$")


@dataclass
class CitableEntity:
    """A format-agnostic view of anything citable.

    The fetchers build one of these out of whichever corpus row they read, so
    nothing below has to know that a civilization keeps its id under
    `properties.civilizationId` and a culture profile keeps its under `id`.
    """

    entity_type: str
    id: str
    name: str
    sources: list[str] = field(default_factory=list)
    #: A representative year for the record; negative is BCE.
    year: int | None = None
    region: str | None = None
    #: Canonical URL, when the caller can build one from the request origin.
    url: str | None = None


class ParsedSource(NamedTuple):
    """One free-text source string, parsed into whatever it gave up."""

    raw: str
    title: str
    author: str | None = None
    year: int | None = None
    url: str | None = None


class CitationRender(NamedTuple):
    """A rendered citation plus the HTTP metadata for its download response."""

    format: str
    content: str
    content_type: str
    filename: str


_FORMAT_META: dict[str, tuple[str, str]] = {
    "bibtex": ("bib", "application/x-bibtex; charset=utf-8"),
    "ris": ("ris", "application/x-research-info-systems; charset=utf-8"),
    "csljson": ("json", "application/vnd.citationstyles.csl+json; charset=utf-8"),
}


def is_citation_format(value: Any) -> bool:
    """Is *value* a format this module can emit? Anything else is a 400."""
    return isinstance(value, str) and value in CITATION_FORMATS


def parse_entity_sources(raw: Any) -> list[str]:
    """Coerce a raw `sources` cell to a list of strings. Never raises.

    Three shapes reach this: a real list (the parsed corpus row), a JSON-array
    string (a raw TSV cell), or a single bare string. Anything else is no
    sources — but note that a *string* that merely looks like it starts an array
    and does not parse is kept whole rather than discarded.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return [s.strip() for s in raw if isinstance(s, str) and s.strip() != ""]
    if isinstance(raw, str):
        value = raw.strip()
        if value == "":
            return []
        if value.startswith("["):
            try:
                parsed = json.loads(value)
            except ValueError:
                return [value]
            if isinstance(parsed, list):
                return parse_entity_sources(parsed)
        return [value]
    return []


def parse_source_string(raw: str) -> ParsedSource:
    """Recover author / year / url from one free-text source string."""
    trimmed = raw.strip()
    url_match = _URL_PATTERN.search(trimmed)
    url = url_match.group(0) if url_match else None

    year_match = _TRAILING_YEAR.search(trimmed)
    if year_match is not None:
        year = int(year_match.group(1))
        # Only a plausible year is a year — otherwise a trailing quantity
        # ("Sherds 100") would be read as a publication date.
        if 100 <= year <= 2100:
            author = _TRAILING_PUNCTUATION.sub(
                "", trimmed[: year_match.start()].strip()
            ).strip()
            if author != "":
                return ParsedSource(
                    raw=trimmed, title=author, author=author, year=year, url=url
                )
            return ParsedSource(raw=trimmed, title=trimmed, year=year, url=url)
    return ParsedSource(raw=trimmed, title=trimmed, url=url)


def _slug(text: str) -> str:
    """Lowercase kebab, safe as a BibTeX / RIS citation key."""
    return _SLUG_RUNS.sub("-", _SLUG_EDGES.sub("", _NON_SLUG.sub("-", text.lower())))


def _escape_bibtex(value: str) -> str:
    """Escape the TeX specials a corpus string can plausibly carry."""
    return _BIBTEX_BRACES.sub("", _BIBTEX_SPECIALS.sub(r"\\\1", value))


def record_cite_key(entity: CitableEntity) -> str:
    """The citation key of the record entry — stable across exports."""
    return _slug(f"pinakes-{entity.entity_type}-{entity.id}") or "pinakes-record"


def _build_keys(entity: CitableEntity, sources: list[ParsedSource]) -> list[str]:
    """Ordered, de-duplicated keys: the record entry first, then one per source.

    An author+year key reads naturally (`minoan-kuijt-2002`); a collision or an
    untitled source falls back to an index suffix, so two sources by the same
    author in the same year still get distinct keys.
    """
    used: set[str] = set()

    def take(candidate: str, fallback: str) -> str:
        key = candidate or fallback
        if key in used:
            index = 2
            while f"{key}-{index}" in used:
                index += 1
            key = f"{key}-{index}"
        used.add(key)
        return key

    keys = [take(record_cite_key(entity), "pinakes-record")]
    stem = _slug(entity.id) or _slug(entity.name) or "source"
    for position, source in enumerate(sources):
        parts = [
            part
            for part in (
                stem,
                _slug(source.author) if source.author else "",
                str(source.year) if source.year else "",
            )
            if part
        ]
        keys.append(take(_slug("-".join(parts)), f"{stem}-source-{position + 1}"))
    return keys


def _record_note(entity: CitableEntity) -> str:
    """The one-line descriptor the record entry carries as its note."""
    bits = [f"pinakes {entity.entity_type.replace('-', ' ')} record"]
    if entity.region:
        bits.append(f"region: {entity.region}")
    return "; ".join(bits)


def entity_to_bibtex(entity: CitableEntity) -> str:
    """A BibTeX document: the record entry, then one `@misc` per source."""
    sources = [parse_source_string(s) for s in entity.sources]
    keys = _build_keys(entity, sources)

    record_fields = [
        f"  title = {{{_escape_bibtex(entity.name)}}}",
        f"  howpublished = {{{_escape_bibtex(DATASET_PUBLISHER)}}}",
    ]
    if entity.year is not None:
        record_fields.append(f"  year = {{{entity.year}}}")
    if entity.url:
        record_fields.append(f"  url = {{{entity.url}}}")
    record_fields.append(f"  note = {{{_escape_bibtex(_record_note(entity))}}}")
    entries = ["@misc{" + keys[0] + ",\n" + ",\n".join(record_fields) + "\n}"]

    for position, source in enumerate(sources):
        fields = []
        if source.author:
            fields.append(f"  author = {{{_escape_bibtex(source.author)}}}")
        fields.append(f"  title = {{{_escape_bibtex(source.title)}}}")
        if source.year:
            fields.append(f"  year = {{{source.year}}}")
        if source.url:
            fields.append(f"  url = {{{source.url}}}")
        fields.append(
            f"  note = {{{_escape_bibtex(f'Source cited for {entity.name}')}}}"
        )
        entries.append(
            "@misc{" + keys[position + 1] + ",\n" + ",\n".join(fields) + "\n}"
        )

    return "\n\n".join(entries) + "\n"


def entity_to_ris(entity: CitableEntity) -> str:
    """An RIS document. The record is a `DATA` type; each source is `GEN`."""
    sources = [parse_source_string(s) for s in entity.sources]

    record = ["TY  - DATA", f"TI  - {entity.name}", f"PB  - {DATASET_PUBLISHER}"]
    if entity.year is not None:
        record.append(f"PY  - {entity.year}")
    if entity.url:
        record.append(f"UR  - {entity.url}")
    record.extend([f"N1  - {_record_note(entity)}", "ER  - "])
    records = ["\n".join(record)]

    for source in sources:
        lines = ["TY  - GEN"]
        if source.author:
            lines.append(f"AU  - {source.author}")
        lines.append(f"TI  - {source.title}")
        if source.year:
            lines.append(f"PY  - {source.year}")
        if source.url:
            lines.append(f"UR  - {source.url}")
        lines.extend([f"N1  - Source cited for {entity.name}", "ER  - "])
        records.append("\n".join(lines))

    return "\n\n".join(records) + "\n"


def entity_to_csl_items(entity: CitableEntity) -> list[dict[str, Any]]:
    """CSL-JSON items: the record item, then one per source. Key order is the
    TypeScript's, because this document is compared against it field by field."""
    sources = [parse_source_string(s) for s in entity.sources]
    keys = _build_keys(entity, sources)

    record: dict[str, Any] = {
        "id": keys[0],
        "type": "dataset",
        "title": entity.name,
        "publisher": DATASET_PUBLISHER,
        "note": _record_note(entity),
    }
    if entity.year is not None:
        record["issued"] = {"date-parts": [[entity.year]]}
    if entity.url:
        record["URL"] = entity.url

    items = [record]
    for position, source in enumerate(sources):
        item: dict[str, Any] = {
            "id": keys[position + 1],
            "type": "document",
            "title": source.title,
        }
        if source.author:
            item["author"] = [{"family": source.author}]
        if source.year:
            item["issued"] = {"date-parts": [[source.year]]}
        if source.url:
            item["URL"] = source.url
        item["note"] = f"Source cited for {entity.name}"
        items.append(item)
    return items


def entity_to_csl_json(entity: CitableEntity) -> str:
    """The CSL-JSON document. ``ensure_ascii=False`` because `JSON.stringify`
    does not escape non-ASCII, and half this corpus is not ASCII."""
    return (
        json.dumps(entity_to_csl_items(entity), indent=2, ensure_ascii=False) + "\n"
    )


def render_citation(entity: CitableEntity, citation_format: str) -> CitationRender:
    """Render *entity*, ready to stream as an attachment."""
    if citation_format == "bibtex":
        content = entity_to_bibtex(entity)
    elif citation_format == "ris":
        content = entity_to_ris(entity)
    else:
        content = entity_to_csl_json(entity)
    extension, content_type = _FORMAT_META[citation_format]
    base = _slug(entity.id) or _slug(entity.name) or "citation"
    return CitationRender(
        format=citation_format,
        content=content,
        content_type=content_type,
        filename=f"{base}.{extension}",
    )
