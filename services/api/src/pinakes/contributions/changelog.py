"""The dataset changelog — one JSON file per recorded change.

The full port of `server/services/changelog.ts`. The **write** half landed first
(pinakes:60 US-1) because the review pipeline needs it: an approved edit and a
promoted AI draft each append a record. The **read** half — filtering, sorting,
pagination and the aggregate — landed with `GET /api/changelog[/stats]`
(pinakes:61 US-2, :mod:`pinakes.routers.changelog`).

Both halves stay in this module rather than splitting along the route boundary.
The record shape, the directory and the id format are what the two servers agree
on during the cutover, and a second module restating them is exactly the drift
worth not having.

Two rules are load-bearing:

* **Recording never fails a review.** An approved contribution is the user's
  work; losing an audit line is bad, losing their submission because the audit
  line could not be written is worse. :func:`record_change` swallows and
  reports, exactly as the try/catch around the TypeScript call site does.
* **Reading is not forgiving in the same way.** :func:`load_all` lets a
  malformed file raise, because `loadAll` in TypeScript let `JSON.parse` throw
  and the route answered 500. An entry silently dropped from an *audit log* is
  worse than an audit log that admits it is broken.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pinakes.contributions.store import iso_now
from pinakes.paths import changelog_dir

logger = logging.getLogger("pinakes")

ChangeType = Literal["added", "modified", "removed"]

CHANGE_TYPES: tuple[str, ...] = ("added", "modified", "removed")

#: Optional string fields dropped when blank, so the persisted record is tidy.
_OPTIONAL_STRINGS = (
    "targetFile",
    "targetId",
    "entityName",
    "sourceUrl",
    "contributionId",
    "reviewer",
    "summary",
)

_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def make_entry(
    payload: dict[str, Any], entry_id: str, timestamp: str
) -> dict[str, Any]:
    """Normalize an input into a persisted entry. Pure — trims, drops blanks."""
    entry: dict[str, Any] = {
        "id": entry_id,
        "timestamp": timestamp,
        "domain": str(payload["domain"]).strip(),
        "changeType": payload["changeType"],
        "source": str(payload["source"]).strip(),
    }
    for key in _OPTIONAL_STRINGS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            entry[key] = value.strip()
    fields = payload.get("fields")
    if isinstance(fields, list):
        trimmed = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if trimmed:
            entry["fields"] = trimmed
    confidence = payload.get("confidence")
    if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
        entry["confidence"] = confidence
    return entry


def validate(payload: dict[str, Any]) -> list[str]:
    """Why this input cannot be recorded. Empty list ⇒ it can."""
    errors: list[str] = []
    domain = payload.get("domain")
    if not isinstance(domain, str) or not domain.strip():
        errors.append("domain is required")
    if payload.get("changeType") not in CHANGE_TYPES:
        errors.append(f"changeType must be one of: {', '.join(CHANGE_TYPES)}")
    source = payload.get("source")
    if not isinstance(source, str) or not source.strip():
        errors.append("source is required")
    confidence = payload.get("confidence")
    if confidence is not None and (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or confidence < 1
        or confidence > 100
    ):
        errors.append("confidence must be a number between 1 and 100")
    return errors


def record_change(
    payload: dict[str, Any],
    *,
    directory: Path | None = None,
    entry_id: str | None = None,
    now: str | None = None,
) -> dict[str, Any] | None:
    """Record one change, best-effort. Returns the entry, or ``None`` on failure.

    ``directory``/``entry_id``/``now`` are injectable so a test asserts on an
    exact file; left unset they resolve the way the running service does.
    """
    try:
        errors = validate(payload)
        if errors:
            raise ValueError(f"Invalid changelog entry: {'; '.join(errors)}")
        target = Path(directory) if directory is not None else changelog_dir()
        target.mkdir(parents=True, exist_ok=True)
        stamp = now if now is not None else iso_now()
        identity = entry_id if entry_id is not None else _generate_id()
        entry = make_entry(payload, identity, stamp)
        (target / f"{identity}.json").write_text(
            json.dumps(entry, indent=2), encoding="utf-8"
        )
        return entry
    except (OSError, ValueError, KeyError) as exc:
        logger.warning("failed to record a changelog entry: %s", exc)
        return None


def _generate_id() -> str:
    """``change-<ms in base36>-<8 random hex chars>``, as TypeScript mints it."""
    value = int(time.time() * 1000)
    digits: list[str] = []
    while value > 0:
        value, remainder = divmod(value, 36)
        digits.append(_BASE36[remainder])
    return f"change-{''.join(reversed(digits))}-{os.urandom(4).hex()}"


# ── The read half: filter, sort, paginate, aggregate ─────────────────────────
#
# Every function below is pure over a list of entries, as the TypeScript's were
# — `filterChangelog` deliberately does *not* paginate, so a caller can take the
# `total` and the stats over the whole filtered set before slicing a page.

#: The page size a request that names no `limit` gets.
DEFAULT_LIMIT = 50

#: A `to` bound written as a bare date covers the whole day, not its midnight.
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def date_parse_ms(value: Any) -> float | None:
    """``Date.parse(value)`` in milliseconds — ``None`` where JavaScript says NaN.

    The two ECMA-262 rules that matter here, because the filters lean on both:
    a **date-only** form is UTC, while a date-*time* form carrying no offset is
    **local**. Python inverts the first (`fromisoformat("2026-07-03")` is a naive
    midnight, which `.timestamp()` then reads as local), so date-only is
    special-cased rather than left to agree by accident.

    ``None`` rather than a NaN float: every caller has to branch on
    unparseable anyway, and `nan` silently poisons the comparisons it reaches.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if _DATE_ONLY.match(text):
        return (
            datetime.fromisoformat(text)
            .replace(tzinfo=UTC)
            .timestamp()
            * 1000
        )
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.timestamp() * 1000


