"""Smoke test for the service shell: it builds, it starts, it answers."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.app import create_app, describe_coverage, registered_routes
from pinakes.paths import (
    CLIENT_DIST_RELPATH,
    PARITY_SPEC_RELPATH,
    RepoRootNotFound,
    client_dist,
    parity_spec_path,
    repo_root,
)


def test_health_reports_a_wired_app(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "pinakes"
    assert body["clientBuilt"] is False
    # The shell's own routers came from discovery, not from a hand-written list.
    assert "pinakes.routers.health" in body["routers"]
    assert body["parity"]["total"] == (
        body["parity"]["ported"] + body["parity"]["unported"]
    )


def test_app_serves_its_own_openapi(unbuilt_client: TestClient) -> None:
    """FastAPI's schema describes what this service serves — not the baseline."""
    schema = unbuilt_client.get("/openapi.json").json()
    assert schema["info"]["title"] == "pinakes"
    assert "/api/health" in schema["paths"]
    # 501 stubs are registered with include_in_schema=False; advertising routes
    # the service does not implement would make its own contract a fiction.
    assert "/api/languages" not in schema["paths"]


def test_create_app_is_repeatable(built_dist: Path) -> None:
    """Two apps from one process must not share or mutate discovery state."""
    first = create_app(client_directory=built_dist)
    second = create_app(client_directory=built_dist)
    assert registered_routes(first) == registered_routes(second)
    assert first.state.router_modules == second.state.router_modules


def test_registered_routes_flattens_included_routers() -> None:
    """The parity diff must see through `include_router`, prefixes and all.

    FastAPI 0.139 stopped copying included routes into `app.routes`; reading the
    table flat made every route look unported and nothing failed loudly. This is
    the guard for the next time that representation changes.
    """
    inner = APIRouter(prefix="/api/inner")

    @inner.get("/thing")
    def thing() -> dict[str, str]:
        return {}

    app = FastAPI()
    app.include_router(inner, prefix="/outer")
    assert ("GET", "/outer/api/inner/thing") in registered_routes(app)


def test_describe_coverage_is_a_one_liner(unbuilt_client: TestClient) -> None:
    summary = describe_coverage(coverage_of(unbuilt_client))
    assert "baseline routes ported" in summary
    assert "\n" not in summary


def test_paths_resolve_inside_the_checkout(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("PINAKES_REPO_ROOT", "PINAKES_CLIENT_DIST", "PINAKES_PARITY_SPEC"):
        monkeypatch.delenv(var, raising=False)
    root = repo_root()
    assert (root / PARITY_SPEC_RELPATH).is_file()
    assert parity_spec_path() == root / PARITY_SPEC_RELPATH
    # The build output need not exist; its location must still be the one
    # `web/vite.config.ts` writes to.
    assert client_dist() == root / CLIENT_DIST_RELPATH


def test_repo_root_env_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PINAKES_REPO_ROOT", str(tmp_path))
    assert repo_root() == tmp_path.resolve()


def test_repo_root_failure_names_the_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    """A packaged install outside the checkout must fail loudly, not guess."""
    monkeypatch.delenv("PINAKES_REPO_ROOT", raising=False)
    monkeypatch.setattr("pinakes.paths.PARITY_SPEC_RELPATH", Path("no-such-marker"))
    with pytest.raises(RepoRootNotFound, match="PINAKES_REPO_ROOT"):
        repo_root()
