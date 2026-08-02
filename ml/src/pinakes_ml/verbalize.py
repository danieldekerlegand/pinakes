"""Triple-verbalization dataset builder (neurosymbolic roadmap Phase 5, US-002).

Turns the canonical **node** + **edge** export
(``build/corpus/{nodes,edges}/*.tsv``) into natural-language training
examples for LLM fine-tuning: one HF-datasets-compatible JSONL record per fact,
carrying the verbalized statement, the source triple, provenance
(``source``/``source_url``/``source_query``) and the SPDX ``license`` class.

Two example kinds:

* **edge** — a typed ``(head, relation, tail)`` fact verbalized with a template
  chosen deterministically per relation (the typed edge vocabulary makes one or
  more hand-written templates per relation tractable).
* **attribute** — a node's *rich* attribute (a date span or geographic
  coordinates) verbalized on its own, so entities without edges still contribute
  grounded facts.

Everything here is a pure function of the export directory + seed (no wall-clock,
no network, no MLflow), so tests drive it with tiny temp-dir fixtures and the
build is byte-reproducible — a byte-identical corpus is a git no-op on the
committed manifest. The thin CLI + MLflow logging live in
:mod:`pinakes_ml.export_verbalizations`.

Design mirrors :mod:`pinakes_ml.triples`:

* **Derived temporal relations are excluded** (via
  :data:`~pinakes_ml.triples.EXCLUDED_RELATIONS`) — they are Datalog rules
  at query time, not stored facts.
* **Edges dedup on ``(head, relation, tail)``** — the export emits one row per
  supporting datum; a fact is verbalized once. Provenance for the kept example is
  taken from the lexicographically-first supporting row so the choice is stable.
* **Null-placeholder attributes are skipped** — a ``(0, 0)`` coordinate (the
  "null island" default) and a year ``0`` (no such historical year; used as a
  blank sentinel) never produce an example.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from pinakes_ml.triples import EXCLUDED_RELATIONS

# --- Canonical export header columns (shared/canonical-schema.json) -------------

# Node columns.
_NODE_CSID = "csid:ID"
_NODE_NAME = "name"
_NODE_TIME_START = "time_start:int"
_NODE_TIME_END = "time_end:int"
_NODE_LAT = "lat:float"
_NODE_LON = "lon:float"

# Edge columns.
_EDGE_START = ":START_ID"
_EDGE_END = ":END_ID"
_EDGE_TYPE = ":TYPE"

# Provenance columns (present on both node and edge exports).
_PROV_SOURCE = "source"
_PROV_SOURCE_URL = "source_url"
_PROV_SOURCE_QUERY = "source_query"
_PROV_LICENSE = "license"

# Pinned salt for deterministic template selection. A corpus change moves the
# manifest; a reroll never does (same seed ⇒ same template per triple).
DEFAULT_SEED = 20260713

# Synthetic relation tokens for attribute examples (kept distinct from any edge
# :TYPE so the manifest's edge/attribute counts never collide).
DATE_RELATION = "DATED"
COORDINATE_RELATION = "LOCATED_AT"

# One or more templates per edge :TYPE. ``{head}``/``{tail}`` are the node names.
# Every non-derived edge type in shared/canonical-schema.json has an entry; a new
# edge type without a template is caught by the coverage test.
EDGE_TEMPLATES: dict[str, tuple[str, ...]] = {
    "DESCENDS_FROM": (
        "{head} descends from {tail}.",
        "{head} is descended from {tail}.",
    ),
    "SPLIT_FROM": (
        "{head} split from {tail}.",
        "{head} diverged from a common ancestor with {tail}.",
    ),
    "MERGED_WITH": (
        "{head} merged with {tail}.",
    ),
    "INFLUENCED_BY": (
        "{head} was influenced by {tail}.",
        "{head} received influence from {tail}.",
    ),
    "CONQUERED_BY": (
        "{head} was conquered by {tail}.",
    ),
    "ABSORBED_INTO": (
        "{head} was absorbed into {tail}.",
    ),
    "SPOKEN_IN": (
        "{head} is spoken in {tail}.",
    ),
    "LOCATED_IN": (
        "{head} is located in {tail}.",
    ),
    "PART_OF_PERIOD": (
        "{head} falls within the {tail} period.",
    ),
    "BORROWED_FROM": (
        "{head} borrowed a term from {tail}.",
        "A word in {head} was borrowed from {tail}.",
    ),
    "COGNATE_WITH": (
        "{head} is cognate with {tail}.",
        "{head} shares a common ancestral form with {tail}.",
    ),
    "DERIVED_FROM": (
        "{head} is derived from {tail}.",
        "{head} developed out of {tail}.",
    ),
    "SYNCRETIZED_WITH": (
        "{head} was syncretized with {tail}.",
    ),
}

# Attribute templates keyed by synthetic relation. ``{name}``/``{value}`` slots.
ATTRIBUTE_TEMPLATES: dict[str, tuple[str, ...]] = {
    DATE_RELATION: (
        "{name} is dated to around {value}.",
        "{name} dates to approximately {value}.",
    ),
    COORDINATE_RELATION: (
        "{name} is located at approximately {value}.",
        "{name} lies at coordinates {value}.",
    ),
}


@dataclass(frozen=True)
class NodeInfo:
    """The verbalizable facts of one canonical node (name + rich attributes)."""

    csid: str
    name: str
    time_start: int | None
    time_end: int | None
    lat: float | None
    lon: float | None
    source: str
    source_url: str
    source_query: str
    license: str


@dataclass(frozen=True)
class Example:
    """One HF-datasets-compatible training example (a flat, uniform record).

    Flat string/`` `` fields keep the JSONL schema uniform across edge and
    attribute rows so ``datasets.load_dataset("json", …)`` infers one feature set.
    ``head``/``relation``/``tail`` (or ``value`` for attributes) IS the source
    triple in structured form.
    """

    text: str
    kind: str  # "edge" | "attribute"
    relation: str
    head: str  # subject csid
    head_name: str
    tail: str  # object csid ("" for attribute examples)
    tail_name: str  # object name ("" for attribute examples)
    value: str  # attribute value ("" for edge examples)
    template_id: str
    source: str
    source_url: str
    source_query: str
    license: str

    def _sort_key(self) -> tuple[str, ...]:
        return (
            self.kind,
            self.relation,
            self.head,
            self.tail,
            self.value,
            self.template_id,
        )

    def as_json_line(self) -> str:
        """Deterministic single-line JSON (sorted keys, unicode preserved)."""
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)


# --- Formatting helpers --------------------------------------------------------


def _format_year(year: int) -> str:
    """Human year label: positive ⇒ ``N CE``, negative ⇒ ``N BCE``."""
    return f"{year} CE" if year > 0 else f"{abs(year)} BCE"


def _format_span(start: int, end: int | None) -> str:
    """Verbalize a date value — a single year or a ``start to end`` span."""
    if end is not None and end != start:
        return f"{_format_year(start)} to {_format_year(end)}"
    return _format_year(start)


def _format_coordinates(lat: float, lon: float) -> str:
    """Round coordinates to 4 decimals for a stable, readable value."""
    return f"{lat:.4f}, {lon:.4f}"


def _parse_int(cell: str) -> int | None:
    """Parse an int cell; blank or a literal ``0`` sentinel ⇒ ``None``."""
    cell = cell.strip()
    if not cell:
        return None
    try:
        value = int(cell)
    except ValueError:
        return None
    return None if value == 0 else value


def _parse_float(cell: str) -> float | None:
    cell = cell.strip()
    if not cell:
        return None
    try:
        return float(cell)
    except ValueError:
        return None


def _select(templates: tuple[str, ...], key: str, *, seed: int) -> int:
    """Deterministic template index from a stable hash of the fact key."""
    digest = hashlib.sha256(f"{seed}\t{key}".encode()).hexdigest()
    return int(digest, 16) % len(templates)


# --- Parsing -------------------------------------------------------------------


def _read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    """Return ``(header, rows)`` for a TSV; ``([], [])`` for an empty file."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return [], []
    header = lines[0].split("\t")
    rows = [line.split("\t") for line in lines[1:] if line]
    return header, rows


