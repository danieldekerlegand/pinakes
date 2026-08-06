"""Community verification — the multi-confirmation threshold logic.

The port of `server/services/community-verification.ts`. One reviewer approving
a contribution is a weak signal; this is the rule that lets **N distinct
reviewers** independently *confirm* one. Each confirmation raises the
contribution's confidence, and once enough distinct reviewers agree it is
**verified**. A steward of the contribution's cultural domain
(:mod:`pinakes.collab.stewardship`) lowers the bar to
``stewardThreshold`` — so data quality scales with domain ownership.

Everything here is pure: the caller passes the confirmation list, the config
and — where a confirmation is stamped — the clock. Persistence lives in
:meth:`pinakes.contributions.store.ContributionStore.confirm` and the HTTP
shape in :mod:`pinakes.routers.community_verification`.

Two JavaScript rules the port has to carry, because both servers read the same
queue and the same responses:

* **A reviewer's dedup key is trimmed and case-folded, but the *stored* name
  keeps its casing** — the same split :func:`~pinakes.collab.stewardship.steward_key`
  makes, and for the same reason: attribution should read the way the reviewer
  typed it.
* **The confidence can be ``NaN``**, because ``Math.round(undefined)`` is, and a
  queue record with no ``confidence`` key is a record the TypeScript writer will
  happily produce. ``JSON.stringify`` writes that as ``null``; Starlette's
  ``JSONResponse`` sets ``allow_nan=False`` and *raises*, so
  :func:`json_confidence` does the conversion before the value reaches a
  response.
"""

from __future__ import annotations

import math
import os
import re
from typing import Any, NamedTuple

from pinakes.analytics.jsmath import js_number, js_round

#: One confirmation, as it is stored on a contribution and served back. A plain
#: dict for the same reason every other record in this service is one: the
#: on-disk shape is the TypeScript writer's, and a key it leaves ``undefined``
#: must be **absent** here rather than ``null``.
Confirmation = dict[str, Any]

#: The verification config, as it is echoed by the verification read.
VerificationConfig = dict[str, int]

#: Distinct reviewers required with, and without, a steward's confirmation.
DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
    "threshold": 3,
    "stewardThreshold": 1,
}

#: Confidence a fully-verified contribution ramps toward. Under 100 on purpose:
#: a verified contribution is well-attested, not certain.
VERIFIED_CONFIDENCE = 99

#: ``parseInt(raw, 10)`` — a leading optional sign and ASCII digits. JavaScript's
#: ``\d`` is ASCII where Python's is Unicode, so this is spelled out rather than
#: written ``\d``: ``VERIFICATION_THRESHOLD=٣`` must fall back to the default,
#: not configure a threshold of three.
_LEADING_INT = re.compile(r"\s*[+-]?[0-9]+")


def js_trim(value: str) -> str:
    """``String.prototype.trim()``.

    Python's ``str.strip()`` is the same set for every character that reaches a
    reviewer name here; spelled as its own function so the call sites read as
    the JavaScript they port and not as an accident of ``strip``'s defaults.
    """
    return value.strip()


def reviewer_key(reviewer: str) -> str:
    """The normalized dedup key for a reviewer name. Never stored."""
    return js_trim(reviewer).lower()


def _parse_threshold(raw: str | None, fallback: int) -> int:
    """``parseInt(raw, 10)`` guarded by ``Number.isFinite(n) && n >= 1``."""
    if raw is None:
        return fallback
    match = _LEADING_INT.match(raw)
    if match is None:
        return fallback
    parsed = int(match.group(0))
    return parsed if parsed >= 1 else fallback


def load_verification_config(
    env: dict[str, str] | None = None,
) -> VerificationConfig:
    """The config from the environment, with the defaults as the fallback.

    ``$VERIFICATION_STEWARD_THRESHOLD`` is clamped to ``threshold``: a steward
    should never need *more* confirmations than an ordinary reviewer would.

    Read per call rather than once at import. Express read its environment at
    route-registration time, which is the same thing for a running server, and
    per call is what makes a test able to set the variables.
    """
    source = os.environ if env is None else env
    threshold = _parse_threshold(
        source.get("VERIFICATION_THRESHOLD"),
        DEFAULT_VERIFICATION_CONFIG["threshold"],
    )
    steward_threshold = _parse_threshold(
        source.get("VERIFICATION_STEWARD_THRESHOLD"),
        DEFAULT_VERIFICATION_CONFIG["stewardThreshold"],
    )
    return {
        "threshold": threshold,
        "stewardThreshold": min(steward_threshold, threshold),
    }


class AddConfirmationResult(NamedTuple):
    """What to persist, and whether the confirmation counted."""

    confirmations: list[Confirmation]
    added: bool
    reason: str | None = None


