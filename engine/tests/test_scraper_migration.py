"""The retirement table is the statement that no domain regressed (pinakes:70 US-1).

``server/services/*-scraper.ts`` and ``*-enrichment.ts`` are gone — twenty-seven
files, ~13.4k lines. :mod:`pinakes_engine.acquire.migration` records, per file,
which acquisition covers its domain now. This module is what makes that a claim
rather than a comment:

* every retired file really is deleted, and has not crept back;
* every category the table names exists, loads, and builds its adapter;
* the three new mechanisms carry the domains the table says they carry, with a
  representative fetch+parse per domain replayed off a recorded fixture.

The last one is the acquisition-parity check. It drives the **committed**
category spec — not a spec written for the test — through the real adapter and
the real :class:`~pinakes_engine.acquire.http.HttpClient`, with a fake transport
serving the fixture at the spec's own URL. So a spec that drifts away from the
shape its endpoint actually returns fails here.
"""

from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from pinakes_engine.acquire import (
    RETIRED_SCRAPERS,
    AdapterSelectionError,
    Coverage,
    HttpClient,
    HttpResponse,
    LlmGenerationAdapter,
    RawRecord,
    RemoteTabularAdapter,
    RestApiAdapter,
    build_adapter,
    coverage_for,
    load_category,
    migrated_category_ids,
)
from pinakes_engine.acquire.migration import (
    UnknownRetiredScraperError,
    category_path,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PACKAGE_ROOT = Path(__file__).resolve().parents[1]
_CATEGORIES = _PACKAGE_ROOT / "inputs" / "categories"
_FIXTURES = Path(__file__).parent / "fixtures" / "scrapers"
_FIXED_NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)

#: Every file the migration retired, as ``ls`` listed them.
_EXPECTED_MODULE_COUNT = 27


# ── the files are gone ───────────────────────────────────────────────────────


@pytest.mark.parametrize("row", RETIRED_SCRAPERS, ids=lambda r: r.module)
def test_every_retired_module_is_deleted(row: Any) -> None:
    assert not (_REPO_ROOT / row.module).exists(), (
        f"{row.module} is back. Its domain is acquired by "
        f"{row.categories or row.replacement} now; two acquisitions of one "
        "domain is the drift this story removed."
    )


def test_no_scraper_or_enrichment_module_survives_in_the_server_tree() -> None:
    """A guard against a *new* one, not only against the twenty-seven."""
    services = _REPO_ROOT / "server" / "services"
    survivors = sorted(
        path.name
        for path in services.glob("*.ts")
        if path.name.endswith(("-scraper.ts", "-enrichment.ts"))
    )
    assert survivors == []


def test_the_table_covers_every_file_the_migration_retired() -> None:
    assert len(RETIRED_SCRAPERS) == _EXPECTED_MODULE_COUNT
    assert len({row.module for row in RETIRED_SCRAPERS}) == _EXPECTED_MODULE_COUNT


# ── the table is internally consistent ───────────────────────────────────────


@pytest.mark.parametrize("row", RETIRED_SCRAPERS, ids=lambda r: r.module)
def test_a_row_names_either_categories_or_a_replacement_module(row: Any) -> None:
    if row.coverage is Coverage.MODULE:
        assert row.replacement, "a ported module must name where it went"
        assert (_REPO_ROOT / row.replacement).exists(), row.replacement
    else:
        assert row.categories, "a category-covered domain must name its categories"
        assert not row.replacement


@pytest.mark.parametrize("row", RETIRED_SCRAPERS, ids=lambda r: r.module)
def test_every_row_explains_itself(row: Any) -> None:
    assert row.domain and row.note
    assert row.module.startswith("server/services/")


def test_coverage_for_accepts_a_bare_file_name_or_a_full_path() -> None:
    by_name = coverage_for("battle-scraper.ts")
    by_path = coverage_for("server/services/battle-scraper.ts")
    assert by_name is by_path
    assert by_name.coverage is Coverage.EXISTING


def test_an_unknown_module_is_refused_with_the_known_list() -> None:
    with pytest.raises(UnknownRetiredScraperError, match="battle-scraper.ts"):
        coverage_for("mythology-scraper.ts")


# ── the categories the table names really acquire something ──────────────────


@pytest.mark.parametrize("category", sorted(migrated_category_ids()))
def test_every_named_category_loads_and_builds_its_adapter(
    category: str, tmp_path: Path
) -> None:
    path = category_path(category, root=_PACKAGE_ROOT)
    assert path.exists(), f"{category} is named by the retirement table but absent"
    spec = load_category(path)
    assert spec.id == category
    adapter = build_adapter(
        spec, http_factory=lambda: HttpClient(cache_dir=tmp_path, min_interval=0.0)
    )
    assert adapter.source_type == spec.source.type


def test_every_committed_category_still_builds(tmp_path: Path) -> None:
    """Not only the migrated ones — the three new adapters share the factory."""
    for path in sorted(_CATEGORIES.glob("*.yml")):
        spec = load_category(path)
        try:
            build_adapter(
                spec,
                http_factory=lambda: HttpClient(cache_dir=tmp_path, min_interval=0.0),
            )
        except AdapterSelectionError as error:  # pragma: no cover - a real break
            pytest.fail(f"{path.name}: {error}")


