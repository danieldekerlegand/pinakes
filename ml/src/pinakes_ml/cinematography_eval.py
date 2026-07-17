"""Cinematography-adherence eval tier (analyzer-bridge US-005, Bridge 3).

The third adherence eval sibling of the VESPACE rule-adherence tier: *does
generated content obey the typed constraint ontology?* Given a list of generated
**shot configs** and the **Analyzer cinematography constraint vocabulary**, it reports
how many constraints each shot list violates, bucketed by ``rule_id`` and
``severity``.

Self-contained + PURE (stdlib only), like the logical-consistency ratchet
(``consistency.py``): it does NOT import Analyzer's ``filmstudio`` package — the
constraint vocabulary is vendored here as data (:data:`CONSTRAINT_VOCAB`, a
faithful mirror of ``filmstudio.core.cinematography_rules.DEFAULT_RULES`` and its
data tables), so the eval runs offline in the slim ``ml/`` env and is CI-testable
against a committed fixture with zero network / zero heavy deps.

A shot config is a plain dict. Its cinematography fields live either at the top
level or under a ``cinematography`` sub-dict (mirroring Analyzer's shot-list shape);
each field value is the enum *value token* (e.g. ``"drone"``, ``"extreme_close_up"``).
The vocabulary is versioned (:data:`CONSTRAINT_VOCAB_VERSION`) so a report records
exactly which constraint set it was measured against.

Everything is a pure function of the shots + vocabulary + optional style, sorted
and wall-clock-free, so :func:`build_report` is byte-reproducible — the same shot
list yields the same committed baseline (a git no-op), the same ratchet shape as
``consistency-baseline.json`` and ``kgqa-eval-baseline.json``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "CONSTRAINT_VOCAB_VERSION",
    "CONSTRAINT_VOCAB",
    "SEVERITY_ERROR",
    "SEVERITY_WARN",
    "Violation",
    "AdherenceReport",
    "evaluate_shotlist",
    "build_report",
]

SEVERITY_ERROR = "error"
SEVERITY_WARN = "warn"

#: Versions the vendored constraint vocabulary so a report is attributable to the
#: exact rule set it was measured against (a rule table change bumps this).
CONSTRAINT_VOCAB_VERSION = "1"

# --- the vendored Analyzer constraint vocabulary (as data) -----------------------
#
# A faithful mirror of ``filmstudio.core.cinematography_rules``. Each pairwise row
# is ``(field_a, value_a, field_b, value_b)``: the rule fires when a shot has BOTH
# fields set to those value tokens. Value tokens are the enum ``.value`` strings.

#: Physically/technically impossible pairings — ``movement_equipment_compat`` (ERROR).
_INCOMPATIBLE_PAIRS: tuple[tuple[str, str, str, str], ...] = (
    ("camera_movement", "drone", "shot_size", "extreme_close_up"),
    ("camera_movement", "drone", "shot_size", "insert"),
    ("camera_movement", "handheld", "camera_height", "overhead"),
)

#: Lens/shot-size pairings that fight the glass — ``lens_shot_size_sanity`` (WARN).
_LENS_SIZE_WARNINGS: tuple[tuple[str, str, str, str], ...] = (
    ("lens", "telephoto", "shot_size", "extreme_wide_shot"),
    ("lens", "wide", "shot_size", "extreme_close_up"),
    ("lens", "fisheye", "shot_size", "close_up"),
    ("lens", "fisheye", "shot_size", "extreme_close_up"),
    ("camera_movement", "dolly_zoom", "lens", "fisheye"),
)

#: Time-of-day/lighting pairings that need motivating — ``time_lighting_consistency``.
_TIME_LIGHTING_WARNINGS: tuple[tuple[str, str, str, str], ...] = (
    ("time_of_day", "night", "lighting", "natural"),
    ("time_of_day", "night", "lighting", "high_key"),
    ("time_of_day", "midday", "lighting", "low_key"),
)

#: Shot-size ladder (widest→tightest) for the intra-scene size-jump check. The
#: non-scalar sizes (OTS/POV/two-shot/insert) are deliberately absent.
_SIZE_RANK: dict[str, int] = {
    "extreme_wide_shot": 0,
    "wide_shot": 1,
    "full_shot": 2,
    "medium_shot": 3,
    "medium_close_up": 4,
    "close_up": 5,
    "extreme_close_up": 6,
}
#: Adjacent shots this many ladder-steps apart or more are a jarring cut.
_MAX_SIZE_JUMP = 4

#: Rough full-frame focal range per lens family (``focal_lens_consistency``, WARN).
_FOCAL_HINTS: dict[str, tuple[int, int]] = {
    "wide": (14, 35),
    "normal": (40, 58),
    "telephoto": (85, 300),
    "anamorphic": (40, 100),
    "macro": (60, 105),
    "fisheye": (8, 16),
}

#: The constrained enum fields and their legal value tokens (documentation + the
#: vocabulary a downstream shot-designer offers). Mirrors ``_FIELD_ENUMS``.
_FIELD_ENUMS: dict[str, tuple[str, ...]] = {
    "shot_size": (
        "extreme_wide_shot", "wide_shot", "full_shot", "medium_shot",
        "medium_close_up", "close_up", "extreme_close_up", "over_the_shoulder",
        "point_of_view", "two_shot", "insert",
    ),
    "camera_movement": (
        "static", "pan", "tilt", "dolly", "truck", "pedestal", "zoom", "handheld",
        "steadicam", "crane", "jib", "drone", "whip_pan", "dolly_zoom",
    ),
    "lens": ("wide", "normal", "telephoto", "anamorphic", "macro", "fisheye"),
    "lighting": (
        "high_key", "low_key", "rembrandt", "silhouette", "practical", "natural",
        "backlit", "hard", "soft", "chiaroscuro",
    ),
    "time_of_day": (
        "dawn", "morning", "midday", "golden_hour", "dusk", "blue_hour", "night",
    ),
    "palette": (
        "warm", "cool", "neutral", "monochrome", "pastel", "saturated",
        "desaturated", "teal_orange", "sepia",
    ),
    "aspect": ("1.37:1", "1.85:1", "2.39:1", "16:9", "4:3", "1:1"),
}

#: rule_id → severity for every rule this tier evaluates. The report always emits
#: a count for each of these, even at zero, so a clean shot list is legible.
_RULE_SEVERITY: dict[str, str] = {
    "movement_equipment_compat": SEVERITY_ERROR,
    "lens_shot_size_sanity": SEVERITY_WARN,
    "aspect_constraints": SEVERITY_WARN,
    "time_lighting_consistency": SEVERITY_WARN,
    "focal_lens_consistency": SEVERITY_WARN,
    "style_era_lock": SEVERITY_ERROR,
    "scene_aspect_uniformity": SEVERITY_WARN,
    "scene_size_jumps": SEVERITY_WARN,
}

#: The full vocabulary as a JSON-ready dict — the committed, corpus-independent
#: artifact (``ml/cinematography/constraint-vocab.json``), CI-gated byte-for-byte
#: against this module so the emitted vocab and the evaluator can never drift.
CONSTRAINT_VOCAB: dict[str, Any] = {
    "version": CONSTRAINT_VOCAB_VERSION,
    "source": "analyzer",
    "ruleSeverity": dict(sorted(_RULE_SEVERITY.items())),
    "incompatiblePairs": [list(p) for p in _INCOMPATIBLE_PAIRS],
    "lensSizeWarnings": [list(p) for p in _LENS_SIZE_WARNINGS],
    "timeLightingWarnings": [list(p) for p in _TIME_LIGHTING_WARNINGS],
    "sizeRank": dict(_SIZE_RANK),
    "maxSizeJump": _MAX_SIZE_JUMP,
    "focalHints": {k: list(v) for k, v in _FOCAL_HINTS.items()},
    "fields": {k: list(v) for k, v in _FIELD_ENUMS.items()},
}


# --- shot-config access -------------------------------------------------------


def _config_of(shot: Mapping[str, Any]) -> Mapping[str, Any]:
    """The cinematography fields of a shot — the ``cinematography`` sub-dict when
    present (Analyzer's shot-list shape), else the shot dict itself (flat configs)."""
    block = shot.get("cinematography")
    return block if isinstance(block, Mapping) else shot


def _shot_id(shot: Mapping[str, Any], index: int) -> str:
    sid = str(shot.get("id") or shot.get("shot_id") or "").strip()
    return sid or f"shot_{index + 1:03d}"


def _get(config: Mapping[str, Any], field_name: str) -> str | None:
    """A shot's value token for a field, or ``None`` when unset/blank."""
    value = config.get(field_name)
    if value is None:
        return None
    token = str(value).strip()
    return token or None


# --- the report ---------------------------------------------------------------


@dataclass(frozen=True)
class Violation:
    """One constraint a shot list broke."""

    shot_id: str
    index: int
    rule_id: str
    severity: str
    field: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "shot_id": self.shot_id,
            "index": self.index,
            "rule_id": self.rule_id,
            "severity": self.severity,
            "field": self.field,
        }

    def _sort_key(self) -> tuple[Any, ...]:
        return (self.index, self.rule_id, self.field, self.severity, self.shot_id)


