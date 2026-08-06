"""The multi-confirmation flow (pinakes:80 US-1, the thirteenth slice).

No recorded fixture grades either route, so this file plus the live diff against
Express is the whole gate. The diff covered 44 requests and every file the pair
writes; what is pinned here is what a rewrite would quietly change:

* the **four refusals** and their status codes (400 missing reviewer, 404 unknown,
  400 self, 409 duplicate) — three of them share a shape and two share a code;
* **`baseConfidence` idempotence** — the ramp is always recomputed from the
  original figure, never from the already-raised one;
* the **steward shortcut** and its attribution, including that an *existing*
  steward confirmation lowers the bar for a later ordinary reviewer;
* the three JavaScript readings of a confidence — a number, an **absent** one
  (``NaN`` → ``null``) and an explicit **null** one (``0``, ramping from 1).
  The last two are the same Python ``None`` and the live diff is what found
  them.

`conftest.py`'s autouse `isolated_data_trees` redirects the contribution queue
and the steward roster into this test's temp tree, so every case seeds its own
records and asserts on what was actually written.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.collab import stewardship, verification
from pinakes.collab.stewardship import STEWARDS_FILE
from pinakes.contributions import store


@pytest.fixture
def queue(isolated_data_trees: dict[str, Path]) -> Path:
    directory = isolated_data_trees["contributions"]
    directory.mkdir(parents=True, exist_ok=True)
    return directory


@pytest.fixture
def roster(isolated_data_trees: dict[str, Path]) -> Path:
    directory = isolated_data_trees["stewardship"]
    directory.mkdir(parents=True, exist_ok=True)
    return directory


@pytest.fixture
def client(queue: Path, roster: Path) -> TestClient:
    """Built after the trees, so the app resolves this test's temp directories."""
    return TestClient(create_app())


def seed(queue: Path, record_id: str, **overrides: Any) -> dict[str, Any]:
    """Write one contribution straight to the queue, the way both writers do."""
    record: dict[str, Any] = {
        "id": record_id,
        "entityType": "civilization",
        "action": "add",
        "status": "pending",
        "submittedAt": "2026-02-01T00:00:00.000Z",
        "entityData": {"name": "Maya"},
        "sources": [{"title": "A book"}],
        "confidence": 50,
    }
    record.update(overrides)
    # `None` here means "drop the key" — the caller's way of writing *absent*,
    # which is a different record from one carrying a null.
    record = {key: value for key, value in record.items() if value is not None}
    (queue / f"{record_id}.json").write_text(json.dumps(record, indent=2))
    return record


def adopt(roster: Path, steward: str, domain: str) -> None:
    (roster / STEWARDS_FILE).write_text(
        json.dumps(
            [
                {
                    "steward": steward,
                    "domain": domain,
                    "adoptedAt": "2026-01-01T00:00:00.000Z",
                }
            ]
        ),
        encoding="utf-8",
    )


def stored(queue: Path, record_id: str) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads((queue / f"{record_id}.json").read_text())
    return parsed


# ── Refusals ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body",
    [{}, {"reviewer": "   "}, {"reviewer": 42}, {"reviewer": None}, [1, 2]],
)
def test_a_missing_reviewer_is_a_400(
    client: TestClient, queue: Path, body: Any
) -> None:
    """`typeof req.body?.reviewer === "string" ? trim : ""` — and a body that is
    not an object at all is an empty one, not a 422."""
    seed(queue, "c-1")
    response = client.post("/api/contributions/c-1/confirm", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": "reviewer is required"}


def test_an_unknown_contribution_is_a_404(client: TestClient) -> None:
    for method, url in (
        ("POST", "/api/contributions/nope/confirm"),
        ("GET", "/api/contributions/nope/verification"),
    ):
        response = client.request(
            method, url, json={"reviewer": "Ann"} if method == "POST" else None
        )
        assert response.status_code == 404
        assert response.json() == {"message": "Contribution 'nope' not found"}


def test_a_contributor_cannot_confirm_their_own_contribution(
    client: TestClient, queue: Path
) -> None:
    """400 and not 409: it is a statement about *who* is asking. The match is
    trimmed and case-folded, so the refusal cannot be dodged by capitalisation."""
    seed(queue, "c-1", contributorName="Dana")
    response = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "  dana  "}
    )
    assert response.status_code == 400
    body = response.json()
    assert body["reason"] == "self"
    assert body["domain"] == "maya"
    assert body["verification"]["distinctReviewers"] == 0
    assert "confirmations" not in stored(queue, "c-1")


