"""Confidence rubric — per-provenance-class priors (tiered-trust corpus, US-001).

The single source of truth for what a ``confidence`` number MEANS. Before this
rubric, confidence was a blanket per-source constant scattered across the acquire
adapters and linkers (Wikidata / Getty / Pleiades / PetScan / Wikitext pulls all
stamped ``1.0``; HTML scraping ``0.5``; the named-in linker ``0.95``), so a
downstream probabilistic engine would learn from fake uncertainty. Each provenance
class here carries a numeric prior in ``[0, 1]`` and a rationale; adapters and
linkers name their class via :func:`confidence_for` instead of hard-coding a
literal, so the numbers are tuned in ONE place.

This mirrors the repo-root ``shared/confidence-rubric.json`` that the pinakes
TypeScript side reads; the values are kept in lockstep by ``tests/test_confidence.py``
(which reads that JSON when the monorepo checkout is present). pinakes-engine is a
vendored, self-contained copy, so the priors are defined here rather than loaded
from the sibling package at runtime.

The priors were chosen to preserve every historically-emitted confidence value, so
introducing the rubric is data-neutral.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

#: Rubric version — mirrors ``shared/confidence-rubric.json`` ``version``.
RUBRIC_VERSION = "1.0"

#: Provenance class -> numeric prior in ``[0, 1]``. Ordered most- to least-trusted.
_PRIORS: Mapping[str, float] = {
    "qid-anchored": 1.0,
    "named-in-linker": 0.95,
    "referenced-wikidata": 0.9,
    "exact-reconciled": 0.9,
    "curated-verified": 0.8,
    "unreferenced-wikidata": 0.8,
    "fuzzy-reconciled": 0.7,
    "inferred": 0.6,
    "scraped-html": 0.5,
    "legacy-curated": 0.5,
    "stub-needs-curation": 0.0,
}

#: Read-only view of the priors (the public source of truth for Python callers).
CONFIDENCE_PRIORS: Mapping[str, float] = MappingProxyType(dict(_PRIORS))


def confidence_for(provenance_class: str) -> float:
    """Return the confidence prior for ``provenance_class``.

    Raises :class:`KeyError` for an unknown class so a typo fails loudly rather
    than silently stamping a wrong number.
    """
    try:
        return CONFIDENCE_PRIORS[provenance_class]
    except KeyError as exc:  # pragma: no cover - defensive
        raise KeyError(
            f"confidence-rubric: unknown provenance class {provenance_class!r}"
        ) from exc
