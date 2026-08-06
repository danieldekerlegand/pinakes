"""The published OpenAPI document (pinakes:80 US-1, the thirteenth slice).

`GET /api/openapi.json` was the **last** route of the cutover, and porting it
had one open question: whether `openapi-spec.test.ts`'s byte-equal assertion
against `docs/openapi.json` moved with it. It did not — it gained a twin. Both
suites now assert the same snapshot, which is what says the two backends publish
one document rather than two that happen to agree, and it is the assertion that
survives when `server/` goes.

The snapshot is therefore the gate. `docs/openapi.json` is committed; regenerate
it from whichever side you edited and both tests will say whether the other
followed.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from pinakes.openapi_spec import build_openapi_spec
from pinakes.paths import repo_root

#: Where the committed snapshot lives, relative to the checkout root.
SNAPSHOT_RELPATH = Path("docs") / "openapi.json"


def snapshot_path() -> Path:
    return repo_root() / SNAPSHOT_RELPATH


def test_the_document_matches_the_committed_snapshot() -> None:
    """The same assertion `server/services/openapi-spec.test.ts` makes."""
    snapshot = json.loads(snapshot_path().read_text(encoding="utf-8"))
    assert build_openapi_spec() == snapshot


def test_the_document_serialises_to_the_snapshot_byte_for_byte() -> None:
    """Stronger than the TypeScript's parsed comparison, and worth having.

    Key **order** is part of what ``JSON.stringify`` wrote, so a port that
    reordered a properties block would still pass a structural check and would
    still change the bytes on the wire. ``ensure_ascii=False`` is load-bearing
    too: the description carries characters Python would otherwise escape to
    ``\\uXXXX`` — the same rule `kcb.manifest.canonical_json` documents.
    """
    raw = snapshot_path().read_text(encoding="utf-8")
    assert not raw.isascii(), "the guard below is vacuous on an ASCII-only document"
    assert json.dumps(build_openapi_spec(), indent=2, ensure_ascii=False) + "\n" == raw


def test_the_route_serves_it(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/openapi.json")
    assert response.status_code == 200
    assert response.json() == build_openapi_spec()


def test_the_document_is_pure() -> None:
    """No environment, no clock, no shared mutable state between calls."""
    first = build_openapi_spec()
    first["paths"]["/api/contributions"]["get"]["summary"] = "mutated"
    assert build_openapi_spec()["paths"]["/api/contributions"]["get"]["summary"] == (
        "List contributions (filterable, paginated)."
    )


def test_it_describes_the_published_api_not_this_process(
    unbuilt_client: TestClient,
) -> None:
    """Two documents, two audiences — the difference is the whole reason this
    route is not an alias for FastAPI's generated `/openapi.json`."""
    published = build_openapi_spec()
    generated = unbuilt_client.get("/openapi.json").json()

    assert published["info"]["title"] == "pinakes Public API"
    assert generated["info"]["title"] == "pinakes"
    # The published document is a curated subset: no health, no parity, no
    # corpus reads — and it documents itself, which the generated one also does.
    assert set(published["paths"]) < set(generated["paths"])
    assert "/api/openapi.json" in published["paths"]
    assert "/api/health" not in published["paths"]


def test_writes_are_secured_and_reads_are_open() -> None:
    """The contract the document exists to publish: `CONTRIBUTION_API_KEYS` guards
    the two writes and nothing else (`pinakes.routers._auth`)."""
    paths = build_openapi_spec()["paths"]
    assert paths["/api/contributions"]["post"]["security"] == [
        {"ApiKeyAuth": []},
        {"BearerAuth": []},
    ]
    assert paths["/api/contributions/{id}/review"]["patch"]["security"] == [
        {"ApiKeyAuth": []},
        {"BearerAuth": []},
    ]
    assert paths["/api/contributions"]["get"]["security"] == []
    assert paths["/api/contributions/stats"]["get"]["security"] == []


def test_every_documented_path_is_one_the_service_serves(
    unbuilt_client: TestClient,
) -> None:
    """The document may be a subset of the surface; it must not be a fiction.

    Its path templating is OpenAPI's and so is the app's, so the two sets are
    directly comparable — which is what would catch a documented endpoint the
    cutover renamed.
    """
    served = set(unbuilt_client.get("/openapi.json").json()["paths"])
    assert set(build_openapi_spec()["paths"]) <= served