def test_a_repeated_reviewer_is_a_409_and_does_not_advance_the_count(
    client: TestClient, queue: Path
) -> None:
    seed(queue, "c-1")
    client.post("/api/contributions/c-1/confirm", json={"reviewer": "alice"})
    duplicate = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": " ALICE "}
    )
    assert duplicate.status_code == 409
    body = duplicate.json()
    assert body["reason"] == "duplicate"
    assert body["verification"]["distinctReviewers"] == 1
    assert len(stored(queue, "c-1")["confirmations"]) == 1


# ── The ramp ─────────────────────────────────────────────────────────────────


def test_confirmations_raise_confidence_and_verify_at_the_threshold(
    client: TestClient, queue: Path
) -> None:
    seed(queue, "c-1", confidence=50)

    first = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "alice"}
    ).json()
    assert first["verification"]["verified"] is False
    assert first["verification"]["required"] == 3
    assert first["verification"]["confidence"] > 50
    assert first["contribution"]["status"] == "pending"

    client.post("/api/contributions/c-1/confirm", json={"reviewer": "bob"})
    third = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "carol"}
    ).json()

    assert third["verification"]["verified"] is True
    assert third["verification"]["distinctReviewers"] == 3
    assert third["verification"]["confidence"] == verification.VERIFIED_CONFIDENCE
    assert third["contribution"]["status"] == "approved"
    assert third["contribution"]["verified"] is True
    assert third["contribution"]["verifiedAt"] == third["contribution"]["reviewedAt"]


def test_the_ramp_recomputes_from_the_preserved_base(
    client: TestClient, queue: Path
) -> None:
    """`baseConfidence` is written on the first confirmation and read on every
    one after it. Recomputing off the already-raised `confidence` would compound
    — the second reviewer would ramp from the first reviewer's answer."""
    seed(queue, "c-1", confidence=50)
    client.post("/api/contributions/c-1/confirm", json={"reviewer": "alice"})
    assert stored(queue, "c-1")["baseConfidence"] == 50

    second = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "bob"}
    ).json()
    # 50 + (99 - 50) * 2/3, rounded — not a ramp from the stored 66.
    assert second["verification"]["confidence"] == 83
    assert stored(queue, "c-1")["baseConfidence"] == 50


def test_a_confirmation_never_lowers_the_base(client: TestClient, queue: Path) -> None:
    seed(queue, "c-1", confidence=99)
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "alice"}
    ).json()
    assert body["verification"]["confidence"] == 99


def test_an_absent_confidence_is_null_and_an_explicit_null_is_zero(
    client: TestClient, queue: Path
) -> None:
    """The divergence the live diff caught, in both directions.

    ``Math.round(undefined)`` is ``NaN`` — which serialises as a **present**
    ``null``, not as a dropped key — and ``Math.round(null)`` is ``0``, which
    clamps to 1 and ramps from there. Both are Python's ``None``.
    """
    seed(queue, "c-1", confidence=None)
    first = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "alice"}
    ).json()
    assert first["verification"]["confidence"] is None
    assert first["contribution"]["confidence"] is None
    # Written as a null, not omitted — which is what makes the next read a 0.
    assert "confidence" in stored(queue, "c-1")
    assert stored(queue, "c-1")["confidence"] is None

    read = client.get("/api/contributions/c-1/verification").json()
    assert read["verification"]["confidence"] == 34


def test_a_zero_confidence_is_kept_by_the_nullish_coalesce(
    client: TestClient, queue: Path
) -> None:
    """`??`, not `||` — a base of 0 is a real base. It clamps to 1 before ramping."""
    seed(queue, "c-1", confidence=0)
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "alice"}
    ).json()
    assert stored(queue, "c-1")["baseConfidence"] == 0
    assert body["verification"]["confidence"] == 34


# ── Stewards ─────────────────────────────────────────────────────────────────


