"""Behaviour of the ported `/api/stewardship` group (pinakes:61 US-2).

The stewardship third of `server/routes/community-verification.test.ts`, plus
the on-disk assertions that file could not make from the outside. The other two
thirds — confirm and verification — are a different port unit and still answer
501 there; :func:`test_the_confirm_flow_is_not_part_of_this_port` is what says
so out loud, because "ported the file" and "ported the route group" are not the
same claim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.collab.stewardship import STEWARDS_FILE


def roster(trees: dict[str, Path]) -> Any:
    """The persisted `stewards.json`, or ``None`` when nothing was written."""
    path = trees["stewardship"] / STEWARDS_FILE
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# ── Adopting ─────────────────────────────────────────────────────────────────


def test_adopting_normalizes_the_domain_and_returns_201(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "Roman Empire"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["alreadyOwned"] is False
    assert body["adoption"]["domain"] == "roman-empire"
    # The steward's own casing survives — the normalization is of the *domain*,
    # and the attribution should read the way they typed their name.
    assert body["adoption"]["steward"] == "Alice"
    assert body["adoption"]["adoptedAt"]
    assert roster(isolated_data_trees) == [body["adoption"]]


def test_an_absent_note_is_absent_rather_than_null(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`JSON.stringify` writes no key for the `undefined` the TypeScript leaves,
    and Express still reads this file for the confirm flow."""
    unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "maya"}
    )
    assert "note" not in roster(isolated_data_trees)[0]


def test_a_note_is_kept_verbatim(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.post(
        "/api/stewardship/adopt",
        json={"steward": "Alice", "domain": "maya", "note": "  fieldwork 2019  "},
    ).json()
    assert body["adoption"]["note"] == "  fieldwork 2019  "


def test_readopting_is_a_no_op_and_a_200(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """A double-click must not mint a second claim with a later `adoptedAt`."""
    first = unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "roman-empire"}
    ).json()
    again = unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "alice", "domain": "Roman  Empire"}
    )
    assert again.status_code == 200
    assert again.json()["alreadyOwned"] is True
    assert again.json()["adoption"] == first["adoption"]
    assert len(roster(isolated_data_trees)) == 1


def test_two_stewards_may_hold_the_same_domain(unbuilt_client: TestClient) -> None:
    """Stewardship is not exclusive ownership — it is expertise, and a domain
    can have more than one expert."""
    for steward in ("Alice", "Bob"):
        unbuilt_client.post(
            "/api/stewardship/adopt", json={"steward": steward, "domain": "maya"}
        )
    assert unbuilt_client.get("/api/stewardship").json()["total"] == 2


# ── Listing ──────────────────────────────────────────────────────────────────


def test_listing_an_empty_roster_is_a_200(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.get("/api/stewardship").json()
    assert body == {"adoptions": [], "total": 0}


def test_the_domain_filter_normalizes_what_it_is_given(
    unbuilt_client: TestClient,
) -> None:
    """A claim made as "Roman Empire" is found by a query for "roman_empire":
    the normalized key is what is stored, so both spellings reach it."""
    unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "Roman Empire"}
    )
    unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Bob", "domain": "maya"}
    )
    body = unbuilt_client.get("/api/stewardship?domain=roman_empire").json()
    assert body["total"] == 1
    assert body["adoptions"][0]["steward"] == "Alice"


def test_a_blank_domain_filter_lists_everything(unbuilt_client: TestClient) -> None:
    unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "maya"}
    )
    assert unbuilt_client.get("/api/stewardship?domain=").json()["total"] == 1


# ── Releasing ────────────────────────────────────────────────────────────────


def test_releasing_drops_the_claim_and_reports_it(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "Alice", "domain": "Roman Empire"}
    )
    released = unbuilt_client.post(
        "/api/stewardship/release", json={"steward": "alice", "domain": "roman-empire"}
    )
    assert released.json() == {"released": True}
    assert roster(isolated_data_trees) == []
    assert unbuilt_client.get("/api/stewardship").json()["total"] == 0


def test_releasing_a_claim_nobody_holds_is_false_not_404(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/stewardship/release", json={"steward": "Alice", "domain": "atlantis"}
    )
    assert response.status_code == 200
    assert response.json() == {"released": False}


def test_releasing_only_touches_that_stewards_claim(
    unbuilt_client: TestClient,
) -> None:
    for steward in ("Alice", "Bob"):
        unbuilt_client.post(
            "/api/stewardship/adopt", json={"steward": steward, "domain": "maya"}
        )
    unbuilt_client.post(
        "/api/stewardship/release", json={"steward": "Alice", "domain": "maya"}
    )
    remaining = unbuilt_client.get("/api/stewardship").json()
    assert [a["steward"] for a in remaining["adoptions"]] == ["Bob"]


# ── Refusals ─────────────────────────────────────────────────────────────────


def test_both_fields_are_required_on_both_writes(unbuilt_client: TestClient) -> None:
    for path in ("/api/stewardship/adopt", "/api/stewardship/release"):
        for payload in ({"steward": "Alice"}, {"domain": "maya"}, {}):
            response = unbuilt_client.post(path, json=payload)
            assert response.status_code == 400, (path, payload)
            assert response.json()["message"] == "steward and domain are required"


def test_a_blank_field_is_a_missing_field(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/stewardship/adopt", json={"steward": "  ", "domain": "maya"}
    )
    assert response.status_code == 400


def test_a_junk_body_is_a_400_not_a_422(unbuilt_client: TestClient) -> None:
    """Express validated `req.body?.steward` by hand, so a body of the wrong
    shape is the endpoint's own 400. A declared model would answer 422, which is
    a different contract."""
    response = unbuilt_client.post(
        "/api/stewardship/adopt",
        content=b"not json at all",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["message"] == "steward and domain are required"


def test_a_broken_roster_degrades_to_nobody_rather_than_a_500(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The opposite call to the changelog's. A claim can be re-made in one
    request, so failing closed costs a steward their shortcut; failing loudly
    would cost every reviewer the endpoint."""
    isolated_data_trees["stewardship"].mkdir(parents=True, exist_ok=True)
    (isolated_data_trees["stewardship"] / STEWARDS_FILE).write_text(
        "{ not an array", encoding="utf-8"
    )
    assert unbuilt_client.get("/api/stewardship").json() == {
        "adoptions": [],
        "total": 0,
    }


# ── What did *not* move ──────────────────────────────────────────────────────


def test_the_confirm_flow_is_not_part_of_this_port(unbuilt_client: TestClient) -> None:
    """`server/routes/community-verification.ts` registers five routes; only the
    three `/api/stewardship*` ones are this unit. The other two belong to the
    contribution queue's verification work and still answer 501 — which is safe
    precisely because Express reads the roster this service writes."""
    for method, url in (
        ("POST", "/api/contributions/abc/confirm"),
        ("GET", "/api/contributions/abc/verification"),
    ):
        assert unbuilt_client.request(method, url).status_code == 501
