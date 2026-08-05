"""Shared fixtures for the `pinakes` service tests."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pinakes import paths
from pinakes.app import create_app
from pinakes.engine import corpus as engine_corpus
from pinakes.engine import graph as engine_graph
from pinakes.parity import ParityCoverage, ParityRoute, load_parity_routes
from pinakes.paths import parity_spec_path
from pinakes.routers import _auth as write_guard_handles


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


@pytest.fixture(autouse=True)
def isolated_data_trees(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> dict[str, Path]:
    """Point every writable data tree at this test's own temp directory.

    Autouse, and not optional. Two of these trees are shared state that outlives
    the run: `data/runtime/contributions` is the live review queue, and
    `data/source/lexicons` is the corpus every other reader in the repo reads.
    A test that promoted a draft into the real corpus would leave a fixture row
    visible to `convergence-qa`, `coverage-report`, `data-quality-scorer` and the
    rest — a failure that lands somewhere else entirely, one run in six
    (`server/CLAUDE.md`). The override is per-call in `pinakes.paths`, so
    redirecting the environment is enough; there is no handle to reset.

    Returns the three directories so a test can assert on what was written.
    """
    trees = {
        paths.CONTRIBUTIONS_DIR_ENV: tmp_path / "contributions",
        paths.CHANGELOG_DIR_ENV: tmp_path / "changelog",
        paths.LEXICONS_DIR_ENV: tmp_path / "lexicons",
    }
    for variable, directory in trees.items():
        directory.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv(variable, str(directory))
    return {
        "contributions": trees[paths.CONTRIBUTIONS_DIR_ENV],
        "changelog": trees[paths.CHANGELOG_DIR_ENV],
        "lexicons": trees[paths.LEXICONS_DIR_ENV],
    }


@pytest.fixture(autouse=True)
def reset_write_guard() -> Iterator[None]:
    """Give every test its own auth config and its own rate-limit counters.

    Autouse, and not optional either. The guard caches both in module state (as
    the Express middleware cached them in a closure), so without this the
    counters accumulate across the whole session and the sixty-first write lands
    a 429 in whichever test happens to make it — and a test that configured keys
    would leave them configured for everything after it.
    """
    write_guard_handles.reset()
    yield
    write_guard_handles.reset()


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


# ── A corpus on disk ─────────────────────────────────────────────────────────

#: A job output root: `corpus/` with the canonical TSVs beside the artifacts the
#: pipeline writes (`catalog.json`, `metrics.json`, `qa.json`, `qa/<id>.qa.json`).
#: Small on purpose — every assertion below names its rows.
_NODES_TSV = "\n".join(
    [
        "csid:ID\t:LABEL\tname\twikidata_qid\tsource",
        "cs:dish:ceviche\tDish;CulturalArtifact\tCeviche\tQ207681\twikidata",
        "cs:dish:tiradito\tDish\tTiradito\tQ7807712\twikidata",
        "cs:place:lima\tPlace\tLima\t\twikidata",
    ]
)

_EDGES_TSV = "\n".join(
    [
        ":START_ID\t:END_ID\t:TYPE\tweight:float\tsource",
        "cs:dish:tiradito\tcs:dish:ceviche\tDERIVED_FROM\t\twikidata",
        "cs:dish:ceviche\tcs:place:lima\tLOCATED_IN\t\twikidata",
    ]
)


@pytest.fixture
def corpus_root(tmp_path: Path) -> Path:
    """A minimal but complete corpus the engine calls can be driven against."""
    root = tmp_path / "job"
    corpus_dir = root / "corpus"
    (corpus_dir / "nodes").mkdir(parents=True)
    (corpus_dir / "edges").mkdir(parents=True)
    (root / "qa").mkdir()
    (corpus_dir / "nodes" / "entities.tsv").write_text(
        _NODES_TSV + "\n", encoding="utf-8"
    )
    (corpus_dir / "edges" / "edges.tsv").write_text(
        _EDGES_TSV + "\n", encoding="utf-8"
    )
    (corpus_dir / "metrics.json").write_text(
        json.dumps(
            {
                "node_count": 3,
                "edge_count": 2,
                "edges_per_node": 0.667,
                "component_count": 1,
                "largest_component_size": 3,
                "largest_component_fraction": 1.0,
                "edges_by_dimension": {"genetic": 1, "geographic": 1},
                "edges_by_type": {"DERIVED_FROM": 1, "LOCATED_IN": 1},
            }
        ),
        encoding="utf-8",
    )
    (corpus_dir / "qa.json").write_text(
        json.dumps(
            {
                "node_count": 3,
                "edge_count": 2,
                "ok": False,
                "gates": [
                    {
                        "key": "provenance_completeness",
                        "label": "provenance completeness",
                        "passed": False,
                    },
                    {"key": "row_count", "label": "row count", "passed": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (root / "catalog.json").write_text(
        json.dumps(
            {
                "categories": [
                    {
                        "id": "peruvian-dishes",
                        "label": "Dish",
                        "source": "wikidata",
                        "node_count": 2,
                        "edge_count": 1,
                        "dimensions": ["genetic"],
                        "last_run": "2026-06-18T09:30:00",
                        "provenance": {
                            "adapter": "wikidata",
                            "sources": ["wikidata"],
                            "records": 2,
                            "errors": 0,
                        },
                    },
                    {
                        "id": "andean-context",
                        "label": "Place",
                        "source": "wikidata",
                        "node_count": 1,
                        "edge_count": 1,
                        "dimensions": ["geographic"],
                        "last_run": "2026-06-18T09:30:00",
                        "provenance": {
                            "adapter": "wikidata",
                            "sources": ["wikidata"],
                            "records": 1,
                            "errors": 2,
                        },
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (root / "qa" / "peruvian-dishes.qa.json").write_text(
        json.dumps({"node_count": 2, "edge_count": 1, "ok": True, "gates": []}),
        encoding="utf-8",
    )
    return root


@pytest.fixture
def corpus_env(corpus_root: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the engine layer at :func:`corpus_root` for the duration of a test."""
    monkeypatch.setenv(engine_corpus.CORPUS_ENV, str(corpus_root))
    return corpus_root


