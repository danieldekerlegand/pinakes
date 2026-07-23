"""Tests for the category generator (``culturescrape generate``).

The generator is the lever for scaling the corpus from a handful of hand-written
categories to thousands: a compact blueprint expands into many validated
``categories/<id>.yml`` files. These tests pin the expansion of each source
selector, the defaults/override merge, the round-trip validity of every written
file, the optional runnable job, and that a malformed blueprint fails loudly.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from functools import partial
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.acquire import HttpClient, HttpResponse, fetch_count
from culturescrape.acquire.categories import CategorySpec, load_category
from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.wikidata_dump_adapter import WikidataDumpAdapter
from culturescrape.orchestrate.generate import (
    BlueprintError,
    CountFn,
    DumpSource,
    build_specs,
    generate,
    verify_counts,
)
from culturescrape.orchestrate.jobs import load_job

_DEFAULTS = {
    "label": "Dish;CulturalArtifact",
    "dimensions": ["temporal", "geographic"],
    "links": [{"type": "ORIGINATES_FROM", "to": "place"}],
}


def _blueprint(**categories_override: object) -> dict[str, object]:
    return {
        "defaults": dict(_DEFAULTS),
        "categories": [dict(categories_override)],
    }


def _only(raw: dict[str, object]) -> CategorySpec:
    (spec,) = build_specs(raw)
    return spec


def test_wikidata_class_becomes_instance_of_query() -> None:
    spec = _only(_blueprint(id="peruvian-dishes", name="Peruvian dish",
                            wikidata_class="Q746549"))
    assert spec.id == "peruvian-dishes"
    assert spec.description == "Every Peruvian dish"  # name -> "Every <name>"
    assert spec.label == "Dish;CulturalArtifact"  # inherited from defaults
    assert spec.source.type == "wikidata-sparql"
    assert "wdt:P31 wd:Q746549" in (spec.source.query or "")
    assert spec.dimensions == ("temporal", "geographic")


def test_subclass_of_becomes_transitive_taxonomy_query() -> None:
    spec = _only(_blueprint(id="ie-languages", description="IE languages",
                            subclass_of="Q19860"))
    assert "wdt:P279+ wd:Q19860" in (spec.source.query or "")


def test_petscan_selector_builds_params_with_defaults() -> None:
    spec = _only(_blueprint(id="acw-battles", name="battle",
                            petscan={"categories": "Battles", "depth": 3}))
    assert spec.source.type == "petscan"
    assert spec.source.params["categories"] == "Battles"
    assert spec.source.params["depth"] == "3"
    assert spec.source.params["language"] == "en"  # default applied


def test_per_stub_overrides_win_over_defaults() -> None:
    spec = _only(_blueprint(
        id="ie-languages", description="IE languages", subclass_of="Q19860",
        label="Language", dimensions=["linguistic"],
        links=[{"type": "DESCENDS_FROM", "to": "language"}],
    ))
    assert spec.label == "Language"
    assert spec.dimensions == ("linguistic",)
    assert spec.links[0].type == "DESCENDS_FROM"


def test_raw_query_selector_is_passed_through() -> None:
    query = "SELECT ?item WHERE { ?item wdt:P31 wd:Q5 }"
    spec = _only(_blueprint(id="people", name="person", query=query))
    assert (spec.source.query or "").startswith("SELECT ?item")


@pytest.mark.parametrize(
    "stub, needle",
    [
        ({"name": "x", "wikidata_class": "Q1"}, "'id'"),  # missing id
        ({"id": "Bad_Id", "name": "x", "wikidata_class": "Q1"}, "'id'"),
        ({"id": "x", "wikidata_class": "Q1"}, "'description' or a 'name'"),
        ({"id": "x", "name": "y"}, "exactly one source selector"),
        ({"id": "x", "name": "y", "wikidata_class": "Q1",
          "query": "SELECT"}, "exactly one source selector"),
        ({"id": "x", "name": "y", "wikidata_class": "42"}, "Wikidata id"),
    ],
)
def test_invalid_stub_is_rejected(stub: dict[str, object], needle: str) -> None:
    with pytest.raises(BlueprintError) as excinfo:
        build_specs(_blueprint(**stub))
    assert needle in str(excinfo.value)


def test_missing_label_anywhere_is_rejected() -> None:
    raw = {"categories": [{"id": "x", "name": "y", "wikidata_class": "Q1"}]}
    with pytest.raises(BlueprintError, match="label"):
        build_specs(raw)


def test_duplicate_ids_are_rejected() -> None:
    raw = {
        "defaults": dict(_DEFAULTS),
        "categories": [
            {"id": "dup", "name": "a", "wikidata_class": "Q1"},
            {"id": "dup", "name": "b", "wikidata_class": "Q2"},
        ],
    }
    with pytest.raises(BlueprintError, match="duplicate id"):
        build_specs(raw)


def test_empty_categories_is_rejected() -> None:
    with pytest.raises(BlueprintError, match="non-empty list"):
        build_specs({"defaults": dict(_DEFAULTS), "categories": []})


def _write_blueprint(tmp_path: Path) -> Path:
    blueprint = tmp_path / "cuisines.yml"
    blueprint.write_text(
        "defaults:\n"
        "  label: Dish;CulturalArtifact\n"
        "  dimensions: [temporal, geographic]\n"
        "  links:\n"
        "    - {type: ORIGINATES_FROM, to: place}\n"
        "categories:\n"
        "  - {id: peruvian-dishes, name: Peruvian dish, wikidata_class: Q746549}\n"
        "  - {id: japanese-dishes, name: Japanese dish, wikidata_class: Q1062834}\n",
        encoding="utf-8",
    )
    return blueprint


def test_generate_writes_validated_category_files(tmp_path: Path) -> None:
    blueprint = _write_blueprint(tmp_path)
    out = tmp_path / "categories"

    result = generate(blueprint, out)

    assert {p.name for p in result.categories} == {
        "peruvian-dishes.yml",
        "japanese-dishes.yml",
    }
    # Every written file round-trips through the real category loader.
    for path in result.categories:
        spec = load_category(path)
        assert spec.source.type == "wikidata-sparql"
    assert result.job is None


def test_generate_emits_runnable_job(tmp_path: Path) -> None:
    blueprint = _write_blueprint(tmp_path)
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "cuisines.yml"

    result = generate(blueprint, out, job=job_path)

    assert result.job == job_path
    job = load_job(job_path)  # parses + validates every referenced category
    assert job.name == "cuisines"
    assert {spec.id for spec in job.categories} == {
        "peruvian-dishes",
        "japanese-dishes",
    }


def test_generate_refuses_to_overwrite_without_force(tmp_path: Path) -> None:
    blueprint = _write_blueprint(tmp_path)
    out = tmp_path / "categories"
    generate(blueprint, out)

    with pytest.raises(BlueprintError, match="already exists"):
        generate(blueprint, out)
    # ...but --force regenerates cleanly.
    assert generate(blueprint, out, force=True).categories


def test_cli_generate_end_to_end(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    blueprint = _write_blueprint(tmp_path)
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "cuisines.yml"

    exit_code = cli.main(
        ["generate", str(blueprint), "--out", str(out), "--job", str(job_path)]
    )

    assert exit_code == 0
    assert (out / "peruvian-dishes.yml").is_file()
    assert job_path.is_file()
    assert "generated 2 category spec(s)" in capsys.readouterr().out


def test_cli_generate_reports_blueprint_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = tmp_path / "bad.yml"
    bad.write_text("categories:\n  - {id: x}\n", encoding="utf-8")

    exit_code = cli.main(["generate", str(bad), "--out", str(tmp_path / "c")])

    assert exit_code == 2
    assert "error:" in capsys.readouterr().err


# --- Dump mode (offline acquisition from a local slice, US-003) --------------


def _dump() -> DumpSource:
    return DumpSource(
        path=Path("out/wikidata/slice.json.gz"),
        index=Path("out/wikidata/slice.json.gz.index.sqlite3"),
        hydrate="default",
    )


def test_dump_mode_expands_class_to_wikidata_dump_source() -> None:
    spec = _only_dump(_blueprint(id="dishes", name="dish", wikidata_class="Q746549"))
    assert spec.source.type == "wikidata-dump"
    assert spec.source.query is None
    params = dict(spec.source.params)
    assert params["path"] == "out/wikidata/slice.json.gz"
    assert params["class"] == "Q746549"
    assert params["transitive"] == "true"  # mirrors build-slice's P31/P279*
    assert params["index"] == "out/wikidata/slice.json.gz.index.sqlite3"
    assert params["hydrate"] == "default"


def test_dump_mode_no_transitive_and_no_index_omits_them() -> None:
    dump = DumpSource(path=Path("slice.json"), transitive=False)
    (spec,) = build_specs(
        _blueprint(id="dishes", name="dish", wikidata_class="Q746549"), dump=dump
    )
    params = dict(spec.source.params)
    assert "transitive" not in params
    assert "index" not in params
    assert "hydrate" not in params
    assert params == {"path": "slice.json", "class": "Q746549"}


@pytest.mark.parametrize(
    "stub, needle",
    [
        ({"id": "x", "description": "d", "subclass_of": "Q1"}, "only 'wikidata_class'"),
        ({"id": "x", "name": "y", "query": "SELECT"}, "only 'wikidata_class'"),
        (
            {"id": "x", "name": "y", "petscan": {"categories": "C"}},
            "only 'wikidata_class'",
        ),
    ],
)
def test_dump_mode_rejects_non_class_selectors(
    stub: dict[str, object], needle: str
) -> None:
    with pytest.raises(BlueprintError, match=needle):
        build_specs(_blueprint(**stub), dump=_dump())


def test_dump_mode_category_round_trips_and_needs_no_network(tmp_path: Path) -> None:
    """A generated dump category loads and builds a dump adapter — no HTTP."""
    blueprint = tmp_path / "food.yml"
    blueprint.write_text(
        "defaults: {label: Dish, dimensions: [temporal]}\n"
        "categories:\n"
        "  - {id: dishes, name: dish, wikidata_class: Q746549}\n",
        encoding="utf-8",
    )
    result = generate(
        blueprint,
        tmp_path / "categories",
        job=tmp_path / "food.job.yml",
        dump=_dump(),
        min_component_fraction=0.1,
    )
    (category,) = result.categories
    spec = load_category(category)
    assert spec.source.type == "wikidata-dump"

    def no_network() -> HttpClient:
        raise AssertionError("dump generation must not build a network client")

    adapter = build_adapter(spec, http_factory=no_network)
    assert isinstance(adapter, WikidataDumpAdapter)

    assert result.job is not None
    job = load_job(result.job)
    assert job.min_component_fraction == 0.1


def test_cli_generate_dump_mode(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    blueprint = _write_blueprint(tmp_path)
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "cuisines.yml"

    exit_code = cli.main(
        [
            "generate",
            str(blueprint),
            "--out",
            str(out),
            "--job",
            str(job_path),
            "--dump",
            "out/wikidata/slice.json.gz",
            "--hydrate",
            "default",
            "--min-component-fraction",
            "0.2",
        ]
    )

    assert exit_code == 0
    spec = load_category(out / "peruvian-dishes.yml")
    assert spec.source.type == "wikidata-dump"
    assert spec.source.params["hydrate"] == "default"
    assert load_job(job_path).min_component_fraction == 0.2


def test_cli_generate_index_without_dump_is_rejected(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    blueprint = _write_blueprint(tmp_path)
    exit_code = cli.main(
        [
            "generate",
            str(blueprint),
            "--out",
            str(tmp_path / "c"),
            "--index",
            "some.sqlite3",
        ]
    )
    assert exit_code == 2
    assert "require --dump" in capsys.readouterr().err


def _only_dump(raw: dict[str, object]) -> CategorySpec:
    (spec,) = build_specs(raw, dump=_dump())
    return spec


# --- Count verification (--verify), with a stubbed Query Service -------------


class _CountTransport:
    """Transport replaying a SPARQL ``COUNT`` reply keyed on the query's QID.

    Faithfully stubs the Wikidata Query Service: the real cached
    :class:`HttpClient` runs against it, so no live network is touched in CI.
    A QID absent from *counts* replies with zero rows — the shape a class that
    does not exist produces.
    """

    def __init__(self, counts: Mapping[str, int]) -> None:
        self._counts = counts
        self.queries: list[str] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        query = (params or {}).get("query", "")
        self.queries.append(query)
        match = re.search(r"wd:(Q[0-9]+)", query)
        qid = match.group(1) if match else ""
        n = self._counts.get(qid)
        bindings = (
            [{"count": {"type": "literal", "value": str(n)}}] if n is not None else []
        )
        body = json.dumps({"results": {"bindings": bindings}})
        return HttpResponse(url=url, status_code=200, text=body, headers={})


def _count_fn(tmp_path: Path, counts: Mapping[str, int]) -> CountFn:
    client = HttpClient(
        cache_dir=tmp_path / "http-cache",
        min_interval=0.0,
        transport=_CountTransport(counts),
        sleep=lambda _: None,
    )
    return partial(fetch_count, client)


def _verifiable_blueprint(tmp_path: Path) -> Path:
    """A blueprint with one un-commented and one stale-comment class stub."""
    blueprint = tmp_path / "cuisines.yml"
    blueprint.write_text(
        "defaults:\n"
        "  label: Dish;CulturalArtifact\n"
        "  dimensions: [temporal, geographic]\n"
        "categories:\n"
        "  - {id: dishes, name: dish, wikidata_class: Q746549}\n"
        "  - {id: cheeses, name: cheese, wikidata_class: Q10943}  # ~1\n",
        encoding="utf-8",
    )
    return blueprint


def test_verify_records_live_counts_as_trailing_comments(tmp_path: Path) -> None:
    blueprint = _verifiable_blueprint(tmp_path)
    counts = {"Q746549": 3238, "Q10943": 174}

    generate(
        blueprint,
        tmp_path / "categories",
        verify=True,
        count_fn=_count_fn(tmp_path, counts),
    )

    text = blueprint.read_text(encoding="utf-8")
    # A fresh count is appended, and a stale one is replaced — both grouped (,).
    assert "wikidata_class: Q746549}  # ~3,238" in text
    assert "wikidata_class: Q10943}  # ~174" in text
    assert "# ~1\n" not in text  # the stale "# ~1" comment was replaced


def test_verify_refuses_a_class_that_resolves_to_zero(tmp_path: Path) -> None:
    blueprint = _verifiable_blueprint(tmp_path)
    out = tmp_path / "categories"
    # Q10943 is absent from the stub -> the Query Service returns zero rows.
    count_fn = _count_fn(tmp_path, {"Q746549": 3238})

    with pytest.raises(BlueprintError) as excinfo:
        generate(blueprint, out, verify=True, count_fn=count_fn)

    message = str(excinfo.value)
    assert "cheeses" in message  # the offending stub is named
    assert "Q10943" in message
    assert "zero entities" in message
    # Refused before any category was written.
    assert not (out / "cheeses.yml").exists()


def test_verify_is_idempotent(tmp_path: Path) -> None:
    blueprint = _verifiable_blueprint(tmp_path)
    counts = {"Q746549": 3238, "Q10943": 174}

    verify_counts(blueprint, _count_fn(tmp_path, counts))
    once = blueprint.read_text(encoding="utf-8")
    verify_counts(blueprint, _count_fn(tmp_path, counts))
    assert blueprint.read_text(encoding="utf-8") == once


def test_verify_requires_a_count_function(tmp_path: Path) -> None:
    blueprint = _verifiable_blueprint(tmp_path)
    with pytest.raises(BlueprintError, match="requires a count function"):
        generate(blueprint, tmp_path / "categories", verify=True)


def test_generate_without_verify_touches_no_network(tmp_path: Path) -> None:
    """Offline generation is the default: a count_fn that explodes is unused."""

    def boom(_query: str) -> int:  # pragma: no cover - must never be called
        raise AssertionError("count_fn called without --verify")

    blueprint = _verifiable_blueprint(tmp_path)
    result = generate(blueprint, tmp_path / "categories", count_fn=boom)
    assert {p.name for p in result.categories} == {"dishes.yml", "cheeses.yml"}


def test_cli_generate_verify_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    blueprint = _verifiable_blueprint(tmp_path)
    counts = {"Q746549": 3238, "Q10943": 174}
    # Replace the live HttpClient the CLI builds with one over a stub transport.
    monkeypatch.setattr(
        cli,
        "HttpClient",
        lambda **_: HttpClient(
            cache_dir=tmp_path / "cli-cache",
            min_interval=0.0,
            transport=_CountTransport(counts),
            sleep=lambda _: None,
        ),
    )

    exit_code = cli.main(
        ["generate", str(blueprint), "--out", str(tmp_path / "categories"), "--verify"]
    )

    assert exit_code == 0
    assert "wikidata_class: Q746549}  # ~3,238" in blueprint.read_text(encoding="utf-8")
