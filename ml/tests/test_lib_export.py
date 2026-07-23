"""The canonical corpus ``ml/`` consumes is the agora lib's output (pinakes:50 US-5).

``ml/`` derives every training artifact from the canonical node/edge TSV export.
Which *renderer* produced those bytes used to be invisible from here: the loaders
hard-code a handful of header strings (``:START_ID``, ``csid:ID``, …) and skip
anything they do not recognise, so a drift in the emitter degrades silently into
fewer triples rather than a red test.

Since pinakes:50 US-1 that renderer is the embedded agora translation engine
(``agora:60-translation-engine-rust``), and this module is what ties ``ml/`` to it
**in CI, over real engine bytes** — without ``ml/`` declaring the extension. The
engine is a macOS/arm64 abi3 wheel vendored in ``core/``; adding it to this
workspace would churn ``ml/uv.lock`` and break ``uv sync --frozen`` on Linux CI
(the same stance ``pyproject.toml`` takes on ``scallopy``). So instead of importing
the lib, this reads its **committed output**:

    core/tests/fixtures/parity/golden/neo4j-export/{nodes,edges}/*.tsv

which ``core/tests/test_translation_parity.py`` captures from
``translation.to_neo4j_export`` and pins byte-for-byte against both the engine and
the pre-migration Python emitters. It is deliberately hostile data — embedded tab /
newline / backslash escapes, a multi-label node, an empty multi-value cell, sparse
rows, a negative year — so "the loaders cope with the engine's escaping" is a claim
with teeth. If the engine's rendering ever moves, core's parity suite fails on the
bytes and this module fails on what ``ml/`` makes of them.

The third group of tests guards the path math itself. ``ml/``'s live gates are
``skipif``-ed on a repo-root-relative path, so an off-by-one (or a relocated
sibling, as when the Python package moved to ``core/``) turns a gate into a
permanent skip and the suite stays green. Every repo-root-anchored default that
points at a *git-tracked* file is asserted to exist here, so that failure mode is
loud.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from pinakes_ml import export_insimul_datasets, export_scallop, triples, verbalize
from pinakes_ml.scallop import intern_symbols, load_relations
from pinakes_ml.triples import (
    EXCLUDED_RELATIONS,
    Triple,
    build_manifest,
    load_triples,
    split_triples,
)

# ml/tests/this_file → parents[2] is the repo root (parents[1] = ml/).
_REPO_ROOT = Path(__file__).resolve().parents[2]
_ML_ROOT = _REPO_ROOT / "ml"

#: The engine-rendered canonical export, committed by core's parity suite.
_ENGINE_EXPORT = (
    _REPO_ROOT / "core" / "tests" / "fixtures" / "parity" / "golden" / "neo4j-export"
)
_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"

#: The three triples the engine's fixture corpus carries.
_EXPECTED = [
    Triple(relation="DERIVED_FROM", head="cs:dish:Q207965", tail="cs:language:Q5218"),
    Triple(relation="ORIGINATES_IN", head="cs:dish:Q207965", tail="cs:place:Q2634"),
    Triple(relation="ORIGINATES_IN", head="cs:place:Q2634", tail="cs:language:Q5218"),
]


def _canonical_headers() -> tuple[list[str], list[str]]:
    """``(node header, edge header)`` as ``shared/canonical-schema.json`` declares."""
    schema = json.loads(_SCHEMA.read_text(encoding="utf-8"))
    return (
        [col["header"] for col in schema["node"]["columns"]],
        [col["header"] for col in schema["edge"]["columns"]],
    )


# --- The repo-root path math (a wrong walk is a silent skip, not a failure) ----


def test_the_repo_root_walk_lands_on_the_repo_root() -> None:
    """``parents[2]`` from ``ml/tests/`` must be the repo root, not ``ml/``."""
    assert (_REPO_ROOT / "shared" / "canonical-schema.json").is_file()
    assert (_REPO_ROOT / "core" / "pyproject.toml").is_file()
    assert (_REPO_ROOT / "ml" / "pyproject.toml").is_file()


def test_every_git_tracked_default_path_resolves() -> None:
    """Repo-root-anchored defaults that point at committed files must exist.

    These are the inputs the CI-tier gates read directly (no DVC pull), so a stale
    path here does not fail — it makes the gate `skipif` forever. That is exactly
    what happened to both `test_scallop.py` committed-artifact gates when the
    Python package moved from `packages/culture-scrape/` to `core/`.
    """
    tracked = {
        "export_scallop.DEFAULT_REGISTRY": export_scallop.DEFAULT_REGISTRY,
        "export_insimul_datasets.DEFAULT_WORLDS[0]": (
            export_insimul_datasets.DEFAULT_WORLDS[0]
        ),
        "shared/canonical-schema.json": _SCHEMA,
        "the engine-rendered export": _ENGINE_EXPORT,
    }
    missing = sorted(name for name, path in tracked.items() if not path.exists())
    assert not missing, f"stale repo-root-relative default(s): {missing}"
    # None of them may point back into the retired shell.
    assert not any("packages/culture-scrape" in str(p) for p in tracked.values())


def test_the_dvc_corpus_anchor_exists_so_the_live_gates_are_gated_on_a_pull() -> None:
    """The live gates skip on a *materialization*, never on a path typo.

    `export/culturescrape/` is DVC-tracked and absent in CI, but its pointer file
    is committed — so if the pointer resolves and the tree does not, the skip is
    honest.
    """
    assert (_REPO_ROOT / "export" / "culturescrape.dvc").is_file()
    assert triples_edges_dir().parent.name == "culturescrape"


def triples_edges_dir() -> Path:
    from pinakes_ml.export_triples import DEFAULT_EDGES_DIR

    return DEFAULT_EDGES_DIR


# --- The engine's bytes are the canonical contract ml/ codes against ------------


def test_the_engine_export_carries_the_canonical_headers() -> None:
    """Every engine-rendered shard's header row is the canonical header, verbatim."""
    node_header, edge_header = _canonical_headers()
    shards = sorted((_ENGINE_EXPORT / "nodes").glob("*.tsv"))
    assert shards, "the engine's node export is empty"
    for path in shards:
        first = path.read_text(encoding="utf-8").splitlines()[0]
        assert first.split("\t") == node_header, path.name
    shards = sorted((_ENGINE_EXPORT / "edges").glob("*.tsv"))
    assert shards, "the engine's edge export is empty"
    for path in shards:
        first = path.read_text(encoding="utf-8").splitlines()[0]
        assert first.split("\t") == edge_header, path.name


