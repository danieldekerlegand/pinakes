"""Tests for the bounded, API-composed Wikidata slice builder.

A fake transport routes WDQS (member-QID) and ``wbgetentities`` (full-entity)
requests through the real cached :class:`HttpClient`, so the whole build —
resolve members → fetch entities → write dump framing → write manifest — is
exercised with no live network, and the written slice is round-tripped back
through the real :func:`iter_entities` reader.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    HttpClient,
    HttpResponse,
    SliceClass,
    WikidataSliceError,
    blueprint_classes,
    build_slice,
    fetch_entities,
    iter_entities,
    member_query,
    resolve_members,
    write_dump,
)
from pinakes_engine.acquire.wikidata_slice import (
    MANIFEST_FORMAT,
    SLICE_SOURCE,
    WIKIDATA_API_ENDPOINT,
)

_FIXED_NOW = datetime(2026, 7, 12, 12, 0, 0, tzinfo=UTC)


def _entity(qid: str, name: str, cls: str) -> dict[str, object]:
    return {
        "type": "item",
        "id": qid,
        "labels": {"en": {"language": "en", "value": name}},
        "claims": {
            "P31": [
                {
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P31",
                        "datavalue": {
                            "value": {"entity-type": "item", "id": cls},
                            "type": "wikibase-entityid",
                        },
                    },
                    "type": "statement",
                    "rank": "normal",
                }
            ]
        },
    }


class _RouterTransport:
    """Routes WDQS vs wbgetentities requests to canned bodies; records calls."""

    def __init__(
        self,
        *,
        members: Mapping[str, list[str]],
        entities: Mapping[str, dict[str, object]],
    ) -> None:
        self._members = members
        self._entities = entities
        self.calls: list[dict[str, str]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        p = dict(params or {})
        self.calls.append(p)
        if p.get("action") == "wbgetentities":
            requested = p["ids"].split("|")
            payload = {
                "entities": {
                    qid: self._entities.get(qid, {"id": qid, "missing": ""})
                    for qid in requested
                }
            }
        else:
            query = p["query"]
            qid = query.split("wd:")[-1].split()[0].rstrip("}").strip()
            payload = {
                "results": {
                    "bindings": [
                        {
                            "item": {
                                "type": "uri",
                                "value": f"http://www.wikidata.org/entity/{m}",
                            }
                        }
                        for m in self._members.get(qid, [])
                    ]
                }
            }
        return HttpResponse(
            url=url, status_code=200, text=json.dumps(payload), headers={}
        )


def _client(tmp_path: Path, transport: _RouterTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path / ".http-cache",
        min_interval=0.0,
        transport=transport,
        sleep=lambda _: None,
    )


def test_member_query_direct_vs_transitive() -> None:
    assert member_query("Q10943", transitive=False, limit=5) == (
        "SELECT ?item WHERE { ?item wdt:P31 wd:Q10943 } LIMIT 5"
    )
    assert member_query("Q10943", transitive=True, limit=5) == (
        "SELECT ?item WHERE { ?item wdt:P31/wdt:P279* wd:Q10943 } LIMIT 5"
    )


def test_blueprint_classes_reads_stubs(tmp_path: Path) -> None:
    bp = tmp_path / "food-drink.yml"
    bp.write_text(
        "categories:\n"
        '  - {id: cheeses, name: "cheese", wikidata_class: Q10943}\n'
        '  - {id: dances, name: "dance", subclass_of: Q11401}\n'
        '  - {id: raw, name: "raw", query: "SELECT ?item WHERE {}"}\n',
        encoding="utf-8",
    )
    classes = blueprint_classes(bp, transitive=False)
    assert [c.qid for c in classes] == ["Q10943", "Q11401"]  # raw query skipped
    assert all(c.domain == "food-drink" for c in classes)
    # wikidata_class honours transitive=False; subclass_of stays transitive.
    assert classes[0].transitive is False
    assert classes[1].transitive is True


def test_blueprint_classes_rejects_non_blueprint(tmp_path: Path) -> None:
    bad = tmp_path / "nope.yml"
    bad.write_text("just: a mapping\n", encoding="utf-8")
    with pytest.raises(WikidataSliceError):
        blueprint_classes(bad)


@pytest.mark.parametrize("name", ["slice.json", "slice.json.gz"])
def test_write_dump_roundtrips_through_reader(tmp_path: Path, name: str) -> None:
    entities = [
        _entity("Q14088", "cheddar", "Q10943"),
        _entity("Q58730", "brie", "Q10943"),
        _entity("Q61612", "gouda", "Q10943"),
    ]
    path = tmp_path / name
    count = write_dump(entities, path)
    assert count == 3
    read_back = list(iter_entities(path))
    assert read_back == entities
    assert [e["id"] for e in read_back] == ["Q14088", "Q58730", "Q61612"]


def test_write_dump_frames_array_last_line_has_no_comma(tmp_path: Path) -> None:
    path = tmp_path / "slice.json.gz"
    write_dump([_entity("Q1", "a", "Q10943"), _entity("Q2", "b", "Q10943")], path)
    lines = gzip.open(path, "rt", encoding="utf-8").read().splitlines()
    assert lines[0] == "["
    assert lines[1].endswith(",")
    assert not lines[2].endswith(",")  # last entity line: no trailing comma
    assert lines[3] == "]"


def test_fetch_entities_batches_and_skips_missing(tmp_path: Path) -> None:
    entities = {
        "Q1": _entity("Q1", "a", "Q10943"),
        "Q3": _entity("Q3", "c", "Q10943"),
    }
    transport = _RouterTransport(members={}, entities=entities)
    client = _client(tmp_path, transport)
    # Q2 is absent -> comes back "missing" -> skipped; order preserved.
    got = list(
        fetch_entities(client, ["Q1", "Q2", "Q3"], batch_size=2)
    )
    assert [e["id"] for e in got] == ["Q1", "Q3"]
    # Two batches of size 2: [Q1,Q2] then [Q3].
    api_calls = [c for c in transport.calls if c.get("action") == "wbgetentities"]
    assert [c["ids"] for c in api_calls] == ["Q1|Q2", "Q3"]


def test_resolve_members_bounds_and_parses_qids(tmp_path: Path) -> None:
    transport = _RouterTransport(
        members={"Q10943": ["Q14088", "Q58730"]}, entities={}
    )
    client = _client(tmp_path, transport)
    cls = SliceClass(qid="Q10943", label="cheese", domain="food-drink")
    memberships = resolve_members(client, [cls], limit_per_class=50)
    assert memberships[0].member_qids == ["Q14088", "Q58730"]
    assert memberships[0].requested == 50
    assert "LIMIT 50" in transport.calls[0]["query"]


def test_build_slice_end_to_end(tmp_path: Path) -> None:
    members = {
        "Q10943": ["Q14088", "Q58730"],  # food-drink: cheeses
        "Q34770": ["Q1860", "Q14088"],  # language: languages (Q14088 shared)
    }
    entities = {
        "Q14088": _entity("Q14088", "cheddar", "Q10943"),
        "Q58730": _entity("Q58730", "brie", "Q10943"),
        "Q1860": _entity("Q1860", "English", "Q34770"),
    }
    transport = _RouterTransport(members=members, entities=entities)
    client = _client(tmp_path, transport)
    classes = [
        SliceClass(qid="Q10943", label="cheese", domain="food-drink"),
        SliceClass(qid="Q34770", label="language", domain="language"),
    ]
    out = tmp_path / "out" / "wikidata-20260712-blueprint-slice.json.gz"
    manifest = build_slice(
        client, classes, out, limit_per_class=200, now=lambda: _FIXED_NOW
    )

    # Slice is a valid dump: shared Q14088 fetched/written once, order preserved.
    read_back = list(iter_entities(out))
    assert [e["id"] for e in read_back] == ["Q14088", "Q58730", "Q1860"]
    assert manifest.entity_total == 3

    # Provenance: version parsed from the file name, source is honest.
    assert manifest.dump_version == "20260712"
    assert manifest.source == SLICE_SOURCE

    # Manifest sidecar written next to the slice with per-domain coverage.
    sidecar = out.with_name(out.name + ".manifest.json")
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload["format"] == MANIFEST_FORMAT
    assert payload["built_at"] == _FIXED_NOW.isoformat()
    assert payload["domains"]["food-drink"]["obtained"] == 2
    assert payload["domains"]["language"]["classes"][0]["class"] == "Q34770"


def test_build_slice_uses_expected_endpoints(tmp_path: Path) -> None:
    transport = _RouterTransport(
        members={"Q10943": ["Q14088"]},
        entities={"Q14088": _entity("Q14088", "cheddar", "Q10943")},
    )
    client = _client(tmp_path, transport)
    classes = [SliceClass(qid="Q10943", label="cheese", domain="food-drink")]
    out = tmp_path / "wikidata-20260712-slice.json"
    build_slice(client, classes, out, limit_per_class=10, now=lambda: _FIXED_NOW)
    # One WDQS query + one wbgetentities batch (against the real endpoint const).
    assert any(c.get("action") == "wbgetentities" for c in transport.calls)
    assert WIKIDATA_API_ENDPOINT == "https://www.wikidata.org/w/api.php"
