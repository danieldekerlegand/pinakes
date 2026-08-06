"""The contribution review queue — one JSON file per contribution.

The port of `server/services/contribution-service.ts`. A submission is validated,
stamped, and written to ``data/runtime/contributions/<id>.json``; nothing here
ever writes to the live dataset, which is the whole premise of the queue — a
contribution is reviewed first, and only an approved AI draft is promoted (see
:mod:`.ai_review`).

Two things are reproduced rather than improved, because Express is still serving
part of this surface and both implementations read the same directory:

* **The record shape**, including which keys are *absent*. ``JSON.stringify``
  drops an ``undefined`` property, so the TypeScript writer emits no key at all
  for an unset optional; :func:`_compact` does the same. A record written here
  has to round-trip through the TypeScript reader unchanged.
* **The validation verdict**, down to JavaScript's truthiness. ``!value`` is
  false for ``[]`` and ``{}`` in JS but true for both in Python, so
  :func:`js_truthy` spells the JS rule out — otherwise a contribution carrying an
  empty-array required field would be accepted by one server and rejected by the
  other.
"""

from __future__ import annotations

import json
import math
import random
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, NamedTuple

from pinakes.collab import verification
from pinakes.paths import contributions_dir

#: A contribution record, as it is stored and served. Deliberately a plain dict:
#: the queue is schemaless at rest (extractors and authoring routes each add
#: their own `entityData` keys), and re-typing it here would mean either losing
#: those keys or maintaining a second copy of a shape that already has one
#: authority — `contracts/parity/openapi.json`.
Contribution = dict[str, Any]

ContributionStatus = Literal["pending", "approved", "rejected"]

#: Required `entityData` fields per entity type, mirroring `REQUIRED_FIELDS` in
#: `contribution-service.ts`. Keys are non-numeric on purpose: the check is a
#: truthiness test, so a numeric field of `0` would spuriously fail.
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "cuisine": ("name", "region"),
    "cuisine-item": ("name", "cuisineId"),
    "music-tradition": ("name", "region"),
    "musical-instrument": ("name", "instrumentFamily"),
    "religion": ("name", "religionType"),
    "haplogroup": ("name",),
    "civilization": ("name",),
    "archaeological-site": ("name", "coordinates"),
    "historical-figure": ("name",),
    "trade-good": ("name",),
    "language-range": ("languageId", "geometry"),
    "language": ("name",),
    "boundary": ("name", "geometry"),
    "trade-route": ("name", "geometry"),
    "migration-route": ("name", "geometry"),
    "timeline-event": ("title", "cultureProfileId", "lane"),
    "relationship": ("sourceId", "targetId", "relationshipType"),
}

#: Confidence a submission gets when it declares none (and warns about it).
DEFAULT_CONFIDENCE = 50

#: Page size `list()` falls back to — `filters?.limit ?? 50`.
DEFAULT_LIMIT = 50

#: Columns of the CSV export, in order.
CSV_HEADERS = (
    "id",
    "entityType",
    "action",
    "status",
    "submittedAt",
    "reviewedAt",
    "contributorName",
    "entityId",
    "fieldName",
    "currentValue",
    "suggestedValue",
    "confidence",
    "notes",
    "reviewNote",
    "sources",
)

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


class ValidationResult(NamedTuple):
    """The verdict on a submission, as the route reports it to the client."""

    valid: bool
    errors: list[str]
    warnings: list[str]


class SubmitResult(NamedTuple):
    """``submit``'s two-part answer: the record (when valid) and the verdict."""

    contribution: Contribution | None
    validation: ValidationResult


class ConfirmResult(NamedTuple):
    """``confirm``'s answer: the record, the state, and whether it counted.

    ``added=False`` is not a failure of the *store* — it is a duplicate reviewer
    or a self-confirmation, and only the route knows those are a 409 and a 400.
    ``reason`` is what it discriminates on, and it is echoed to the client.
    """

    contribution: Contribution
    verification: dict[str, Any]
    added: bool
    reason: str | None = None


# ── JavaScript semantics the record shape depends on ─────────────────────────