def test_the_loaders_header_constants_are_canonical_schema_columns() -> None:
    """Every header string ``ml/`` hard-codes must be a column the schema declares.

    The loaders are header-*driven* but the names they look up are literals; a
    column renamed in the contract would make them silently read blanks.
    """
    node_header, edge_header = _canonical_headers()
    assert {triples._START_COL, triples._END_COL, triples._TYPE_COL} <= set(edge_header)
    assert {
        verbalize._EDGE_START,
        verbalize._EDGE_END,
        verbalize._EDGE_TYPE,
    } <= set(edge_header)
    assert {
        verbalize._NODE_CSID,
        verbalize._NODE_NAME,
        verbalize._NODE_TIME_START,
        verbalize._NODE_TIME_END,
        verbalize._NODE_LAT,
        verbalize._NODE_LON,
    } <= set(node_header)
    provenance = {
        verbalize._PROV_SOURCE,
        verbalize._PROV_SOURCE_URL,
        verbalize._PROV_SOURCE_QUERY,
        verbalize._PROV_LICENSE,
    }
    assert provenance <= set(node_header)
    assert provenance <= set(edge_header)


# --- The ml/ builders, driven over engine-rendered bytes ------------------------


def test_triples_load_from_the_engine_rendered_export() -> None:
    assert load_triples(_ENGINE_EXPORT / "edges") == _EXPECTED


def test_excluded_relations_are_dropped_from_an_engine_rendered_export(
    tmp_path: Path,
) -> None:
    """A derived temporal shard rendered by the engine still never reaches training."""
    edges = tmp_path / "edges"
    shutil.copytree(_ENGINE_EXPORT / "edges", edges)
    _node_header, edge_header = _canonical_headers()
    row = dict.fromkeys(edge_header, "")
    row[":START_ID"] = "cs:dish:Q207965"
    row[":END_ID"] = "cs:place:Q2634"
    row[":TYPE"] = "CONTEMPORARY_WITH"
    (edges / "CONTEMPORARY_WITH.tsv").write_text(
        "\t".join(edge_header) + "\n" + "\t".join(row[c] for c in edge_header) + "\n",
        encoding="utf-8",
    )
    assert load_triples(edges) == _EXPECTED
    assert "CONTEMPORARY_WITH" in EXCLUDED_RELATIONS


