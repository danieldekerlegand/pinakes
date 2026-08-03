"""Shared fixtures for the `pinakes` service tests."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.parity import ParityCoverage, ParityRoute, load_parity_routes
from pinakes.paths import parity_spec_path


def coverage_of(client: TestClient) -> ParityCoverage:
    """The coverage the app under *client* computed at construction.

    ``TestClient.app`` is typed as the bare ASGI callable, so reaching for
    ``.state`` needs the cast; doing it here keeps it out of every test.
    """
    coverage: ParityCoverage = cast(FastAPI, client.app).state.parity_coverage
    return coverage


@pytest.fixture(scope="session")
def spec_path() -> Path:
    """The committed parity baseline. Located the way the service locates it."""
    path = parity_spec_path()
    assert path.is_file(), f"missing parity baseline at {path}"
    return path


@pytest.fixture(scope="session")
def spec(spec_path: Path) -> dict[str, object]:
    parsed: dict[str, object] = json.loads(spec_path.read_text(encoding="utf-8"))
    return parsed


@pytest.fixture(scope="session")
def baseline_routes() -> tuple[ParityRoute, ...]:
    return load_parity_routes()


@pytest.fixture
def unbuilt_client() -> Iterator[TestClient]:
    """The app with no client build present — the default developer state."""
    with TestClient(create_app(client_directory=Path("/nonexistent/dist"))) as client:
        yield client


@pytest.fixture
def built_dist(tmp_path: Path) -> Path:
    """A minimal stand-in for `dist/public`, so the static mount is exercised.

    A real `npm run build` would take minutes and pull the whole toolchain in;
    what the service actually needs from that output is an `index.html` and
    hashed assets beside it, which is what this provides.
    """
    dist = tmp_path / "public"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><title>pinakes</title>", encoding="utf-8"
    )
    (dist / "assets" / "index-abc123.js").write_text(
        "console.log('pinakes');", encoding="utf-8"
    )
    return dist


@pytest.fixture
def built_client(built_dist: Path) -> Iterator[TestClient]:
    """The app serving a built client at the root."""
    with TestClient(create_app(client_directory=built_dist)) as client:
        yield client
