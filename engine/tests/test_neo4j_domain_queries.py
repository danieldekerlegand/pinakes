"""Execute the new per-domain Cypher queries against a fixture graph.

The corpus-expansion story ships one example query per new domain, each
exercising that domain's signature relationship:

* ``invention-lineage.cypher`` — ``DERIVED_FROM`` chains (science / technology);
* ``game-family-variants.cypher`` — ``VARIANT_OF`` families (sports / games);
* ``material-composition.cypher`` — ``MADE_OF`` substance (material culture);
* ``festivals-in-period.cypher`` — ``PART_OF_PERIOD`` calendar slots (living
  traditions).

No live database is available offline, so these tests run the *shipped query
text* over a tiny in-memory property graph with a minimal evaluator
(:class:`_Graph`) and assert the exact rows each query returns. The evaluator
understands only the single-relationship-segment shape these queries use; an
unrecognised query raises rather than passing silently. The companion linter
test (``test_neo4j_queries.py``) separately guarantees every shipped query
references only registered ``:TYPE`` tokens and defined labels.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from math import inf

import pytest

from pinakes_engine.neo4j.queries import iter_queries

# --- A minimal in-memory property graph + single-segment Cypher evaluator ----

#: One node pattern: ``(var:Label {prop: value})`` with optional label/props.
_NODE = r"\(\s*(\w+)\s*(?::(\w+))?\s*(?:\{([^}]*)\})?\s*\)"
#: A node joined to a node by one (optionally variable-length) relationship.
_SEGMENT = re.compile(
    _NODE + r"\s*(<-|-)\[([^\]]*)\]\s*(->|-)\s*" + _NODE,
    re.VERBOSE,
)
_PROP = re.compile(r"(\w+)\s*:\s*(\$\w+|'[^']*')")
_RETURN_ITEM = re.compile(r"(.+?)\s+AS\s+(\w+)", re.IGNORECASE)
_VAR_PROP = re.compile(r"^(\w+)\.(\w+)$")


@dataclass
class _Graph:
    """A property graph of csid-keyed nodes and typed directed edges."""

    nodes: dict[str, dict[str, object]] = field(default_factory=dict)
    labels: dict[str, set[str]] = field(default_factory=dict)
    edges: list[tuple[str, str, str]] = field(default_factory=list)

    def add_node(self, csid: str, label: str, name: str) -> None:
        self.nodes[csid] = {"csid": csid, "name": name}
        self.labels.setdefault(csid, set()).update({label, "Entity"})

    def add_edge(self, start: str, rel_type: str, end: str) -> None:
        self.edges.append((start, end, rel_type))

    def run(self, query: str, params: dict[str, object]) -> list[dict[str, object]]:
        """Evaluate the single-segment *query* and return its ordered rows."""
        match, length_var = _parse_match(query)
        rows = self._match_rows(match, params, length_var)
        return _project(query, rows)

    def _match_rows(
        self, m: _Match, params: dict[str, object], length_var: str | None
    ) -> list[dict[str, object]]:
        anchor, free = (m.left, m.right) if m.left.bound else (m.right, m.left)
        left = anchor is m.left
        forward = (left and m.outgoing) or (not left and m.incoming) or m.undirected
        backward = (left and m.incoming) or (not left and m.outgoing) or m.undirected

        start_csid = _value(anchor.value, params)
        rows: list[dict[str, object]] = []
        seen: set[str] = set()
        for end_csid, depth in self._reachable(
            start_csid, m.types, forward, backward, m.min_hops, m.max_hops
        ):
            if free.label and free.label not in self.labels.get(end_csid, set()):
                continue
            if end_csid in seen:
                continue
            seen.add(end_csid)
            binding = {anchor.var: start_csid, free.var: end_csid}
            row: dict[str, object] = {"__bind__": binding}
            if length_var:
                row[length_var] = depth
            rows.append(row)
        return rows

    def _reachable(
        self,
        start: str,
        types: set[str],
        forward: bool,
        backward: bool,
        lo: int,
        hi: float,
    ) -> list[tuple[str, int]]:
        """Simple-path traversal from *start*; yields (node, hop-count) pairs."""
        out: list[tuple[str, int]] = []
        stack = [(start, 0, frozenset({start}))]
        while stack:
            node, depth, path = stack.pop()
            if lo <= depth <= hi and depth > 0:
                out.append((node, depth))
            if depth >= hi:
                continue
            for nxt in self._neighbors(node, types, forward, backward):
                if nxt not in path:
                    stack.append((nxt, depth + 1, path | {nxt}))
        return out

    def _neighbors(
        self, node: str, types: set[str], forward: bool, backward: bool
    ) -> list[str]:
        nbrs: list[str] = []
        for start, end, rel in self.edges:
            if rel not in types:
                continue
            if forward and start == node:
                nbrs.append(end)
            if backward and end == node:
                nbrs.append(start)
        return nbrs


@dataclass
class _Node:
    var: str
    label: str
    value: str | None  # the $param token or 'literal' the node is bound to
    bound: bool


@dataclass
class _Match:
    left: _Node
    right: _Node
    types: set[str]
    outgoing: bool
    incoming: bool
    undirected: bool
    min_hops: int
    max_hops: float


def _node(var: str, label: str, props: str | None) -> _Node:
    prop = _PROP.search(props) if props else None
    value = prop.group(2) if prop else None
    return _Node(var=var, label=label, value=value, bound=value is not None)


def _parse_match(query: str) -> tuple[_Match, str | None]:
    body = re.sub(r"//[^\n]*", "", query)
    seg = _SEGMENT.search(body)
    if not seg:
        raise ValueError("query is not a single-relationship-segment MATCH")
    left = _node(seg.group(1), seg.group(2), seg.group(3))
    right = _node(seg.group(7), seg.group(8), seg.group(9))
    left_conn, rel_body, right_conn = seg.group(4), seg.group(5), seg.group(6)

    rel = rel_body.lstrip(":")
    type_part, _, var_part = rel.partition("*")
    types = set(type_part.split("|"))
    if "*" in rel_body:
        lo_s, _, hi_s = var_part.partition("..")
        lo = int(lo_s) if lo_s else 1
        hi: float = int(hi_s) if hi_s else inf
    else:
        lo = hi = 1

    incoming = left_conn == "<-"
    outgoing = right_conn == "->"
    undirected = not incoming and not outgoing
    length_var = "path" if re.search(r"\bpath\s*=", body) else None
    return (
        _Match(left, right, types, outgoing, incoming, undirected, lo, hi),
        length_var,
    )


def _value(token: str | None, params: dict[str, object]) -> str:
    assert token is not None
    if token.startswith("$"):
        return str(params[token[1:]])
    return token.strip("'")


def _project(query: str, rows: list[dict[str, object]]) -> list[dict[str, object]]:
    return _Projector(query).project(rows)


class _Projector:
    """Render RETURN columns and apply ORDER BY for a parsed query."""

    def __init__(self, query: str) -> None:
        self.query = re.sub(r"//[^\n]*", "", query)

    def project(self, rows: list[dict[str, object]]) -> list[dict[str, object]]:
        return_clause = re.search(
            r"\bRETURN\b(.+?)(?:\bORDER BY\b|;|$)", self.query, re.IGNORECASE | re.S
        )
        assert return_clause
        items = [
            (_RETURN_ITEM.match(part.strip()).group(1).strip(),  # type: ignore[union-attr]
             _RETURN_ITEM.match(part.strip()).group(2))  # type: ignore[union-attr]
            for part in _split_commas(return_clause.group(1))
        ]
        out: list[dict[str, object]] = []
        for row in rows:
            rendered = {alias: self._eval(expr, row) for expr, alias in items}
            rendered["__bind__"] = row["__bind__"]
            out.append(rendered)
        self._sort(out)
        for row in out:
            row.pop("__bind__", None)
        return out

    def _eval(self, expr: str, row: dict[str, object]) -> object:
        expr = expr.strip()
        if expr.lower().startswith("length("):
            return row.get("path")
        prop = _VAR_PROP.match(expr)
        if prop:
            var, attr = prop.group(1), prop.group(2)
            csid = row["__bind__"][var]  # type: ignore[index]
            return _NODE_PROPS[csid][attr]
        raise ValueError(f"unsupported RETURN expression: {expr!r}")

    def _sort(self, rows: list[dict[str, object]]) -> None:
        order = re.search(r"\bORDER BY\b(.+?)(?:;|$)", self.query, re.IGNORECASE | re.S)
        if not order:
            return
        keys = [k.strip().split()[0] for k in _split_commas(order.group(1))]

        def sort_key(row: dict[str, object]) -> tuple[object, ...]:
            values: list[object] = []
            for key in keys:
                prop = _VAR_PROP.match(key)
                if prop:
                    csid = row["__bind__"][prop.group(1)]  # type: ignore[index]
                    val: object = _NODE_PROPS[csid][prop.group(2)]
                else:
                    val = row[key]
                values.append((val is None, val))
            return tuple(values)

        rows.sort(key=sort_key)


def _split_commas(text: str) -> list[str]:
    depth = 0
    parts: list[str] = []
    current = ""
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current)
    return parts


# --- The fixture graph -------------------------------------------------------

#: A flat csid -> properties map the projector reads for RETURN/ORDER BY.
_NODE_PROPS: dict[str, dict[str, object]] = {}


def _build_graph() -> _Graph:
    g = _Graph()
    # Inventions: a DERIVED_FROM lineage rooted at the telephone (a tree).
    g.add_node("cs:invention:telephone", "Entity", "Telephone")
    g.add_node("cs:invention:mobile-phone", "Entity", "Mobile phone")
    g.add_node("cs:invention:rotary-phone", "Entity", "Rotary phone")
    g.add_node("cs:invention:smartphone", "Entity", "Smartphone")
    g.add_edge("cs:invention:mobile-phone", "DERIVED_FROM", "cs:invention:telephone")
    g.add_edge("cs:invention:rotary-phone", "DERIVED_FROM", "cs:invention:telephone")
    g.add_edge("cs:invention:smartphone", "DERIVED_FROM", "cs:invention:mobile-phone")

    # Games: VARIANT_OF is symmetric but not transitive — makruk is a variant of
    # xiangqi, not (directly) of chess, so it must not surface for chess.
    g.add_node("cs:game:chess", "Entity", "Chess")
    g.add_node("cs:game:xiangqi", "Entity", "Xiangqi")
    g.add_node("cs:game:shogi", "Entity", "Shogi")
    g.add_node("cs:game:makruk", "Entity", "Makruk")
    g.add_edge("cs:game:xiangqi", "VARIANT_OF", "cs:game:chess")
    g.add_edge("cs:game:shogi", "VARIANT_OF", "cs:game:chess")
    g.add_edge("cs:game:makruk", "VARIANT_OF", "cs:game:xiangqi")

    # Material culture: a kimono MADE_OF two materials; a sari's edge must not leak.
    g.add_node("cs:clothing:kimono", "Entity", "Kimono")
    g.add_node("cs:clothing:sari", "Entity", "Sari")
    g.add_node("cs:material:silk", "Material", "Silk")
    g.add_node("cs:material:cotton", "Material", "Cotton")
    g.add_edge("cs:clothing:kimono", "MADE_OF", "cs:material:silk")
    g.add_edge("cs:clothing:kimono", "MADE_OF", "cs:material:cotton")
    g.add_edge("cs:clothing:sari", "MADE_OF", "cs:material:silk")

    # Living traditions: festivals PART_OF_PERIOD a season; autumn must not leak.
    g.add_node("cs:period:spring", "Period", "Spring")
    g.add_node("cs:period:autumn", "Period", "Autumn")
    g.add_node("cs:festival:holi", "Entity", "Holi")
    g.add_node("cs:festival:nowruz", "Entity", "Nowruz")
    g.add_node("cs:festival:diwali", "Entity", "Diwali")
    g.add_edge("cs:festival:holi", "PART_OF_PERIOD", "cs:period:spring")
    g.add_edge("cs:festival:nowruz", "PART_OF_PERIOD", "cs:period:spring")
    g.add_edge("cs:festival:diwali", "PART_OF_PERIOD", "cs:period:autumn")

    _NODE_PROPS.clear()
    _NODE_PROPS.update(g.nodes)
    return g


@pytest.fixture
def graph() -> _Graph:
    return _build_graph()


def _query(name: str) -> str:
    for path in iter_queries():
        if path.name == name:
            return path.read_text(encoding="utf-8")
    raise AssertionError(f"shipped query {name} not found")


# --- Per-domain row assertions ----------------------------------------------


def test_invention_lineage_returns_descendants_with_depth(graph: _Graph) -> None:
    rows = graph.run(
        _query("invention-lineage.cypher"),
        {"root_csid": "cs:invention:telephone"},
    )
    assert rows == [
        {"csid": "cs:invention:mobile-phone", "name": "Mobile phone", "depth": 1},
        {"csid": "cs:invention:rotary-phone", "name": "Rotary phone", "depth": 1},
        {"csid": "cs:invention:smartphone", "name": "Smartphone", "depth": 2},
    ]


def test_invention_lineage_is_empty_for_a_leaf(graph: _Graph) -> None:
    rows = graph.run(
        _query("invention-lineage.cypher"),
        {"root_csid": "cs:invention:smartphone"},
    )
    assert rows == []


def test_game_family_variants_are_direct_only(graph: _Graph) -> None:
    rows = graph.run(
        _query("game-family-variants.cypher"),
        {"csid": "cs:game:chess"},
    )
    # shogi and xiangqi are direct variants; makruk (variant of xiangqi) is not.
    assert rows == [
        {"csid": "cs:game:shogi", "name": "Shogi"},
        {"csid": "cs:game:xiangqi", "name": "Xiangqi"},
    ]


def test_material_composition_lists_an_artifacts_materials(graph: _Graph) -> None:
    rows = graph.run(
        _query("material-composition.cypher"),
        {"csid": "cs:clothing:kimono"},
    )
    assert rows == [
        {"csid": "cs:material:cotton", "name": "Cotton"},
        {"csid": "cs:material:silk", "name": "Silk"},
    ]


def test_festivals_in_period_groups_a_season(graph: _Graph) -> None:
    rows = graph.run(
        _query("festivals-in-period.cypher"),
        {"period_csid": "cs:period:spring"},
    )
    # Holi and Nowruz share spring; Diwali (autumn) is excluded.
    assert rows == [
        {"csid": "cs:festival:holi", "name": "Holi"},
        {"csid": "cs:festival:nowruz", "name": "Nowruz"},
    ]
