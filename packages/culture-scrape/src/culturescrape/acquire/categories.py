"""Declarative category specifications loaded from ``categories/<name>.yml``.

A *category* is the unit of acquisition (see ``PLAN.md``): a YAML document that
names a set of entities to scrape, the source that produces them, the
dimensions to enrich, and the cross-dimensional links to mint. Declaring it in
YAML makes a category a reproducible, version-controlled input.

:func:`load_category` parses one such file, validates it against the schema in
``docs/data-model.md``, and returns a typed :class:`CategorySpec`. Validation is
exhaustive: every missing or invalid key is reported together in a single
:class:`CategorySpecError`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType

import yaml

#: Dimensions a category may request enrichment along (see ``docs/data-model.md``).
VALID_DIMENSIONS = frozenset({"temporal", "geographic", "linguistic", "genetic"})
#: Source kinds an acquisition adapter may consume.
VALID_SOURCE_TYPES = frozenset(
    {"wikidata-sparql", "wikidata-dump", "petscan", "wikitext", "dump", "http"}
)

_REQUIRED_KEYS = ("id", "label", "description", "source", "dimensions")
_OPTIONAL_KEYS = ("links",)
_ALLOWED_KEYS = frozenset(_REQUIRED_KEYS + _OPTIONAL_KEYS)


class CategorySpecError(ValueError):
    """Raised when a category file is unreadable or fails schema validation."""


@dataclass(frozen=True)
class SourceSpec:
    """How a category's rows are produced.

    Attributes:
        type: One of :data:`VALID_SOURCE_TYPES`.
        query: The SPARQL/PetScan spec or page producing the rows; optional for
            sources (e.g. ``dump``) that take no query.
        params: Source-specific request parameters (e.g. PetScan's
            ``categories``/``depth``/``combination``/``sparql``). Values are
            coerced to strings; empty when the source takes none.
    """

    type: str
    query: str | None = None
    params: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Link:
    """A cross-dimensional edge to mint from each acquired entity.

    Attributes:
        type: Relationship ``:TYPE`` from the ontology (e.g. ``ORIGINATES_FROM``).
        to: Target entity kind (e.g. ``place``).
    """

    type: str
    to: str


@dataclass(frozen=True)
class CategorySpec:
    """A parsed, validated ``categories/<name>.yml`` document.

    Attributes:
        id: Stable category id (e.g. ``peruvian-dishes``).
        label: Node label(s) for acquired entities, ``;``-separated.
        description: Human-readable gloss.
        source: Where the rows come from.
        dimensions: Dimensions to enrich along; each in :data:`VALID_DIMENSIONS`.
        links: Cross-dimensional edges to mint (may be empty).
    """

    id: str
    label: str
    description: str
    source: SourceSpec
    dimensions: tuple[str, ...]
    links: tuple[Link, ...] = ()


def load_category(path: str | Path) -> CategorySpec:
    """Load and validate the category declared in *path*.

    Raises:
        CategorySpecError: If the file cannot be read, is not valid YAML, or
            does not match the schema. The message lists every problem found.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CategorySpecError(f"cannot read category file {path}: {exc}") from exc
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise CategorySpecError(f"{path}: invalid YAML: {exc}") from exc
    return _parse(raw, path)


def parse_category(raw: object, *, source: str = "<category>") -> CategorySpec:
    """Validate an already-loaded category mapping.

    The in-memory counterpart of :func:`load_category`: it runs the same
    exhaustive validation on a mapping a caller already has (e.g. one the
    category generator just built), without round-tripping through a file.
    *source* names the mapping in error messages.

    Raises:
        CategorySpecError: If *raw* does not match the schema; the message lists
            every problem found.
    """
    return _parse(raw, Path(source))


def _parse(raw: object, path: Path) -> CategorySpec:
    if not isinstance(raw, dict):
        raise CategorySpecError(
            f"{path}: expected a YAML mapping at the top level, got "
            f"{type(raw).__name__}"
        )

    errors: list[str] = []

    unknown = sorted(set(raw) - _ALLOWED_KEYS)
    if unknown:
        errors.append(f"unknown keys: {', '.join(map(str, unknown))}")
    missing = [key for key in _REQUIRED_KEYS if key not in raw]
    if missing:
        errors.append(f"missing required keys: {', '.join(missing)}")

    for key in ("id", "label", "description"):
        if key in raw and not _is_nonempty_str(raw[key]):
            errors.append(f"{key!r} must be a non-empty string")

    source = _parse_source(raw.get("source"), errors) if "source" in raw else None
    dimensions = (
        _parse_dimensions(raw.get("dimensions"), errors)
        if "dimensions" in raw
        else ()
    )
    links = _parse_links(raw.get("links", []), errors)

    if errors:
        raise CategorySpecError(
            f"{path}: invalid category spec:\n  - " + "\n  - ".join(errors)
        )

    assert source is not None  # guaranteed: missing 'source' would have errored
    return CategorySpec(
        id=str(raw["id"]),
        label=str(raw["label"]),
        description=str(raw["description"]),
        source=source,
        dimensions=dimensions,
        links=links,
    )


def _parse_source(value: object, errors: list[str]) -> SourceSpec | None:
    if not isinstance(value, dict):
        errors.append("'source' must be a mapping with a 'type'")
        return None
    type_ = value.get("type")
    if not _is_nonempty_str(type_):
        errors.append("'source.type' must be a non-empty string")
    elif type_ not in VALID_SOURCE_TYPES:
        errors.append(
            f"'source.type' {type_!r} is not one of: "
            f"{', '.join(sorted(VALID_SOURCE_TYPES))}"
        )
    query = value.get("query")
    if query is not None and not isinstance(query, str):
        errors.append("'source.query' must be a string when present")
    params = _parse_params(value.get("params", {}), errors)
    if errors:
        return None
    return SourceSpec(type=str(type_), query=query, params=params)


def _parse_params(value: object, errors: list[str]) -> Mapping[str, str]:
    if not isinstance(value, dict):
        errors.append("'source.params' must be a mapping when present")
        return MappingProxyType({})
    params: dict[str, str] = {}
    for key, raw_value in value.items():
        if isinstance(raw_value, bool) or not isinstance(
            raw_value, str | int | float
        ):
            errors.append(
                f"'source.params.{key}' must be a string or number"
            )
            continue
        params[str(key)] = str(raw_value)
    return MappingProxyType(params)


def _parse_dimensions(value: object, errors: list[str]) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(d, str) for d in value):
        errors.append("'dimensions' must be a list of strings")
        return ()
    invalid = [d for d in value if d not in VALID_DIMENSIONS]
    if invalid:
        errors.append(
            f"invalid dimensions: {', '.join(invalid)}; valid: "
            f"{', '.join(sorted(VALID_DIMENSIONS))}"
        )
    return tuple(value)


def _parse_links(value: object, errors: list[str]) -> tuple[Link, ...]:
    if not isinstance(value, list):
        errors.append("'links' must be a list")
        return ()
    links: list[Link] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            errors.append(f"links[{index}] must be a mapping")
            continue
        type_ = item.get("type")
        to = item.get("to")
        if not _is_nonempty_str(type_):
            errors.append(f"links[{index}].type must be a non-empty string")
        if not _is_nonempty_str(to):
            errors.append(f"links[{index}].to must be a non-empty string")
        if _is_nonempty_str(type_) and _is_nonempty_str(to):
            links.append(Link(type=str(type_), to=str(to)))
    return tuple(links)


def _is_nonempty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