def _cell(row: list[str], idx: int | None) -> str:
    """Safe cell read — blank when the column is absent or the row is short."""
    if idx is None or idx >= len(row):
        return ""
    return row[idx]


def load_nodes(nodes_dir: Path | str) -> dict[str, NodeInfo]:
    """Load every ``nodes/*.tsv`` into a ``csid → NodeInfo`` map.

    Header-driven so column order can't bite us; a node missing name/csid is
    skipped. Iterating sorted files then rows keeps a first-wins choice stable.
    """
    nodes_dir = Path(nodes_dir)
    out: dict[str, NodeInfo] = {}
    for path in sorted(nodes_dir.glob("*.tsv")):
        header, rows = _read_tsv(path)
        if _NODE_CSID not in header or _NODE_NAME not in header:
            continue
        idx = {name: i for i, name in enumerate(header)}
        for row in rows:
            csid = _cell(row, idx.get(_NODE_CSID)).strip()
            name = _cell(row, idx.get(_NODE_NAME)).strip()
            if not csid or not name or csid in out:
                continue
            out[csid] = NodeInfo(
                csid=csid,
                name=name,
                time_start=_parse_int(_cell(row, idx.get(_NODE_TIME_START))),
                time_end=_parse_int(_cell(row, idx.get(_NODE_TIME_END))),
                lat=_parse_float(_cell(row, idx.get(_NODE_LAT))),
                lon=_parse_float(_cell(row, idx.get(_NODE_LON))),
                source=_cell(row, idx.get(_PROV_SOURCE)).strip(),
                source_url=_cell(row, idx.get(_PROV_SOURCE_URL)).strip(),
                source_query=_cell(row, idx.get(_PROV_SOURCE_QUERY)).strip(),
                license=_cell(row, idx.get(_PROV_LICENSE)).strip(),
            )
    return out