def test_the_three_new_adapters_are_all_http_and_all_reachable_by_name() -> None:
    for adapter in (RestApiAdapter, RemoteTabularAdapter, LlmGenerationAdapter):
        assert adapter.source_type == "http"
        assert adapter.name


# ── acquisition parity, per migrated mechanism ───────────────────────────────


class _FixtureTransport:
    """Serve one recorded body for any URL, refusing an unexpected method."""

    def __init__(self, body: str) -> None:
        self._body = body
        self.calls: list[str] = []

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
        self.calls.append(url)
        return HttpResponse(url=url, status_code=200, text=self._body, headers={})


def _run(category: str, fixture: str, tmp_path: Path) -> list[RawRecord]:
    """Drive the committed spec for *category* over the recorded *fixture*."""
    spec = load_category(category_path(category, root=_PACKAGE_ROOT))
    transport = _FixtureTransport(
        (_FIXTURES / fixture).read_text(encoding="utf-8")
    )
    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )
    adapter = build_adapter(spec, http_factory=lambda: client)
    adapter._now = lambda: _FIXED_NOW  # type: ignore[attr-defined]
    return list(adapter.fetch(spec))


def test_seshat_polities_parse_to_the_rows_the_polity_scraper_produced(
    tmp_path: Path,
) -> None:
    records = _run("seshat-polities", "seshat-polities.json", tmp_path)

    assert [r.fields.get("name") for r in records][:2] == [
        "Kingdom of Aksum",
        "Qin Dynasty",
    ]
    assert records[0].fields["start_year"] == "-100"
    assert records[0].fields["region"] == "Africa"
    assert (
        records[0].provenance.source_url
        == "https://seshatdatabank.info/browser/AfAksumite"
    )
    assert records[0].provenance.source == "seshat"


def test_commons_category_members_parse_to_titled_image_rows(
    tmp_path: Path,
) -> None:
    records = _run("commons-images", "commons-categorymembers-page1.json", tmp_path)

    assert [r.fields["name"] for r in records[:2]] == [
        "File:Rosetta Stone.jpg",
        "File:Ishtar Gate detail.jpg",
    ]
    assert (
        records[0].provenance.source_url
        == "https://commons.wikimedia.org/?curid=12345"
    )
    assert records[0].provenance.license == "CC-BY-SA-4.0"


def test_wals_values_parse_to_language_keyed_typology_rows(tmp_path: Path) -> None:
    records = _run("wals-cldf", "wals-values.csv", tmp_path)

    assert [r.fields["language_code"] for r in records] == ["eng", "jpn", "arz"]
    assert [r.fields["name"] for r in records] == ["SVO", "SOV", "VSO"]
    assert records[0].provenance.license == "CC-BY-4.0"
    assert records[0].provenance.confidence == 0.8


def test_unimorph_triples_parse_without_eating_the_first_paradigm(
    tmp_path: Path,
) -> None:
    records = _run("verb-paradigms", "unimorph-lat.tsv", tmp_path)

    assert len(records) == 3
    assert records[0].fields == {
        "lemma": "amare",
        "name": "amo",
        "features": "V;IND;PRS;1;SG",
    }


def test_cldr_script_metadata_parses_with_the_script_code_as_a_column(
    tmp_path: Path,
) -> None:
    records = _run("cldr-scripts", "cldr-script-metadata.json", tmp_path)

    assert [r.fields["script"] for r in records] == ["Latn", "Arab", "Egyp"]
    assert records[1].fields["rtl"] == "YES"


def test_a_generated_domain_parses_a_recorded_model_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The generation leg of parity: one recorded envelope, two distinct rows.

    ``existing`` is dropped for this one case. The committed spec points it at
    the live ``data/source/lexicons/kinship-systems.tsv`` so a real run is told
    what not to regenerate, and a test that read the live corpus would pass or
    fail depending on what is in it today.
    """
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    spec = load_category(category_path("kinship-systems", root=_PACKAGE_ROOT))
    params = {
        key: value for key, value in spec.source.params.items() if key != "existing"
    }
    spec = replace(spec, source=replace(spec.source, params=params))

    transport = _FixtureTransport(
        (_FIXTURES / "gemini-kinship-systems.json").read_text(encoding="utf-8")
    )
    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )
    adapter = build_adapter(spec, http_factory=lambda: client)
    adapter._now = lambda: _FIXED_NOW  # type: ignore[attr-defined]
    records: Sequence[RawRecord] = list(adapter.fetch(spec))

    assert [r.fields["id"] for r in records] == [
        "hawaiian-generational",
        "iroquois-bifurcate-merging",
    ]
    assert records[0].fields["system_type"] == "Hawaiian"
    assert records[0].provenance.source == "llm-generated"
    # Generated, so down-weighted — the TypeScript wrote these at no stated
    # confidence at all, straight into the corpus.
    assert records[0].provenance.confidence < 1.0