def test_a_domain_steward_verifies_single_handedly_and_is_attributed(
    client: TestClient, queue: Path, roster: Path
) -> None:
    adopt(roster, "Expert", "maya")
    seed(queue, "c-1")

    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Expert"}
    ).json()
    assert body["confirmedAsSteward"] is True
    assert body["domain"] == "maya"
    assert body["verification"]["verified"] is True
    assert body["verification"]["stewards"] == ["Expert"]
    assert body["contribution"]["status"] == "approved"
    assert body["contribution"]["stewardAttribution"] == [
        {"steward": "Expert", "domain": "maya"}
    ]


def test_an_existing_steward_confirmation_lowers_the_bar_for_everyone(
    client: TestClient, queue: Path
) -> None:
    """`requiredConfirmations` reads the confirmation *list*, not this request —
    so a reviewer who is nobody still lands on the steward threshold."""
    seed(
        queue,
        "c-1",
        confirmations=[
            {
                "reviewer": "Sam",
                "confirmedAt": "2026-01-16T00:00:00.000Z",
                "isSteward": True,
                "domain": "maya",
            }
        ],
    )
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Ann"}
    ).json()
    assert body["confirmedAsSteward"] is False
    assert body["verification"]["required"] == 1
    assert body["verification"]["verified"] is True
    assert body["verification"]["stewardConfirmed"] is True


def test_a_non_steward_confirmation_carries_no_steward_keys(
    client: TestClient, queue: Path
) -> None:
    """`JSON.stringify` writes no key for the `undefined` the builder leaves, so
    an ordinary confirmation is exactly `{reviewer, confirmedAt}`."""
    seed(queue, "c-1")
    client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": " Ann ", "note": 42}
    )
    confirmation = stored(queue, "c-1")["confirmations"][0]
    assert set(confirmation) == {"reviewer", "confirmedAt"}
    # The reviewer is stored trimmed; a non-string note is no note at all.
    assert confirmation["reviewer"] == "Ann"


def test_a_string_note_is_recorded(client: TestClient, queue: Path) -> None:
    seed(queue, "c-1")
    client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Ann", "note": "checked"}
    )
    assert stored(queue, "c-1")["confirmations"][0]["note"] == "checked"


def test_an_already_verified_contribution_keeps_its_first_verified_at(
    client: TestClient, queue: Path, roster: Path
) -> None:
    """`if (!contribution.verifiedAt)` — and an already-approved status is left
    alone, because only a *pending* one is advanced."""
    adopt(roster, "Expert", "maya")
    seed(
        queue,
        "c-1",
        status="approved",
        reviewedAt="2026-02-02T00:00:00.000Z",
        verifiedAt="2026-02-03T00:00:00.000Z",
    )
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Expert"}
    ).json()
    assert body["contribution"]["verifiedAt"] == "2026-02-03T00:00:00.000Z"
    assert body["contribution"]["reviewedAt"] == "2026-02-02T00:00:00.000Z"


# ── The domain ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("record", "expected"),
    [
        ({"entityData": {"culturalDomain": "  Norse  Mythology "}}, "norse-mythology"),
        ({"entityData": {"cultureId": "Maya_Lowlands"}}, "maya-lowlands"),
        ({"entityData": {"associatedCultureId": "Hittite"}}, "hittite"),
        # A blank explicit domain shadows the next key and then fails its own
        # guard, so it falls through to the entity type — not to `cultureId`.
        (
            {
                "entityType": "religion",
                "entityData": {"culturalDomain": "   ", "cultureId": "maya"},
            },
            "religion",
        ),
        # Only a *civilization* is named by its entity data.
        ({"entityType": "language", "entityData": {"name": "Mandarin"}}, "language"),
        ({"entityType": "civilization", "entityData": {"name": "   "}}, "civilization"),
    ],
)
def test_the_domain_is_resolved_from_the_contribution(
    client: TestClient, queue: Path, record: dict[str, Any], expected: str
) -> None:
    seed(queue, "c-1", **record)
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Ann"}
    ).json()
    assert body["domain"] == expected
    read = client.get("/api/contributions/c-1/verification").json()
    assert read["domain"] == expected


def test_a_claim_adopted_through_the_stewardship_route_takes_effect_at_once(
    client: TestClient, queue: Path
) -> None:
    """The whole reason these two routes could be ported a band apart from the
    stewardship three: the domain is *resolved* per request, never stored."""
    seed(queue, "c-1")
    client.post("/api/stewardship/adopt", json={"steward": "Expert", "domain": "Maya"})
    body = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "Expert"}
    ).json()
    assert body["confirmedAsSteward"] is True