@dataclass(frozen=True)
class AdherenceReport:
    """Aggregate + per-shot cinematography-adherence result over a shot list."""

    checked: int  #: shots that carried any cinematography field (were validated)
    violations: list[Violation] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """True when no ERROR-severity constraint was violated."""
        return not any(v.severity == SEVERITY_ERROR for v in self.violations)

    def counts_by_rule(self) -> dict[str, int]:
        counts = {rule_id: 0 for rule_id in sorted(_RULE_SEVERITY)}
        for v in self.violations:
            counts[v.rule_id] = counts.get(v.rule_id, 0) + 1
        return counts

    def counts_by_severity(self) -> dict[str, int]:
        counts = {SEVERITY_ERROR: 0, SEVERITY_WARN: 0}
        for v in self.violations:
            counts[v.severity] = counts.get(v.severity, 0) + 1
        return counts

    def as_dict(self) -> dict[str, Any]:
        """Deterministic report body: aggregate counts + the sorted violation list."""
        return {
            "vocabVersion": CONSTRAINT_VOCAB_VERSION,
            "checked": self.checked,
            "ok": self.ok,
            "total": len(self.violations),
            "countsByRule": self.counts_by_rule(),
            "countsBySeverity": self.counts_by_severity(),
            "violations": [v.as_dict() for v in self.violations],
        }


