"""Shipped runnable example queries for the symbolic layer (T5-US-009).

The fact projection (``nodes.py``, ``edges.py``) and the rule library
(``rules.py``) make the logic program; this module makes it *usable on day one*.
It pairs worked queries — shipped as ``.pl`` files under ``inputs/datalog-examples`` and
documented in ``docs/datalog.md`` — with a small self-contained dataset
(``inputs/datalog-examples/dataset``) they run against, plus the harness that runs each
query in SWI-Prolog and the offline linter that checks the query files without an
engine installed.

The first four examples cover the base closures the story calls for:

* :data:`ANCESTRY` — ``ancestry-of-dish.pl``: the full ancestry of a dish, via
  the ``influenced_transitively/2`` closure;
* :data:`WITHIN_REGION` — ``entities-within-region.pl``: every entity inside a
  region, via the transitive ``within_region/2`` closure;
* :data:`CONTEMPORARIES` — ``contemporaries-of-event.pl``: the contemporaries of
  an event, via the symmetric ``contemporary/2`` closure;
* :data:`SHORTEST_CHAIN` — ``shortest-influence-chain.pl``: the shortest
  lineage path between two artifacts, reconstructed by iterative deepening over
  ``derived_from/2`` ∪ ``influenced_by/2``.

Four more mirror the new corpus-expansion ``cypher/*.cypher`` queries (T8), one
per domain's signature relationship — each reaching only the typed predicate the
exporter emits for that registered :TYPE:

* :data:`FESTIVALS_IN_PERIOD` — ``festivals-in-period.pl``: practices in a named
  period, via ``part_of_period/2`` (``PART_OF_PERIOD``);
* :data:`GAME_FAMILY_VARIANTS` — ``game-family-variants.pl``: a game's variant
  family, via the symmetric closure of ``variant_of/2`` (``VARIANT_OF``);
* :data:`INVENTION_LINEAGE` — ``invention-lineage.pl``: the derivation tree below
  an invention, via the transitive ``derived_from/2`` (``DERIVED_FROM``) with
  per-row depth;
* :data:`MATERIAL_COMPOSITION` — ``material-composition.pl``: an artifact's
  materials, via ``made_of/2`` (``MADE_OF``).

Two more run over pinakes-origin facts in the merged dataset
(``source: pinakes``), exercising the correlation rules ported from
pinakes (T-LS-US-005):

* :data:`GENETIC_LINGUISTIC_CORRELATION` —
  ``genetic-linguistic-correlation.pl``: the languages a haplogroup correlates
  with, via ``genetic_linguistic_correlation/2`` (shared origin/spoken region);
* :data:`LANGUAGE_DESCENT` — ``language-descent.pl``: a language's full ancestry,
  via the transitive ``ancestor/2`` closure running over pinakes
  ``descends_from`` edges.

One more makes provenance itself a query target (US-004): the ``source/2`` fact
keyed by csid (the queryable form of the trailing ``% source:`` comment) joined to
``node/3`` for the display name —

* :data:`ENTITIES_BY_SOURCE` — ``entities-by-source.pl``: the entities a named
  acquisition source contributed, via ``source/2`` (its edge sibling is
  ``rel_source/4``).

Each query file defines a ``main/0`` that prints its answer rows tab-separated,
so :func:`run_example` can load a generated ``graph.pl`` alongside the file and
collect the result as a set of tuples — the *expected output shape* recorded in
each :class:`Example`. The runnable test (``tests/test_datalog_examples.py``)
skips with a logged reason when ``swipl`` is absent.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from pinakes_engine.datalog.edges import predicate_for_type
from pinakes_engine.datalog.rules import RULES
from pinakes_engine.ontology.registry import relation_types

#: Directory (relative to the repo root) holding the example query files.
EXAMPLES_DIRNAME = "inputs/datalog-examples"

#: The bundled dataset the examples run against, under :data:`EXAMPLES_DIRNAME`.
DATASET_DIRNAME = "dataset"

#: The entry-point predicate every query file defines (printing its answer rows).
ENTRY_POINT = "main"


@dataclass(frozen=True)
class Example:
    """One shipped example query and its expected answer on the dataset.

    *slug* is the query file's stem (``inputs/datalog-examples/<slug>.pl``). *title* and
    *focus* describe it for the docs (the relation or closure it showcases).
    *expected* is the set of answer rows ``main/0`` prints on the bundled dataset,
    one tuple per row — the output shape the harness asserts when ``swipl`` runs.
    """

    slug: str
    title: str
    focus: str
    expected: frozenset[tuple[str, ...]]


ANCESTRY = Example(
    slug="ancestry-of-dish",
    title="Full ancestry of a dish",
    focus="influenced_transitively/2 (transitive derived_from ∪ influenced_by)",
    expected=frozenset(
        {
            ("cs:dish:tiradito",),
            ("cs:dish:ceviche",),
            ("cs:dish:kinilaw",),
        }
    ),
)

WITHIN_REGION = Example(
    slug="entities-within-region",
    title="All entities within a region, transitively",
    focus="within_region/2 (transitive located_in)",
    expected=frozenset(
        {
            ("cs:place:lima",),
            ("cs:dish:ceviche",),
            ("cs:dish:tiradito",),
        }
    ),
)

CONTEMPORARIES = Example(
    slug="contemporaries-of-event",
    title="Contemporaries of an event",
    focus="contemporary/2 (symmetric contemporary_with)",
    expected=frozenset(
        {
            ("cs:event:columbian-exchange",),
            ("cs:dish:ceviche",),
        }
    ),
)

SHORTEST_CHAIN = Example(
    slug="shortest-influence-chain",
    title="Shortest influence chain between two artifacts",
    focus="iterative deepening over derived_from/2 ∪ influenced_by/2",
    expected=frozenset(
        {
            ("cs:dish:nikkei-ceviche", "cs:dish:tiradito", "cs:dish:ceviche"),
        }
    ),
)

FESTIVALS_IN_PERIOD = Example(
    slug="festivals-in-period",
    title="Festivals and traditions belonging to a period",
    focus="part_of_period/2 (PART_OF_PERIOD, single direct hop)",
    expected=frozenset(
        {
            ("cs:festival:holi",),
            ("cs:festival:hanami",),
        }
    ),
)

GAME_FAMILY_VARIANTS = Example(
    slug="game-family-variants",
    title="The variant family of a game",
    focus="variant/2 (symmetric closure of VARIANT_OF)",
    expected=frozenset(
        {
            ("cs:game:shogi",),
            ("cs:game:xiangqi",),
        }
    ),
)

INVENTION_LINEAGE = Example(
    slug="invention-lineage",
    title="The derivation lineage descending from an invention",
    focus="descendant_depth/3 (transitive DERIVED_FROM with depth)",
    expected=frozenset(
        {
            ("cs:invention:mobile-phone", "1"),
            ("cs:invention:smartphone", "2"),
        }
    ),
)

MATERIAL_COMPOSITION = Example(
    slug="material-composition",
    title="The materials an artifact is made of",
    focus="made_of/2 (MADE_OF, single direct hop)",
    expected=frozenset(
        {
            ("cs:material:silk",),
            ("cs:material:cotton",),
        }
    ),
)

GENETIC_LINGUISTIC_CORRELATION = Example(
    slug="genetic-linguistic-correlation",
    title="Genetic–linguistic correlation of a haplogroup",
    focus="genetic_linguistic_correlation/2 (shared origin/spoken region)",
    expected=frozenset(
        {
            ("cs:language:proto-celtic",),
            ("cs:language:gaulish",),
        }
    ),
)

LANGUAGE_DESCENT = Example(
    slug="language-descent",
    title="Full ancestry of a language",
    focus="ancestor/2 (transitive descends_from over pinakes edges)",
    expected=frozenset(
        {
            ("cs:language:proto-celtic",),
            ("cs:language:pie",),
        }
    ),
)

ENTITIES_BY_SOURCE = Example(
    slug="entities-by-source",
    title="The entities a source contributed, by provenance",
    focus="source/2 (queryable provenance keyed by csid), joined to node/3",
    expected=frozenset(
        {
            ("cs:haplogroup:r1b", "Haplogroup R1b"),
            ("cs:language:pie", "Proto-Indo-European"),
            ("cs:language:proto-celtic", "Proto-Celtic"),
            ("cs:language:gaulish", "Gaulish"),
            ("cs:place:western-europe", "Western Europe"),
            ("cs:event:la-tene", "La Tène culture"),
        }
    ),
)

#: The shipped examples, in the order they appear in ``docs/datalog.md``: the
#: four base closures first, then one per-domain query per new corpus-expansion
#: signature relationship (T8 — mirroring the new ``cypher/*.cypher`` queries).
EXAMPLES: tuple[Example, ...] = (
    ANCESTRY,
    WITHIN_REGION,
    CONTEMPORARIES,
    SHORTEST_CHAIN,
    FESTIVALS_IN_PERIOD,
    GAME_FAMILY_VARIANTS,
    INVENTION_LINEAGE,
    MATERIAL_COMPOSITION,
    GENETIC_LINGUISTIC_CORRELATION,
    LANGUAGE_DESCENT,
    ENTITIES_BY_SOURCE,
)

#: Predicates a query file may legitimately reference from the projection: the
#: rule heads, the base predicates the rules read, the typed predicate the
#: exporter emits for every registered edge :TYPE (``predicate_for_type``), and
#: the entity predicates. The linter uses it to flag a query that names no schema
#: predicate at all — so a per-domain query reaching only its registered relation
#: (e.g. ``part_of_period``, ``variant_of``, ``made_of``) still lints clean.
KNOWN_PREDICATES: frozenset[str] = frozenset(
    {rule.name for rule in RULES}
    | {dependency for rule in RULES for dependency in rule.depends}
    | {predicate_for_type(rel.name) for rel in relation_types()}
    | {"node", "instance_of", "subclass_of", "rel", "rel_conf", "located_at"}
    | {"source", "rel_source"}  # queryable provenance facts (US-004)
)

#: A clause that defines the :data:`ENTRY_POINT` predicate (``main :- ...``).
_ENTRY_RE = re.compile(rf"(?m)^{ENTRY_POINT}\b")
#: A line comment running to end of line (Prolog ``%``).
_COMMENT_RE = re.compile(r"%[^\n]*")
_BRACKETS = {")": "(", "]": "["}


def repo_root() -> Path:
    """The repository root (three levels above this package's ``src`` dir)."""
    return Path(__file__).resolve().parents[3]


def examples_dir(root: str | Path | None = None) -> Path:
    """Return the ``inputs/datalog-examples`` directory, defaulting to the repo root."""
    base = Path(root) if root is not None else repo_root()
    return base / EXAMPLES_DIRNAME


def dataset_dir(root: str | Path | None = None) -> Path:
    """Return the bundled example dataset directory the queries run against."""
    return examples_dir(root) / DATASET_DIRNAME


def example_file(slug: str, root: str | Path | None = None) -> Path:
    """Return the ``.pl`` query file for *slug*."""
    return examples_dir(root) / f"{slug}.pl"


def iter_example_files(root: str | Path | None = None) -> list[Path]:
    """Return the shipped ``.pl`` query files, sorted by name."""
    return sorted(examples_dir(root).glob("*.pl"))


def _strip_comments(text: str) -> str:
    return _COMMENT_RE.sub("", text)


def _unbalanced(text: str) -> bool:
    stack: list[str] = []
    for char in _strip_comments(text):
        if char in "([":
            stack.append(char)
        elif char in _BRACKETS:
            if not stack or stack.pop() != _BRACKETS[char]:
                return True
    return bool(stack)


def lint_example(text: str) -> list[str]:
    """Return a list of problems with a query file's *text*; empty means clean.

    The offline counterpart to running the query: it checks the file is
    non-empty, documented (carries a ``%`` comment), defines the ``main/0``
    entry point the harness runs, has balanced brackets, and references at least
    one :data:`KNOWN_PREDICATES` predicate (so a query naming only made-up
    relations is caught even where no engine is installed).
    """
    problems: list[str] = []
    code = _strip_comments(text)
    if not code.strip():
        problems.append("query is empty")
    if "%" not in text:
        problems.append("query has no explanatory comment")
    if not _ENTRY_RE.search(code):
        problems.append(f"query defines no {ENTRY_POINT}/0 entry point")
    if _unbalanced(text):
        problems.append("unbalanced brackets")
    if not any(re.search(rf"\b{p}\b", code) for p in KNOWN_PREDICATES):
        problems.append("query references no known schema predicate")
    return problems


def run_example(
    program: str | Path, query_file: str | Path, *, swipl: str = "swipl"
) -> set[tuple[str, ...]]:
    """Run a query file's ``main/0`` against a generated *program* in SWI-Prolog.

    Loads the *program* (a ``graph.pl`` produced by ``pinakes_engine to-datalog``)
    and *query_file* together in *swipl*, runs ``main/0`` — which prints one
    answer row per line, columns tab-separated — and returns the rows as a set of
    tuples. Raises :class:`RuntimeError` if ``swipl`` exits non-zero, with its
    output attached so a load or query error is visible.
    """
    result = subprocess.run(
        [swipl, "-q", "-g", ENTRY_POINT, "-t", "halt", str(program), str(query_file)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"swipl failed to run {Path(query_file).name} "
            f"(exit {result.returncode}):\n{result.stdout}{result.stderr}"
        )
    return {
        tuple(line.split("\t")) for line in result.stdout.splitlines() if line
    }


__all__ = [
    "ANCESTRY",
    "CONTEMPORARIES",
    "DATASET_DIRNAME",
    "ENTITIES_BY_SOURCE",
    "ENTRY_POINT",
    "EXAMPLES",
    "EXAMPLES_DIRNAME",
    "FESTIVALS_IN_PERIOD",
    "GAME_FAMILY_VARIANTS",
    "GENETIC_LINGUISTIC_CORRELATION",
    "INVENTION_LINEAGE",
    "KNOWN_PREDICATES",
    "LANGUAGE_DESCENT",
    "MATERIAL_COMPOSITION",
    "SHORTEST_CHAIN",
    "WITHIN_REGION",
    "Example",
    "dataset_dir",
    "example_file",
    "examples_dir",
    "iter_example_files",
    "lint_example",
    "repo_root",
    "run_example",
]