def add_confirmation(
    existing: list[Confirmation], confirmation: Confirmation
) -> AddConfirmationResult:
    """Append a confirmation, deduping by reviewer.

    A reviewer's repeated confirmation is a **no-op**, not an error to the pure
    layer — independence is the whole point of the count. The route is what
    turns the ``duplicate`` reason into a 409.
    """
    key = reviewer_key(str(confirmation.get("reviewer", "")))
    if any(reviewer_key(str(c.get("reviewer", ""))) == key for c in existing):
        return AddConfirmationResult(existing, False, "duplicate")
    return AddConfirmationResult([*existing, confirmation], True)


def distinct_reviewers(confirmations: list[Confirmation]) -> int:
    """How many distinct reviewers are represented."""
    return len({reviewer_key(str(c.get("reviewer", ""))) for c in confirmations})


def steward_reviewers(confirmations: list[Confirmation]) -> list[str]:
    """Distinct steward reviewers, original casing, first-seen order."""
    seen: set[str] = set()
    out: list[str] = []
    for confirmation in confirmations:
        if not confirmation.get("isSteward"):
            continue
        reviewer = str(confirmation.get("reviewer", ""))
        key = reviewer_key(reviewer)
        if key in seen:
            continue
        seen.add(key)
        out.append(js_trim(reviewer))
    return out


def has_steward_confirmation(confirmations: list[Confirmation]) -> bool:
    """Has a steward of the domain confirmed?

    ``c.isSteward === true`` — a strict identity test, so a truthy non-``True``
    value in a hand-edited record does not lower the bar.
    """
    return any(c.get("isSteward") is True for c in confirmations)


def required_confirmations(
    confirmations: list[Confirmation],
    config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
) -> int:
    """Distinct reviewers needed to verify, given who has confirmed so far."""
    if has_steward_confirmation(confirmations):
        return config["stewardThreshold"]
    return config["threshold"]


def is_verified(
    confirmations: list[Confirmation],
    config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
) -> bool:
    """Have enough distinct reviewers confirmed?"""
    return distinct_reviewers(confirmations) >= required_confirmations(
        confirmations, config
    )


def _clamp(value: float, lo: float, hi: float) -> float:
    """``Math.max(lo, Math.min(hi, value))``.

    Written out rather than as ``min``/``max``: ``Math.min(hi, NaN)`` is ``NaN``
    and propagates, where Python's ``min`` would answer the bound. A record with
    no confidence really does reach the client as ``null``.
    """
    inner = math.nan if math.isnan(value) else min(hi, value)
    return math.nan if math.isnan(inner) else max(lo, inner)


def compute_confidence(
    base: float,
    confirmations: list[Confirmation],
    config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
) -> float:
    """Confidence after applying the confirmations to *base*.

    Ramps linearly from the base toward :data:`VERIFIED_CONFIDENCE` with
    confirmation progress and **never lowers** the base — a confirmation is
    evidence for, and nothing here is evidence against.
    """
    if math.isnan(base):
        return math.nan
    rounded = _clamp(js_round(base), 1, 100)
    distinct = distinct_reviewers(confirmations)
    if distinct == 0:
        return rounded
    required = max(1, required_confirmations(confirmations, config))
    progress = min(1.0, distinct / required)
    ramped = js_round(rounded + (VERIFIED_CONFIDENCE - rounded) * progress)
    return _clamp(max(rounded, ramped), 1, 100)


def base_confidence(contribution: dict[str, Any]) -> float:
    """``contribution.baseConfidence ?? contribution.confidence``, as a number.

    Three readings, and the live diff needed all three:

    * a present, non-null ``baseConfidence`` wins — that is what makes the ramp
      idempotent;
    * **an absent confidence is ``NaN``** (``Math.round(undefined)``), which
      reaches the client as ``null``;
    * **an explicit null confidence is ``0``** (``Number(null)``), which then
      clamps to ``1`` and ramps from there.

    The last two are the same Python ``None`` and different JavaScript values,
    so this is ``"key" in record``'s third appearance in the queue — the rule
    :mod:`pinakes.contributions.store` opens with.
    """
    if contribution.get("baseConfidence") is not None:
        raw = contribution["baseConfidence"]
    elif "confidence" in contribution:
        raw = contribution["confidence"]
    else:
        return math.nan
    return 0.0 if raw is None else float(raw)


def json_confidence(value: float) -> Any:
    """A confidence as ``JSON.stringify`` would write it.

    ``NaN`` is ``null`` (and would otherwise *raise* out of Starlette's
    serialiser), and an integral double has no fractional part on the wire.
    """
    if isinstance(value, float) and math.isnan(value):
        return None
    return js_number(value)


def summarize_verification(
    base: float,
    confirmations: list[Confirmation],
    config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
) -> dict[str, Any]:
    """The whole client-facing verification state for a base + confirmations."""
    return {
        "confirmations": confirmations,
        "distinctReviewers": distinct_reviewers(confirmations),
        "required": required_confirmations(confirmations, config),
        "verified": is_verified(confirmations, config),
        "confidence": json_confidence(compute_confidence(base, confirmations, config)),
        "stewardConfirmed": has_steward_confirmation(confirmations),
        "stewards": steward_reviewers(confirmations),
    }
