"""Clean raw source fields into canonical columns.

Acquisition adapters hand back heterogeneous string fields named however the
source happened to name them, with whatever whitespace and Unicode form the
source happened to use. Before entity resolution can match two rows it must see
them in one canonical shape, so this module provides the cleaning primitives:

* :func:`normalize_text` — NFC-normalize, trim, and collapse internal
  whitespace, so ``"  Café\\tCriollo "`` and ``"Café Criollo"`` compare equal.
* :func:`map_field_names` / :func:`normalize_fields` — rename source field names
  to canonical column names (``docs/data-model.md``) via a *configurable*
  mapping, leaving unknown fields untouched.
* :func:`parse_temporal` — turn a human temporal string ("500 BC", "5th
  century", "1879–1955") into integer ``time_start`` / ``time_end`` years (BCE
  negative), keeping the raw value in ``time_start_iso`` when sub-year precision
  or ambiguity must be preserved.
* :func:`parse_point` / :func:`parse_lat_lon` — parse coordinates into a
  validated ``(lat, lon)``; an unparseable or out-of-range coordinate is dropped
  (returns ``None``) with a logged warning rather than poisoning the data.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

LOGGER = logging.getLogger("culturescrape.schema.normalize")


def normalize_text(value: str) -> str:
    """Return *value* NFC-normalized, trimmed, with whitespace runs collapsed.

    Unicode is normalized to NFC, leading/trailing whitespace is stripped, and
    every internal run of whitespace (including tabs and newlines) becomes a
    single space — the canonical single-line form for a scalar column.
    """
    return " ".join(unicodedata.normalize("NFC", value).split())


#: Default mapping of common source field names to canonical column names.
#: Callers may pass their own mapping (or an extended copy) to
#: :func:`map_field_names`; only keys present here are renamed.
DEFAULT_FIELD_MAP: dict[str, str] = {
    # name
    "itemLabel": "name",
    "label": "name",
    "title": "name",
    "name": "name",
    # description
    "itemDescription": "description",
    "description": "description",
    "desc": "description",
    # identity
    "item": "wikidata_qid",
    "wikidata": "wikidata_qid",
    "qid": "wikidata_qid",
    "getty": "getty_id",
    # language
    "lang": "lang",
    "language": "lang",
    # aliases
    "aliases": "aliases",
    "altLabel": "aliases",
    "alias": "aliases",
    # temporal
    "date": "time_start_iso",
    "time": "time_start_iso",
    "inception": "time_start_iso",
    "period": "period",
    # geographic
    "coord": "coordinates",
    "coords": "coordinates",
    "coordinates": "coordinates",
    "coordinate_location": "coordinates",
    "lat": "lat",
    "latitude": "lat",
    "lon": "lon",
    "long": "lon",
    "longitude": "lon",
}


def map_field_names(
    fields: Mapping[str, str],
    mapping: Mapping[str, str] = DEFAULT_FIELD_MAP,
) -> dict[str, str]:
    """Rename source field names to canonical names via *mapping*.

    A key found in *mapping* is renamed to its canonical name; an unknown key
    passes through unchanged. Values are not modified. When two source fields
    map to the same canonical name the later one (in iteration order) wins.
    """
    return {mapping.get(key, key): value for key, value in fields.items()}


def normalize_fields(
    fields: Mapping[str, str],
    mapping: Mapping[str, str] = DEFAULT_FIELD_MAP,
) -> dict[str, str]:
    """Map field names to canonical columns and normalize every value's text."""
    return {
        key: normalize_text(value)
        for key, value in map_field_names(fields, mapping).items()
    }


@dataclass(frozen=True)
class TimeSpan:
    """A parsed temporal value (years; BCE negative).

    ``time_start`` / ``time_end`` are integer years when they could be parsed;
    a point in time leaves ``time_end`` ``None``. ``time_start_iso`` holds the
    raw string when the value carries sub-year precision (an ISO date) or could
    not be reduced to a clean year at all (ambiguous), so nothing is lost.
    """

    time_start: int | None = None
    time_end: int | None = None
    time_start_iso: str | None = None

    @property
    def is_empty(self) -> bool:
        """True when nothing at all could be extracted."""
        return (
            self.time_start is None
            and self.time_end is None
            and self.time_start_iso is None
        )


#: ``YYYY-MM-DD`` (optionally with a time component); year is unambiguous.
_ISO_DATE_RE = re.compile(r"^(-?\d{1,4})-\d{2}-\d{2}(?:[T ]\S*)?$")

#: ``YYYY-MM``; the year is clear, the rest is sub-year precision.
_ISO_YEAR_MONTH_RE = re.compile(r"^(-?\d{1,4})-\d{2}$")

#: ``Nth century`` with an optional trailing era marker.
_CENTURY_RE = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?\s+century\b(.*)$", re.IGNORECASE)

#: A single year: optional sign, 1–4 digits, optional trailing era marker.
_YEAR_RE = re.compile(r"^([+-]?)(\d{1,4})\s*(.*)$")

#: Dash variants that may separate the two ends of a year range.
_EN_DASH = "–"
_EM_DASH = "—"


def _era_sign(text: str) -> int | None:
    """Return -1 for a BCE marker, +1 for a CE/AD marker, ``None`` otherwise."""
    token = re.sub(r"[.\s]", "", text).upper()
    if token in {"BC", "BCE"}:
        return -1
    if token in {"AD", "CE"}:
        return 1
    return None


