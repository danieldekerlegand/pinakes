"""Tests for the explorer app shell and the ``serve`` command (T7-US-001).

The explorer is behind the optional ``gui`` extra, so these tests skip cleanly
when FastAPI is not installed. They drive the app with FastAPI's TestClient — no
live server — asserting the overview page loads and lists the corpus and views,
and that the CLI wiring guards its inputs.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from culturescrape import cli, translation  # noqa: E402
from culturescrape.explorer import create_app  # noqa: E402
from culturescrape.explorer.datalog import Datalog  # noqa: E402

#: Resolved once: the runnable Datalog assertions need swipl, the rest do not.
SWIPL = shutil.which("swipl")

REPO_ROOT = Path(__file__).resolve().parent.parent
#: A ready-made corpus dataset shipped in the repo (nodes/ + edges/).
SAMPLE = REPO_ROOT / "datalog" / "examples" / "dataset"
#: A full job output root fixture: corpus/ TSV plus catalog/metrics/qa artifacts.
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "explorer-corpus"


def test_overview_lists_the_corpus_and_views() -> None:
    client = TestClient(create_app(SAMPLE))

    response = client.get("/")

    assert response.status_code == 200
    body = response.text
    assert "culture-scrape explorer" in body
    assert "dataset" in body  # the corpus source name
    # The nav advertises the views later stories fill in.
    for label in ("Tables", "Completeness", "Metrics", "Graph", "Datalog"):
        assert label in body


def test_serve_rejects_a_non_directory(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = cli.main(["serve", str(REPO_ROOT / "does-not-exist")])

    assert exit_code == 2
    assert "not a directory" in capsys.readouterr().err


def test_serve_is_registered_in_the_cli() -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--help"])
    assert excinfo.value.code == 0


# --- Browse, search, and detail views (T7-US-003) ---------------------------


def test_node_table_lists_nodes_with_detail_links() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/nodes")

    assert response.status_code == 200
    body = response.text
    assert "csid:ID" in body  # the canonical header is shown
    assert "Ceviche" in body
    # Each node deep-links to its detail page.
    assert '/nodes/cs:dish:ceviche"' in body


def test_node_table_filters_by_label() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/nodes", params={"label": "Place"})

    assert response.status_code == 200
    body = response.text
    assert "Lima" in body
    assert "Ceviche" not in body  # a Dish, filtered out


def test_node_table_free_text_search_on_name_and_csid() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    by_name = client.get("/nodes", params={"q": "lima"})
    assert "Lima" in by_name.text
    assert "Ceviche" not in by_name.text

    by_csid = client.get("/nodes", params={"q": "cs:dish:ceviche"})
    assert "Ceviche" in by_csid.text
    assert "Lima" not in by_csid.text


def test_edge_table_filters_by_type() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/edges", params={"type": "LOCATED_IN"})

    assert response.status_code == 200
    body = response.text
    assert "LOCATED_IN" in body
    # kinilaw only appears in the INFLUENCED_BY edge, which is filtered out.
    assert "cs:dish:kinilaw" not in body
    # Endpoints deep-link to the node detail.
    assert '/nodes/cs:place:lima"' in body


def test_node_detail_shows_columns_provenance_and_incident_edges() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/nodes/cs:place:lima")

    assert response.status_code == 200
    body = response.text
    # Every canonical column header, including provenance, is present.
    assert "csid:ID" in body
    assert ":LABEL" in body
    assert "source" in body
    # Lima locates into Peru (outgoing) and dishes locate into Lima (incoming).
    assert "cs:place:peru" in body
    assert "cs:dish:ceviche" in body
    assert "Outgoing edges" in body
    assert "Incoming edges" in body


def test_missing_node_returns_404() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/nodes/cs:does:not-exist")

    assert response.status_code == 404
    assert "not found" in response.text.lower()


# --- Scraping completeness dashboard (T7-US-004) ----------------------------


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _build_mixed_root(tmp_path: Path) -> Path:
    """A job root whose categories span every completeness status."""
    root = tmp_path / "out" / "mixed"
    _write(
        root / "corpus" / "nodes" / "n.tsv",
        "csid:ID\t:LABEL\tname\ncs:x:1\tDish\tA\n",
    )
    _write(
        root / "corpus" / "edges" / "e.tsv",
        ":START_ID\t:END_ID\t:TYPE\ncs:x:1\tcs:x:1\tDERIVED_FROM\n",
    )

    def entry(cid: str, nodes: int, errors: int, records: int) -> dict[str, object]:
        return {
            "id": cid,
            "label": "Dish",
            "node_count": nodes,
            "edge_count": nodes,
            "last_run": "2026-06-18T09:30:00",
            "provenance": {
                "adapter": "wikidata",
                "sources": ["wikidata"] if records else [],
                "records": records,
                "errors": errors,
            },
        }

    _write(
        root / "catalog.json",
        json.dumps(
            {
                "categories": [
                    entry("complete-cat", nodes=5, errors=0, records=5),
                    entry("incomplete-cat", nodes=3, errors=0, records=3),
                    entry("failed-cat", nodes=0, errors=3, records=0),
                ]
            }
        ),
    )

    def report(cid: str, *, prov_ok: bool) -> str:
        return json.dumps(
            {
                "dataset": cid,
                "node_count": 0,
                "edge_count": 0,
                "ok": prov_ok,
                "gates": [
                    {
                        "key": "provenance_completeness",
                        "label": "provenance completeness",
                        "passed": prov_ok,
                    }
                ],
            }
        )

    _write(root / "qa" / "complete-cat.qa.json", report("complete-cat", prov_ok=True))
    _write(
        root / "qa" / "incomplete-cat.qa.json", report("incomplete-cat", prov_ok=False)
    )
    _write(root / "qa" / "failed-cat.qa.json", report("failed-cat", prov_ok=False))
    # A graded category that never made it into the catalog.
    _write(root / "qa" / "neverrun-cat.qa.json", report("neverrun-cat", prov_ok=False))
    return root


def test_completeness_flags_an_incomplete_fixture_category() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/completeness")

    assert response.status_code == 200
    body = response.text
    # Every catalogued category gets a row...
    assert "peruvian-dishes" in body
    assert "andean-context" in body
    # ...and the known-incomplete one is flagged with its provenance violation.
    assert "incomplete" in body
    assert "provenance completeness" in body


def test_completeness_renders_every_status(tmp_path: Path) -> None:
    client = TestClient(create_app(_build_mixed_root(tmp_path)))

    body = client.get("/completeness").text
    for label in ("complete", "incomplete", "failed", "never run"):
        assert label in body
    # The never-run category surfaces even though it is absent from the catalog.
    assert "neverrun-cat" in body


def test_completeness_filters_by_status(tmp_path: Path) -> None:
    client = TestClient(create_app(_build_mixed_root(tmp_path)))

    response = client.get("/completeness", params={"status": "failed"})

    assert response.status_code == 200
    body = response.text
    assert "failed-cat" in body
    assert "complete-cat" not in body
    assert "neverrun-cat" not in body


def test_completeness_is_sortable(tmp_path: Path) -> None:
    client = TestClient(create_app(_build_mixed_root(tmp_path)))

    response = client.get("/completeness", params={"sort": "category"})

    assert response.status_code == 200
    body = response.text
    # Sorted alphabetically by id: complete-cat precedes failed-cat.
    assert body.index("complete-cat") < body.index("failed-cat")
    # Headers offer sort links for the other columns.
    assert "/completeness?sort=nodes" in body


# --- Category actions on the dashboard (T7-US-011) --------------------------


def _build_actions_root(tmp_path: Path, *, artifacts: bool, refresh: bool) -> Path:
    """A job root with one incomplete category, optionally with exports + a log."""
    root = _build_mixed_root(tmp_path)
    if artifacts:
        _write(root / "corpus-neo4j" / "import.sh", "#!/bin/sh\n")
        _write(root / "corpus-datalog" / "corpus.pl", "% datalog\n")
        _write(root / "mixed-manifest.json", '{"name": "mixed"}\n')
    if refresh:
        _write(
            root / "refresh-log.jsonl",
            json.dumps(
                {
                    "timestamp": "2026-06-19T03:15:00+00:00",
                    "cutoff": "2026-06-18T03:15:00+00:00",
                    "refreshed": ["incomplete-cat"],
                    "skipped": ["complete-cat"],
                    "decisions": [
                        {
                            "category": "incomplete-cat",
                            "refresh": True,
                            "reason": "last run 2026-06-18 at/before cutoff",
                            "last_run": "2026-06-18T09:30:00",
                        }
                    ],
                }
            )
            + "\n",
        )
    return root


def test_category_actions_surface_commands_referencing_the_category() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/completeness/peruvian-dishes")

    assert response.status_code == 200
    body = response.text
    # All three operator commands are present...
    assert "culturescrape run jobs/" in body
    assert "culturescrape run --since 7d jobs/" in body
    assert "culturescrape package" in body
    # ...and each names the category it acts on (the copyable comment line).
    assert body.count("# peruvian-dishes:") == 3


def test_category_actions_link_artifacts_and_manifest(tmp_path: Path) -> None:
    root = _build_actions_root(tmp_path, artifacts=True, refresh=False)
    client = TestClient(create_app(root))

    body = client.get("/completeness/incomplete-cat").text

    assert "corpus-neo4j" in body
    assert "corpus-datalog" in body
    assert "mixed-manifest.json" in body
    # The exports are flagged as built (present), not greyed out.
    assert "not built" not in body


def test_category_actions_flag_absent_artifacts(tmp_path: Path) -> None:
    root = _build_actions_root(tmp_path, artifacts=False, refresh=False)
    client = TestClient(create_app(root))

    body = client.get("/completeness/incomplete-cat").text

    # With nothing exported the artifacts are listed but flagged absent.
    assert "corpus-neo4j" in body
    assert "not built" in body


def test_category_actions_show_last_refresh_entry(tmp_path: Path) -> None:
    root = _build_actions_root(tmp_path, artifacts=False, refresh=True)
    client = TestClient(create_app(root))

    body = client.get("/completeness/incomplete-cat").text

    assert "2026-06-19T03:15:00" in body
    assert "at/before cutoff" in body  # this category's per-run decision


def test_category_actions_without_refresh_log_says_so(tmp_path: Path) -> None:
    root = _build_actions_root(tmp_path, artifacts=False, refresh=False)
    client = TestClient(create_app(root))

    body = client.get("/completeness/incomplete-cat").text

    assert "refresh-log.jsonl" in body  # the empty-state hint


def test_category_actions_unknown_category_is_404() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/completeness/no-such-category")

    assert response.status_code == 404
    assert "Category not found" in response.text


def test_category_actions_unavailable_for_bare_corpus() -> None:
    # SAMPLE is a bare nodes/edges dataset: no job root, so no actions exist.
    client = TestClient(create_app(SAMPLE))

    assert client.get("/completeness/anything").status_code == 404


def test_completeness_links_each_category_to_its_actions() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/completeness").text

    assert '/completeness/peruvian-dishes"' in body


# --- Graph metrics (T7-US-005) ----------------------------------------------


def test_metrics_renders_counts_and_breakdowns() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/metrics")

    assert response.status_code == 200
    body = response.text
    # Counts and density from the fixture metrics.json.
    assert "nodes" in body
    assert "edges / node" in body
    assert "components" in body
    # Edges broken down by dimension and by :TYPE.
    assert "geographic" in body
    assert "LOCATED_IN" in body
    # The single-component fixture is well-connected, not flagged.
    assert "Well-connected" in body
    assert "Fragmented" not in body


def test_metrics_flags_fragmentation_below_threshold(tmp_path: Path) -> None:
    # Three disconnected nodes and no edges: three components, largest 1/3.
    corpus = tmp_path / "islands"
    _write(
        corpus / "nodes" / "n.tsv",
        "csid:ID\t:LABEL\tname\ncs:x:1\tDish\tA\ncs:x:2\tDish\tB\ncs:x:3\tDish\tC\n",
    )
    (corpus / "edges").mkdir(parents=True)
    client = TestClient(create_app(corpus))

    # Default threshold (0.9) flags the fragmentation...
    assert "Fragmented" in client.get("/metrics").text
    # ...and a low enough threshold clears it.
    assert "Well-connected" in client.get("/metrics", params={"threshold": 0.3}).text


def test_metrics_reports_when_unavailable(tmp_path: Path) -> None:
    # A corpus whose metrics.json is unreadable surfaces no metrics, gracefully.
    corpus = tmp_path / "broken"
    (corpus / "nodes").mkdir(parents=True)
    (corpus / "edges").mkdir()
    _write(corpus / "metrics.json", "{ not valid json")
    client = TestClient(create_app(corpus))

    response = client.get("/metrics")

    assert response.status_code == 200
    assert "No metrics available" in response.text


# --- Interactive graph visualization (T7-US-006) ----------------------------


def test_graph_view_renders_cytoscape_for_a_node() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/graph", params={"csid": "cs:place:lima"})

    assert response.status_code == 200
    body = response.text
    # Cytoscape.js is pulled from a CDN, with no JS build step.
    assert "cytoscape" in body
    assert "cdnjs.cloudflare.com" in body
    # The canvas is seeded with the selected node and fetches its neighborhood.
    assert 'data-csid="cs:place:lima"' in body
    assert "/api/graph/" in body


def test_graph_view_defaults_to_the_first_node() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/graph")

    assert response.status_code == 200
    # With no csid the view seeds itself from the first node so it always draws.
    assert "data-csid=" in response.text


def test_neighborhood_endpoint_returns_expected_nodes_and_edges() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/api/graph/cs:place:lima", params={"depth": 1})

    assert response.status_code == 200
    payload = response.json()
    assert payload["center"] == "cs:place:lima"
    assert payload["depth"] == 1

    by_id = {n["data"]["id"]: n["data"] for n in payload["nodes"]}
    # The seed, its two incoming dishes, and the place it locates into.
    expected = {"cs:place:lima", "cs:dish:ceviche", "cs:dish:tiradito", "cs:place:peru"}
    assert expected <= set(by_id)
    # Out-of-range neighbours are excluded at depth 1.
    assert "cs:event:inca-expansion" not in by_id
    # The seed is flagged as the center and carries its :LABEL.
    assert by_id["cs:place:lima"]["center"] is True
    assert by_id["cs:place:lima"]["label"] == "Place"

    edges = payload["edges"]
    # Edges are self-contained: both endpoints are in the node set.
    ids = set(by_id)
    assert all(e["data"]["source"] in ids and e["data"]["target"] in ids for e in edges)
    # LOCATED_IN edges are styled on the geographic dimension.
    located = [e["data"] for e in edges if e["data"]["type"] == "LOCATED_IN"]
    assert located and all(e["dimension"] == "geographic" for e in located)


def test_neighborhood_depth_zero_returns_only_the_seed() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    payload = client.get("/api/graph/cs:place:lima", params={"depth": 0}).json()

    assert [n["data"]["id"] for n in payload["nodes"]] == ["cs:place:lima"]
    # A lone node has no self-contained edges.
    assert payload["edges"] == []


def test_neighborhood_endpoint_404s_for_unknown_csid() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/api/graph/cs:does:not-exist")

    assert response.status_code == 404
    assert "unknown csid" in response.json()["error"]


# --- Logic queries over the exported program (T7-US-008) --------------------
#
# Mirrors tests/test_datalog_examples.py: an offline layer that covers the route
# and linting with no engine installed, and a runnable layer that runs the query
# in swipl and skips with a logged reason when swipl is absent.


def test_datalog_lists_examples_with_descriptions() -> None:
    client = TestClient(create_app(SAMPLE))

    response = client.get("/datalog")

    assert response.status_code == 200
    body = response.text
    # Every shipped example is listed with its file name and documented title.
    assert "ancestry-of-dish.pl" in body
    assert "Full ancestry of a dish" in body
    for slug in (
        "entities-within-region",
        "contemporaries-of-event",
        "shortest-influence-chain",
    ):
        assert slug in body


def test_datalog_shows_selected_query_source() -> None:
    client = TestClient(create_app(SAMPLE))

    response = client.get("/datalog", params={"query": "ancestry-of-dish"})

    assert response.status_code == 200
    body = response.text
    # Selecting an example renders its full source, including the entry point.
    assert "influenced_transitively" in body
    assert "main :-" in body
    # ...and offers a Run button.
    assert 'name="run"' in body


def test_datalog_lints_offline_when_swipl_absent() -> None:
    # Force the offline path so the route lints rather than runs.
    offline = Datalog(SAMPLE, swipl=None)
    client = TestClient(create_app(SAMPLE, datalog=offline))

    # A clean shipped example: explained as not run, lint clean.
    clean = client.get(
        "/datalog", params={"query": "ancestry-of-dish", "run": "1"}
    ).text
    assert "swipl not found" in clean.lower()
    assert "lint: clean" in clean.lower()

    # An ad-hoc bogus goal: the offline linter surfaces its problems instead.
    bogus = client.get(
        "/datalog",
        params={"goal": "nonsense without a comment or entry point", "run": "1"},
    ).text
    assert "entry point" in bogus
    assert "no known schema predicate" in bogus


@pytest.mark.skipif(SWIPL is None, reason="running a datalog query needs swipl")
def test_datalog_runs_a_selected_example() -> None:
    client = TestClient(create_app(SAMPLE))

    response = client.get(
        "/datalog", params={"query": "ancestry-of-dish", "run": "1"}
    )

    assert response.status_code == 200
    body = response.text
    # The expected ancestry rows are rendered.
    for csid in ("cs:dish:tiradito", "cs:dish:ceviche", "cs:dish:kinilaw"):
        assert csid in body


@pytest.mark.skipif(SWIPL is None, reason="running a datalog query needs swipl")
def test_datalog_runs_an_adhoc_goal() -> None:
    client = TestClient(create_app(SAMPLE))
    goal = (
        "% every derivation pair\n"
        "main :- forall(derived_from(X, Y), format('~w\\t~w~n', [X, Y]))."
    )

    response = client.get("/datalog", params={"goal": goal, "run": "1"})

    assert response.status_code == 200
    body = response.text
    # The base derived_from facts come back as two-column rows.
    assert "cs:dish:tiradito" in body
    assert "cs:dish:ceviche" in body


@pytest.mark.skipif(SWIPL is None, reason="running a datalog query needs swipl")
def test_datalog_surfaces_a_query_error() -> None:
    client = TestClient(create_app(SAMPLE))
    # Defines main/0 (so it loads) but calls an undefined predicate at run time.
    goal = "% broken\nmain :- no_such_predicate(_)."

    response = client.get("/datalog", params={"goal": goal, "run": "1"})

    assert response.status_code == 200
    assert "no_such_predicate" in response.text


def test_datalog_skip_is_logged_when_swipl_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when ``swipl`` is unavailable."""
    if SWIPL is not None:
        pytest.skip("swipl installed; the runnable datalog views run above")
    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info(
            "skipping runnable datalog views: swipl not found"
        )
    assert "swipl not found" in caplog.text


