"""The KCB capability-bus routes (pinakes:65 US-1).

`server/routes/capability-bus.test.ts` case for case, plus the two things the
TypeScript could not assert about a *port*: that the served document is
byte-identical to the contract on disk with nothing configured, and that a
signature minted here carries the same key id the Express signer derives.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contract_path

from pinakes.kcb import registry
from pinakes.kcb.manifest import MANIFEST_WELL_KNOWN_PATH, manifest_for
from pinakes.kcb.signing import (
    derive_key_id,
    sign_manifest_for_serving,
    verify_manifest_signature,
)


@pytest.fixture
def signing_keys(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Configure a signing key, and hand back what verifies against it.

    A **fixed** seed rather than a fresh keypair per run, so the derived key id
    is deterministic: `derive_key_id` is the one thing here that has to agree
    digit for digit with `server/services/manifest-signing.ts`, and a random key
    would make that assertion vacuous.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    private = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
    pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    monkeypatch.setenv("PINAKES_SIGNING_PRIVATE_KEY", pem)
    return {"public": private.public_key(), "key_id": derive_key_id(private)}


# ── The two manifest fronts ──────────────────────────────────────────────────


def test_the_well_known_front_serves_the_kcb_manifest(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH)

    assert response.status_code == 200
    manifest = response.json()
    assert manifest["identity"] == "pinakes:agent:resolver"
    assert manifest["kcb_version"] == "0.2.0"
    assert [c["name"] for c in manifest["capabilities"]] == [
        "resolve",
        "reconcile",
        "query",
        # The specialized KFT provider rides on the same document.
        "finetune",
    ]


def test_the_api_front_serves_the_same_document(unbuilt_client: TestClient) -> None:
    well_known = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH).json()
    api = unbuilt_client.get("/api/kcb/manifest").json()

    assert api == well_known


def test_the_knowledge_ports_are_grounding_only_consensus_reality(
    unbuilt_client: TestClient,
) -> None:
    manifest = unbuilt_client.get("/api/kcb/manifest").json()

    knowledge = [p for p in manifest["produces"] if p["plane"] == "knowledge"]
    assert knowledge
    for port in knowledge:
        assert port["dialect"] == "grounding-only"
        assert "pinakes:world:consensus-reality" in port["worlds"]


def test_a_configured_origin_absolutizes_every_dialable_address(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PINAKES_PUBLIC_ORIGIN", "https://pinakes.example")

    manifest = unbuilt_client.get("/api/kcb/manifest").json()

    assert (
        manifest["endpoints"]["manifest"]
        == "https://pinakes.example/.well-known/kcb-manifest.json"
    )
    # The MCP tools surface and the A2A agent-card are dialable fronts too.
    assert manifest["endpoints"]["mcp"] == "https://pinakes.example/mcp"
    assert (
        manifest["endpoints"]["a2a"]
        == "https://pinakes.example/.well-known/agent-card.json"
    )
    resolve = next(c for c in manifest["capabilities"] if c["name"] == "resolve")
    assert (
        resolve["x_surfaces"][0]["url"]
        == "https://pinakes.example/api/graph/resolve"
    )


def test_with_no_public_origin_the_request_origin_is_used(
    unbuilt_client: TestClient,
) -> None:
    """A card pulled over the network has to be dialable without configuration."""
    manifest = unbuilt_client.get("/api/kcb/manifest").json()

    assert (
        manifest["endpoints"]["manifest"]
        == "http://testserver/.well-known/kcb-manifest.json"
    )


def test_the_as_authored_manifest_is_the_contract_on_disk_verbatim() -> None:
    """The self-description guarantee, in the shape Express proves it too.

    With no origin, no signing key and no registry, the document this service
    serves IS `contracts/capability-manifest.json` — so the participant does not
    depend on anything outside its own repository to describe itself
    (`docs/self-describing-participant.md`).
    """
    authored = json.loads(
        contract_path("capability-manifest.json").read_text(encoding="utf-8")
    )

    assert sign_manifest_for_serving(manifest_for(None)) == authored


# ── The invocation directory ─────────────────────────────────────────────────


def test_the_directory_lists_every_capability_with_its_built_endpoints(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/kcb/capabilities")

    assert response.status_code == 200
    body = response.json()
    assert body["identity"] == "pinakes:agent:resolver"
    by_name = {c["name"]: c for c in body["capabilities"]}
    assert by_name["reconcile"]["grant"] == "invoke:reconcile"
    # The reconciler is the merged Python module; the manifest wraps it.
    assert (
        by_name["reconcile"]["surfaces"][0]["implementation"]
        == "engine/src/pinakes_engine/schema/reconcile.py"
    )
    assert by_name["resolve"]["surfaces"][0]["path"] == "/api/graph/resolve"
    assert "/api/graph/datalog" in [s["path"] for s in by_name["query"]["surfaces"]]


def test_only_the_narrow_capability_carries_a_specialization_block(
    unbuilt_client: TestClient,
) -> None:
    """FT-K's tiebreak is decided here, so it must not be manifest-only."""
    body = unbuilt_client.get("/api/kcb/capabilities").json()

    specialized = {c["name"] for c in body["capabilities"] if "specialization" in c}
    assert specialized == {"finetune"}
    finetune = next(c for c in body["capabilities"] if c["name"] == "finetune")
    assert finetune["specialization"]["provider_class"] == "specialized"