def _parse_simple_year(token: str) -> tuple[int, int | None] | None:
    """Parse ``"500 BC"`` / ``"-500"`` / ``"1879"`` into (magnitude, sign).

    ``sign`` is ``-1`` or ``+1`` when an era is explicit (a leading ``-`` or a
    trailing BC/AD marker) and ``None`` when unspecified, so a range can let one
    end inherit the other's era. Returns ``None`` if *token* is not a clean year.
    """
    match = _YEAR_RE.match(token.strip())
    if match is None:
        return None
    lead, digits, tail = match.groups()
    magnitude = int(digits)
    if lead == "-":
        return magnitude, -1
    tail = tail.strip()
    if not tail:
        return magnitude, None
    sign = _era_sign(tail)
    if sign is None:
        return None  # trailing text that is not an era marker -> not a year
    return magnitude, sign


def _split_range(text: str) -> tuple[str, str] | None:
    """Split *text* into its two ends if it looks like a range, else ``None``."""
    for dash in (_EN_DASH, _EM_DASH):
        if dash in text:
            left, _, right = text.partition(dash)
            return left.strip(), right.strip()
    word = re.split(r"\bto\b", text, maxsplit=1, flags=re.IGNORECASE)
    if len(word) == 2:
        return word[0].strip(), word[1].strip()
    hyphen = re.match(r"^(.*\d.*?)\s*-\s*(.*\d.*)$", text)
    if hyphen is not None:
        return hyphen.group(1).strip(), hyphen.group(2).strip()
    return None


def _century_span(n: int, sign: int) -> tuple[int, int]:
    """Return the (start, end) years of the *n*-th century (sign -1 = BCE)."""
    if sign < 0:
        return -(n * 100), -((n - 1) * 100 + 1)
    return (n - 1) * 100 + 1, n * 100


def parse_temporal(value: str) -> TimeSpan:
    """Parse a temporal *value* into a :class:`TimeSpan`.

    Recognises ISO dates (``1879-03-14``), centuries (``5th century BC``), year
    ranges (``1879–1955``, ``500-400 BC``), and single years (``1879``,
    ``500 BC``, ``-500``). A value that matches none of these is treated as
    ambiguous: its raw text is kept in ``time_start_iso`` and the integer years
    are left ``None``.
    """
    text = normalize_text(value)
    if not text:
        return TimeSpan()

    iso = _ISO_DATE_RE.match(text) or _ISO_YEAR_MONTH_RE.match(text)
    if iso is not None:
        return TimeSpan(time_start=int(iso.group(1)), time_start_iso=text)

    century = _CENTURY_RE.match(text)
    if century is not None:
        sign = _era_sign(century.group(2)) or 1
        start, end = _century_span(int(century.group(1)), sign)
        return TimeSpan(time_start=start, time_end=end)

    split = _split_range(text)
    if split is not None:
        left = _parse_simple_year(split[0])
        right = _parse_simple_year(split[1])
        if left is not None and right is not None:
            lmag, lsign = left
            rmag, rsign = right
            # Let an end without its own era inherit the other end's era,
            # so "500-400 BC" reads as BCE on both ends; default to CE.
            shared = lsign if lsign is not None else rsign
            shared = shared if shared is not None else 1
            start_sign = lsign if lsign is not None else shared
            end_sign = rsign if rsign is not None else shared
            return TimeSpan(time_start=lmag * start_sign, time_end=rmag * end_sign)

    year = _parse_simple_year(text)
    if year is not None:
        magnitude, year_sign = year
        return TimeSpan(
            time_start=magnitude * (year_sign if year_sign is not None else 1)
        )

    return TimeSpan(time_start_iso=text)


@dataclass(frozen=True)
class Coordinates:
    """A validated WGS84 coordinate pair."""

    lat: float
    lon: float


#: Inclusive bounds for a valid WGS84 latitude / longitude.
_LAT_MAX = 90.0
_LON_MAX = 180.0

#: Wikidata's WKT literal: ``Point(<lon> <lat>)``.
_WKT_POINT_RE = re.compile(
    r"^Point\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$",
    re.IGNORECASE,
)


def _validate(
    lat: float, lon: float, raw: str, logger: logging.Logger
) -> Coordinates | None:
    """Return :class:`Coordinates` if in range, else log a warning and ``None``."""
    if -_LAT_MAX <= lat <= _LAT_MAX and -_LON_MAX <= lon <= _LON_MAX:
        return Coordinates(lat, lon)
    logger.warning("dropping out-of-range coordinate: %r", raw)
    return None


def parse_point(value: str, *, logger: logging.Logger = LOGGER) -> Coordinates | None:
    """Parse a single coordinate *value* into validated :class:`Coordinates`.

    Accepts Wikidata's WKT ``Point(<lon> <lat>)`` literal or a plain
    ``"<lat>, <lon>"`` / ``"<lat> <lon>"`` pair. Returns ``None`` (with a logged
    warning) when the value is unparseable or out of range.
    """
    text = value.strip()
    point = _WKT_POINT_RE.match(text)
    if point is not None:
        return _validate(float(point.group(2)), float(point.group(1)), value, logger)
    parts = re.split(r"\s*,\s*|\s+", text)
    if len(parts) == 2:
        try:
            return _validate(float(parts[0]), float(parts[1]), value, logger)
        except ValueError:
            pass
    logger.warning("dropping unparseable coordinate: %r", value)
    return None


def parse_lat_lon(
    lat_value: str, lon_value: str, *, logger: logging.Logger = LOGGER
) -> Coordinates | None:
    """Parse separate latitude/longitude strings into :class:`Coordinates`.

    Returns ``None`` (with a logged warning) when either value is not a number
    or the pair is out of range.
    """
    try:
        lat, lon = float(lat_value.strip()), float(lon_value.strip())
    except ValueError:
        logger.warning(
            "dropping unparseable coordinate: lat=%r lon=%r", lat_value, lon_value
        )
        return None
    return _validate(lat, lon, f"{lat_value}, {lon_value}", logger)