# ── The read ─────────────────────────────────────────────────────────────────


def test_the_verification_read_summarizes_without_mutating(
    client: TestClient, queue: Path
) -> None:
    seed(queue, "c-1")
    client.post("/api/contributions/c-1/confirm", json={"reviewer": "alice"})
    before = stored(queue, "c-1")

    body = client.get("/api/contributions/c-1/verification").json()
    assert body["id"] == "c-1"
    assert body["domain"] == "maya"
    assert body["status"] == "pending"
    assert body["config"] == {"threshold": 3, "stewardThreshold": 1}
    assert body["verification"]["distinctReviewers"] == 1
    assert body["stewardAttribution"] == []
    # Reading it twice cannot ramp anything — it recomputes from `baseConfidence`.
    assert client.get("/api/contributions/c-1/verification").json() == body
    assert stored(queue, "c-1") == before


def test_the_config_is_read_from_the_environment_and_the_steward_bar_is_clamped(
    client: TestClient, queue: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A steward should never need *more* confirmations than an ordinary
    reviewer, so `stewardThreshold` is clamped to `threshold`."""
    monkeypatch.setenv("VERIFICATION_THRESHOLD", "2")
    monkeypatch.setenv("VERIFICATION_STEWARD_THRESHOLD", "5")
    seed(queue, "c-1")

    body = client.get("/api/contributions/c-1/verification").json()
    assert body["config"] == {"threshold": 2, "stewardThreshold": 2}

    client.post("/api/contributions/c-1/confirm", json={"reviewer": "alice"})
    second = client.post(
        "/api/contributions/c-1/confirm", json={"reviewer": "bob"}
    ).json()
    assert second["verification"]["verified"] is True


@pytest.mark.parametrize("raw", ["abc", "0", "-3", "", "٣"])
def test_a_junk_threshold_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """`parseInt` guarded by `Number.isFinite(n) && n >= 1`. The Arabic-Indic
    digit is the reason the pattern is `[0-9]` and not `\\d`: Python's class is
    Unicode and JavaScript's is not, so it parses here and must not."""
    monkeypatch.setenv("VERIFICATION_THRESHOLD", raw)
    assert verification.load_verification_config()["threshold"] == 3


def test_a_fractional_threshold_truncates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VERIFICATION_THRESHOLD", "2.9")
    assert verification.load_verification_config()["threshold"] == 2


# ── Route order ──────────────────────────────────────────────────────────────


def test_the_id_route_does_not_swallow_confirm_or_verification(
    client: TestClient, queue: Path
) -> None:
    """`routers/contributions.py` owns `/api/contributions/{id}` and sorts after
    this module, but the shadowing trap needs *equal* segment counts — three
    against two here, so no re-registration is needed. Said out loud rather than
    left for the next reader to infer a rule that does not apply."""
    seed(queue, "c-1")
    assert client.get("/api/contributions/c-1").json()["id"] == "c-1"
    assert client.get("/api/contributions/c-1/verification").json()["id"] == "c-1"


# ── The store's half ─────────────────────────────────────────────────────────


def test_confirm_returns_none_for_an_unknown_id(queue: Path) -> None:
    assert store.queue().confirm("nope", reviewer="Ann") is None


def test_steward_attribution_keeps_an_earlier_stewards_own_domain(
    queue: Path, roster: Path
) -> None:
    """`c.domain ?? input.domain ?? ""` — re-confirming under a different domain
    does not rewrite an attribution already recorded."""
    seed(
        queue,
        "c-1",
        confirmations=[
            {
                "reviewer": "Sam",
                "confirmedAt": "2026-01-16T00:00:00.000Z",
                "isSteward": True,
                "domain": "old-domain",
            }
        ],
    )
    result = store.queue().confirm(
        "c-1", reviewer="Ann", is_steward=True, domain="new-domain"
    )
    assert result is not None
    assert result.contribution["stewardAttribution"] == [
        {"steward": "Sam", "domain": "old-domain"},
        {"steward": "Ann", "domain": "new-domain"},
    ]


def test_resolve_contribution_domain_refuses_a_typeless_record() -> None:
    """`normalizeDomain(undefined)` throws over there. Answering `"none"` would
    be a *wrong* steward lookup rather than a refusal."""
    with pytest.raises(TypeError):
        stewardship.resolve_contribution_domain({"entityData": {}})