def js_truthy(value: Any) -> bool:
    """``!!value`` as JavaScript evaluates it.

    The difference that matters: an empty array or object is **truthy** in JS and
    falsy in Python. Required-field validation is a truthiness test, so getting
    this wrong would silently disagree with the TypeScript server about whether a
    contribution is valid.
    """
    if value is None or value is False:
        return False
    if value is True:
        return True
    if isinstance(value, str):
        return value != ""
    if isinstance(value, (int, float)):
        return value != 0 and not (isinstance(value, float) and math.isnan(value))
    return True


def parse_int_js(raw: str | None) -> float | None:
    """``parseInt(raw, 10)`` — a leading integer, else ``NaN``.

    Returns ``None`` for an absent or empty (falsy) param, matching the
    `req.query.limit ? parseInt(...) : undefined` guard in the Express route, and
    ``math.nan`` for a present-but-unparseable one. The NaN is not a detail to
    round away: it propagates into `Array.slice`, where it collapses the page to
    empty — so a junk `?limit=` returns no rows on either server.
    """
    if raw is None or raw == "":
        return None
    match = re.match(r"\s*[+-]?\d+", raw)
    if match is None:
        return math.nan
    return float(match.group(0))


def _to_integer(value: float) -> int:
    """``ToIntegerOrInfinity``: truncate toward zero, ``NaN`` → ``0``."""
    if math.isnan(value):
        return 0
    return math.trunc(value)


def js_slice(items: list[Any], start: float, end: float) -> list[Any]:
    """``items.slice(start, end)``, including the negative-index wrap."""
    length = len(items)
    lo = _to_integer(start)
    hi = _to_integer(end)
    lo = max(length + lo, 0) if lo < 0 else min(lo, length)
    hi = max(length + hi, 0) if hi < 0 else min(hi, length)
    return items[lo:hi] if hi > lo else []


