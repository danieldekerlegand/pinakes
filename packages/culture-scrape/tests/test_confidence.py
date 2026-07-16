"""Tests for the confidence rubric (US-001).

Verifies the Python priors are well-formed and — when the monorepo checkout is
present — stay in lockstep with the shared ``shared/confidence-rubric.json`` that
the Pinakes TypeScript side reads. The parity check is skipped (not failed)
when the sibling JSON is absent, so the vendored package still tests standalone.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from culturescrape.confidence import (
    CONFIDENCE_PRIORS,
    RUBRIC_VERSION,
    confidence_for,
)

_SHARED_RUBRIC = (
    pathlib.Path(__file__).resolve().parents[3] / "shared" / "confidence-rubric.json"
)


def test_priors_are_well_formed() -> None:
    assert CONFIDENCE_PRIORS, "rubric must define at least one class"
    for name, prior in CONFIDENCE_PRIORS.items():
        assert isinstance(prior, float)
        assert 0.0 <= prior <= 1.0, f"{name} prior out of range"


def test_confidence_for_returns_prior_and_raises_on_unknown() -> None:
    assert confidence_for("qid-anchored") == 1.0
    assert confidence_for("legacy-curated") == 0.5
    assert confidence_for("stub-needs-curation") == 0.0
    with pytest.raises(KeyError):
        confidence_for("does-not-exist")


def test_preserves_historical_acquisition_values() -> None:
    # Grandfathering guarantee: introducing the rubric must not move any adapter's
    # emitted confidence. These pin the class each Python path relies on.
    # qid-anchored: wikidata/getty/pleiades/petscan/wikitext + the lexicon default.
    assert confidence_for("qid-anchored") == 1.0
    assert confidence_for("named-in-linker") == 0.95  # named_in linker
    assert confidence_for("scraped-html") == 0.5  # html adapter


@pytest.mark.skipif(
    not _SHARED_RUBRIC.exists(),
    reason="shared/confidence-rubric.json not present (standalone checkout)",
)
def test_matches_shared_json() -> None:
    shared = json.loads(_SHARED_RUBRIC.read_text())
    assert shared["version"] == RUBRIC_VERSION
    shared_priors = {name: entry["prior"] for name, entry in shared["classes"].items()}
    assert shared_priors == dict(CONFIDENCE_PRIORS), (
        "Python priors drifted from shared/confidence-rubric.json"
    )
    # The Python mapping is ordered most- to least-trusted, mirroring the JSON `order`.
    assert list(CONFIDENCE_PRIORS.keys()) == list(shared["order"])
