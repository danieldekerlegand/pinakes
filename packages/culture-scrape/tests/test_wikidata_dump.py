"""Tests for the streaming Wikidata JSON dump reader.

A tiny committed slice of the dump — ``tests/fixtures/wikidata/sample-dump.json``
and its gzip/bzip2 twins — drives every case offline. The slice reproduces the
real dump's framing: a ``[`` opener, a ``]`` closer, per-line trailing commas,
two items, one property, and one deliberately truncated (malformed) line so the
skip-and-count path is exercised without a multi-gigabyte download.
"""

from pathlib import Path

import pytest

from culturescrape.acquire import (
    DumpReadStats,
    WikidataDumpError,
    iter_entities,
    open_dump,
)

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "wikidata"
_PLAIN = _FIXTURE_DIR / "sample-dump.json"
_GZ = _FIXTURE_DIR / "sample-dump.json.gz"
_BZ2 = _FIXTURE_DIR / "sample-dump.json.bz2"


def test_yields_well_formed_entities_skipping_the_malformed_line() -> None:
    entities = list(iter_entities(_PLAIN))
    ids = [e["id"] for e in entities]
    # The truncated "Q999" line is dropped; the four valid records survive.
    assert ids == ["Q1", "Q42", "Q146", "P31"]


def test_parsed_entity_carries_id_labels_claims_and_sitelinks() -> None:
    entity = next(e for e in iter_entities(_PLAIN) if e["id"] == "Q42")
    assert entity["labels"]["en"]["value"] == "Douglas Adams"
    assert entity["labels"]["fr"]["value"] == "Douglas Adams"
    assert "P31" in entity["claims"]
    p31 = entity["claims"]["P31"][0]
    assert p31["mainsnak"]["datavalue"]["value"]["id"] == "Q5"
    assert entity["sitelinks"]["enwiki"]["title"] == "Douglas Adams"


@pytest.mark.parametrize("path", [_PLAIN, _GZ, _BZ2])
def test_compression_is_handled_transparently(path: Path) -> None:
    ids = [e["id"] for e in iter_entities(path)]
    assert ids == ["Q1", "Q42", "Q146", "P31"]


def test_stats_count_entities_and_skips() -> None:
    stats = DumpReadStats()
    consumed = list(iter_entities(_PLAIN, stats=stats))
    assert stats.entities == len(consumed) == 4
    assert stats.skipped == 1


def test_streams_lazily_without_materialising_the_array() -> None:
    # Pulling a single entity must not require reading to the end of the dump.
    stats = DumpReadStats()
    first = next(iter(iter_entities(_PLAIN, stats=stats)))
    assert first["id"] == "Q1"
    # Only the first record was consumed, proving records arrive incrementally.
    assert stats.entities == 1


def test_accepts_str_path() -> None:
    ids = [e["id"] for e in iter_entities(str(_PLAIN))]
    assert ids == ["Q1", "Q42", "Q146", "P31"]


def test_malformed_line_is_skipped_not_raised() -> None:
    # A whole scan completes despite the corrupt line — no exception escapes.
    stats = DumpReadStats()
    list(iter_entities(_PLAIN, stats=stats))
    assert stats.skipped >= 1


def test_non_entity_json_line_is_skipped(tmp_path: Path) -> None:
    dump = tmp_path / "framed.json"
    dump.write_text(
        '[\n'
        '{"id": "Q1", "labels": {}, "claims": {}, "sitelinks": {}},\n'
        '[1, 2, 3],\n'  # valid JSON, but not an entity object
        '{"type": "item"},\n'  # entity object without a string id
        '{"id": "Q2", "labels": {}, "claims": {}, "sitelinks": {}}\n'
        ']\n',
        encoding="utf-8",
    )
    stats = DumpReadStats()
    ids = [e["id"] for e in iter_entities(dump, stats=stats)]
    assert ids == ["Q1", "Q2"]
    assert stats.skipped == 2


def test_missing_path_raises_dump_error(tmp_path: Path) -> None:
    with pytest.raises(WikidataDumpError, match="not found"):
        list(iter_entities(tmp_path / "nope.json.gz"))


def test_open_dump_selects_decompressor_by_extension() -> None:
    with open_dump(_GZ) as handle:
        assert handle.readline().strip() == "["
    with open_dump(_BZ2) as handle:
        assert handle.readline().strip() == "["
    with open_dump(_PLAIN) as handle:
        assert handle.readline().strip() == "["


def test_empty_dump_yields_nothing(tmp_path: Path) -> None:
    dump = tmp_path / "empty.json"
    dump.write_text("[\n]\n", encoding="utf-8")
    stats = DumpReadStats()
    assert list(iter_entities(dump, stats=stats)) == []
    assert stats.entities == 0
    assert stats.skipped == 0
