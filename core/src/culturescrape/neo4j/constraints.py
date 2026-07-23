"""Generate and apply the Neo4j schema constraints that anchor ``csid`` identity.

Every culture-scrape node carries the shared :data:`ENTITY_LABEL` label in
addition to its per-type labels (``Dish``, ``Sculpture``, ...), because ``csid``
is a *global* primary key — "unique across all nodes" (``docs/data-model.md``) —
and Neo4j uniqueness constraints and indexes always attach to a single label.
Anchoring identity on one base label lets a single constraint enforce ``csid``
uniqueness across the whole graph and lets a single index back the
``MERGE (n:Entity {csid})`` the incremental loader (``load_csv.py``) runs, so
re-imports are index lookups rather than full scans.

This module emits three idempotent statements — a ``csid`` uniqueness constraint
and supporting indexes on ``wikidata_qid`` and ``name`` — to a runnable
``cypher-shell`` script (no live database required), and offers
:func:`apply_constraints` to run them against a connected database via the
optional driver (see :mod:`culturescrape.neo4j`). ``IF NOT EXISTS`` makes every
statement safe to re-run.

On top of the global anchor, :func:`label_constraint_statements` derives a
**per-label** ``csid`` uniqueness constraint (each backed by a per-label ``csid``
lookup index) and a per-label ``name`` index for the concrete node labels a
corpus actually carries (:func:`dataset_node_labels`). These are additive: the
global ``Entity`` constraint remains the primary guarantee, while the per-label
constraints/indexes give label-scoped ``MERGE``/lookup its own backing index.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from culturescrape.neo4j import connect
from culturescrape.neo4j.admin_import import discover_dataset
from culturescrape.schema.tsvio import read_rows

if TYPE_CHECKING:
    from neo4j import Driver

#: Shared base label every node carries; the anchor for the ``csid`` constraint.
ENTITY_LABEL = "Entity"

#: Name of the ``csid`` uniqueness constraint.
CSID_CONSTRAINT = "csid_unique"

#: Name of the ``wikidata_qid`` lookup index.
WIKIDATA_QID_INDEX = "entity_wikidata_qid"

#: Name of the ``name`` lookup index.
NAME_INDEX = "entity_name"

#: Filename of the emitted Cypher script.
SCRIPT_NAME = "neo4j-constraints.cypher"


def constraint_statements() -> tuple[str, ...]:
    """Return the idempotent constraint and index statements, in apply order.

    The uniqueness constraint comes first (it also creates a backing index for
    ``csid``); the explicit ``wikidata_qid`` and ``name`` indexes follow. Every
    statement uses ``IF NOT EXISTS`` so re-running is a no-op.
    """
    return (
        f"CREATE CONSTRAINT {CSID_CONSTRAINT} IF NOT EXISTS\n"
        f"FOR (n:{ENTITY_LABEL}) REQUIRE n.csid IS UNIQUE;",
        f"CREATE INDEX {WIKIDATA_QID_INDEX} IF NOT EXISTS\n"
        f"FOR (n:{ENTITY_LABEL}) ON (n.wikidata_qid);",
        f"CREATE INDEX {NAME_INDEX} IF NOT EXISTS\n"
        f"FOR (n:{ENTITY_LABEL}) ON (n.name);",
    )


def _label_csid_constraint(label: str) -> str:
    """Idempotent per-*label* ``csid`` uniqueness constraint (backs a csid index)."""
    return (
        f"CREATE CONSTRAINT csid_unique_{label} IF NOT EXISTS\n"
        f"FOR (n:{label}) REQUIRE n.csid IS UNIQUE;"
    )


def _label_name_index(label: str) -> str:
    """Idempotent per-*label* ``name`` lookup index."""
    return (
        f"CREATE INDEX {label}_name IF NOT EXISTS\n"
        f"FOR (n:{label}) ON (n.name);"
    )


def label_constraint_statements(labels: Iterable[str]) -> tuple[str, ...]:
    """Return per-label ``csid`` constraints + ``name`` indexes for *labels*.

    For each distinct label (sorted for a deterministic order), a ``csid``
    uniqueness constraint — whose backing index doubles as a label-scoped ``csid``
    lookup key — followed by a ``name`` lookup index. Every statement is
    ``IF NOT EXISTS`` so re-running is a no-op. The global ``Entity`` constraint
    from :func:`constraint_statements` remains the primary uniqueness guarantee;
    these narrow it to the concrete labels the corpus carries.
    """
    statements: list[str] = []
    for label in sorted(set(labels)):
        statements.append(_label_csid_constraint(label))
        statements.append(_label_name_index(label))
    return tuple(statements)


def dataset_node_labels(directory: str | Path) -> tuple[str, ...]:
    """Return the distinct node ``:LABEL`` tokens present under *directory*.

    Reads every ``nodes/*.tsv`` file's ``:LABEL`` cells (a node may carry more
    than one ``;``-separated label) and returns the sorted, de-duplicated set —
    the concrete labels :func:`label_constraint_statements` should constrain.

    Raises:
        AdminImportError: If *directory* holds no ``nodes/*.tsv`` files.
    """
    node_files, _ = discover_dataset(directory)
    labels: set[str] = set()
    for path in node_files:
        _, rows = read_rows(path)
        for row in rows:
            cell = row.get(":LABEL", [])
            if isinstance(cell, list):
                labels.update(str(label) for label in cell)
            elif cell:
                labels.add(str(cell))
    return tuple(sorted(labels))


def all_constraint_statements(directory: str | Path) -> tuple[str, ...]:
    """Return the global constraints/indexes plus the per-label ones for *directory*.

    The global ``Entity`` anchor and its ``wikidata_qid``/``name`` indexes come
    first (see :func:`constraint_statements`), followed by the per-label ``csid``
    constraints and ``name`` indexes for every label the corpus carries.
    """
    return constraint_statements() + label_constraint_statements(
        dataset_node_labels(directory)
    )


def render_script(statements: tuple[str, ...]) -> str:
    """Render *statements* as a runnable ``cypher-shell`` script."""
    return (
        "// Generated by culturescrape: schema constraints and indexes for Neo4j.\n"
        "// Idempotent — IF NOT EXISTS makes re-running a no-op.\n"
        f"// Run with: cypher-shell -f {SCRIPT_NAME}\n\n"
        + "\n\n".join(statements)
        + "\n"
    )


def generate_constraints_script(
    out_dir: str | Path,
    *,
    script_path: str | Path | None = None,
) -> Path:
    """Write the constraint/index Cypher to a runnable script and return its path.

    No live database is touched. The statements are dataset-independent: they
    describe the canonical schema, not a particular set of files.

    Args:
        out_dir: Directory the script is written to.
        script_path: Explicit script path (default: ``<out_dir>/<SCRIPT_NAME>``).
    """
    out_path = Path(out_dir)
    script = Path(script_path) if script_path is not None else out_path / SCRIPT_NAME
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(render_script(constraint_statements()), encoding="utf-8")
    return script


def apply_constraints(
    config: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
    statements: tuple[str, ...] | None = None,
) -> tuple[str, ...]:
    """Apply the constraint/index statements to a connected database.

    Runs each statement in its own session. *statements* defaults to the global
    :func:`constraint_statements`; pass :func:`all_constraint_statements` to also
    apply the per-label constraints/indexes. When *driver* is given it is used
    as-is (and left open for the caller); otherwise a driver is opened from
    *config*/*env* via :func:`culturescrape.neo4j.connect` and closed before
    returning.

    Returns:
        The statements that were executed, in order.
    """
    statements = constraint_statements() if statements is None else statements
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        with handle.session() as session:
            for statement in statements:
                session.run(statement)
    finally:
        if owned:
            handle.close()
    return statements


__all__ = [
    "CSID_CONSTRAINT",
    "ENTITY_LABEL",
    "NAME_INDEX",
    "SCRIPT_NAME",
    "WIKIDATA_QID_INDEX",
    "all_constraint_statements",
    "apply_constraints",
    "constraint_statements",
    "dataset_node_labels",
    "generate_constraints_script",
    "label_constraint_statements",
    "render_script",
]