@dataclass(frozen=True)
class _EdgeRow:
    head: str
    relation: str
    tail: str
    source: str
    source_url: str
    source_query: str
    license: str


def _read_edge_rows(path: Path) -> list[_EdgeRow]:
    """Parse one ``edges/<rel>.tsv`` into provenance-bearing edge rows."""
    header, rows = _read_tsv(path)
    if not header:
        return []
    try:
        s_idx = header.index(_EDGE_START)
        e_idx = header.index(_EDGE_END)
        t_idx = header.index(_EDGE_TYPE)
    except ValueError as exc:
        raise ValueError(f"{path} is missing a canonical edge header column") from exc
    idx = {name: i for i, name in enumerate(header)}

    out: list[_EdgeRow] = []
    for row in rows:
        head = _cell(row, s_idx).strip()
        tail = _cell(row, e_idx).strip()
        relation = _cell(row, t_idx).strip()
        if not head or not tail or not relation:
            continue
        if relation in EXCLUDED_RELATIONS:
            continue
        out.append(
            _EdgeRow(
                head=head,
                relation=relation,
                tail=tail,
                source=_cell(row, idx.get(_PROV_SOURCE)).strip(),
                source_url=_cell(row, idx.get(_PROV_SOURCE_URL)).strip(),
                source_query=_cell(row, idx.get(_PROV_SOURCE_QUERY)).strip(),
                license=_cell(row, idx.get(_PROV_LICENSE)).strip(),
            )
        )
    return out


def load_edge_rows(edges_dir: Path | str) -> list[_EdgeRow]:
    """Every edge row across ``edges/*.tsv``, sorted so dedup is stable."""
    edges_dir = Path(edges_dir)
    rows: list[_EdgeRow] = []
    for path in sorted(edges_dir.glob("*.tsv")):
        rows.extend(_read_edge_rows(path))
    return sorted(rows, key=lambda r: (r.head, r.relation, r.tail, r.source_query,
                                       r.source_url, r.source))


# --- Example construction ------------------------------------------------------


def _edge_examples(
    edge_rows: list[_EdgeRow],
    nodes: dict[str, NodeInfo],
    *,
    seed: int,
) -> tuple[list[Example], int]:
    """Verbalize distinct ``(head, relation, tail)`` facts. Returns (examples,
    skipped) where ``skipped`` counts facts dropped for an unknown/nameless
    endpoint (no node to name)."""
    seen: set[tuple[str, str, str]] = set()
    examples: list[Example] = []
    skipped = 0
    for row in edge_rows:
        key = (row.head, row.relation, row.tail)
        if key in seen:
            continue
        seen.add(key)
        templates = EDGE_TEMPLATES.get(row.relation)
        head = nodes.get(row.head)
        tail = nodes.get(row.tail)
        if templates is None or head is None or tail is None:
            skipped += 1
            continue
        tpl_key = f"{row.head}\t{row.relation}\t{row.tail}"
        tpl_idx = _select(templates, tpl_key, seed=seed)
        text = templates[tpl_idx].format(head=head.name, tail=tail.name)
        examples.append(
            Example(
                text=text,
                kind="edge",
                relation=row.relation,
                head=row.head,
                head_name=head.name,
                tail=row.tail,
                tail_name=tail.name,
                value="",
                template_id=f"{row.relation.lower()}.{tpl_idx}",
                source=row.source,
                source_url=row.source_url,
                source_query=row.source_query,
                license=row.license,
            )
        )
    return examples, skipped


