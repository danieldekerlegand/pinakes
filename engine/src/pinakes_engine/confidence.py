"""Confidence rubric — per-provenance-class priors (tiered-trust corpus, US-001).

The single source of truth for what a ``confidence`` number MEANS. Before this
rubric, confidence was a blanket per-source constant scattered across the acquire
adapters and linkers (Wikidata / Getty / Pleiades / PetScan / Wikitext pulls all
stamped ``1.0``; HTML scraping ``0.5``; the named-in linker ``0.95``), so a
downstream probabilistic engine would learn from fake uncertainty. Each provenance
class carries a numeric prior in ``[0, 1]`` and a rationale; adapters and linkers
name their class via :func:`confidence_for` instead of hard-coding a literal, so
the numbers are tuned in ONE place.

That one place is ``contracts/confidence-rubric.json``, and this module now
**re-exports** its generated Python binding
(:mod:`pinakes_contracts.confidence_rubric`) rather than transcribing the priors.
It used to hold its own copy, kept honest by a skip-if-absent parity test — a
guard that could only fail *after* a divergence was committed, and that silently
degraded to a skip in a checkout without the sibling JSON. The binding is a
declared dependency (``pinakes-contracts``, a workspace member), so there is no
longer a second copy for the test to police (40-contracts-codegen US-1).

The priors were chosen to preserve every historically-emitted confidence value, so
introducing the rubric was data-neutral.
"""

from __future__ import annotations

from pinakes_contracts.confidence_rubric import (
    CONFIDENCE_PRIORS,
    VERSION,
    confidence_for,
)

#: Rubric version — ``contracts/confidence-rubric.json`` ``version``.
RUBRIC_VERSION: str = VERSION

__all__ = ["CONFIDENCE_PRIORS", "RUBRIC_VERSION", "confidence_for"]
