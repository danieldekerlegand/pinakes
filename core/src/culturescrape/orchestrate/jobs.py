"""End-to-end pipeline jobs loaded from ``jobs/<name>.yml``.

A *job* declares how one or more categories run through the pipeline: which
category specs to process, which ordered stages to run
(``acquire -> normalize -> link -> export``), and where each stage writes its
output. Declaring it in YAML makes a whole-corpus run reproducible and
version-controlled, the same way a ``categories/<name>.yml`` makes one
acquisition reproducible.

:func:`load_job` parses one such file, validates it — including every
referenced category spec — and returns a typed :class:`Job`. Validation is
exhaustive: every problem found is reported together in a single
:class:`JobConfigError`.

Relative paths (the referenced categories and ``output_root``) resolve against
the job file's own directory, so a job is self-contained wherever the repo
lives.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from culturescrape.acquire.categories import (
    CategorySpec,
    CategorySpecError,
    load_category,
)
from culturescrape.orchestrate.qa import GateThresholds

#: Pipeline stages in canonical execution order (see ``PLAN.md`` data flow).
STAGE_ORDER = ("acquire", "normalize", "link", "export")
#: Stages a job may request; the same set, for membership tests.
VALID_STAGES = frozenset(STAGE_ORDER)

_REQUIRED_KEYS = ("name", "categories", "output_root")
_OPTIONAL_KEYS = (
    "description",
    "stages",
    "min_provenance_completeness",
    "min_component_fraction",
    "reconcile_shared_qids",
    "tiered_trust",
    "tier_gates",
)
_ALLOWED_KEYS = frozenset(_REQUIRED_KEYS + _OPTIONAL_KEYS)


class JobConfigError(ValueError):
    """Raised when a job file is unreadable or fails validation."""


@dataclass(frozen=True)
class Job:
    """A parsed, validated ``jobs/<name>.yml`` document.

    Attributes:
        name: Stable job id (e.g. ``seed-corpus``).
        description: Human-readable gloss (may be empty).
        categories: The category specs to process, in declaration order.
        stages: Stages to run, in canonical :data:`STAGE_ORDER` (a subset).
        output_root: Directory under which per-stage outputs are written.
        min_provenance_completeness: Optional override for the corpus QA
            provenance-completeness floor (``None`` keeps the default). A corpus
            built entirely from a source that carries no external ``source_url``
            (e.g. a pinakes-only convergence corpus) relaxes this — the
            source-of-record provenance is still enforced by the pinakes
            provenance gate.
        min_component_fraction: Optional override for the connectivity floor
            (``None`` keeps the default). A small single-domain fixture corpus
            need not reach the multi-domain seed corpus's connectivity.
        reconcile_shared_qids: When true, collapse nodes that share a Wikidata
            QID but were minted under different node types into one before the
            corpus is written (a merged corpus stitching several sources needs
            this so one QID is one node — see ``ontology.reconcile_qid``).
        tiered_trust: When true, the corpus build classifies every row into a
            trust tier (``curated`` / ``auto-admitted`` / ``quarantine`` /
            ``inferred`` — see :mod:`culturescrape.orchestrate.tiers`), writes a
            composition-by-tier manifest, and grades each tier against its own QA
            gates. Off by default so single-source builds are byte-identical.
        tier_gates: Per-tier QA threshold overrides, keyed by tier name; each
            value is a partial :class:`~culturescrape.orchestrate.qa.GateThresholds`
            mapping. A tier absent here uses its
            :data:`~culturescrape.orchestrate.tiers.DEFAULT_TIER_GATES` entry.
            Only meaningful with ``tiered_trust``.
    """

    name: str
    description: str
    categories: tuple[CategorySpec, ...]
    stages: tuple[str, ...]
    output_root: Path
    min_provenance_completeness: float | None = None
    min_component_fraction: float | None = None
    reconcile_shared_qids: bool = False
    tiered_trust: bool = False
    tier_gates: Mapping[str, GateThresholds] = field(default_factory=dict)

    def output_dir(self, stage: str) -> Path:
        """Return the output directory for *stage* under :attr:`output_root`.

        Raises:
            ValueError: If *stage* is not one of this job's :attr:`stages`.
        """
        if stage not in self.stages:
            raise ValueError(
                f"stage {stage!r} is not run by job {self.name!r}; "
                f"runs: {', '.join(self.stages)}"
            )
        return self.output_root / stage


def load_job(path: str | Path) -> Job:
    """Load and validate the job declared in *path*.

    Raises:
        JobConfigError: If the file cannot be read, is not valid YAML, or does
            not match the schema. The message lists every problem found,
            including failures in any referenced category spec.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise JobConfigError(f"cannot read job file {path}: {exc}") from exc
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise JobConfigError(f"{path}: invalid YAML: {exc}") from exc
    return _parse(raw, path)


