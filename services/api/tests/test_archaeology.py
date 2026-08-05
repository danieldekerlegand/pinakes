"""`pinakes.ingest.archaeology`, graded against the TypeScript's own fixtures.

The Python half of `server/services/archaeological-site-scraper.test.ts`, case
for case, reading the **same** recorded payloads
(`server/services/fixtures/archaeological/*.json`) out of the repo rather than a
copy. That is what makes this a port and not a rewrite that happens to agree:
the two suites can only both pass if the two mappers answer identically about the
same four Open Context features and the same four tDAR resources.

Nothing here reaches the network — every test passes a fixture-backed
:class:`ArchaeologyDeps` — and `conftest.py`'s autouse `isolated_data_trees`
points the contribution queue at a temp directory.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from pinakes_contracts import contracts_dir
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.contributions import store
from pinakes.ingest import archaeology, http

FIXTURES = (
    contracts_dir().parent / "server" / "services" / "fixtures" / "archaeological"
)


def recorded(name: str) -> Any:
    return json.loads(FIXTURES.joinpath(f"{name}.json").read_text(encoding="utf-8"))


OPEN_CONTEXT = recorded("open-context-search")
TDAR = recorded("tdar-search")


class FixtureDeps:
    """Both authorities, answered from the recordings. Counts what it was asked."""

    def __init__(self, *, open_context: Any = None, tdar: Any = None) -> None:
        self.open_context = OPEN_CONTEXT if open_context is None else open_context
        self.tdar = TDAR if tdar is None else tdar
        self.calls: list[tuple[str, str | None, int | None]] = []

    def fetch_open_context(self, *, query: str | None, limit: int | None) -> Any:
        self.calls.append(("open-context", query, limit))
        return self.open_context

    def fetch_tdar(self, *, query: str | None, limit: int | None) -> Any:
        self.calls.append(("tdar", query, limit))
        return self.tdar


class UnreachableDeps:
    def fetch_open_context(self, *, query: str | None, limit: int | None) -> Any:
        raise archaeology.ArchaeologyAcquisitionError("network down")

    def fetch_tdar(self, *, query: str | None, limit: int | None) -> Any:
        raise archaeology.ArchaeologyAcquisitionError("network down")


@pytest.fixture
def queue(isolated_data_trees: dict[str, Path]) -> store.ContributionStore:
    return store.queue()


# ── The catalog ──────────────────────────────────────────────────────────────


def test_the_two_authorities_are_exposed() -> None:
    ids = sorted(s["id"] for s in archaeology.list_archaeology_sources())
    assert ids == ["open-context", "tdar"]


@pytest.mark.parametrize("named", ["nope", "", None, 42])
def test_an_unknown_or_absent_source_resolves_to_nothing(named: Any) -> None:
    assert archaeology.resolve_archaeology_source(named) is None


def test_a_known_source_resolves_to_its_catalog_entry() -> None:
    assert (
        archaeology.resolve_archaeology_source("tdar")
        is archaeology.ARCHAEOLOGY_SOURCES["tdar"]
    )


# ── Open Context ─────────────────────────────────────────────────────────────


def test_a_feature_becomes_a_site_with_coordinates_dates_culture_and_provenance() -> (
    None
):
    site = archaeology.open_context_to_scraped_site(OPEN_CONTEXT["features"][0])

    assert site is not None
    assert site.name == "Çatalhöyük East Mound"
    # GeoJSON records [lng, lat]; the corpus records {lat, lng}.
    assert site.coordinates == {"lat": 37.6669, "lng": 32.8281}
    assert site.time_period_start == -7100
    assert site.time_period_end == -5700
    assert site.time_period_label == "7100 BCE - 5700 BCE"
    # The culture came from the leaf of "Asia/Turkey/Çatalhöyük", accents folded.
    assert "catalhoyuk" in site.associated_culture_ids
    assert site.provenance == archaeology.SiteProvenance(
        source="open-context",
        source_id="https://opencontext.org/subjects/catalhoyuk-east",
        source_url="https://opencontext.org/subjects/catalhoyuk-east",
    )


def test_an_explicit_cultures_list_beats_the_context_leaf() -> None:
    site = archaeology.open_context_to_scraped_site(OPEN_CONTEXT["features"][1])
    assert site is not None
    assert site.associated_culture_ids == ["natufian", "pre-pottery-neolithic"]


def test_null_island_and_a_nameless_record_are_dropped() -> None:
    assert archaeology.open_context_to_scraped_site(OPEN_CONTEXT["features"][2]) is None
    assert archaeology.open_context_to_scraped_site(OPEN_CONTEXT["features"][3]) is None


# ── tDAR ─────────────────────────────────────────────────────────────────────


def test_a_resource_with_an_explicit_point_becomes_a_site() -> None:
    site = archaeology.tdar_to_scraped_site(TDAR["resources"][0])

    assert site is not None
    assert site.name == "Snaketown Excavation Records"
    assert site.coordinates == {"lat": 33.1836, "lng": -111.9075}
    assert site.time_period_start == 300
    assert site.time_period_end == 1100
    assert site.time_period_label == "300 CE - 1100 CE"
    assert site.associated_culture_ids == ["hohokam"]
    assert site.provenance == archaeology.SiteProvenance(
        source="tdar",
        source_id="391847",
        source_url="https://core.tdar.org/document/391847",
    )
    # The id is minted from the accession number, not the title.
    assert site.id == "tdar-391847"


def test_a_bounding_box_yields_its_centroid() -> None:
    site = archaeology.tdar_to_scraped_site(TDAR["resources"][1])
    assert site is not None
    assert site.coordinates["lat"] == pytest.approx(36.06)
    assert site.coordinates["lng"] == pytest.approx(-107.96)
    assert site.associated_culture_ids == ["ancestral-puebloan", "chacoan"]


def test_a_resource_with_no_place_and_one_with_no_title_are_dropped() -> None:
    assert archaeology.tdar_to_scraped_site(TDAR["resources"][2]) is None
    assert archaeology.tdar_to_scraped_site(TDAR["resources"][3]) is None


# ── Free text → the site-type vocabulary ─────────────────────────────────────


@pytest.mark.parametrize(
    ("keywords", "expected"),
    [
        (["necropolis"], "burial"),  # the exact Pleiades entry
        (["Habitation Site"], "settlement"),  # a synonym pattern
        (["Great House"], "unknown"),  # no signal at all
        (["Great House", "Ballcourt", "citadel"], "fortress"),  # first hit wins
        (["cave"], "cave_art"),  # the map answers before the patterns
        (["burial cave"], "burial"),  # …but a phrase reaches the patterns
    ],
)
def test_a_keyword_resolves_to_the_first_site_type_it_matches(
    keywords: list[str], expected: str
) -> None:
    assert archaeology.map_keyword_site_type(keywords) == expected


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        (-7100, -5700, "7100 BCE - 5700 BCE"),
        (850, None, "From 850 CE"),
        (None, 1250, "Until 1250 CE"),
        (None, None, "Unknown period"),
    ],
)
def test_a_date_range_reads_as_a_label(
    start: int | None, end: int | None, expected: str
) -> None:
    assert archaeology.format_time_period_label(start, end) == expected


# ── Fetch + normalize ────────────────────────────────────────────────────────


def test_open_context_features_normalize_and_drop_the_unusable() -> None:
    sites = archaeology.scrape_archaeology_source(
        "open-context", FixtureDeps(), query=None, limit=None
    )
    assert [site.name for site in sites] == [
        "Çatalhöyük East Mound",
        "Jericho Tell es-Sultan",
    ]


def test_tdar_resources_normalize_and_drop_the_unusable() -> None:
    sites = archaeology.scrape_archaeology_source(
        "tdar", FixtureDeps(), query=None, limit=None
    )
    assert [site.name for site in sites] == [
        "Snaketown Excavation Records",
        "Chaco Canyon Great House Survey",
    ]


@pytest.mark.parametrize("source", ["open-context", "tdar"])
def test_a_payload_missing_its_collection_is_no_sites_rather_than_a_crash(
    source: str,
) -> None:
    deps = FixtureDeps(open_context={}, tdar={"resources": "nonsense"})
    sites = archaeology.scrape_archaeology_source(
        source, deps, query=None, limit=None
    )
    assert sites == []


# ── The queue record ─────────────────────────────────────────────────────────


def test_a_site_becomes_an_auto_derived_add_with_its_authority_cited() -> None:
    site = archaeology.open_context_to_scraped_site(OPEN_CONTEXT["features"][0])
    assert site is not None
    draft = archaeology.site_to_contribution(site)

    assert draft is not None
    assert draft["entityType"] == "archaeological-site"
    assert draft["action"] == "add"
    data = draft["entityData"]
    assert data["name"] == "Çatalhöyük East Mound"
    assert data["coordinates"] == {"lat": 37.6669, "lng": 32.8281}
    assert data["source"] == "open-context"
    assert data["autoDerived"] is True
    # An authority is not a model: the AI-review queue must not claim this row.
    assert data["aiGenerated"] is False
    assert draft["sources"][0]["url"] == (
        "https://opencontext.org/subjects/catalhoyuk-east"
    )
    assert draft["sources"][0]["title"] == "Çatalhöyük East Mound — Open Context"
    # Below 100, so it always reads as needing review.
    assert 0 < draft["confidence"] < 100


def test_an_unciteable_source_leaves_the_url_key_absent() -> None:
    """`JSON.stringify` emits no key for `undefined`, and the TS reader agrees."""
    site = archaeology.tdar_to_scraped_site(
        {"id": 1, "title": "No link", "latitude": 1.0, "longitude": 2.0}
    )
    assert site is not None
    draft = archaeology.site_to_contribution(site)
    assert draft is not None
    assert "url" not in draft["sources"][0]


@pytest.mark.parametrize(
    ("confidence", "expected"), [(0, 1), (65, 65), (100, 99), (64.5, 65)]
)
def test_confidence_is_clamped_below_certainty(
    confidence: float, expected: int
) -> None:
    assert archaeology.to_contribution_confidence(confidence) == expected


# ── The run ──────────────────────────────────────────────────────────────────


def test_an_acquisition_queues_its_sites_and_streams_progress(
    queue: store.ContributionStore,
) -> None:
    phases: list[str] = []
    result = archaeology.run_archaeological_acquisition(
        "open-context",
        contributions=queue,
        deps=FixtureDeps(),
        on_progress=lambda progress: phases.append(progress.phase),
    )

    assert result.acquired == 2
    assert result.queued == 2
    assert result.skipped == 0
    assert len(result.contribution_ids) == 2
    assert phases[0] == "starting"
    assert phases[-1] == "done"

    queued = queue.list(entity_type="archaeological-site")["contributions"]
    assert len(queued) == 2
    assert all(row["status"] == "pending" for row in queued)
    assert all(row["entityData"]["source"] == "open-context" for row in queued)


def test_the_query_and_limit_reach_the_authority(
    queue: store.ContributionStore,
) -> None:
    deps = FixtureDeps()
    archaeology.run_archaeological_acquisition(
        "tdar", contributions=queue, deps=deps, query="hohokam", limit=10
    )
    assert deps.calls == [("tdar", "hohokam", 10)]


def test_a_row_the_queue_rejects_is_skipped_not_fatal(
    queue: store.ContributionStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One unqueueable site must not cost the run the others."""
    original = archaeology.site_to_contribution

    def strip_the_sources(site: archaeology.ScrapedSite) -> Any:
        draft = original(site)
        if draft is not None and site.name.startswith("Jericho"):
            draft["sources"] = []
        return draft

    monkeypatch.setattr(archaeology, "site_to_contribution", strip_the_sources)

    result = archaeology.run_archaeological_acquisition(
        "open-context", contributions=queue, deps=FixtureDeps()
    )
    assert (result.acquired, result.queued, result.skipped) == (2, 1, 1)


