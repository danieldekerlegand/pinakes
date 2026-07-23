"""Tests for the acquired-row representation: Provenance and RawRecord."""

import dataclasses

import pytest

from culturescrape.acquire import Provenance, RawRecord


def _provenance(**overrides: object) -> Provenance:
    kwargs: dict[str, object] = {
        "source": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q42",
        "source_query": "SELECT ?item WHERE { ?item wdt:P31 wd:Q5 . }",
        "retrieved_at": "2026-06-16T12:00:00+00:00",
        "confidence": 0.9,
    }
    kwargs.update(overrides)
    return Provenance(**kwargs)  # type: ignore[arg-type]


def test_provenance_construction() -> None:
    prov = _provenance()
    assert prov.source == "wikidata"
    assert prov.confidence == 0.9


def test_provenance_is_frozen() -> None:
    prov = _provenance()
    with pytest.raises(dataclasses.FrozenInstanceError):
        prov.confidence = 0.5  # type: ignore[misc]


def test_raw_record_construction() -> None:
    prov = _provenance()
    record = RawRecord(fields={"name": "Ceviche", "lang": "es"}, provenance=prov)
    assert record.fields["name"] == "Ceviche"
    assert record.provenance is prov


@pytest.mark.parametrize("value", [0.0, 0.5, 1.0])
def test_confidence_in_range_accepted(value: float) -> None:
    assert _provenance(confidence=value).confidence == value


@pytest.mark.parametrize("value", [-0.1, 1.1, 2.0, -1.0])
def test_confidence_out_of_range_rejected(value: float) -> None:
    with pytest.raises(ValueError, match="confidence"):
        _provenance(confidence=value)


@pytest.mark.parametrize(
    "value",
    [
        "2026-06-16T12:00:00Z",
        "2026-06-16T12:00:00+00:00",
        "2026-06-16T12:00:00.123456+00:00",
    ],
)
def test_retrieved_at_utc_accepted(value: str) -> None:
    assert _provenance(retrieved_at=value).retrieved_at == value


@pytest.mark.parametrize(
    "value",
    [
        "not-a-timestamp",
        "2026-06-16T12:00:00+02:00",  # not UTC
        "2026-06-16T12:00:00",  # naive, no offset
    ],
)
def test_retrieved_at_invalid_rejected(value: str) -> None:
    with pytest.raises(ValueError, match="retrieved_at"):
        _provenance(retrieved_at=value)