def _parse(raw: object, path: Path) -> Job:
    if not isinstance(raw, dict):
        raise JobConfigError(
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

    if "name" in raw and not _is_nonempty_str(raw["name"]):
        errors.append("'name' must be a non-empty string")

    description = raw.get("description", "")
    if "description" in raw and not isinstance(description, str):
        errors.append("'description' must be a string")
        description = ""

    min_provenance = _parse_fraction(
        raw.get("min_provenance_completeness"), "min_provenance_completeness", errors
    )
    min_component = _parse_fraction(
        raw.get("min_component_fraction"), "min_component_fraction", errors
    )
    reconcile_qids = _parse_bool(
        raw.get("reconcile_shared_qids"), "reconcile_shared_qids", errors
    )
    tiered_trust = _parse_bool(raw.get("tiered_trust"), "tiered_trust", errors)
    tier_gates = _parse_tier_gates(raw.get("tier_gates"), errors)

    stages = _parse_stages(raw.get("stages"), errors)
    categories = (
        _parse_categories(raw.get("categories"), path, errors)
        if "categories" in raw
        else ()
    )
    output_root = (
        _parse_output_root(raw.get("output_root"), path, errors)
        if "output_root" in raw
        else None
    )

    if errors:
        raise JobConfigError(
            f"{path}: invalid job config:\n  - " + "\n  - ".join(errors)
        )

    assert output_root is not None  # guaranteed: missing key would have errored
    return Job(
        name=str(raw["name"]),
        description=str(description),
        categories=categories,
        stages=stages,
        output_root=output_root,
        min_provenance_completeness=min_provenance,
        min_component_fraction=min_component,
        reconcile_shared_qids=reconcile_qids,
        tiered_trust=tiered_trust,
        tier_gates=tier_gates,
    )


def _parse_stages(value: object, errors: list[str]) -> tuple[str, ...]:
    if value is None:  # omitted: run the full pipeline
        return STAGE_ORDER
    if not isinstance(value, list) or not all(isinstance(s, str) for s in value):
        errors.append("'stages' must be a list of strings")
        return ()
    if not value:
        errors.append("'stages' must list at least one stage")
    invalid = [s for s in value if s not in VALID_STAGES]
    if invalid:
        errors.append(
            f"invalid stages: {', '.join(invalid)}; valid: "
            f"{', '.join(STAGE_ORDER)}"
        )
    duplicates = sorted({s for s in value if value.count(s) > 1})
    if duplicates:
        errors.append(f"duplicate stages: {', '.join(duplicates)}")
    return tuple(s for s in STAGE_ORDER if s in value)


def _parse_categories(
    value: object, path: Path, errors: list[str]
) -> tuple[CategorySpec, ...]:
    if not isinstance(value, list):
        errors.append("'categories' must be a list of category file paths")
        return ()
    if not value:
        errors.append("'categories' must list at least one category")
        return ()
    base = path.parent
    specs: list[CategorySpec] = []
    for index, item in enumerate(value):
        if not _is_nonempty_str(item):
            errors.append(f"categories[{index}] must be a non-empty string path")
            continue
        ref = Path(item)
        resolved = ref if ref.is_absolute() else base / ref
        try:
            specs.append(load_category(resolved))
        except CategorySpecError as exc:
            errors.append(f"categories[{index}] ({item}): {exc}")
    return tuple(specs)


def _parse_fraction(value: object, key: str, errors: list[str]) -> float | None:
    """Parse an optional ``[0, 1]`` fraction override, or ``None`` when omitted."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append(f"{key!r} must be a number between 0 and 1")
        return None
    number = float(value)
    if not 0.0 <= number <= 1.0:
        errors.append(f"{key!r} must be between 0 and 1, got {number}")
        return None
    return number


def _parse_bool(value: object, key: str, errors: list[str]) -> bool:
    """Parse an optional boolean flag, defaulting to ``False`` when omitted."""
    if value is None:
        return False
    if not isinstance(value, bool):
        errors.append(f"{key!r} must be a boolean (true/false)")
        return False
    return value


def _parse_tier_gates(
    value: object, errors: list[str]
) -> Mapping[str, GateThresholds]:
    """Parse an optional per-tier QA-threshold override map, or ``{}`` when omitted.

    Each key must be a known tier (``curated`` / ``auto-admitted`` / ...) and each
    value a mapping of :class:`~culturescrape.orchestrate.qa.GateThresholds`
    fields; a partial mapping keeps that tier's defaults for the rest. An unknown
    tier or a non-numeric threshold is a validation error.
    """
    # Imported here (not at module top) to avoid a jobs<->tiers import order
    # coupling: tiers imports the QA/manifest layer, jobs only needs the names.
    from culturescrape.orchestrate.tiers import ALL_TIERS

    if value is None:
        return {}
    if not isinstance(value, dict):
        errors.append("'tier_gates' must be a mapping of tier -> threshold mapping")
        return {}
    gates: dict[str, GateThresholds] = {}
    for tier, overrides in value.items():
        if tier not in ALL_TIERS:
            errors.append(
                f"tier_gates: unknown tier {tier!r}; valid: {', '.join(ALL_TIERS)}"
            )
            continue
        if not isinstance(overrides, dict):
            errors.append(f"tier_gates[{tier!r}] must be a mapping of thresholds")
            continue
        try:
            gates[str(tier)] = GateThresholds.from_dict(overrides)
        except ValueError as exc:
            errors.append(f"tier_gates[{tier!r}]: {exc}")
    return gates


def _parse_output_root(value: object, path: Path, errors: list[str]) -> Path | None:
    if not _is_nonempty_str(value):
        errors.append("'output_root' must be a non-empty string path")
        return None
    ref = Path(str(value))
    return ref if ref.is_absolute() else path.parent / ref


def _is_nonempty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