# --- style locks (optional) ---------------------------------------------------


def _style_violations(config: Mapping[str, Any], style: Mapping[str, Any] | None,
                      shot_id: str, index: int) -> Iterable[Violation]:
    """A project style lock: per-field ``allowed`` whitelists / ``forbidden``
    blacklists. Value tokens; a field absent from both is unconstrained. Off-style
    values are ERROR (``style_era_lock``)."""
    if not style:
        return
    allowed = style.get("allowed") or {}
    forbidden = style.get("forbidden") or {}
    for field_name in _FIELD_ENUMS:
        value = _get(config, field_name)
        if value is None:
            continue
        allow = allowed.get(field_name)
        forbid = forbidden.get(field_name)
        off_style = (allow is not None and value not in allow) or (
            forbid is not None and value in forbid)
        if off_style:
            yield Violation(
                shot_id, index, "style_era_lock", SEVERITY_ERROR, field_name)


# --- shot-scope + scene-scope checks ------------------------------------------


def _pairwise(config: Mapping[str, Any],
              pairs: Iterable[tuple[str, str, str, str]]) -> list[str]:
    """The constrained (second) field of every pairwise row both of whose fields
    match this config — the field the violation lands on."""
    hits: list[str] = []
    for field_a, val_a, field_b, val_b in pairs:
        if _get(config, field_a) == val_a and _get(config, field_b) == val_b:
            hits.append(field_b)
    return hits


def _aspect_violations(config: Mapping[str, Any]) -> bool:
    """``aspect_constraints`` (WARN): anamorphic glass implies a scope frame; a
    vertical/square frame guts an extreme-wide establishing shot."""
    lens = _get(config, "lens")
    aspect = _get(config, "aspect")
    shot_size = _get(config, "shot_size")
    if lens == "anamorphic" and aspect not in (None, "2.39:1"):
        return True
    if aspect in ("1:1",) and shot_size == "extreme_wide_shot":
        return True
    return False


