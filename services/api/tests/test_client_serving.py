"""Serving the built React client at the root, with SPA fallback."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from pinakes.app import create_app


def test_root_serves_index_html(built_client: TestClient) -> None:
    response = built_client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<title>pinakes</title>" in response.text


def test_hashed_assets_are_served(built_client: TestClient) -> None:
    response = built_client.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert "console.log('pinakes')" in response.text


def test_client_side_routes_fall_back_to_the_shell(built_client: TestClient) -> None:
    """Deep links are the browser router's, not the server's."""
    for url in ("/atlas", "/languages/lang-42", "/deeply/nested/view"):
        response = built_client.get(url)
        assert response.status_code == 200, url
        assert "<title>pinakes</title>" in response.text


def test_the_static_mount_never_shadows_the_api(built_client: TestClient) -> None:
    """The mount is last, so a baseline route still answers its 501."""
    assert built_client.get("/api/languages").status_code == 501
    assert built_client.get("/api/health").status_code == 200


def test_unknown_backend_paths_404_rather_than_serving_html(
    built_client: TestClient,
) -> None:
    """Deliberate divergence from `server/vite.ts`; see pinakes.client."""
    for url in ("/api/no-such-route", "/.well-known/nope", "/mcp/nope"):
        response = built_client.get(url)
        assert response.status_code == 404, url
        assert not response.text.startswith("<!doctype html>"), url


def test_health_reports_the_build(built_client: TestClient) -> None:
    assert built_client.get("/api/health").json()["clientBuilt"] is True


def test_without_a_build_the_root_explains_itself(unbuilt_client: TestClient) -> None:
    """A developer who has not run the build gets an answer, not a stack trace."""
    response = unbuilt_client.get("/")
    assert response.status_code == 503
    body = response.json()
    assert body["error"] == "client_not_built"
    assert "npm run build" in body["message"]


def test_without_a_build_the_api_still_works(unbuilt_client: TestClient) -> None:
    assert unbuilt_client.get("/api/health").status_code == 200
    assert unbuilt_client.get("/api/languages").status_code == 501


def test_a_dist_without_index_html_counts_as_unbuilt(tmp_path: Path) -> None:
    """Half a build is not a build — an empty directory must not be mounted."""
    (tmp_path / "assets").mkdir()
    app = create_app(client_directory=tmp_path)
    assert app.state.client_built is False