# --- The console's symbolic layer is the agora engine's (pinakes:50 US-4) ---


def test_datalog_console_projects_its_facts_through_the_agora_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The console's ``graph.pl`` takes its fact clauses from the embedded engine.

    The console projects a **rule-bearing** program (``include_rules=True``), which
    was for five iterations the stated reason it could not delegate — the exporter
    gated delegation on ``not attach_rules``. It now re-composes the engine's
    rendered document instead, contributing only what the engine cannot know: the
    directive preamble, the rule clauses and the P279 taxonomy overlay. That is
    pinakes:50 US-4 AC-4 ("the relocated explorer emits any Cypher/Datalog it needs
    via the agora lib"), so it is pinned here rather than inferred from
    ``datalog/export.py``.

    Both halves are asserted because either alone is weak: the spy proves the call
    happens but would pass if its result were discarded, and the byte check proves
    what landed in the file but would pass if the hand-written emitters were
    silently re-instated — they render identical bytes by construction
    (``tests/test_translation_lib.py``).
    """
    rendered: list[dict[str, object]] = []
    real = translation.dataset_datalog

    def spy(*args: object, **kwargs: object) -> dict[str, object]:
        result = real(*args, **kwargs)  # type: ignore[arg-type]
        rendered.append(result)
        return result

    monkeypatch.setattr(translation, "dataset_datalog", spy)

    console = Datalog(SAMPLE, swipl=None)
    # The projection step itself — independent of swipl, which only runs queries
    # against the program this produces.
    program = console._program_path()  # noqa: SLF001

    assert len(rendered) == 1, (
        "the explorer's Datalog console no longer renders through the agora "
        "translation engine (culturescrape.translation.dataset_datalog was not "
        "called) — pinakes:50 US-4 AC-4 requires that it does"
    )
    clauses = translation.program_fact_clauses(str(rendered[0]["prolog"]))
    # Guard against a vacuous comparison: the sample corpus projects a real graph.
    assert len(clauses) > 10, f"engine rendered only {len(clauses)} fact clauses"

    body = program.read_text(encoding="utf-8")
    # ``_clause_lines`` writes one clause per line with nothing interleaved, so the
    # engine's clauses appear as one verbatim, contiguous block — anything else
    # means the exporter reformatted them on the way through.
    assert "\n".join(clauses) in body
    # ...and the structure around them is still culture-scrape's.
    assert ":- discontiguous" in body
    assert "% Inference rules" in body


# --- One entity across TSV / Neo4j / Datalog (T7-US-009) --------------------


def test_resolve_links_maps_a_fixture_csid_to_each_store() -> None:
    from culturescrape.explorer.links import resolve_links

    links = resolve_links("cs:place:lima")

    # The TSV detail and graph view key off the raw csid (path-encoded).
    assert links.tsv == "/nodes/cs:place:lima"
    assert links.graph == "/graph?csid=cs%3Aplace%3Alima"
    assert links.neo4j == "/neo4j?csid=cs%3Aplace%3Alima"
    # The Neo4j locator matches the entity node by its shared csid key.
    assert links.neo4j_cypher == "MATCH (n:Entity {csid: 'cs:place:lima'}) RETURN n"
    # The Datalog locator is the node/3 atom; the deep-link pre-fills a goal.
    assert links.datalog_atom == "node('cs:place:lima', Type, Name)"
    assert links.datalog.startswith("/datalog?goal=")
    assert "cs:place:lima" in links.datalog_goal


def test_node_detail_deep_links_to_every_store() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/nodes/cs:place:lima").text

    # The detail page surfaces a deep-link into each of the three stores.
    assert 'href="/graph?csid=cs%3Aplace%3Alima"' in body
    assert 'href="/neo4j?csid=cs%3Aplace%3Alima"' in body
    assert 'href="/datalog?goal=' in body
    # ...and shows the by-csid locators for Neo4j and Datalog.
    assert "MATCH (n:Entity {csid: &#39;cs:place:lima&#39;}) RETURN n" in body
    assert "node(&#39;cs:place:lima&#39;, Type, Name)" in body


def test_graph_links_back_to_the_node_detail() -> None:
    # TSV detail -> graph -> back: the centered graph offers a return link.
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/graph", params={"csid": "cs:place:lima"}).text

    assert 'href="/nodes/cs:place:lima"' in body


def test_datalog_deep_link_prefills_a_goal_for_the_csid() -> None:
    # TSV -> Datalog console pre-filled with a goal for that csid.
    client = TestClient(create_app(FIXTURE_ROOT))
    from culturescrape.explorer.links import datalog_goal

    body = client.get("/datalog", params={"goal": datalog_goal("cs:place:lima")}).text

    # The goal lands in the ad-hoc textarea, naming the node by csid.
    assert "node(" in body
    assert "cs:place:lima" in body


def test_neo4j_focus_panel_shows_the_locator_and_back_link() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/neo4j", params={"csid": "cs:place:lima"}).text

    # The focused console shows the by-csid Cypher and a link back to the detail.
    assert "MATCH (n:Entity {csid: &#39;cs:place:lima&#39;}) RETURN n" in body
    assert 'href="/nodes/cs:place:lima"' in body


def test_neo4j_focus_ignores_an_unknown_csid() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/neo4j", params={"csid": "cs:does:not-exist"})

    # An unknown csid simply shows no focus panel; the console still renders.
    assert response.status_code == 200
    assert "cs:does:not-exist" not in response.text


# --- One global search box across every node file (T7-US-010) ---------------


def test_search_finds_a_fixture_entity_by_name_and_by_qid() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    by_name = client.get("/search", params={"q": "ceviche"})
    assert by_name.status_code == 200
    body = by_name.text
    # The name match surfaces the entity and deep-links to its detail.
    assert "Ceviche" in body
    assert '/nodes/cs:dish:ceviche"' in body
    # A name search is scoped: an unrelated place is not in the results.
    assert "cs:place:peru" not in body

    by_qid = client.get("/search", params={"q": "Q207681"}).text
    # The same entity is found by its Wikidata QID.
    assert "Ceviche" in by_qid
    assert '/nodes/cs:dish:ceviche"' in by_qid


def test_search_finds_an_entity_by_csid_fragment() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/search", params={"q": "place:lima"}).text

    assert "Lima" in body
    assert '/nodes/cs:place:lima"' in body
    # A csid-fragment search does not drag in unrelated dishes.
    assert "cs:dish:ceviche" not in body


def test_search_results_link_to_the_graph_neighborhood() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get("/search", params={"q": "Lima"}).text

    # Each hit offers a jump to its graph neighborhood, csid percent-encoded.
    assert 'href="/graph?csid=cs%3Aplace%3Alima"' in body


def test_search_ranks_exact_matches_ahead_of_substrings() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    # "ceviche" matches Ceviche exactly and Nikkei ceviche as a substring.
    body = client.get("/search", params={"q": "ceviche"}).text

    assert body.index("cs:dish:ceviche") < body.index("cs:dish:nikkei-ceviche")


def test_search_empty_query_renders_the_box_without_results() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/search")

    assert response.status_code == 200
    body = response.text
    # The form is always present; no result table until a query is entered.
    assert 'name="q"' in body
    assert "result" not in body.lower()


def test_search_is_advertised_in_the_nav() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    assert 'href="/search"' in client.get("/").text


# --- JSON content negotiation for the TS sidecar client (T15-US-003) ---------

#: The header the first-party TS client sends to ask for JSON over HTML.
JSON_ACCEPT = {"Accept": "application/json"}


def test_search_returns_json_matching_the_client_shape() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/search", params={"q": "ceviche"}, headers=JSON_ACCEPT)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["query"] == "ceviche"
    assert body["results"], "expected at least one hit"
    hit = body["results"][0]
    # Every field the SearchHitSchema models is present.
    assert set(hit) == {"csid", "name", "label", "qid", "field", "tsv", "graph"}
    assert hit["csid"].startswith("cs:")
    assert hit["tsv"] == f"/nodes/{hit['csid']}"
    # Parity: the JSON hit is the same node the HTML view links to.
    html = client.get("/search", params={"q": "ceviche"}).text
    assert hit["csid"] in html


def test_metrics_returns_json_matching_the_client_shape() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/metrics", headers=JSON_ACCEPT)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {
        "node_count",
        "edge_count",
        "edges_per_node",
        "component_count",
        "largest_component_size",
        "largest_component_fraction",
        "edges_by_dimension",
        "edges_by_type",
    }
    # Parity with the fixture metrics the HTML view renders.
    assert body["node_count"] > 0
    assert "geographic" in body["edges_by_dimension"]
    assert "LOCATED_IN" in body["edges_by_type"]


def test_metrics_json_is_zeroed_when_unavailable(tmp_path: Path) -> None:
    # A corpus whose metrics.json is unreadable still answers a valid JSON shape.
    corpus = tmp_path / "broken"
    (corpus / "nodes").mkdir(parents=True)
    (corpus / "edges").mkdir()
    _write(corpus / "metrics.json", "{ not valid json")
    client = TestClient(create_app(corpus))

    body = client.get("/metrics", headers=JSON_ACCEPT).json()

    assert body["node_count"] == 0
    assert body["edges_per_node"] == 0.0
    assert body["edges_by_dimension"] == {}
    assert body["edges_by_type"] == {}


def test_completeness_returns_json_matching_the_client_shape() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    response = client.get("/completeness", headers=JSON_ACCEPT)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {"qa", "rows"}
    assert body["qa"] is None or set(body["qa"]) == {
        "ok",
        "node_count",
        "edge_count",
        "violations",
        "failed_keys",
    }
    assert body["rows"], "expected at least one category row"
    row = body["rows"][0]
    assert set(row) == {
        "category_id",
        "label",
        "status",
        "node_count",
        "edge_count",
        "violations",
        "last_run",
        "errors",
        "provenance_complete",
        "reasons",
    }
    # Parity: the categories the HTML dashboard lists are in the JSON.
    ids = {r["category_id"] for r in body["rows"]}
    assert {"peruvian-dishes", "andean-context"} <= ids


def test_completeness_json_honours_the_status_filter() -> None:
    client = TestClient(create_app(FIXTURE_ROOT))

    body = client.get(
        "/completeness", params={"status": "incomplete"}, headers=JSON_ACCEPT
    ).json()

    assert body["rows"], "the fixture has an incomplete category"
    assert all(r["status"] == "incomplete" for r in body["rows"])


def test_views_still_render_html_without_the_json_accept_header() -> None:
    # Content negotiation must not regress the HTML explorer (default Accept).
    client = TestClient(create_app(FIXTURE_ROOT))

    for path in ("/search", "/metrics", "/completeness"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