def _focal_violation(config: Mapping[str, Any]) -> bool:
    """``focal_lens_consistency`` (WARN): an explicit ``focal_mm`` outside the lens
    family's rough range."""
    lens = _get(config, "lens")
    focal = config.get("focal_mm")
    if lens is None or focal is None or lens not in _FOCAL_HINTS:
        return False
    try:
        mm = int(focal)
    except (TypeError, ValueError):
        return False
    lo, hi = _FOCAL_HINTS[lens]
    return not (lo <= mm <= hi)


def _shot_violations(config: Mapping[str, Any], style: Mapping[str, Any] | None,
                     shot_id: str, index: int) -> list[Violation]:
    out: list[Violation] = []
    for fld in _pairwise(config, _INCOMPATIBLE_PAIRS):
        out.append(Violation(shot_id, index, "movement_equipment_compat",
                             SEVERITY_ERROR, fld))
    for fld in _pairwise(config, _LENS_SIZE_WARNINGS):
        out.append(Violation(shot_id, index, "lens_shot_size_sanity",
                             SEVERITY_WARN, fld))
    for fld in _pairwise(config, _TIME_LIGHTING_WARNINGS):
        out.append(Violation(shot_id, index, "time_lighting_consistency",
                             SEVERITY_WARN, fld))
    if _aspect_violations(config):
        out.append(Violation(shot_id, index, "aspect_constraints",
                             SEVERITY_WARN, "aspect"))
    if _focal_violation(config):
        out.append(Violation(shot_id, index, "focal_lens_consistency",
                             SEVERITY_WARN, "focal_mm"))
    out.extend(_style_violations(config, style, shot_id, index))
    return out


def _scene_violations(shots: Sequence[Mapping[str, Any]], ids: Sequence[str],
                      configs: Sequence[Mapping[str, Any]]) -> list[Violation]:
    out: list[Violation] = []
    # aspect uniformity: flag every shot that breaks from the first set aspect.
    anchor: str | None = None
    for config in configs:
        anchor = _get(config, "aspect")
        if anchor is not None:
            break
    if anchor is not None:
        for i, config in enumerate(configs):
            aspect = _get(config, "aspect")
            if aspect is not None and aspect != anchor:
                out.append(Violation(ids[i], i, "scene_aspect_uniformity",
                                     SEVERITY_WARN, "aspect"))
    # size jumps: adjacent shots leaping across the ladder.
    for i in range(1, len(configs)):
        prev = _get(configs[i - 1], "shot_size")
        cur = _get(configs[i], "shot_size")
        if prev in _SIZE_RANK and cur in _SIZE_RANK:
            if abs(_SIZE_RANK[prev] - _SIZE_RANK[cur]) >= _MAX_SIZE_JUMP:
                out.append(Violation(ids[i], i, "scene_size_jumps",
                                     SEVERITY_WARN, "shot_size"))
    return out


def evaluate_shotlist(shots: Sequence[Mapping[str, Any]],
                      style: Mapping[str, Any] | None = None) -> AdherenceReport:
    """Evaluate a shot list against the constraint vocabulary.

    ``shots`` is a list of shot dicts (cinematography fields at the top level or
    under a ``cinematography`` key). ``style`` is an optional project style lock
    (``{name, allowed, forbidden}`` with value-token lists). Returns an
    :class:`AdherenceReport` whose violations are sorted for byte-stability.
    """
    valid = [s for s in shots if isinstance(s, Mapping)]
    ids = [_shot_id(s, i) for i, s in enumerate(valid)]
    configs = [_config_of(s) for s in valid]

    violations: list[Violation] = []
    checked = 0
    for i, config in enumerate(configs):
        if any(_get(config, f) is not None for f in _FIELD_ENUMS) or (
            config.get("focal_mm") is not None
        ):
            checked += 1
        violations.extend(_shot_violations(config, style, ids[i], i))
    violations.extend(_scene_violations(valid, ids, configs))

    violations.sort(key=lambda v: v._sort_key())
    return AdherenceReport(checked=checked, violations=violations)


def build_report(shots: Sequence[Mapping[str, Any]],
                 style: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The deterministic, committable report dict for a shot list + optional style."""
    return evaluate_shotlist(shots, style).as_dict()