# ── A fake Neo4j driver ──────────────────────────────────────────────────────
#
# The `neo4j` driver's own types are `Mapping`s over their properties, so the
# fakes below are too — that is what lets `dict(node)` in the projection work
# unchanged against either. Nothing here touches a database.


class FakeNode(Mapping[str, Any]):
    """Stand-in for `neo4j.graph.Node`."""

    def __init__(
        self, element_id: str, labels: list[str], properties: dict[str, Any]
    ) -> None:
        self.element_id = element_id
        self.labels = labels
        self._properties = properties

    def __getitem__(self, key: str) -> Any:
        return self._properties[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._properties)

    def __len__(self) -> int:
        return len(self._properties)


class FakeRelationship(Mapping[str, Any]):
    """Stand-in for `neo4j.graph.Relationship`."""

    def __init__(
        self,
        element_id: str,
        type_: str,
        start: FakeNode,
        end: FakeNode,
        properties: dict[str, Any] | None = None,
    ) -> None:
        self.element_id = element_id
        self.type = type_
        self.start_node = start
        self.end_node = end
        self._properties = properties or {}

    def __getitem__(self, key: str) -> Any:
        return self._properties[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._properties)

    def __len__(self) -> int:
        return len(self._properties)


class FakeResult(list[Any]):
    """A driver result: a record list that also answers `keys()`."""

    def __init__(self, records: list[Any], keys: list[str] | None = None) -> None:
        super().__init__(records)
        self._keys = keys or []

    def keys(self) -> list[str]:
        return self._keys


class FakeSession:
    def __init__(self, handler: Callable[[str, dict[str, Any]], Any]) -> None:
        self._handler = handler

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, cypher: str, params: dict[str, Any] | None = None) -> Any:
        return self._handler(cypher, params or {})


class FakeDriver:
    """A driver whose every query is answered by one injected handler."""

    def __init__(
        self,
        handler: Callable[[str, dict[str, Any]], Any],
        *,
        reachable: bool = True,
    ) -> None:
        self.handler = handler
        self.reachable = reachable
        self.queries: list[tuple[str, dict[str, Any]]] = []
        self.closed = 0
        self.probes = 0

    def _run(self, cypher: str, params: dict[str, Any]) -> Any:
        self.queries.append((cypher, params))
        return self.handler(cypher, params)

    def session(self, **_kwargs: Any) -> FakeSession:
        return FakeSession(self._run)

    def verify_connectivity(self) -> None:
        self.probes += 1
        if not self.reachable:
            raise RuntimeError("no route to the graph store")

    def close(self) -> None:
        self.closed += 1


@pytest.fixture
def fake_graph() -> Iterator[Callable[..., FakeDriver]]:
    """Install a fake driver behind the engine's graph layer.

    Yields a factory: call it with a handler (and optionally `reachable=False`)
    and the returned driver is what every graph call in the test talks to.
    """

    def install(
        handler: Callable[[str, dict[str, Any]], Any], *, reachable: bool = True
    ) -> FakeDriver:
        driver = FakeDriver(handler, reachable=reachable)
        # `Connect` is typed to return a real `neo4j.Driver`; the fake satisfies
        # every attribute the engine layer touches, which is the point of the
        # injection seam, so the cast is the honest way to say so.
        engine_graph.configure(connect=cast(Any, lambda *_a, **_k: driver))
        return driver

    engine_graph.reset_handles()
    yield install
    engine_graph.reset_handles()