def test_a_fetch_failure_propagates(queue: store.ContributionStore) -> None:
    with pytest.raises(archaeology.ArchaeologyAcquisitionError, match="network down"):
        archaeology.run_archaeological_acquisition(
            "tdar", contributions=queue, deps=UnreachableDeps()
        )


# ── The live boundary ────────────────────────────────────────────────────────


class FakeTransport:
    """A transport scripted with one response per request, in order."""

    def __init__(self, responses: list[HttpResponse]) -> None:
        self.responses = responses
        self.requests: list[tuple[str, str, dict[str, str] | None]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
        body: str | None = None,
    ) -> HttpResponse:
        assert body is None, "an acquisition reads; it never posts"
        self.requests.append((method, url, dict(params) if params else None))
        return self.responses.pop(0)


def _answer(body: str, status: int = 200) -> HttpResponse:
    return HttpResponse(
        url="https://example.test", status_code=status, text=body, headers={}
    )


def _install(source: http.Source, transport: FakeTransport, tmp_path: Path) -> None:
    http.configure(
        source,
        HttpClient(
            cache_dir=tmp_path / source.name,
            transport=transport,
            min_interval=0.0,
            sleep=lambda _seconds: None,
        ),
    )


def test_the_live_boundary_goes_through_the_engines_client(tmp_path: Path) -> None:
    """Not a bare fetch: the rate limit, the retries and the cache are the point."""
    transport = FakeTransport([_answer(json.dumps(OPEN_CONTEXT))])
    _install(http.OPEN_CONTEXT, transport, tmp_path)

    payload = archaeology.live_deps().fetch_open_context(query="tell", limit=250)

    assert len(payload["features"]) == 4
    method, url, params = transport.requests[0]
    assert method == "GET"
    assert url == "https://opencontext.org/query/.json"
    # The caller's 250 is clamped to the authority's page ceiling.
    assert params == {"rows": "100", "type": "subjects", "q": "tell"}


def test_an_unlimited_run_asks_for_the_default_page(tmp_path: Path) -> None:
    transport = FakeTransport([_answer(json.dumps(TDAR))])
    _install(http.TDAR, transport, tmp_path)

    archaeology.live_deps().fetch_tdar(query=None, limit=None)

    _method, url, params = transport.requests[0]
    assert url == "https://core.tdar.org/api/lookup/resource"
    assert params == {"recordsPerPage": "25"}


def test_an_error_status_is_an_acquisition_error(tmp_path: Path) -> None:
    # 403, not 429: a retryable status would exhaust the scripted transport.
    transport = FakeTransport([_answer("nope", status=403)])
    _install(http.TDAR, transport, tmp_path)

    with pytest.raises(archaeology.ArchaeologyAcquisitionError, match="403"):
        archaeology.live_deps().fetch_tdar(query=None, limit=None)


def test_an_unreadable_body_is_an_acquisition_error(tmp_path: Path) -> None:
    transport = FakeTransport([_answer("<html>maintenance</html>")])
    _install(http.OPEN_CONTEXT, transport, tmp_path)

    with pytest.raises(archaeology.ArchaeologyAcquisitionError, match="not JSON"):
        archaeology.live_deps().fetch_open_context(query=None, limit=None)
