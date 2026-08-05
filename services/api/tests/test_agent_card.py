"""The A2A agent-card front (pinakes:65 US-1).

`server/routes/a2a.test.ts`, plus the assertion that only exists because this is
a reimplementation rather than a port: the card Express builds through the
`@a2a-js/sdk` codec drops empty and default-valued fields, and this one has to
come out the same shape. The key set below is what the TypeScript actually
serves — it is pinned here, not inferred, because the SDK is what decides it.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.kcb.agent_card import (
    AGENT_CARD_ROUTE_PATH,
    KCB_MANIFEST_EXTENSION_URI,
    build_agent_card,
)
from pinakes.kcb.manifest import capability_manifest

#: What survives the `@a2a-js/sdk` `AgentCard.fromJSON`→`toJSON` round trip, in
#: order. `securitySchemes`, `securityRequirements` and `signatures` are absent
#: because they were empty; `tenant: ""` is gone from the interface for the same
#: reason. Adding a field to the card means checking the codec first.
EXPECTED_KEYS = [
    "name",
    "description",
    "supportedInterfaces",
    "provider",
    "version",
    "capabilities",
    "defaultInputModes",
    "defaultOutputModes",
    "skills",
]


@pytest.fixture
def card(unbuilt_client: TestClient) -> dict[str, Any]:
    response = unbuilt_client.get(AGENT_CARD_ROUTE_PATH)
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def test_the_card_is_the_sdk_normalized_shape(card: dict[str, Any]) -> None:
    assert list(card) == EXPECTED_KEYS
    interface = card["supportedInterfaces"][0]
    assert set(interface) == {"url", "protocolBinding", "protocolVersion"}
    assert interface["protocolBinding"] == "MCP"
    extension = card["capabilities"]["extensions"][0]
    # `required: false` is a default and does not survive the codec.
    assert set(extension) == {"uri", "description", "params"}


def test_the_card_identity_is_the_kinp_agent_id(card: dict[str, Any]) -> None:
    """KCB §2 reads identity off the card's `name`, so a dialer knows whom it got."""
    manifest = capability_manifest()
    assert card["name"] == manifest["identity"]
    assert card["provider"]["url"] == manifest["x_pinakes"]["identityIri"]
    assert card["version"] == manifest["x_pinakes"]["manifestVersion"]


def test_every_capability_becomes_a_skill(card: dict[str, Any]) -> None:
    """Skills are *derived*: a new capability becomes a skill by being declared."""
    manifest = capability_manifest()
    assert [s["id"] for s in card["skills"]] == [
        c["name"] for c in manifest["capabilities"]
    ]
    for skill, entry in zip(card["skills"], manifest["capabilities"], strict=True):
        assert skill["description"] == entry["description"]
        assert set(skill) == {"id", "name", "description", "tags"}


def test_a_skill_is_tagged_with_its_planes_and_its_specialization(
    card: dict[str, Any],
) -> None:
    """The FT-K tiebreak must be readable from the card alone, by tag."""
    by_id = {s["id"]: s for s in card["skills"]}

    assert by_id["resolve"]["tags"] == ["resolve", "entity", "koine-capability-bus"]
    finetune = by_id["finetune"]["tags"]
    assert "specialized" in finetune
    assert "text-generation" in finetune
    assert "local-only" in finetune
    # Order-preserving dedup: the planes appear once each, in port order.
    assert finetune.count("entity") == 1


def test_the_kcb_manifest_rides_as_one_extension(card: dict[str, Any]) -> None:
    """A crawler that pulls only the card recovers the whole KCB §2 payload."""
    manifest = capability_manifest()
    extension = card["capabilities"]["extensions"][0]

    assert extension["uri"] == KCB_MANIFEST_EXTENSION_URI
    params = extension["params"]
    assert params["kcb_version"] == manifest["kcb_version"]
    assert params["produces"] == manifest["produces"]
    assert params["consumes"] == manifest["consumes"]
    assert params["capabilities"] == manifest["capabilities"]
    assert params["auth"] == manifest["auth"]
    assert params["signing"] == manifest["signing"]


def test_the_mcp_url_is_carried_twice_and_absolutized_together(
    card: dict[str, Any],
) -> None:
    """The interface url and the extension's `mcp` are one address, not two."""
    assert card["supportedInterfaces"][0]["url"] == "http://testserver/mcp"
    assert card["capabilities"]["extensions"][0]["params"]["mcp"] == (
        "http://testserver/mcp"
    )


def test_the_as_authored_card_is_server_relative() -> None:
    """No origin ⇒ no guessing: the document a same-origin client wants."""
    card = build_agent_card(None)

    assert card["supportedInterfaces"][0]["url"] == "/mcp"
    assert card["capabilities"]["extensions"][0]["params"]["mcp"] == "/mcp"


def test_a_configured_origin_wins_over_the_request(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PINAKES_PUBLIC_ORIGIN", "https://pinakes.example/")

    card = unbuilt_client.get(AGENT_CARD_ROUTE_PATH).json()

    assert card["supportedInterfaces"][0]["url"] == "https://pinakes.example/mcp"