def _bound_ms(bound: Any, kind: Literal["from", "to"]) -> float | None:
    """One end of the date range, in milliseconds. ``None`` = unbounded."""
    if not isinstance(bound, str) or not bound.strip():
        return None
    trimmed = bound.strip()
    if kind == "to" and _DATE_ONLY.match(trimmed):
        # A date-only upper bound is inclusive of the whole day: someone
        # filtering `to=2026-07-04` means "through the 4th", not "up to the
        # instant it began".
        return date_parse_ms(f"{trimmed}T23:59:59.999Z")
    return date_parse_ms(trimmed)


def within_date_range(timestamp: Any, frm: Any = None, to: Any = None) -> bool:
    """True when *timestamp* falls inside the inclusive ``[frm, to]`` range.

    An unparseable *timestamp* is out of every range (the TypeScript's `NaN`
    comparisons are all false, and it returns early on one) — but an unparseable
    **bound** is simply not a bound, so a junk `?from=` widens the query rather
    than emptying it.
    """
    moment = date_parse_ms(timestamp)
    if moment is None:
        return False
    lower = _bound_ms(frm, "from")
    upper = _bound_ms(to, "to")
    if lower is not None and moment < lower:
        return False
    return not (upper is not None and moment > upper)


def sort_newest_first(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Newest first, with the id as a stable descending tiebreaker.

    The tiebreak is a plain string comparison where TypeScript used
    `localeCompare`. Ids are minted by :func:`_generate_id` from lowercase
    base36 and hex, so the two orders agree on every id this log can hold.
    """
    return sorted(
        entries,
        key=lambda entry: (
            date_parse_ms(entry.get("timestamp")) or 0.0,
            str(entry.get("id", "")),
        ),
        reverse=True,
    )


def filter_changelog(
    entries: list[dict[str, Any]], filters: dict[str, Any]
) -> list[dict[str, Any]]:
    """Filter + sort. **Not** paginated — see :func:`paginate_changelog`.

    Splitting the two is what lets the route report a `total` over the whole
    matching set and the stats endpoint ignore pagination entirely.
    """
    frm = filters.get("from")
    to = filters.get("to")
    dated = bool(frm or to)
    matched = [
        entry
        for entry in entries
        if _matches(entry, filters)
        and (not dated or within_date_range(entry.get("timestamp"), frm, to))
    ]
    return sort_newest_first(matched)


def _matches(entry: dict[str, Any], filters: dict[str, Any]) -> bool:
    """The equality half of the filter. A blank filter value is no filter."""
    for filter_key, entry_key in (
        ("domain", "domain"),
        ("changeType", "changeType"),
        ("source", "source"),
        ("contributionId", "contributionId"),
    ):
        wanted = filters.get(filter_key)
        if wanted and entry.get(entry_key) != wanted:
            return False
    return True


def paginate_changelog(
    entries: list[dict[str, Any]], filters: dict[str, Any]
) -> list[dict[str, Any]]:
    """Apply ``offset``/``limit`` to an already-filtered list.

    A **negative** limit returns everything from the offset on, which is how the
    TypeScript's `slice(offset)` branch behaved and is the only way a caller can
    ask for the whole log in one response.
    """
    offset = max(0, _as_number(filters.get("offset"), 0))
    limit = _as_number(filters.get("limit"), DEFAULT_LIMIT)
    if limit < 0:
        return entries[offset:]
    return entries[offset : offset + limit]


def _as_number(value: Any, fallback: int) -> int:
    """``value ?? fallback`` for the two numeric filters."""
    return value if isinstance(value, int) and not isinstance(value, bool) else fallback


def compute_stats(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate counts + date bounds over a set of entries.

    `byChangeType` names all three kinds whether or not they occur, because the
    client renders a fixed row per kind; `byDomain`/`bySource` carry only what
    is present.
    """
    by_domain: dict[str, int] = {}
    by_source: dict[str, int] = {}
    by_change_type: dict[str, int] = {"added": 0, "modified": 0, "removed": 0}
    first_at: str | None = None
    last_at: str | None = None

    for entry in entries:
        domain = _bucket(entry.get("domain"))
        by_domain[domain] = by_domain.get(domain, 0) + 1
        source = _bucket(entry.get("source"))
        by_source[source] = by_source.get(source, 0) + 1
        change_type = _bucket(entry.get("changeType"))
        by_change_type[change_type] = by_change_type.get(change_type, 0) + 1
        timestamp = entry.get("timestamp")
        if first_at is None or _earlier(timestamp, first_at):
            first_at = timestamp
        if last_at is None or _earlier(last_at, timestamp):
            last_at = timestamp

    return {
        "total": len(entries),
        "byDomain": by_domain,
        "byChangeType": by_change_type,
        "bySource": by_source,
        "firstAt": first_at,
        "lastAt": last_at,
    }


def _bucket(value: Any) -> str:
    """The key a value is counted under.

    A record written by :func:`make_entry` always carries a string here; this
    only decides how a hand-edited file is *reported*, and it stringifies for
    the same reason JavaScript coerced an object key rather than dropping the
    row — an entry that cannot be bucketed must still be counted.
    """
    return value if isinstance(value, str) else str(value)


def _earlier(candidate: Any, incumbent: Any) -> bool:
    """``Date.parse(a) < Date.parse(b)`` — false whenever either is unparseable.

    That falsehood is the behaviour, not an oversight: an entry with a broken
    timestamp must not become the log's reported first or last moment.
    """
    left = date_parse_ms(candidate)
    right = date_parse_ms(incumbent)
    return left is not None and right is not None and left < right


def load_all(directory: Path | None = None) -> list[dict[str, Any]]:
    """Every recorded entry, unsorted.

    A directory that does not exist yet is an empty log rather than an error —
    the TypeScript store created it in its constructor, and a fresh checkout
    answering 500 on `GET /api/changelog` would be a worse contract than
    answering with nothing. A file that exists and does not parse still raises;
    see the module docstring.
    """
    target = Path(directory) if directory is not None else changelog_dir()
    if not target.is_dir():
        return []
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(target.glob("*.json"))
    ]


def list_entries(
    filters: dict[str, Any], *, directory: Path | None = None
) -> dict[str, Any]:
    """One page of the log plus the pre-pagination total."""
    filtered = filter_changelog(load_all(directory), filters)
    return {"entries": paginate_changelog(filtered, filters), "total": len(filtered)}


def stats(filters: dict[str, Any], *, directory: Path | None = None) -> dict[str, Any]:
    """Aggregates over the filtered set. Pagination does not apply."""
    return compute_stats(filter_changelog(load_all(directory), filters))