def _attribute_example(
    node: NodeInfo, relation: str, value: str, *, seed: int
) -> Example:
    templates = ATTRIBUTE_TEMPLATES[relation]
    tpl_idx = _select(templates, f"{node.csid}\t{relation}", seed=seed)
    text = templates[tpl_idx].format(name=node.name, value=value)
    return Example(
        text=text,
        kind="attribute",
        relation=relation,
        head=node.csid,
        head_name=node.name,
        tail="",
        tail_name="",
        value=value,
        template_id=f"{relation.lower()}.{tpl_idx}",
        source=node.source,
        source_url=node.source_url,
        source_query=node.source_query,
        license=node.license,
    )


def _attribute_examples(
    nodes: dict[str, NodeInfo], *, seed: int
) -> list[Example]:
    """Verbalize rich node attributes (date spans, coordinates)."""
    examples: list[Example] = []
    for csid in sorted(nodes):
        node = nodes[csid]
        if node.time_start is not None:
            value = _format_span(node.time_start, node.time_end)
            examples.append(
                _attribute_example(node, DATE_RELATION, value, seed=seed)
            )
        if node.lat is not None and node.lon is not None and not (
            node.lat == 0.0 and node.lon == 0.0
        ):
            value = _format_coordinates(node.lat, node.lon)
            examples.append(
                _attribute_example(node, COORDINATE_RELATION, value, seed=seed)
            )
    return examples


def build_examples(
    export_dir: Path | str, *, seed: int = DEFAULT_SEED
) -> tuple[list[Example], dict[str, int]]:
    """Pure build: load nodes+edges → verbalize → sorted examples + skip counts.

    ``export_dir`` is the canonical export root (containing ``nodes/`` and
    ``edges/``). Output is sorted by :meth:`Example._sort_key` so serialization
    is byte-reproducible.
    """
    export_dir = Path(export_dir)
    nodes = load_nodes(export_dir / "nodes")
    edge_rows = load_edge_rows(export_dir / "edges")
    edge_examples, skipped_edges = _edge_examples(edge_rows, nodes, seed=seed)
    attribute_examples = _attribute_examples(nodes, seed=seed)
    examples = sorted(
        edge_examples + attribute_examples, key=lambda e: e._sort_key()
    )
    return examples, {"unknownEndpointNode": skipped_edges}


# --- Serialization + manifest --------------------------------------------------


def serialize_examples(examples: list[Example]) -> str:
    """Exact JSONL body (one record per line, trailing newline)."""
    if not examples:
        return ""
    return "\n".join(e.as_json_line() for e in examples) + "\n"


def content_hash(examples: list[Example]) -> str:
    """sha256 of the exact JSONL bytes the dataset file will hold."""
    return hashlib.sha256(serialize_examples(examples).encode("utf-8")).hexdigest()


def _counter(values: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def build_manifest(
    examples: list[Example],
    skipped: dict[str, int],
    *,
    seed: int = DEFAULT_SEED,
) -> dict[str, object]:
    """Deterministic manifest: counts per edge type / attribute / template /
    license + the content hash. No wall-clock — a function of the corpus + seed,
    so it is committed to git and snapshot-tested against a fresh build."""
    edges = [e for e in examples if e.kind == "edge"]
    attributes = [e for e in examples if e.kind == "attribute"]
    return {
        "seed": seed,
        "excludedRelations": sorted(EXCLUDED_RELATIONS),
        "counts": {
            "examples": len(examples),
            "edges": len(edges),
            "attributes": len(attributes),
        },
        "edgeCounts": _counter([e.relation for e in edges]),
        "attributeCounts": _counter([e.relation for e in attributes]),
        "templateCounts": _counter([e.template_id for e in examples]),
        "licenseCounts": _counter([e.license or "(none)" for e in examples]),
        "skipped": dict(sorted(skipped.items())),
        "sha256": content_hash(examples),
    }
