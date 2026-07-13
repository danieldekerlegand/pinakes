"""Tests for the on-disk class-membership index over a Wikidata dump.

The index is a SQLite KV store built and queried entirely offline against the
committed dump slice under ``tests/fixtures/wikidata/`` — the same
``peruvian_dishes_dump.json`` the adapter parity tests use. Cases cover the
one-pass build, the *class → member QIDs* and *QID → classes* lookups (direct
and transitive), the round-trip through disk, and the fingerprint guard that
rejects an index pointed at a different dump.
"""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from culturescrape.acquire.wikidata_dump_index import (
    INDEX_FORMAT,
    INDEX_VERSION,
    DumpIndexError,
    build_index,
    default_index_path,
    dump_fingerprint,
    dump_version,
    load_index,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "wikidata" / "peruvian_dishes_dump.json"

#: Peruvian dish (the root class), one of its P279 subclasses, and member dishes.
_DISH = "Q746549"
_RAW_FISH = "Q60505892"  # P279 subclass of _DISH
_CEVICHE = "Q207058"
_LOMO = "Q2734670"
_TIRADITO = "Q3037464"  # instance of _RAW_FISH, not of _DISH directly


def _dump_copy(tmp_path: Path, name: str = "dump.json") -> Path:
    dest = tmp_path / name
    shutil.copyfile(_FIXTURE, dest)
    return dest


def test_build_index_maps_instances_and_subclasses(tmp_path: Path) -> None:
    index = build_index(_dump_copy(tmp_path))
    assert index.members_of(_DISH) == [_CEVICHE, _LOMO]  # sorted P31 members
    assert index.subclasses_of(_DISH) == [_RAW_FISH]  # P279 subclass edge
    assert index.members_of("Q-absent") == []


def test_member_qids_direct_excludes_subclass_instances(tmp_path: Path) -> None:
    index = build_index(_dump_copy(tmp_path))
    assert index.member_qids((_DISH,), transitive=False) == {_CEVICHE, _LOMO}


def test_member_qids_transitive_includes_subclass_instances(tmp_path: Path) -> None:
    index = build_index(_dump_copy(tmp_path))
    assert index.member_qids((_DISH,), transitive=True) == {
        _CEVICHE,
        _LOMO,
        _TIRADITO,
    }


def test_classes_of_inverts_instances(tmp_path: Path) -> None:
    index = build_index(_dump_copy(tmp_path))
    assert index.classes_of(_CEVICHE) == [_DISH]
    assert index.classes_of(_TIRADITO) == [_RAW_FISH]
    assert index.classes_of("Q-absent") == []


def test_build_writes_to_default_sidecar(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    build_index(dump)
    assert default_index_path(dump).exists()
    assert default_index_path(dump).name == "dump.json.index.sqlite3"


def test_build_reports_summary_counts(tmp_path: Path) -> None:
    index = build_index(_dump_copy(tmp_path))
    # Distinct classes with >=1 P31 member / >=1 P279 subclass in the fixture.
    assert index.class_count == 4
    assert index.subclass_parent_count == 3


def test_index_round_trips_through_disk(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    built = build_index(dump)
    loaded = load_index(default_index_path(dump), dump)
    assert loaded.members_of(_DISH) == built.members_of(_DISH)
    assert loaded.subclasses_of(_DISH) == built.subclasses_of(_DISH)
    assert loaded.member_qids((_DISH,), transitive=True) == built.member_qids(
        (_DISH,), transitive=True
    )
    assert loaded.fingerprint == built.fingerprint


def test_payload_records_format_version_and_dump(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    build_index(dump)
    conn = sqlite3.connect(default_index_path(dump))
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    finally:
        conn.close()
    assert meta["format"] == INDEX_FORMAT
    assert meta["version"] == str(INDEX_VERSION)
    assert meta["dump_name"] == "dump.json"
    assert meta["dump_size"] == str(dump.stat().st_size)


def test_dump_version_parses_date_from_name(tmp_path: Path) -> None:
    dated = _dump_copy(tmp_path, "wikidata-20240101-all.json")
    assert dump_version(dated) == "20240101"
    assert dump_fingerprint(dated).version == "20240101"
    assert dump_version(_dump_copy(tmp_path)) == "unknown"


def test_load_rejects_index_built_from_a_different_dump(tmp_path: Path) -> None:
    dump_a = _dump_copy(tmp_path, "wikidata-20240101-all.json")
    build_index(dump_a, tmp_path / "a.index.sqlite3")
    # A second dump differing in size (an extra trailing newline) is a mismatch.
    dump_b = tmp_path / "wikidata-20240108-all.json"
    dump_b.write_text(dump_a.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(DumpIndexError, match="different dump"):
        load_index(tmp_path / "a.index.sqlite3", dump_b)


def test_load_rejects_missing_index(tmp_path: Path) -> None:
    with pytest.raises(DumpIndexError, match="not found"):
        load_index(tmp_path / "absent.index.sqlite3", _dump_copy(tmp_path))


def test_load_rejects_foreign_file(tmp_path: Path) -> None:
    bogus = tmp_path / "bogus.index.sqlite3"
    bogus.write_text('{"hello": "world"}', encoding="utf-8")
    with pytest.raises(DumpIndexError, match="not a"):
        load_index(bogus, _dump_copy(tmp_path))


def test_load_rejects_unsupported_version(tmp_path: Path) -> None:
    dump = _dump_copy(tmp_path)
    build_index(dump)
    sidecar = default_index_path(dump)
    conn = sqlite3.connect(sidecar)
    try:
        conn.execute(
            "UPDATE meta SET value = ? WHERE key = 'version'",
            (str(INDEX_VERSION + 1),),
        )
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(DumpIndexError, match="version"):
        load_index(sidecar, dump)