class _JsonNull:
    """A value ``JSON.stringify`` writes as ``null``.

    This module spells *undefined* as ``None`` — :func:`_compact` drops the key
    entirely, which is what the TypeScript writer does. A JavaScript ``NaN`` is
    neither: it serialises as a **present** ``null``, and the difference is
    observable one request later, because ``Math.round(undefined)`` is ``NaN``
    while ``Math.round(null)`` is ``0``. One sentinel is cheaper than teaching
    every optional in the record to carry a tri-state.
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "JSON_NULL"


#: The sole :class:`_JsonNull`. Compare with ``is``.
JSON_NULL = _JsonNull()


def _first_present(*candidates: Any) -> Any:
    """``a ?? b ?? c`` — the first candidate that is neither null nor undefined.

    Not ``or``: a blank string and a zero are *present* to ``??`` and falsy to
    ``||``, and the difference decides whether a steward attribution records the
    domain it was made under.
    """
    for candidate in candidates:
        if candidate is not None:
            return candidate
    return None


def _compact(record: Contribution) -> Contribution:
    """Drop unset optionals, the way ``JSON.stringify`` drops ``undefined``.

    :data:`JSON_NULL` survives, as the literal ``null`` it stands for.
    """
    return {
        key: (None if value is JSON_NULL else value)
        for key, value in record.items()
        if value is not None
    }


def _epoch_ms(timestamp: Any) -> float:
    """``new Date(x).getTime()`` — unparseable is 0 here rather than ``NaN``.

    JavaScript's comparator returns ``NaN`` for an unparseable date, which leaves
    the pair in place; sorting on 0 puts such records last instead. Both keep the
    sort total and neither is observable through a fixture, so the simpler rule
    wins.
    """
    if not isinstance(timestamp, str):
        return 0.0
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return parsed.timestamp() * 1000
    except ValueError:
        return 0.0


# ── Validation ───────────────────────────────────────────────────────────────


def validate_contribution(data: Contribution) -> ValidationResult:
    """The port of `validateContribution`. Pure — no filesystem, no clock."""
    errors: list[str] = []
    warnings: list[str] = []

    entity_type = data.get("entityType")
    action = data.get("action")

    if not js_truthy(entity_type):
        errors.append("entityType is required")
    elif entity_type not in REQUIRED_FIELDS:
        errors.append(f"Invalid entityType: {entity_type}")

    if not js_truthy(action) or action not in ("add", "edit", "flag"):
        errors.append("action must be 'add', 'edit', or 'flag'")

    if action == "edit" and not js_truthy(data.get("entityId")):
        errors.append("entityId is required for edit contributions")

    if js_truthy(data.get("fieldName")) and not js_truthy(data.get("suggestedValue")):
        errors.append("suggestedValue is required when fieldName is specified")

    if action == "flag" and not js_truthy(data.get("entityId")):
        errors.append("entityId is required for flag contributions")

    entity_data = data.get("entityData")
    if not isinstance(entity_data, dict):
        errors.append("entityData is required and must be an object")
    elif isinstance(entity_type, str) and entity_type in REQUIRED_FIELDS:
        for field in REQUIRED_FIELDS[entity_type]:
            if action == "flag":
                continue
            if not js_truthy(entity_data.get(field)):
                errors.append(
                    f"entityData.{field} is required for {entity_type}"
                )

    sources = data.get("sources")
    if not isinstance(sources, list) or len(sources) == 0:
        if action != "flag":
            errors.append("At least one source citation is required")
    else:
        for index, source in enumerate(sources):
            title = source.get("title") if isinstance(source, dict) else None
            if not js_truthy(title):
                errors.append(f"sources[{index}].title is required")

    # Absent is a warning; an explicit `null` is an error, because `null` is not
    # `undefined` to the check this mirrors — and a submission that *declares* a
    # confidence of nothing is saying something different from one that omits it.
    confidence = data.get("confidence")
    if "confidence" not in data:
        warnings.append("confidence not specified, defaulting to 50")
    elif (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or confidence < 1
        or confidence > 100
    ):
        errors.append("confidence must be a number between 1 and 100")

    email = data.get("contributorEmail")
    if js_truthy(email) and not (
        isinstance(email, str) and _EMAIL.match(email) is not None
    ):
        warnings.append("contributorEmail format appears invalid")

    return ValidationResult(valid=not errors, errors=errors, warnings=warnings)


# ── The store ────────────────────────────────────────────────────────────────


class ContributionStore:
    """JSON-per-record queue rooted at one directory.

    Unlike the TypeScript service there is no in-memory cache of the directory:
    two processes serve this queue during the cutover, so a cached listing would
    be a listing of what *this* process last wrote. The directory is small and
    the read is cheap; correctness across the two servers is not.
    """

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    # -- identity ------------------------------------------------------------

    def _generate_id(self) -> str:
        """``contrib-<ms in base36>-<6 random base36 chars>``, as TS mints it."""
        return f"contrib-{_base36(int(time.time() * 1000))}-{_random_suffix()}"

    def _path(self, contribution_id: str) -> Path:
        return self.directory / f"{contribution_id}.json"

    # -- reads ---------------------------------------------------------------

    def load_all(self) -> list[Contribution]:
        """Every contribution, newest submission first."""
        records: list[Contribution] = []
        for file in sorted(self.directory.glob("*.json")):
            try:
                records.append(json.loads(file.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        records.sort(key=lambda record: -_epoch_ms(record.get("submittedAt")))
        return records

    def get(self, contribution_id: str) -> Contribution | None:
        """One contribution by id, read straight off disk. ``None`` if absent."""
        path = self._path(contribution_id)
        if not path.is_file():
            return None
        loaded: Contribution = json.loads(path.read_text(encoding="utf-8"))
        return loaded

    def get_by_entity(self, entity_type: str, entity_id: str) -> list[Contribution]:
        """Approved contributions attached to one entity.

        Declared before :meth:`list` deliberately: that method's name shadows the
        builtin for every annotation after it in the class body, so a later
        ``-> list[Contribution]`` would not type-check.
        """
        return [
            record
            for record in self.load_all()
            if record.get("entityType") == entity_type
            and record.get("entityId") == entity_id
            and record.get("status") == "approved"
        ]

    def list(
        self,
        *,
        status: str | None = None,
        entity_type: str | None = None,
        action: str | None = None,
        limit: float | None = None,
        offset: float | None = None,
    ) -> dict[str, Any]:
        """Filtered, paginated page plus the pre-pagination ``total``."""
        records = self.load_all()
        if js_truthy(status):
            records = [r for r in records if r.get("status") == status]
        if js_truthy(entity_type):
            records = [r for r in records if r.get("entityType") == entity_type]
        if js_truthy(action):
            records = [r for r in records if r.get("action") == action]

        total = len(records)
        start = 0.0 if offset is None else offset
        size = float(DEFAULT_LIMIT) if limit is None else limit
        return {
            "contributions": js_slice(records, start, start + size),
            "total": total,
        }

    def stats(self) -> dict[str, Any]:
        """Queue aggregate. The shape recorded by `get-contributions-stats`."""
        by_entity_type: dict[str, int] = {}
        by_action: dict[str, int] = {}
        pending = approved = rejected = 0

        records = self.load_all()
        for record in records:
            entity_type = str(record.get("entityType"))
            action = str(record.get("action"))
            by_entity_type[entity_type] = by_entity_type.get(entity_type, 0) + 1
            by_action[action] = by_action.get(action, 0) + 1
            status = record.get("status")
            if status == "pending":
                pending += 1
            elif status == "approved":
                approved += 1
            else:
                rejected += 1

        return {
            "total": len(records),
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "byEntityType": by_entity_type,
            "byAction": by_action,
        }

    def export_csv(self) -> str:
        """The whole queue as CSV. Hand-rolled to match the TS export byte for
        byte — `csv` would quote and line-end differently."""
        rows = [",".join(CSV_HEADERS)]
        for record in self.load_all():
            sources = record.get("sources")
            titles = (
                "; ".join(
                    str(source.get("title", ""))
                    for source in sources
                    if isinstance(source, dict)
                )
                if isinstance(sources, list)
                else ""
            )
            cells = [
                _cell(record.get("id")),
                _cell(record.get("entityType")),
                _cell(record.get("action")),
                _cell(record.get("status")),
                _cell(record.get("submittedAt")),
                _cell(record.get("reviewedAt")),
                _cell(record.get("contributorName")),
                _cell(record.get("entityId")),
                _cell(record.get("fieldName")),
                _cell(record.get("currentValue")),
                _cell(record.get("suggestedValue")),
                _cell(record.get("confidence")),
                _cell(record.get("notes")),
                _cell(record.get("reviewNote")),
                titles,
            ]
            rows.append(",".join(_escape_csv(cell) for cell in cells))
        return "\n".join(rows)

    # -- writes --------------------------------------------------------------

    def save(self, contribution: Contribution) -> None:
        """Persist one record. Pretty-printed, as the TypeScript writer leaves it."""
        self.directory.mkdir(parents=True, exist_ok=True)
        self._path(str(contribution["id"])).write_text(
            json.dumps(_compact(contribution), indent=2), encoding="utf-8"
        )

    def submit(self, data: Contribution) -> SubmitResult:
        """Validate and enqueue a submission.

        The AI-extraction flags are **hoisted** out of `entityData` onto the
        record itself so the review workflow does not have to dig for them; the
        extractors still write them into `entityData`, so this stays
        backward-compatible with drafts already in the queue.
        """
        validation = validate_contribution(data)
        if not validation.valid:
            return SubmitResult(contribution=None, validation=validation)

        entity_data: dict[str, Any] = data["entityData"]

        # `data.aiGenerated ?? entityData.aiGenerated === true ? true : undefined`
        # — the nullish coalesce binds tighter than the ternary, so an explicitly
        # false `aiGenerated` reads as "not an AI draft", same as an absent one.
        declared = data.get("aiGenerated")
        hoisted = entity_data.get("aiGenerated") is True
        flag = declared if declared is not None else hoisted
        ai_generated = True if js_truthy(flag) else None
        ai_source = data.get("aiSource")
        if ai_source is None:
            source = entity_data.get("source")
            ai_source = source if isinstance(source, str) and ai_generated else None
        per_field = data.get("perFieldConfidence")
        if per_field is None:
            raw = entity_data.get("perFieldConfidence")
            per_field = raw if isinstance(raw, dict) else None

        contribution: Contribution = {
            "id": self._generate_id(),
            "entityType": data["entityType"],
            "action": data["action"],
            "status": "pending",
            "submittedAt": iso_now(),
            "contributorName": data.get("contributorName"),
            "contributorEmail": data.get("contributorEmail"),
            "entityId": data.get("entityId"),
            "entityData": entity_data,
            "sources": data["sources"],
            "confidence": data["confidence"]
            if "confidence" in data
            else DEFAULT_CONFIDENCE,
            "notes": data.get("notes"),
            "fieldName": data.get("fieldName"),
            "currentValue": data.get("currentValue"),
            "suggestedValue": data.get("suggestedValue"),
            "aiGenerated": ai_generated,
            "aiSource": ai_source,
            "perFieldConfidence": per_field,
        }
        contribution = _compact(contribution)
        self.save(contribution)
        return SubmitResult(contribution=contribution, validation=validation)

    def review(
        self, contribution_id: str, decision: str, note: str | None = None
    ) -> Contribution | None:
        """Approve or reject. ``None`` when the id is unknown."""
        contribution = self.get(contribution_id)
        if contribution is None:
            return None
        contribution["status"] = decision
        contribution["reviewedAt"] = iso_now()
        # `contribution.reviewNote = note` with an absent note assigns
        # `undefined`, which JSON.stringify then drops — including over a note
        # left by an earlier review.
        contribution["reviewNote"] = note
        contribution = _compact(contribution)
        self.save(contribution)
        return contribution

    def confirm(
        self,
        contribution_id: str,
        *,
        reviewer: str,
        is_steward: bool = False,
        domain: str | None = None,
        note: Any = None,
        config: verification.VerificationConfig | None = None,
        now: str | None = None,
    ) -> ConfirmResult | None:
        """Record an independent confirmation from a distinct reviewer.

        ``None`` for an unknown id. Otherwise the updated contribution and its
        verification state, with ``added=False`` and a ``reason`` when the
        confirmation was a no-op — a duplicate reviewer, or the contributor
        trying to confirm their own work.

        Three shapes here are the TypeScript's and are load-bearing because both
        servers read this queue:

        * **``baseConfidence`` is preserved on first confirmation**, so the ramp
          is recomputed from the original figure every time. Recomputing off the
          already-raised ``confidence`` would compound.
        * **``??``, not ``or``.** A base confidence of ``0`` is kept as ``0``;
          an absent one stays absent (and rounds to ``NaN``, which reaches the
          client as ``null``).
        * **A confirmation's unset keys are absent.** A non-steward's record has
          no ``isSteward`` and no ``domain`` key at all, because
          ``JSON.stringify`` writes none.
        """
        contribution = self.get(contribution_id)
        if contribution is None:
            return None

        settings = (
            config if config is not None else verification.DEFAULT_VERIFICATION_CONFIG
        )
        stamp = now if now is not None else iso_now()

        base_number = verification.base_confidence(contribution)
        # `contribution.baseConfidence = contribution.baseConfidence ??
        # contribution.confidence`. Assigning `undefined` writes no key, which
        # `_compact` reproduces on save; assigning a `null` confidence through
        # writes the null.
        if contribution.get("baseConfidence") is None:
            contribution["baseConfidence"] = (
                JSON_NULL
                if contribution.get("confidence") is None
                and "confidence" in contribution
                else contribution.get("confidence")
            )
        raw_existing = contribution.get("confirmations")
        existing: list[verification.Confirmation] = (
            list(raw_existing) if isinstance(raw_existing, list) else []
        )

        contributor = contribution.get("contributorName")
        if js_truthy(contributor) and verification.reviewer_key(
            str(contributor)
        ) == verification.reviewer_key(reviewer):
            return ConfirmResult(
                contribution=_compact(contribution),
                verification=verification.summarize_verification(
                    base_number, existing, settings
                ),
                added=False,
                reason="self",
            )

        candidate: verification.Confirmation = {
            "reviewer": verification.js_trim(reviewer),
            "confirmedAt": stamp,
        }
        if is_steward:
            candidate["isSteward"] = True
            if domain is not None:
                candidate["domain"] = domain
        if isinstance(note, str):
            candidate["note"] = note

        result = verification.add_confirmation(existing, candidate)
        if not result.added:
            return ConfirmResult(
                contribution=_compact(contribution),
                verification=verification.summarize_verification(
                    base_number, existing, settings
                ),
                added=False,
                reason=result.reason,
            )

        contribution["confirmations"] = result.confirmations
        confidence = verification.compute_confidence(
            base_number, result.confirmations, settings
        )
        contribution["confidence"] = (
            JSON_NULL
            if isinstance(confidence, float) and math.isnan(confidence)
            else confidence
        )

        if verification.is_verified(result.confirmations, settings):
            contribution["verified"] = True
            if not js_truthy(contribution.get("verifiedAt")):
                contribution["verifiedAt"] = stamp
            if contribution.get("status") == "pending":
                contribution["status"] = "approved"
                contribution["reviewedAt"] = stamp

        stewards = [c for c in result.confirmations if c.get("isSteward")]
        if stewards:
            contribution["stewardAttribution"] = [
                {
                    "steward": verification.js_trim(str(c.get("reviewer", ""))),
                    # `c.domain ?? input.domain ?? ""` — an *earlier* steward's
                    # recorded domain wins over this request's, so re-confirming
                    # under a different domain does not rewrite the attribution
                    # of a claim already made.
                    "domain": _first_present(c.get("domain"), domain, ""),
                }
                for c in stewards
            ]

        # `save` compacts for itself, so it is handed the *raw* record — a
        # `JSON_NULL` that has already been resolved to `None` would be dropped
        # by the second pass.
        self.save(contribution)
        return ConfirmResult(
            contribution=_compact(contribution),
            verification=verification.summarize_verification(
                base_number, result.confirmations, settings
            ),
            added=True,
        )

    def record_ai_review(
        self,
        contribution_id: str,
        *,
        status: str,
        reviewer: str,
        field_reviews: dict[str, Any] | None = None,
        promotion: dict[str, Any] | None = None,
        note: Any = ...,
    ) -> Contribution | None:
        """Persist the outcome of a field-level AI-draft review.

        Deliberately lexicon-agnostic: the TSV write is
        :func:`~pinakes.contributions.ai_review.promote_contribution`'s job and
        its record is passed in here already made.

        ``note`` distinguishes *absent* (the ellipsis default, leave any existing
        note alone) from an explicit ``None`` — which the TypeScript writer
        stores as a literal ``null``, so this does too.
        """
        contribution = self.get(contribution_id)
        if contribution is None:
            return None
        contribution["status"] = status
        contribution["reviewer"] = reviewer
        contribution["reviewedAt"] = iso_now()
        if field_reviews is not None:
            contribution["fieldReviews"] = field_reviews
        if promotion is not None:
            contribution["promotion"] = promotion
        if note is not ...:
            contribution["reviewNote"] = note
        self.save(contribution)
        return contribution


# ── Module-level access ──────────────────────────────────────────────────────


def queue(directory: Path | None = None) -> ContributionStore:
    """The queue this process serves.

    Built per call from :func:`pinakes.paths.contributions_dir`, which reads its
    environment override every time — so a test redirects the queue by setting
    ``$PINAKES_CONTRIBUTIONS_DIR`` and nothing has to be reset afterwards. There
    is no singleton to go stale, and no cache to disagree with the other server.
    """
    return ContributionStore(
        directory if directory is not None else contributions_dir()
    )


# ── Small helpers ────────────────────────────────────────────────────────────


def iso_now() -> str:
    """``new Date().toISOString()`` — UTC, milliseconds, trailing ``Z``.

    Not ``datetime.isoformat()``: that emits microseconds and ``+00:00``, and the
    queue's timestamps are parsed by the TypeScript reader too.
    """
    stamp = datetime.now(UTC)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{stamp.microsecond // 1000:03d}Z"


def _base36(value: int) -> str:
    if value == 0:
        return "0"
    digits: list[str] = []
    while value > 0:
        value, remainder = divmod(value, 36)
        digits.append(_BASE36[remainder])
    return "".join(reversed(digits))


def _random_suffix() -> str:
    return "".join(random.choice(_BASE36) for _ in range(6))  # noqa: S311


def _cell(value: Any) -> str:
    """One CSV cell: ``String(v)`` when present, else the empty string."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _escape_csv(value: str) -> str:
    if "," in value or '"' in value or "\n" in value:
        return '"' + value.replace('"', '""') + '"'
    return value