def test_splits_over_the_engine_rendered_export_stay_leakage_safe() -> None:
    """The grouped split is unchanged: same seed ⇒ same partition, no pair split."""
    loaded = load_triples(_ENGINE_EXPORT / "edges")
    first = split_triples(loaded)
    assert split_triples(loaded).items() == first.items()
    assigned: dict[tuple[str, str], str] = {}
    for name, part in first.items():
        for t in part:
            key = (t.head, t.tail) if t.head <= t.tail else (t.tail, t.head)
            assert assigned.setdefault(key, name) == name
    assert sorted(first.train + first.valid + first.test) == _EXPECTED


def test_the_triples_manifest_is_byte_stable_over_the_engine_rendered_export() -> None:
    """Rebuilding the manifest from the same engine bytes is a git no-op.

    The reproducible-artifact discipline (`ml/CLAUDE.md`): `json.dumps(sort_keys=
    True)` + a trailing newline over a pure, wall-clock-free build.
    """
    loaded = load_triples(_ENGINE_EXPORT / "edges")

    def rendered() -> str:
        manifest = build_manifest(loaded, split_triples(loaded))
        return json.dumps(manifest, indent=2, sort_keys=True) + "\n"

    assert rendered() == rendered()
    assert rendered().endswith("}\n")


def test_scallop_relations_load_from_the_engine_rendered_export() -> None:
    """The Scallop context export reads the engine's shards into typed relations."""
    relations = load_relations(_ENGINE_EXPORT / "edges")
    assert relations == {
        "derived_from": [("cs:dish:Q207965", "cs:language:Q5218")],
        "originates_in": [
            ("cs:dish:Q207965", "cs:place:Q2634"),
            ("cs:place:Q2634", "cs:language:Q5218"),
        ],
    }
    # Interning is over the sorted entity set, so it is stable across renderers.
    assert intern_symbols(relations) == {
        "cs:dish:Q207965": 0,
        "cs:language:Q5218": 1,
        "cs:place:Q2634": 2,
    }


def test_verbalizations_build_from_the_engine_rendered_export() -> None:
    """Node names, provenance and the engine's escaping survive into the dataset."""
    nodes = verbalize.load_nodes(_ENGINE_EXPORT / "nodes")
    assert nodes["cs:language:Q5218"].name == "Quechua"
    assert nodes["cs:dish:Q207965"].license == "CC0-1.0"
    # The engine escapes an embedded tab/newline/backslash; the loader must not
    # split the row on them (a raw tab would shift every later column).
    assert nodes["cs:place:Q2634"].name == "Lima"
    assert nodes["cs:place:Q2634"].lat == pytest.approx(-12.0464)

    examples, skipped = verbalize.build_examples(_ENGINE_EXPORT)
    edges = [e for e in examples if e.kind == "edge"]
    # DERIVED_FROM has a template; ORIGINATES_IN has none, so both its facts are
    # skipped (never invented) — the coverage test in test_verbalize.py owns which
    # types qualify. NOTE the counter lumps template-less facts in with genuinely
    # unknown endpoints, so `unknownEndpointNode` here is 2 template misses and 0
    # dangling endpoints; every endpoint in this corpus resolves.
    assert skipped == {"unknownEndpointNode": 2}
    assert [(e.relation, e.head_name, e.tail_name) for e in edges] == [
        ("DERIVED_FROM", "Ceviche", "Quechua")
    ]
    assert verbalize.serialize_examples(examples).endswith("\n")


# --- The committed manifests keep the reproducible-artifact discipline ---------


def test_every_committed_manifest_is_canonical_json() -> None:
    """`sort_keys` + `indent=2` + a trailing newline, so a byte-identical corpus is
    a git no-op.

    A generator that forgets the discipline (or a hand-edit) reorders keys, and the
    next regeneration shows up as a spurious diff that hides the real one. Both
    `ensure_ascii` settings are accepted: the handoff/contract writers deliberately
    emit `False` to keep unicode readable, the rest take the default.
    """
    manifests = sorted((_ML_ROOT / "manifests").glob("*.json"))
    assert manifests, "no committed manifests found"
    offenders = []
    for path in manifests:
        body = path.read_text(encoding="utf-8")
        payload = json.loads(body)
        canonical = {
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=ascii_only)
            + "\n"
            for ascii_only in (True, False)
        }
        if body not in canonical:
            offenders.append(path.name)
    assert not offenders, f"manifests not in canonical JSON form: {offenders}"