def test_every_directory_entry_has_a_surface_behind_it(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/kcb/capabilities").json()

    assert len(body["capabilities"]) == 4
    for entry in body["capabilities"]:
        assert entry["surfaces"], entry["name"]


# ── Registration status ──────────────────────────────────────────────────────


def test_status_answers_before_any_registration_settles(
    unbuilt_client: TestClient,
) -> None:
    """Serving never waits on the registry, so the probe must be answerable."""
    body = unbuilt_client.get("/api/kcb/status").json()

    assert body["identity"] == "pinakes:agent:resolver"
    assert body["manifestVersion"] == "0.4.0"
    assert body["signed"] is False
    assert body["registry"]["servingDirectly"] is True


def test_with_no_registry_configured_publishing_is_a_no_op() -> None:
    result = registry.publish()

    assert result.registered is False
    assert result.registry_url is None
    assert "KCB_REGISTRY_URL" in result.detail
    assert result.as_dict()["servingDirectly"] is True


def test_an_unreachable_registry_does_not_claim_the_capabilities_are_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """KCB §3: the registry is a cache. Its absence is never our outage."""
    monkeypatch.setenv(registry.REGISTRY_URL_ENV, "http://127.0.0.1:1/registry/")

    result = registry.publish(timeout=0.5)

    assert result.registered is False
    # The trailing slash is normalized away, or the POST path would be `//manifests`.
    assert result.registry_url == "http://127.0.0.1:1/registry"
    assert "unreachable" in result.detail.lower()
    assert result.serving_directly is True


def test_the_reported_registration_is_whatever_the_push_returned() -> None:
    registry._record(  # noqa: SLF001 - the recorder is the seam; there is no route
        registry.PublishResult(
            registered=True,
            registry_url="https://registry.example",
            detail="Published pinakes:agent:resolver to the KCB registry.",
        )
    )

    assert registry.registration().as_dict() == {
        "registered": True,
        "servingDirectly": True,
        "registryUrl": "https://registry.example",
        "detail": "Published pinakes:agent:resolver to the KCB registry.",
    }


# ── Signing ──────────────────────────────────────────────────────────────────


def test_a_configured_key_signs_the_served_manifest_and_status_says_so(
    unbuilt_client: TestClient, signing_keys: dict[str, Any]
) -> None:
    manifest = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH).json()

    assert manifest["signing"]["key_id"] == signing_keys["key_id"]
    assert isinstance(manifest["signing"]["signature"], str)
    assert verify_manifest_signature(manifest, signing_keys["public"])
    assert unbuilt_client.get("/api/kcb/status").json()["signed"] is True


def test_tampering_with_a_signed_field_invalidates_the_signature(
    unbuilt_client: TestClient, signing_keys: dict[str, Any]
) -> None:
    manifest = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH).json()

    manifest["identity"] = "someone:else"

    assert not verify_manifest_signature(manifest, signing_keys["public"])


def test_a_malformed_key_degrades_to_unsigned_rather_than_failing_to_serve(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """KCB §5 signing is a SHOULD; an unserved manifest is the worse failure."""
    monkeypatch.setenv("PINAKES_SIGNING_PRIVATE_KEY", "not-a-key")

    response = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH)

    assert response.status_code == 200
    assert response.json()["signing"]["key_id"] is None
    assert unbuilt_client.get("/api/kcb/status").json()["signed"] is False


def test_an_explicit_key_id_overrides_the_derived_one(
    unbuilt_client: TestClient,
    signing_keys: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PINAKES_SIGNING_KEY_ID", "ops:rotated-2026")

    manifest = unbuilt_client.get(MANIFEST_WELL_KNOWN_PATH).json()

    assert manifest["signing"]["key_id"] == "ops:rotated-2026"
    assert verify_manifest_signature(manifest, signing_keys["public"])
