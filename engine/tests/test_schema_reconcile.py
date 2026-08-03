"""Tests for reconciling name-anchored node rows to Wikidata QIDs.

A fake transport replays a recorded reconciliation-API JSON fixture through the
real cached :class:`~pinakes_engine.acquire.http.HttpClient`, so the request
shape, the threshold/ambiguity decision, and the effect on a row (QID, re-minted
``csid``, confidence, recorded provenance) are exercised without live network.
The fixtures cover the three decisions the acceptance criteria require: a
confident **match**, an **ambiguous** pair, and a below-threshold **none**.
"""

import json
from collections.abc import Mapping
from pathlib import Path

import pytest

from pinakes_engine.acquire.http import HttpClient, HttpResponse
from pinakes_engine.schema import (
    OVERFLOW_KEY,
    RECONCILIATION_KEY,
    ReconciliationCandidate,
    ReconciliationDecision,
    ReconciliationError,
    Row,
    WikidataReconciler,
    reconcile_row,
    reconcile_rows,
)
from pinakes_engine.schema.reconcile import WIKIDATA_RECONCILE_ENDPOINT

_FIXTURES = Path(__file__).parent / "fixtures" / "reconcile"


class _FakeTransport:
    """Transport that returns a fixed body and records the calls made."""

    def __init__(self, body: str, status_code: int = 200) -> None:
        self._body = body
        self._status_code = status_code
        self.calls: list[tuple[str, str, dict[str, str]]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self.calls.append((method, url, dict(params or {})))
        return HttpResponse(
            url=url, status_code=self._status_code, text=self._body, headers={}
        )


def _client(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )


def _fixture(name: str) -> str:
    return (_FIXTURES / f"{name}.json").read_text(encoding="utf-8")


def _reconciler(
    tmp_path: Path, transport: _FakeTransport, **kwargs: object
) -> WikidataReconciler:
    return WikidataReconciler(_client(tmp_path, transport), **kwargs)  # type: ignore[arg-type]


def _row(**overrides: object) -> Row:
    base: Row = {
        ":LABEL": ["Dish", "CulturalArtifact"],
        "name": "ceviche",
        "lang": "en",
        "csid": "cs:dish:ceviche-deadbeefdeadbeef",
        "confidence": "0.9",
    }
    base.update(overrides)  # type: ignore[arg-type]
    return base


# --- request shape ---------------------------------------------------------


def test_request_targets_language_endpoint_with_typed_query(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture("match"))
    _reconciler(tmp_path, transport).reconcile(
        "ceviche", type_hint="Dish", lang="es"
    )

    method, url, params = transport.calls[0]
    assert method == "GET"
    assert url == f"{WIKIDATA_RECONCILE_ENDPOINT}/es/api"
    query = json.loads(params["queries"])["q0"]
    assert query["query"] == "ceviche"
    assert query["type"] == "Dish"
    assert query["limit"] == 5


def test_type_hint_is_omitted_when_absent(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture("match"))
    _reconciler(tmp_path, transport).reconcile("ceviche")

    query = json.loads(transport.calls[0][2]["queries"])["q0"]
    assert "type" not in query


def test_second_reconcile_is_served_from_cache(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture("match"))
    reconciler = _reconciler(tmp_path, transport)

    reconciler.reconcile("ceviche", type_hint="Dish")
    reconciler.reconcile("ceviche", type_hint="Dish")

    assert len(transport.calls) == 1  # identical query served from disk cache


# --- decisions -------------------------------------------------------------


def test_match_above_threshold_is_accepted(tmp_path: Path) -> None:
    result = _reconciler(tmp_path, _FakeTransport(_fixture("match"))).reconcile(
        "ceviche", type_hint="Dish"
    )
    assert result.decision is ReconciliationDecision.MATCHED
    assert result.qid == "Q207058"
    assert result.score == 98.5


def test_close_runner_up_is_ambiguous(tmp_path: Path) -> None:
    result = _reconciler(tmp_path, _FakeTransport(_fixture("ambiguous"))).reconcile(
        "San Francisco", type_hint="Place"
    )
    assert result.decision is ReconciliationDecision.AMBIGUOUS
    assert result.qid is None
    assert result.score == 91.0


def test_below_threshold_is_none(tmp_path: Path) -> None:
    result = _reconciler(tmp_path, _FakeTransport(_fixture("none"))).reconcile(
        "vaguely similar thing"
    )
    assert result.decision is ReconciliationDecision.NONE
    assert result.qid is None
    assert result.score == 33.0


def test_no_candidates_is_none(tmp_path: Path) -> None:
    result = _reconciler(tmp_path, _FakeTransport(_fixture("empty"))).reconcile(
        "nothing here"
    )
    assert result.decision is ReconciliationDecision.NONE
    assert result.qid is None
    assert result.score is None
    assert result.candidates == ()


def test_threshold_is_configurable(tmp_path: Path) -> None:
    # With a threshold above the top score, the same fixture yields no match.
    result = _reconciler(
        tmp_path, _FakeTransport(_fixture("match")), threshold=99.0
    ).reconcile("ceviche")
    assert result.decision is ReconciliationDecision.NONE


def test_candidates_are_sorted_best_first(tmp_path: Path) -> None:
    result = _reconciler(tmp_path, _FakeTransport(_fixture("match"))).reconcile(
        "ceviche"
    )
    scores = [c.score for c in result.candidates]
    assert scores == sorted(scores, reverse=True)
    assert result.candidates[0] == ReconciliationCandidate(
        qid="Q207058", name="ceviche", score=98.5, match=True
    )


# --- transport errors ------------------------------------------------------


def test_error_status_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("upstream boom", status_code=500)
    with pytest.raises(ReconciliationError, match="status 500"):
        _reconciler(tmp_path, transport).reconcile("ceviche")


def test_non_json_body_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("<html>not json</html>")
    with pytest.raises(ReconciliationError, match="non-JSON"):
        _reconciler(tmp_path, transport).reconcile("ceviche")


# --- applying a decision to a row ------------------------------------------


def test_match_sets_qid_and_remints_csid(tmp_path: Path) -> None:
    row = _row()
    reconciler = _reconciler(tmp_path, _FakeTransport(_fixture("match")))
    result = reconcile_row(row, reconciler)

    assert result is not None and result.decision is ReconciliationDecision.MATCHED
    assert row["wikidata_qid"] == "Q207058"
    assert row["csid"] == "cs:dish:Q207058"  # re-minted QID-anchored
    assert row["confidence"] == "0.9"  # confidence untouched on a match


def test_two_sources_of_same_entity_collapse_to_one_csid(tmp_path: Path) -> None:
    wikidata_row = _row(name="ceviche")
    petscan_row = _row(name="Cebiche", csid="cs:dish:cebiche-cafefeed00000000")
    reconciler = _reconciler(tmp_path, _FakeTransport(_fixture("match")))

    reconcile_row(wikidata_row, reconciler)
    reconcile_row(petscan_row, reconciler)

    assert wikidata_row["csid"] == petscan_row["csid"] == "cs:dish:Q207058"


def test_none_leaves_qid_null_and_lowers_confidence(tmp_path: Path) -> None:
    row = _row(name="vaguely similar thing")
    reconcile_row(row, _reconciler(tmp_path, _FakeTransport(_fixture("none"))))

    assert "wikidata_qid" not in row
    assert row["csid"] == "cs:dish:ceviche-deadbeefdeadbeef"  # unchanged
    assert row["confidence"] == repr(0.45)  # 0.9 * default 0.5 penalty


def test_ambiguous_leaves_qid_null_and_lowers_confidence(tmp_path: Path) -> None:
    row = _row(name="San Francisco", confidence="0.8")
    reconcile_row(
        row,
        _reconciler(tmp_path, _FakeTransport(_fixture("ambiguous"))),
        no_match_penalty=0.25,
    )
    assert "wikidata_qid" not in row
    assert row["confidence"] == repr(0.2)


def test_decision_is_recorded_in_provenance(tmp_path: Path) -> None:
    row = _row()
    reconcile_row(row, _reconciler(tmp_path, _FakeTransport(_fixture("match"))))

    overflow = json.loads(row[OVERFLOW_KEY])  # type: ignore[arg-type]
    record = overflow[RECONCILIATION_KEY]
    assert record["decision"] == "matched"
    assert record["qid"] == "Q207058"
    assert record["score"] == 98.5
    assert record["candidates"] == 2


def test_recording_preserves_existing_overflow(tmp_path: Path) -> None:
    row = _row(**{OVERFLOW_KEY: json.dumps({"spiciness": "high"})})
    reconcile_row(row, _reconciler(tmp_path, _FakeTransport(_fixture("none"))))

    overflow = json.loads(row[OVERFLOW_KEY])  # type: ignore[arg-type]
    assert overflow["spiciness"] == "high"  # untouched raw field
    assert overflow[RECONCILIATION_KEY]["decision"] == "none"


def test_row_with_existing_qid_is_skipped(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture("match"))
    row = _row(wikidata_qid="Q12345")
    result = reconcile_row(row, _reconciler(tmp_path, transport))

    assert result is None
    assert transport.calls == []  # no network touched
    assert row["wikidata_qid"] == "Q12345"


def test_row_without_name_is_skipped(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture("match"))
    row: Row = {":LABEL": ["Dish"], "confidence": "0.9"}
    assert reconcile_row(row, _reconciler(tmp_path, transport)) is None
    assert transport.calls == []


def test_reconcile_rows_processes_each_row(tmp_path: Path) -> None:
    rows = [_row(name="ceviche"), _row(wikidata_qid="Q1", name="known")]
    out = reconcile_rows(rows, _reconciler(tmp_path, _FakeTransport(_fixture("match"))))

    assert out[0]["wikidata_qid"] == "Q207058"
    assert out[1]["wikidata_qid"] == "Q1"  # already identified, left as-is
