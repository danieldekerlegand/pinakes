"""`POST /api/graph/explain` — the grounded connection narrative.

Nothing here reaches a model or a database: the traversal, the model and the
Datalog inference are all `NarrativeDeps` parameters, and the two route tests
drive the paths that never get that far (validation, and an unreachable graph).

The property most worth guarding is the negative one — **with no path and no
inferred fact the model is not called at all**. That is what makes
`aiGenerated: false` trustworthy: the honest answer is not a *choice* the
orchestration makes after seeing the prose, it is the absence of any prose to
have generated.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from conftest import FakeNode, FakeRelationship, FakeResult
from pinakes.narrative import connection
from pinakes.narrative.connection import DatalogFact, Endpoint, NarrativeDeps
from pinakes.narrative.llm import LiveNarrativeLlm, NarrativeModelError

LATIN = Endpoint(csid="cs:language:lat", name="Latin")
PIE = Endpoint(csid="cs:language:pie", name="Proto-Indo-European")


def _node(csid: str, name: str) -> dict[str, Any]:
    return {"csid": csid, "labels": ["Language"], "name": name, "properties": {}}


PATH: dict[str, Any] = {
    "from": _node("cs:language:lat", "Latin"),
    "to": _node("cs:language:pie", "Proto-Indo-European"),
    "nodes": [
        _node("cs:language:lat", "Latin"),
        _node("cs:language:ita", "Proto-Italic"),
        _node("cs:language:pie", "Proto-Indo-European"),
    ],
    "edges": [
        {
            "id": "1",
            "type": "DESCENDS_FROM",
            "startCsid": "cs:language:lat",
            "endCsid": "cs:language:ita",
            "weight": 0.9,
            "properties": {"source": "Ringe 2006", "source_url": "https://example/1"},
        },
        {
            "id": "2",
            "type": "SPLIT_FROM",
            # Recorded pointing *backwards* along the path, which is the case
            # the orientation logic exists for.
            "startCsid": "cs:language:pie",
            "endCsid": "cs:language:ita",
            "properties": {},
        },
    ],
    "length": 2,
}


class RecordingLlm:
    """A model that records what it was asked and answers a fixed sentence."""

    def __init__(
        self, answer: str = "Latin descends from Proto-Indo-European."
    ) -> None:
        self.prompts: list[str] = []
        self.answer = answer

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.answer


class ExplodingLlm:
    """A model that is unreachable — what the route maps onto a 502."""

    def generate(self, prompt: str) -> str:
        raise NarrativeModelError("the model is unavailable")


# ── Evidence extraction ──────────────────────────────────────────────────────


def test_evidence_reads_forward_along_the_path_whatever_the_edge_direction() -> None:
    evidence = connection.extract_path_evidence(PATH)

    assert [record["statement"] for record in evidence] == [
        "Latin — descends from — Proto-Italic",
        "Proto-Italic — split from — Proto-Indo-European",
    ]
    assert evidence[1]["fromCsid"] == "cs:language:ita"
    assert evidence[1]["toCsid"] == "cs:language:pie"


def test_provenance_is_lifted_out_of_the_edge() -> None:
    first = connection.extract_path_evidence(PATH)[0]
    assert first["source"] == "Ringe 2006"
    assert first["sourceUrl"] == "https://example/1"
    assert first["confidence"] == 0.9
    # An edge with no provenance carries no keys at all rather than nulls —
    # `JSON.stringify` dropped an undefined property.
    assert "source" not in connection.extract_path_evidence(PATH)[1]


def test_confidence_is_the_product_not_the_average() -> None:
    """A chain is only as trustworthy as its weakest link, compounding."""
    evidence = connection.extract_path_evidence(PATH)
    # 0.9 × the 0.7 neutral prior for the unweighted second edge.
    assert connection.path_confidence(evidence) == 0.63
    assert connection.path_confidence([]) == 0


def test_an_unweighted_chain_still_scores_rather_than_collapsing() -> None:
    unweighted = [
        {"kind": "edge", "statement": "a"},
        {"kind": "edge", "statement": "b"},
    ]
    assert connection.path_confidence(unweighted) == 0.49


# ── Orchestration ────────────────────────────────────────────────────────────


def test_no_path_and_no_fact_never_calls_the_model() -> None:
    llm = RecordingLlm()
    result = connection.explain_connection(
        LATIN, PIE, NarrativeDeps(find_path=lambda a, b: None, llm=llm)
    )

    assert llm.prompts == []
    assert result["connected"] is False
    assert result["aiGenerated"] is False
    assert result["evidence"] == []
    assert result["confidence"] == 0
    assert result["lowConfidence"] is True
    assert "does not mean none exists" in result["explanation"]


def test_a_path_is_explained_and_labelled_ai_generated() -> None:
    llm = RecordingLlm()
    result = connection.explain_connection(
        LATIN, PIE, NarrativeDeps(find_path=lambda a, b: PATH, llm=llm)
    )

    assert result["connected"] is True
    assert result["aiGenerated"] is True
    assert result["pathLength"] == 2
    assert result["confidence"] == 0.63
    assert result["lowConfidence"] is False
    assert result["explanation"] == "Latin descends from Proto-Indo-European."
    assert len(result["evidence"]) == 2


def test_the_prompt_hands_the_model_only_the_evidence() -> None:
    llm = RecordingLlm()
    connection.explain_connection(
        LATIN,
        PIE,
        NarrativeDeps(
            find_path=lambda a, b: PATH,
            llm=llm,
            infer_facts=lambda a, b: [
                DatalogFact("ancestor", "PIE is an ancestor of Latin.", [a, b])
            ],
        ),
    )

    prompt = llm.prompts[0]
    assert "Do not introduce any fact, entity, date, or claim" in prompt
    assert "1. Latin — descends from — Proto-Italic (confidence 0.90)" in prompt
    assert "[source: Ringe 2006]" in prompt
    assert "D1. PIE is an ancestor of Latin. [inferred: ancestor]" in prompt
    assert "Aggregate confidence in this connection: 0.63" in prompt


def test_an_inferred_fact_alone_is_enough_to_explain() -> None:
    """Inference is *augmentation* over a path — but it is also a link in its
    own right, so a graph with no edge between the two still answers."""
    llm = RecordingLlm()
    result = connection.explain_connection(
        LATIN,
        PIE,
        NarrativeDeps(
            find_path=lambda a, b: None,
            llm=llm,
            infer_facts=lambda a, b: [DatalogFact("ancestor", "…", [a, b])],
        ),
    )

    assert result["connected"] is True
    assert result["pathLength"] == 0
    # No *edge* evidence, so the aggregate stays 0 and the answer is hedged.
    assert result["confidence"] == 0
    assert result["lowConfidence"] is True
    assert result["evidence"][0]["kind"] == "datalog"


def test_a_failing_inference_degrades_to_no_facts() -> None:
    def explode(a: str, b: str) -> list[DatalogFact]:
        raise RuntimeError("no SWI-Prolog on this machine")

    result = connection.explain_connection(
        LATIN,
        PIE,
        NarrativeDeps(
            find_path=lambda a, b: None, llm=RecordingLlm(), infer_facts=explode
        ),
    )
    assert result["connected"] is False


def test_a_model_failure_after_a_path_propagates() -> None:
    """It must not be swallowed into a 200: an answer with no prose reads
    exactly like the honest "no connection found", which it is not."""
    with pytest.raises(NarrativeModelError):
        connection.explain_connection(
            LATIN, PIE, NarrativeDeps(find_path=lambda a, b: PATH, llm=ExplodingLlm())
        )


def test_a_weak_chain_is_flagged_low_confidence() -> None:
    weak = {
        **PATH,
        "edges": [{**PATH["edges"][0], "weight": 0.2}, PATH["edges"][1]],
    }
    result = connection.explain_connection(
        LATIN, PIE, NarrativeDeps(find_path=lambda a, b: weak, llm=RecordingLlm())
    )
    assert result["confidence"] == 0.14
    assert result["lowConfidence"] is True


# ── The route ────────────────────────────────────────────────────────────────


def test_an_empty_body_is_the_recorded_400(unbuilt_client: TestClient) -> None:
    """The `post-graph-explain-invalid` contract, and the reason this route can
    keep answering on both backends: nothing downstream is reached."""
    response = unbuilt_client.post("/api/graph/explain", json={})

    assert response.status_code == 400
    assert response.json() == {
        "error": "from: each of `from` and `to` must be an object"
    }


def test_a_bad_to_endpoint_names_which_side_failed(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/graph/explain", json={"from": {"csid": "cs:a:1"}, "to": {}}
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "to: an endpoint needs either a `csid` or a `type` + `id`/`name`"
    }


def test_the_same_entity_twice_is_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/graph/explain",
        json={"from": {"csid": "cs:a:1"}, "to": {"csid": "cs:a:1"}},
    )
    assert response.status_code == 400
    assert response.json() == {"error": "from and to resolve to the same entity"}


def test_an_unresolvable_entity_ref_is_400(unbuilt_client: TestClient) -> None:
    """The refs go through the same alias table `/api/graph/resolve` publishes,
    so the two routes cannot disagree about what an entity ref means."""
    response = unbuilt_client.post(
        "/api/graph/explain",
        json={"from": {"type": "language", "id": "klingon"}, "to": {"csid": "cs:a:1"}},
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "from: could not resolve language:klingon to a graph node"
    }


def test_an_unreachable_graph_is_503(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/graph/explain",
        json={"from": {"csid": "cs:a:1"}, "to": {"csid": "cs:b:2"}},
    )
    assert response.status_code == 503
    body = response.json()
    assert body["available"] is False
    assert body["error"] == "the shared graph is unavailable"


# ── The engine traversal ─────────────────────────────────────────────────────


def test_find_path_projects_a_shortest_path(fake_graph: Any) -> None:
    from pinakes.engine import graph

    latin = FakeNode("1", ["Language"], {"csid": "cs:language:lat", "name": "Latin"})
    italic = FakeNode("2", ["Language"], {"csid": "cs:language:ita", "name": "Italic"})
    edge = FakeRelationship("e1", "DESCENDS_FROM", latin, italic, {"weight": 0.9})
    fake_graph(
        lambda cypher, params: FakeResult(
            [{"pathNodes": [latin, italic], "pathRels": [edge]}],
            ["pathNodes", "pathRels"],
        )
    )

    path = graph.find_path("cs:language:lat", "cs:language:ita")

    assert path is not None
    assert path["length"] == 1
    assert path["from"]["csid"] == "cs:language:lat"
    assert path["to"]["csid"] == "cs:language:ita"
    assert path["edges"][0]["type"] == "DESCENDS_FROM"


def test_find_path_returns_none_when_there_is_no_path(fake_graph: Any) -> None:
    from pinakes.engine import graph

    fake_graph(lambda cypher, params: FakeResult([], ["pathNodes", "pathRels"]))
    assert graph.find_path("cs:a:1", "cs:b:2") is None


def test_a_path_through_a_personal_node_is_not_surfaced(fake_graph: Any) -> None:
    """Pruning the node would leave a partial chain that misrepresents how the
    two ends are connected, so the whole path is withheld."""
    from pinakes.engine import graph

    start = FakeNode("1", ["Language"], {"csid": "cs:language:lat", "name": "Latin"})
    asset = FakeNode("2", ["Asset"], {"csid": "sha256:abc", "name": "photo"})
    end = FakeNode("3", ["Language"], {"csid": "cs:language:ita", "name": "Italic"})
    fake_graph(
        lambda cypher, params: FakeResult(
            [{"pathNodes": [start, asset, end], "pathRels": []}],
            ["pathNodes", "pathRels"],
        )
    )

    assert graph.find_path("cs:language:lat", "cs:language:ita") is None


def test_the_hop_bound_is_clamped() -> None:
    from pinakes.engine import graph

    assert graph.clamp_path_length(0) == graph.MIN_PATH_LENGTH
    assert graph.clamp_path_length(99) == graph.MAX_PATH_LENGTH
    assert graph.clamp_path_length(4) == 4


# ── The model proxy ──────────────────────────────────────────────────────────


def test_a_missing_key_raises_rather_than_faking_a_narrative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with fabricated prose would be dishonest, and a 200 with empty
    prose would read exactly like "no connection found"."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(NarrativeModelError, match="GEMINI_API_KEY"):
        LiveNarrativeLlm().generate("explain")


def test_the_key_is_read_from_a_server_only_variable() -> None:
    """A Vite-prefixed name would be inlined into the browser bundle — the same
    invariant `server/security/gemini-proxy.test.ts` guards on the other side."""
    from pinakes.narrative import llm

    assert llm.API_KEY_ENV == "GEMINI_API_KEY"
    assert not llm.API_KEY_ENV.startswith("VITE_")
