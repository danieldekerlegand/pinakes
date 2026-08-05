"""Tests for the Insimul ``CanonicalWorldExport`` ingest bridge (insimul-bridge US-003).

Covers Bridge 2 end-to-end over a committed fixture world:

* the ``insimul`` acquisition adapter — reads the ``CanonicalWorldExport`` envelope,
  mints world-scoped csids, stamps ``source=insimul`` + the world id / seed /
  contract version as provenance and the proprietary SPDX licence;
* the entity mapping — characters / buildings / businesses / settlements / truths
  become canonical nodes of the v1.3 vocabulary, and genealogy / employment /
  occupancy / containment / causality become the v1.3 edge types;
* the **synthetic trust tier** — every ingested record classifies synthetic;
* **idempotence** — re-ingesting the same artifact yields byte-identical rows
  (0 changes), the AC's re-ingest guarantee;
* the **hard containment gate** — a synthetic-tier record can never enter a
  packaged / open-data artifact (the Insimul bridge spec §7 "License leakage");
* the world's Prolog rules as **full-prolog, world-scoped** rules-registry entries
  that never reach the committed Datalog registry;
* a ``validate`` over the ingested corpus — nodes + edges are import-clean (no
  dangling endpoint, no duplicate csid).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from pinakes_contracts import canonical_schema, load_document

from pinakes_engine.acquire import insimul
from pinakes_engine.acquire.categories import CategorySpec, SourceSpec
from pinakes_engine.acquire.factory import build_adapter
from pinakes_engine.acquire.http import HttpClient
from pinakes_engine.acquire.insimul import (
    CONTRACT_VERSION,
    INSIMUL_LICENSE,
    INSIMUL_SOURCE,
    WORLD_RULE_DIALECT,
    InsimulExportError,
    InsimulWorldAdapter,
    read_world_export,
    world_rule_entries,
)
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.datalog.export import (
    SYNTHETIC_TIER,
    DatalogExportError,
    tier_row_filter,
)
from pinakes_engine.datalog.registry import (
    LAYER_INSIMUL_WORLD,
    RuleStatus,
    build_registry,
)
from pinakes_engine.ontology.registry import is_registered
from pinakes_engine.orchestrate.package import PackageError, package_corpus
from pinakes_engine.orchestrate.tiers import (
    TIER_SYNTHETIC,
    SyntheticTierContainmentError,
    assert_no_synthetic_records,
    classify_tier,
)
from pinakes_engine.schema.license_class import classify_license
from pinakes_engine.schema.pipeline import normalize_records, write_result
from pinakes_engine.schema.tsvio import Row
from pinakes_engine.schema.validate import validate_directory

FIXTURE_WORLD = Path(__file__).parent / "fixtures" / "insimul" / "world-export.json"

_WORLD = "w-laterre"
_MARIE = f"cs:character:insimul:{_WORLD}:c1"
_JEAN = f"cs:character:insimul:{_WORLD}:c2"
_LUC = f"cs:character:insimul:{_WORLD}:c3"
_HOUSE = f"cs:building:insimul:{_WORLD}:b1"
_WAREHOUSE = f"cs:building:insimul:{_WORLD}:b2"
_BAKERY = f"cs:business:insimul:{_WORLD}:biz1"
_BELLEVUE = f"cs:place:insimul:{_WORLD}:s1"
_MARCHAND = f"cs:place:insimul:{_WORLD}:s2"
_FLOOD = f"cs:myth-motif:insimul:{_WORLD}:t1"
_REBUILD = f"cs:myth-motif:insimul:{_WORLD}:t2"
_MILL = f"cs:myth-motif:insimul:{_WORLD}:t3"


def _spec(
    query: str | None, params: Mapping[str, str] | None = None
) -> CategorySpec:
    merged = {"adapter": "insimul", **dict(params or {})}
    return CategorySpec(
        id="insimul",
        label="Character",
        description="an insimul CanonicalWorldExport",
        source=SourceSpec(type="dump", query=query, params=merged),
        dimensions=("structural",),
        links=(),
    )


def _fetch(spec: CategorySpec) -> list[RawRecord]:
    return list(InsimulWorldAdapter().fetch(spec))


def _normalize(spec: CategorySpec) -> tuple[list[Row], list[Row]]:
    result = normalize_records(_fetch(spec), spec)
    return result.nodes, result.edges


def _fixture_rows() -> tuple[list[Row], list[Row]]:
    return _normalize(_spec(str(FIXTURE_WORLD)))


def _by_csid(nodes: list[Row]) -> dict[str, Row]:
    return {str(node["csid"]): node for node in nodes}


def _pairs(edges: list[Row], edge_type: str) -> set[tuple[str, str]]:
    return {
        (str(edge[":START_ID"]), str(edge[":END_ID"]))
        for edge in edges
        if edge[":TYPE"] == edge_type
    }


def _overflow(node: Row) -> dict[str, object]:
    raw = node.get("extra")
    assert isinstance(raw, str), f"node {node.get('csid')!r} has no overflow"
    decoded = json.loads(raw)
    assert isinstance(decoded, dict)
    return decoded


def _write_world(root: Path, **overrides: object) -> Path:
    """A copy of the fixture world with *overrides* applied at the top level."""
    document = json.loads(FIXTURE_WORLD.read_text(encoding="utf-8"))
    document.update(overrides)
    path = root / "world.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


# --- the adapter -------------------------------------------------------------


def test_reads_the_committed_fixture_world() -> None:
    records = _fetch(_spec(str(FIXTURE_WORLD)))
    nodes = [r for r in records if ":LABEL" in r.fields]
    edges = [r for r in records if ":TYPE" in r.fields]
    # 3 characters + 2 buildings + 1 business + 2 settlements + 3 truths.
    assert len(nodes) == 11
    assert len(edges) == 13


def test_every_record_carries_world_seed_and_contract_provenance() -> None:
    records = _fetch(_spec(str(FIXTURE_WORLD)))
    assert records
    for record in records:
        prov = record.provenance
        assert prov.source == INSIMUL_SOURCE
        assert prov.source_url == f"insimul:world:{_WORLD}"
        # world_id + seed + contractVersion, the AC's provenance triple.
        assert "seed=seed-4711" in prov.source_query
        assert f"contractVersion={CONTRACT_VERSION}" in prov.source_query
        assert prov.license == INSIMUL_LICENSE


def test_retrieved_at_is_the_export_stamp_not_the_wall_clock() -> None:
    # A world export is an artifact, so its retrieval time IS its export time —
    # that is what keeps a re-ingest byte-identical.
    record = _fetch(_spec(str(FIXTURE_WORLD)))[0]
    assert record.provenance.retrieved_at == "2026-07-20T09:15:00+00:00"


def test_the_proprietary_licence_is_never_redistributable() -> None:
    # `LicenseRef-Insimul-Proprietary` is unregistered in the SPDX class registry,
    # which classifies it `unknown` — the verify-before-redistribute class.
    assert classify_license(INSIMUL_LICENSE) == "unknown"


def test_the_adapter_reads_no_network(tmp_path: Path) -> None:
    spec = _spec(str(FIXTURE_WORLD))

    def _no_http() -> HttpClient:  # pragma: no cover - a dump takes no client
        raise AssertionError("a local world export must not build an HttpClient")

    adapter = build_adapter(spec, http_factory=_no_http)
    assert isinstance(adapter, InsimulWorldAdapter)


# --- entity mapping ----------------------------------------------------------


def test_characters_become_character_nodes_with_world_scoped_csids() -> None:
    nodes, _ = _fixture_rows()
    marie = _by_csid(nodes)[_MARIE]
    assert marie[":LABEL"] == ["Character"]
    assert marie["name"] == "Marie Angélique Bernard"
    # birthYear is the one WorldIR field with a canonical temporal home.
    assert marie["time_start"] == "1798"
    # Non-canonical WorldIR properties ride into the overflow, never dropped.
    overflow = _overflow(marie)
    assert overflow["gender"] == "female"
    assert overflow["occupation"] == "baker"


def test_buildings_and_businesses_become_place_family_nodes() -> None:
    nodes, _ = _fixture_rows()
    by_csid = _by_csid(nodes)
    # A building has no WorldIR `name`; its lot address is the readable identity,
    # and a lot-less building falls back to its spec type.
    assert by_csid[_HOUSE][":LABEL"] == ["Building"]
    assert by_csid[_HOUSE]["name"] == "12 Rue Verte"
    assert by_csid[_WAREHOUSE]["name"] == "warehouse"
    assert by_csid[_BAKERY][":LABEL"] == ["Business"]
    assert by_csid[_BAKERY]["name"] == "Boulangerie Bernard"
    assert by_csid[_BAKERY]["time_start"] == "1820"
    assert by_csid[_BELLEVUE][":LABEL"] == ["Place"]


def test_a_settlement_position_never_becomes_a_geographic_coordinate() -> None:
    # WorldIR positions are world-space metres around procedural terrain, NOT
    # WGS-84 — writing them into lat/lon would put a generated town at lat 412.
    nodes, _ = _fixture_rows()
    bellevue = _by_csid(nodes)[_BELLEVUE]
    assert "lat" not in bellevue
    assert "lon" not in bellevue
    assert _overflow(bellevue)["population"] == "412"


def test_truths_become_point_in_time_event_nodes() -> None:
    nodes, _ = _fixture_rows()
    flood = _by_csid(nodes)[_FLOOD]
    # A truth anchors on `myth-motif` — the canonical type the registry already
    # pairs Insimul truths with; v1.3 coined no general event type.
    assert flood[":LABEL"] == ["MythMotif"]
    assert flood["name"] == "The flood of 1828"
    # A truth is a point event: truth_year becomes BOTH canonical endpoints.
    assert flood["time_start"] == "1828"
    assert flood["time_end"] == "1828"


# --- edge mapping ------------------------------------------------------------


def test_genealogy_edges_use_canonical_argument_order() -> None:
    _, edges = _fixture_rows()
    # (parent, child) — `child_of/2` is the same relation with the arguments
    # swapped, so c3's parentIds add no second edge type and no duplicate.
    assert _pairs(edges, "PARENT_OF") == {(_MARIE, _LUC), (_JEAN, _LUC)}


def test_spouse_edges_collapse_to_one_sorted_edge() -> None:
    _, edges = _fixture_rows()
    # `soc:spouse_of` is symmetric, so the two directions Insimul stores (each
    # spouse names the other) collapse to ONE edge with sorted endpoints.
    assert _pairs(edges, "SPOUSE_OF") == {(_MARIE, _JEAN)}


def test_business_owner_and_founder_become_employed_by_edges() -> None:
    _, edges = _fixture_rows()
    assert _pairs(edges, "EMPLOYED_BY") == {(_MARIE, _BAKERY), (_JEAN, _BAKERY)}


def test_residents_become_resides_in_edges() -> None:
    _, edges = _fixture_rows()
    # Both stored sides — a character's homeResidenceId AND a building's
    # occupantIds — collapse to one edge per (resident, dwelling) fact.
    assert _pairs(edges, "RESIDES_IN") == {
        (_MARIE, _HOUSE),
        (_JEAN, _HOUSE),
        (_LUC, _HOUSE),
    }


def test_settlement_containment_becomes_located_in_edges() -> None:
    _, edges = _fixture_rows()
    assert _pairs(edges, "LOCATED_IN") == {
        (_HOUSE, _BELLEVUE),
        (_WAREHOUSE, _MARCHAND),
        (_BAKERY, _BELLEVUE),
    }


def test_truth_causal_chain_becomes_caused_by_edges() -> None:
    _, edges = _fixture_rows()
    # Canonical order (effect, cause). Both stored directions are read:
    # t2.causedByTruthIds names t1, and t1.causesTruthIds names t3.
    assert _pairs(edges, "CAUSED_BY") == {(_REBUILD, _FLOOD), (_MILL, _FLOOD)}


def test_a_world_without_causal_fields_emits_no_causality_edges(
    tmp_path: Path,
) -> None:
    # Insimul does not ship causesTruthIds/causedByTruthIds on TruthIR yet — the
    # fields are read forward-compatibly, so their absence must be a no-op.
    document = json.loads(FIXTURE_WORLD.read_text(encoding="utf-8"))
    for truth in document["ir"]["systems"]["truths"]:
        truth.pop("causesTruthIds", None)
        truth.pop("causedByTruthIds", None)
    path = tmp_path / "world.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    nodes, edges = _normalize(_spec(str(path)))
    assert _pairs(edges, "CAUSED_BY") == set()
    # The truths themselves still land as nodes.
    assert _FLOOD in _by_csid(nodes)


def test_every_emitted_edge_type_is_a_registered_ontology_type() -> None:
    _, edges = _fixture_rows()
    assert edges
    for edge in edges:
        assert is_registered(str(edge[":TYPE"]))


def test_no_edge_dangles_outside_the_ingested_world() -> None:
    nodes, edges = _fixture_rows()
    csids = set(_by_csid(nodes))
    for edge in edges:
        assert edge[":START_ID"] in csids
        assert edge[":END_ID"] in csids


# --- the synthetic trust tier ------------------------------------------------


def test_every_ingested_record_lands_in_the_synthetic_tier() -> None:
    nodes, edges = _fixture_rows()
    for row in [*nodes, *edges]:
        assert classify_tier(row) == TIER_SYNTHETIC


def test_the_synthetic_tier_wins_over_a_citation_and_a_qid() -> None:
    # A world row carries a real `source_url` and would otherwise auto-admit as
    # though it described the world; the source token decides first.
    row: Row = {
        ":LABEL": ["Character"],
        "source": "insimul",
        "source_url": "insimul:world:w-laterre",
        "wikidata_qid": "Q42",
    }
    assert classify_tier(row) == TIER_SYNTHETIC


# --- idempotent re-ingest ----------------------------------------------------


def test_re_ingesting_the_same_world_yields_byte_identical_rows(
    tmp_path: Path,
) -> None:
    spec = _spec(str(FIXTURE_WORLD))
    first = _written(spec, tmp_path / "one")
    second = _written(spec, tmp_path / "two")
    assert sorted(first) == sorted(second)
    assert first
    for name, payload in first.items():
        assert second[name] == payload, f"{name} is not reproducible"


def _written(spec: CategorySpec, out_dir: Path) -> dict[str, bytes]:
    """``<kind>/<file>`` → bytes for a full normalize + write of *spec*."""
    node_files, edge_files = write_result(
        normalize_records(_fetch(spec), spec), out_dir
    )
    return {
        f"{path.parent.name}/{path.name}": path.read_bytes()
        for path in [*node_files, *edge_files]
    }


def test_a_copied_world_export_mints_the_same_csids(tmp_path: Path) -> None:
    # The csid is a pure function of (world id, entity id) — not the file path —
    # so the same artifact re-ingested from anywhere lands on the same nodes.
    copy = tmp_path / "elsewhere.json"
    copy.write_text(FIXTURE_WORLD.read_text(encoding="utf-8"), encoding="utf-8")
    original, _ = _fixture_rows()
    relocated, _ = _normalize(_spec(str(copy)))
    assert sorted(_by_csid(original)) == sorted(_by_csid(relocated))


def test_a_different_world_id_scopes_the_csids_apart(tmp_path: Path) -> None:
    # Insimul entity ids are unique within a world only, so two worlds sharing an
    # id must NOT collide onto one canonical node.
    other = _write_world(tmp_path, worldId="w-other")
    _, _ = _fixture_rows()
    nodes, _ = _normalize(_spec(str(other)))
    assert "cs:character:insimul:w-other:c1" in _by_csid(nodes)
    assert _MARIE not in _by_csid(nodes)


def test_the_ingested_corpus_validates(tmp_path: Path) -> None:
    spec = _spec(str(FIXTURE_WORLD))
    write_result(normalize_records(_fetch(spec), spec), tmp_path / "corpus")
    assert validate_directory(tmp_path / "corpus") == []


# --- world rules -------------------------------------------------------------


def test_world_rules_become_world_scoped_registry_entries() -> None:
    entries = world_rule_entries(read_world_export(FIXTURE_WORLD))
    assert [e.rule_id for e in entries] == [
        f"insimul:{_WORLD}:r-base-inherit",
        f"insimul:{_WORLD}:r-flood-displaces",
        f"insimul:{_WORLD}:r-retired-guild",
    ]
    for entry in entries:
        assert entry.layer == LAYER_INSIMUL_WORLD
        assert entry.source == INSIMUL_SOURCE
        assert entry.source_url == f"insimul:world:{_WORLD}"
        assert entry.version == CONTRACT_VERSION


def test_world_rules_are_flagged_full_prolog_and_never_cross_to_datalog() -> None:
    entries = world_rule_entries(read_world_export(FIXTURE_WORLD))
    for entry in entries:
        # An empty `clause_souffle` IS the full-prolog flag: cuts, negation and
        # rule_likelihood/2 random chance do not cross into constrained Horn.
        assert entry.clause_souffle == ""
        assert entry.clause_prolog
    assert WORLD_RULE_DIALECT == "full-prolog"
    # The fixture's active rule really does carry a cut, so the flag is earned.
    flood = next(e for e in entries if e.rule_id.endswith("r-flood-displaces"))
    assert "!." in flood.clause_prolog


def test_an_inactive_world_rule_is_recorded_but_retired() -> None:
    entries = world_rule_entries(read_world_export(FIXTURE_WORLD))
    by_id = {e.rule_id: e for e in entries}
    assert by_id[f"insimul:{_WORLD}:r-flood-displaces"].status == (
        RuleStatus.ACTIVE.value
    )
    assert by_id[f"insimul:{_WORLD}:r-retired-guild"].status == (
        RuleStatus.RETIRED.value
    )


def test_world_rules_never_enter_the_committed_rules_registry() -> None:
    # The committed registry is a deterministic function of code-resident rule
    # sources; a world's rules arrive as data, one set per ingested artifact.
    assert not any(e.layer == LAYER_INSIMUL_WORLD for e in build_registry())


# --- the hard containment gate ----------------------------------------------


_NODE_HEADER = (
    "csid:ID\t:LABEL\tname\tsource\tsource_url\tretrieved_at\tconfidence:float"
)


def _write_corpus(root: Path, node_files: dict[str, str]) -> Path:
    (root / "nodes").mkdir(parents=True, exist_ok=True)
    (root / "edges").mkdir(parents=True, exist_ok=True)
    for name, text in node_files.items():
        (root / "nodes" / f"{name}.tsv").write_text(text, encoding="utf-8")
    return root


def test_assert_no_synthetic_records_raises_on_a_synthetic_row() -> None:
    with pytest.raises(SyntheticTierContainmentError, match="synthetic-tier"):
        assert_no_synthetic_records(
            [{":LABEL": ["Character"], "source": "insimul"}], context="test export"
        )


def test_assert_no_synthetic_records_is_a_noop_without_synthetic_rows() -> None:
    assert_no_synthetic_records(
        [{":LABEL": ["Place"], "source": "pinakes"}], context="test export"
    )


def test_package_refuses_a_corpus_holding_a_synthetic_record(tmp_path: Path) -> None:
    corpus = _write_corpus(
        tmp_path / "corpus_in",
        {
            "character": f"{_NODE_HEADER}\n"
            f"{_MARIE}\tCharacter\tMarie\tinsimul\tinsimul:world:{_WORLD}"
            "\t2026-07-20T09:15:00+00:00\t0.6"
        },
    )
    with pytest.raises(PackageError, match="synthetic-tier"):
        package_corpus(corpus, tmp_path / "out")


def test_the_public_datalog_program_drops_synthetic_rows() -> None:
    # The Datalog projection is a release path too, so the default (public)
    # program filters every contained tier out. (The personal half of that claim
    # is covered in test_tiers.py, which registers a personal source to test it —
    # pinakes bundles no personal-tier producer.)
    public = tier_row_filter(None)
    assert not public({"source": INSIMUL_SOURCE})
    assert public({"source": "pinakes"})


def test_the_synthetic_tier_scopes_the_datalog_program_to_one_world() -> None:
    scoped = tier_row_filter(SYNTHETIC_TIER)
    assert scoped({"source": INSIMUL_SOURCE})
    assert not scoped({"source": "pinakes"})


def test_an_unknown_datalog_tier_is_rejected() -> None:
    with pytest.raises(DatalogExportError, match="unknown tier"):
        tier_row_filter("curated")


def test_package_still_allows_a_real_world_corpus(tmp_path: Path) -> None:
    corpus = _write_corpus(
        tmp_path / "corpus_in",
        {
            "place": f"{_NODE_HEADER}\n"
            "cs:place:Q1524\tPlace\tAthens\tpinakes\thttps://x"
            "\t2026-01-01T00:00:00+00:00\t1.0"
        },
    )
    assert package_corpus(corpus, tmp_path / "out").archive.exists()


# --- errors ------------------------------------------------------------------


def test_missing_path_is_rejected() -> None:
    with pytest.raises(InsimulExportError, match="no world-export path"):
        _fetch(_spec(None))


def test_an_off_contract_export_is_rejected(tmp_path: Path) -> None:
    path = _write_world(tmp_path, contractVersion="insimul-grounding-v2")
    with pytest.raises(InsimulExportError, match="off-contract"):
        _fetch(_spec(str(path)))


def test_a_world_without_an_id_is_rejected(tmp_path: Path) -> None:
    path = _write_world(tmp_path, worldId="")
    with pytest.raises(InsimulExportError, match="no 'worldId'"):
        _fetch(_spec(str(path)))


def test_a_world_without_an_ir_is_rejected(tmp_path: Path) -> None:
    path = _write_world(tmp_path, ir=None)
    with pytest.raises(InsimulExportError, match="no 'ir' object"):
        _fetch(_spec(str(path)))


def test_a_world_without_an_export_timestamp_is_rejected(tmp_path: Path) -> None:
    # Falling back to a wall clock would silently break re-ingest idempotence.
    path = _write_world(tmp_path, exportedAt="")
    with pytest.raises(InsimulExportError, match="no 'exportedAt'"):
        _fetch(_spec(str(path)))


def test_a_non_utc_export_timestamp_is_rejected(tmp_path: Path) -> None:
    path = _write_world(tmp_path, exportedAt="2026-07-20T09:15:00+02:00")
    with pytest.raises(InsimulExportError, match="not a UTC"):
        _fetch(_spec(str(path)))


def test_a_missing_file_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(InsimulExportError, match="cannot read"):
        _fetch(_spec(str(tmp_path / "absent.json")))


def test_a_non_json_file_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "world.json"
    path.write_text("not json", encoding="utf-8")
    with pytest.raises(InsimulExportError, match="not valid JSON"):
        _fetch(_spec(str(path)))


# ---------------------------------------------------------------------------
# The in-repo bridge mapping (90-repatriate-koine-config US-2)
# ---------------------------------------------------------------------------
#
# The return leg's correspondences are owned by pinakes and live in
# ``contracts/bridge-insimul.json`` — beside the code that performs the crossing,
# not in an external config source. These tests are how the return path
# *exercises* that document: the adapter must emit exactly the canonical types the
# mapping declares for ``return``, and each must resolve in pinakes's own schema.


def _bridge_mapping() -> dict[str, Any]:
    """The in-repo bridge mapping, located through ``pinakes_contracts``.

    No ``parents[n]`` walk and no path outside this repo: the contracts package
    is the single place that knows where the neutral sources live.
    """
    return load_document("bridge-insimul.json")


def _return_rows(kind: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = _bridge_mapping()["rows"]
    return [
        r for r in rows if r["direction"] == "return" and r["canonicalKind"] == kind
    ]


def test_the_bridge_mapping_declares_the_return_leg_this_adapter_implements() -> None:
    mapping = _bridge_mapping()
    ret = next(d for d in mapping["directions"] if d["id"] == "return")
    assert "engine/src/pinakes_engine/acquire/insimul.py" in ret["implementedBy"]
    form = mapping["idSpaces"]["return"]["form"]
    assert form == "cs:<type>:insimul:<worldId>:<entityId>"


def test_the_adapter_emits_exactly_the_node_types_the_bridge_mapping_declares() -> None:
    declared = {t for row in _return_rows("node") for t in row["canonicalTypes"]}
    assert declared == set(insimul.CANONICAL_NODE_TYPES)


def test_the_adapter_emits_exactly_the_edge_types_the_bridge_mapping_declares() -> None:
    declared = {
        canonical_schema.TOKEN_BY_EDGE_TYPE[t]
        for row in _return_rows("edge")
        for t in row["canonicalTypes"]
    }
    assert declared == set(insimul.CANONICAL_EDGE_TYPES)


def test_every_canonical_type_the_bridge_mapping_names_exists_in_the_schema() -> None:
    # The Python half of the "fails on an unmapped type" check: a row naming a
    # type pinakes does not have would resolve to nothing here.
    for row in _bridge_mapping()["rows"]:
        for name in row["canonicalTypes"]:
            if row["canonicalKind"] == "node":
                assert canonical_schema.node_type_by_name(name) is not None, name
            else:
                assert canonical_schema.edge_type_by_name(name) is not None, name


def test_the_returned_rows_are_the_types_the_bridge_mapping_covers() -> None:
    # End-to-end over the committed fixture world: what actually lands is a subset
    # of the declared return leg, never something undeclared.
    records = list(_fetch(_spec(str(FIXTURE_WORLD))))
    labels = {
        canonical_schema.LABEL_BY_NODE_TYPE[t] for t in insimul.CANONICAL_NODE_TYPES
    }
    for record in records:
        fields = record.fields
        if ":LABEL" in fields:
            assert fields[":LABEL"] in labels
        else:
            assert fields[":TYPE"] in set(insimul.CANONICAL_EDGE_TYPES)
