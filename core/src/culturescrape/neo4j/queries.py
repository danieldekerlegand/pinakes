"""Locate and lint the example Cypher queries shipped in ``cypher/``.

The example queries (``cypher/*.cypher``) are meant to run as-is against a graph
imported by this package, so they may reference only the vocabulary the schema
defines:

* node :data:`DEFINED_LABELS` — the base ``Entity`` label every node carries
  (:mod:`culturescrape.neo4j.constraints`), the synthesized ``Category`` /
  ``Type`` labels (:mod:`culturescrape.schema.categorize`), and the node kinds
  the ontology draws edges between (the ``domain``/``range`` of every registered
  relation, capitalized);
* relationship :data:`DEFINED_TYPES` — every registered ``:TYPE`` in
  :mod:`culturescrape.ontology.registry`.

:func:`lint_query` is the lightweight linter the acceptance criteria allow in
place of a live-database ``EXPLAIN``: it extracts the ``:Label`` and ``:TYPE``
tokens a query uses and rejects any the schema does not define, and checks the
query is non-empty, documented, and has balanced brackets. :func:`iter_queries`
finds the shipped ``.cypher`` files.
"""

from __future__ import annotations

import re
from pathlib import Path

from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.ontology import registry
from culturescrape.schema.categorize import CATEGORY_LABEL, TYPE_LABEL

#: Directory (relative to the repo root) holding the example query files.
QUERIES_DIRNAME = "cypher"

#: Node labels the schema defines: the base/anchor labels plus the node kinds
#: the ontology relates (each relation ``domain``/``range``, capitalized).
DEFINED_LABELS: frozenset[str] = frozenset(
    {ENTITY_LABEL, CATEGORY_LABEL, TYPE_LABEL}
    | {
        kind.capitalize()
        for rel in registry.relation_types()
        for kind in (rel.domain, rel.range)
    }
)

#: Relationship ``:TYPE`` tokens the schema defines (the whole registry).
DEFINED_TYPES: frozenset[str] = frozenset(registry.REGISTRY)

#: A bracketed relationship pattern body, e.g. the ``...`` in ``-[...]->``.
_REL_BODY = re.compile(r"\[([^\]]*)\]")
#: An upper-snake-case ``:TYPE`` token inside a relationship body.
_TYPE_TOKEN = re.compile(r"[A-Z][A-Z0-9_]+")
#: A ``:Label`` token attached to a node (a colon directly followed by a name).
_LABEL_TOKEN = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")
#: A line comment running to end of line.
_COMMENT = re.compile(r"//[^\n]*")

_BRACKETS = {")": "(", "]": "[", "}": "{"}


def queries_dir(root: str | Path | None = None) -> Path:
    """Return the ``cypher/`` directory, defaulting to the repo root."""
    base = Path(root) if root is not None else Path(__file__).resolve().parents[3]
    return base / QUERIES_DIRNAME


def iter_queries(root: str | Path | None = None) -> list[Path]:
    """Return the shipped ``.cypher`` query files, sorted by name."""
    return sorted(queries_dir(root).glob("*.cypher"))


def _strip_comments(query: str) -> str:
    return _COMMENT.sub("", query)


def relationship_types(query: str) -> set[str]:
    """Return the ``:TYPE`` tokens *query* references (comments ignored)."""
    body = _strip_comments(query)
    types: set[str] = set()
    for segment in _REL_BODY.findall(body):
        _, _, after_colon = segment.partition(":")
        if after_colon:
            types.update(_TYPE_TOKEN.findall(after_colon))
    return types


def node_labels(query: str) -> set[str]:
    """Return the node ``:Label`` tokens *query* references (comments ignored)."""
    # Drop relationship bodies first so their ``:TYPE`` tokens are not counted
    # as labels; what remains are node patterns and property maps.
    body = _REL_BODY.sub("[]", _strip_comments(query))
    return set(_LABEL_TOKEN.findall(body))


def _unbalanced(query: str) -> bool:
    stack: list[str] = []
    for char in _strip_comments(query):
        if char in "([{":
            stack.append(char)
        elif char in _BRACKETS:
            if not stack or stack.pop() != _BRACKETS[char]:
                return True
    return bool(stack)


def lint_query(query: str) -> list[str]:
    """Return a list of problems with *query*; empty means it passes.

    Checks the query is non-empty, carries an explanatory ``//`` comment, has
    balanced brackets, and references only :data:`DEFINED_LABELS` and
    :data:`DEFINED_TYPES`.
    """
    problems: list[str] = []
    if not _strip_comments(query).strip():
        problems.append("query is empty")
    if "//" not in query:
        problems.append("query has no explanatory comment")
    if _unbalanced(query):
        problems.append("unbalanced brackets")
    for label in sorted(node_labels(query) - DEFINED_LABELS):
        problems.append(f"undefined label :{label}")
    for rel_type in sorted(relationship_types(query) - DEFINED_TYPES):
        problems.append(f"undefined relationship type :{rel_type}")
    return problems


__all__ = [
    "DEFINED_LABELS",
    "DEFINED_TYPES",
    "QUERIES_DIRNAME",
    "iter_queries",
    "lint_query",
    "node_labels",
    "queries_dir",
    "relationship_types",
]
