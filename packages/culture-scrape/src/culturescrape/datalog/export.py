"""Turn a whole canonical TSV dataset into a ready-to-load logic program.

One step up from the per-file projectors (``nodes.py``, ``edges.py``) and the
per-engine emitters (``prolog.py``, ``souffle.py``): this module discovers a
dataset's ``nodes/*.tsv`` and ``edges/*.tsv``, projects every row to facts, and
writes the program for one or both engines into an output directory. It is the
work behind the ``culturescrape to-datalog`` command — the single step from
canonical TSV to a logic program a researcher can load and query.

Engine targets are independent and write side by side: SWI-Prolog emits a single
``graph.pl`` (:data:`PROLOG_PROGRAM_NAME`), Soufflé emits ``graph.dl``
(:data:`~culturescrape.datalog.SOUFFLE_PROGRAM_NAME`) plus one ``.facts`` file
per relation. Their filenames never collide, so ``both`` simply runs each into
the same ``--out`` directory. Passing ``--rules`` attaches the shared inference
library (:data:`~culturescrape.datalog.RULES`) to whichever program(s) are
written.
"""

from __future__ import annotations

import enum
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from culturescrape.datalog import Fact, edge_file_facts, node_file_facts
from culturescrape.datalog.constraints import constraint_file_rules
from culturescrape.datalog.file_web import FILE_WEB_RULES
from culturescrape.datalog.problog import (
    PROBLOG_PROGRAM_NAME,
    collect_problog_facts,
    write_problog_program,
)
from culturescrape.datalog.prolog import write_program
from culturescrape.datalog.registry import active_curated_rules
from culturescrape.datalog.rules import Rule
from culturescrape.datalog.schema_constraints import (
    schema_constraint_file_rules,
)
from culturescrape.datalog.schema_constraints import (
    souffle_rules as schema_souffle_rules,
)
from culturescrape.datalog.souffle import SOUFFLE_PROGRAM_NAME, write_souffle_program
from culturescrape.datalog.taxonomy import subclass_file_facts
from culturescrape.schema.tsvio import Row

#: Filename of the generated SWI-Prolog program inside the output directory
#: (parallel to :data:`~culturescrape.datalog.SOUFFLE_PROGRAM_NAME` for Soufflé).
PROLOG_PROGRAM_NAME = "graph.pl"

#: The personal (Analyzer) trust tier — the ``--tier`` token that scopes the export
#: to the local-only file web (asset nodes + grounding edges) and attaches the
#: file-web reasoning rules. Any other tier token is rejected. The privacy
#: invariant (the media-bridge mapping spec §6): a personal-tier fact must NEVER reach the
#: default (public) program, so the default export **filters personal rows out**
#: — the containment gate for this release path (mirrors
#: :func:`culturescrape.orchestrate.tiers.assert_no_personal_records`).
PERSONAL_TIER = "personal"

#: The synthetic (Insimul) trust tier — the ``--tier`` token that scopes the export
#: to a generated world's own subgraph. The containment invariant
#: (INSIMUL_SYNC_PLAN.md §7 "License leakage") is the exact twin of the personal
#: one: a generated-world fact must NEVER reach the default (public) program, so
#: the default export **filters synthetic rows out** too. Unlike the personal tier
#: it attaches no special rule library — a world's own rules are full-prolog and
#: do not cross into Datalog (they ride as ``insimul-world`` rules-registry entries
#: instead; see :func:`culturescrape.acquire.insimul.world_rule_entries`).
SYNTHETIC_TIER = "synthetic"

#: The contained tiers, in ``--tier`` token order: neither reaches the default
#: program, and each can be selected on its own.
CONTAINED_TIERS: tuple[str, ...] = (PERSONAL_TIER, SYNTHETIC_TIER)


class DatalogExportError(ValueError):
    """Raised when a dataset cannot be projected to a logic program."""


def _row_source(row: Row) -> str:
    """The scalar ``source`` provenance cell of *row* (``""`` when absent/list)."""
    value = row.get("source")
    return value if isinstance(value, str) else ""


def tier_row_filter(tier: str | None) -> Callable[[Row], bool]:
    """Build the row-level keep predicate that scopes a projection to *tier*.

    * ``None`` — the **public** program: every row of a *contained* tier is
      dropped and everything else kept, so a corpus that has ingested Analyzer
      file-facts (:data:`~culturescrape.orchestrate.tiers.PERSONAL_SOURCES`) or
      Insimul worlds (:data:`~culturescrape.orchestrate.tiers.SYNTHETIC_SOURCES`)
      still yields a release-safe program with neither in it.
    * :data:`PERSONAL_TIER` — the **local-only** program: only personal rows.
    * :data:`SYNTHETIC_TIER` — the **generated-world** program: only synthetic rows.

    Raises:
        DatalogExportError: for any tier token outside
            :data:`CONTAINED_TIERS` / ``None``.
    """
    # Imported lazily so the datalog package stays free of an import-time edge to
    # orchestrate (orchestrate.corpus imports datalog.export); these read the single
    # PERSONAL_SOURCES / SYNTHETIC_SOURCES sets, so neither source vocabulary is
    # duplicated here.
    from culturescrape.orchestrate.tiers import (
        is_personal_source,
        is_synthetic_source,
    )

    predicates = {
        PERSONAL_TIER: is_personal_source,
        SYNTHETIC_TIER: is_synthetic_source,
    }
    if tier is None:
        return lambda row: not any(
            contained(_row_source(row)) for contained in predicates.values()
        )
    contained_predicate = predicates.get(tier)
    if contained_predicate is None:
        raise DatalogExportError(
            f"unknown tier {tier!r} (the tier-scoped exports are "
            f"{', '.join(repr(t) for t in CONTAINED_TIERS)})"
        )
    return lambda row: contained_predicate(_row_source(row))


class Engine(enum.Enum):
    """A logic engine the projection can target.

    The ``value`` is the ``--engine`` token a user types
    (``swipl``/``souffle``/``problog``); ``both`` on the command line expands to
    the SWI-Prolog + Soufflé pair, not a member here. ProbLog is selected on its
    own (``--engine problog``) — it is the probabilistic on-ramp, not part of the
    default deterministic pair.
    """

    SWIPL = "swipl"
    SOUFFLE = "souffle"
    PROBLOG = "problog"


def engines_for_choice(choice: str) -> tuple[Engine, ...]:
    """Expand an ``--engine`` token into the engines to emit, in stable order.

    ``"swipl"`` / ``"souffle"`` / ``"problog"`` select one engine; ``"both"``
    selects the deterministic pair (SWI-Prolog first, then Soufflé — ProbLog is
    opt-in, not part of ``both``). An unknown token raises.

        >>> engines_for_choice("both")
        (<Engine.SWIPL: 'swipl'>, <Engine.SOUFFLE: 'souffle'>)
    """
    if choice == "both":
        return (Engine.SWIPL, Engine.SOUFFLE)
    try:
        return (Engine(choice),)
    except ValueError:
        raise DatalogExportError(
            f"unknown engine {choice!r} (choose from swipl, souffle, problog, both)"
        ) from None


@dataclass(frozen=True)
class ExportResult:
    """The outcome of exporting a dataset to one or more engines.

    *fact_count* is the number of facts projected (shared by every engine).
    *programs* maps each emitted :class:`Engine` to the program entrypoint
    written for it (the ``graph.pl`` / ``graph.dl`` path).
    """

    fact_count: int
    programs: dict[Engine, Path]

    def load_hint(self, engine: Engine) -> str:
        """A copy-pasteable command to load/run *engine*'s generated program."""
        path = self.programs[engine]
        if engine is Engine.SWIPL:
            return f"swipl {path}"
        if engine is Engine.PROBLOG:
            # ProbLog runs the program (grounding + inference) once a query is
            # added to it; the CLI ships with `pip install problog`.
            return f"problog {path}"
        # Soufflé loads facts from, and writes outputs into, the program's dir.
        directory = path.parent
        return f"souffle {path} -F {directory} -D {directory}"


@dataclass(frozen=True)
class _DatasetFacts:
    """A re-iterable, lazy stream of a dataset's projected facts.

    Iterating it re-reads the files from disk (``nodes/*.tsv`` then
    ``edges/*.tsv``, each in filename order) and yields facts one at a time, so
    the whole corpus is never materialised. It is deliberately re-iterable (each
    ``iter()`` reopens the files): the streaming emitters pass over the facts
    more than once (signatures/types, then rows), and each pass costs a fresh
    disk read rather than a resident fact list.
    """

    node_files: tuple[Path, ...]
    edge_files: tuple[Path, ...]
    #: When set, the committed P279 taxonomy is appended as ``subclass_of/2``
    #: facts (so the class-membership closure rule has its base relation). It is
    #: opt-in — the rule-less export is byte-for-byte unchanged.
    include_taxonomy: bool = False
    #: Optional per-row keep predicate (the tier scope). ``None`` keeps every row,
    #: so the default projection is byte-for-byte unchanged; the tier-scoped export
    #: passes :func:`tier_row_filter`. The taxonomy facts carry no source row, so
    #: they are never filtered.
    keep_row: Callable[[Row], bool] | None = field(default=None)

    def __iter__(self) -> Iterator[Fact]:
        for path in self.node_files:
            yield from node_file_facts(path, keep_row=self.keep_row)
        for path in self.edge_files:
            yield from edge_file_facts(path, keep_row=self.keep_row)
        if self.include_taxonomy:
            yield from subclass_file_facts()


def collect_facts(
    directory: str | Path,
    *,
    include_taxonomy: bool = False,
    keep_row: Callable[[Row], bool] | None = None,
) -> _DatasetFacts:
    """Project every node and edge row under *directory* into a fact stream.

    Discovers ``nodes/*.tsv`` then ``edges/*.tsv`` (each sorted by filename, so
    the output is deterministic) and returns a re-iterable :class:`_DatasetFacts`
    that yields their projected facts lazily — node files first, so
    entity-defining facts precede the edges that reference them. The directory is
    validated eagerly (so a bad dataset fails on the call, not mid-iteration);
    the rows themselves are read only when the stream is iterated, and never held
    whole in memory.

    When *include_taxonomy* is set, the committed Wikidata P279 taxonomy
    (:mod:`culturescrape.datalog.taxonomy`) is appended as ``subclass_of/2`` facts
    so the ``instance_of`` closure rule has its base relation. It is opt-in
    because the ``subclass_of`` facts are only meaningful *with* the rules — the
    default fact stream (and every count pinned against it) is unchanged.

    When *keep_row* is given, each node/edge row is projected only if the
    predicate returns ``True`` — the tier scope (:func:`tier_row_filter`). The
    taxonomy facts are unaffected (they carry no source row). ``None`` keeps every
    row, so the default stream is byte-for-byte unchanged.

    Raises:
        DatalogExportError: If *directory* is not a directory or holds no
            ``nodes/*.tsv`` (a logic program needs at least its entities).
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise DatalogExportError(f"{directory} is not a directory")
    node_files = tuple(sorted((directory / "nodes").glob("*.tsv")))
    edge_files = tuple(sorted((directory / "edges").glob("*.tsv")))
    if not node_files:
        raise DatalogExportError(f"{directory} holds no nodes/*.tsv to project")
    return _DatasetFacts(
        node_files,
        edge_files,
        include_taxonomy=include_taxonomy,
        keep_row=keep_row,
    )


def export_dataset(
    directory: str | Path,
    out: str | Path,
    engines: Iterable[Engine],
    *,
    include_rules: bool = False,
    include_constraints: bool = False,
    include_schema_constraints: bool = False,
    tier: str | None = None,
) -> ExportResult:
    """Export the dataset at *directory* to a logic program under *out*.

    Projects the dataset once (:func:`collect_facts`) and writes a program for
    each engine in *engines* into *out* (created as needed): SWI-Prolog to
    :data:`PROLOG_PROGRAM_NAME`, Soufflé to
    :data:`~culturescrape.datalog.SOUFFLE_PROGRAM_NAME` (plus its ``.facts``
    files). When *include_rules* is set, the shared inference library
    (:data:`~culturescrape.datalog.RULES`) is attached to every program.

    When *include_constraints* is set, the rules translated from Wikidata property
    constraints (:mod:`culturescrape.datalog.constraints`, rules-layer US-002) are
    attached — and, because the subject/value-type integrity rules negate over the
    **transitive** ``instance_of`` membership, the shared rule library (the P279
    closure and its taxonomy facts) is attached alongside them even without
    *include_rules*. The constraint rules are **engine-specific**: SWI-Prolog receives
    only the symmetric derivations (self-recursive, so tabled and terminating), while
    Soufflé also receives the inverse derivations and the subject/value-type integrity
    rules (mutually-recursive inverse pairs and stratified negation are Soufflé's
    domain — see the module docstring). ProbLog is the probabilistic on-ramp and
    receives no constraint rules.

    When *include_schema_constraints* is set, the rules compiled from the canonical
    schema's own edge from/to constraints, csid-uniqueness and declared symmetry
    (:mod:`culturescrape.datalog.schema_constraints`, rules-layer US-003) are attached —
    Soufflé-only (negation-as-failure over the ``instance_of`` closure), so the shared
    rule library and its P279 taxonomy facts are attached alongside them exactly as the
    property-constraint integrity rules require.

    *tier* scopes which trust tier reaches the program (:func:`tier_row_filter`).
    The default (``None``) is the **public** program: personal-tier
    (``source=analyzer``) rows are filtered out, so a corpus that has ingested Analyzer
    file-facts still exports a release-safe program with no personal data — the
    containment gate for this path. ``tier="personal"`` is the **local-only**
    program: only personal-tier rows are projected, and the file-web reasoning
    rules (:data:`~culturescrape.datalog.file_web.FILE_WEB_RULES` — lineage
    transitivity over ``derived_from`` and the ``refers_to``/``co_refers`` join)
    are attached so the ingested file web gains the logic Analyzer never built.

    Raises:
        DatalogExportError: If *engines* is empty, the dataset cannot be read
            (see :func:`collect_facts`), or *tier* is an unknown token.
    """
    engines = tuple(engines)
    if not engines:
        raise DatalogExportError("no engine selected")

    keep_row = tier_row_filter(tier)
    personal = tier == PERSONAL_TIER

    # The taxonomy rides with the rules: subclass_of/2 facts only earn their keep
    # when the instance_of closure rule is attached to consume them — and the
    # integrity rules (property + schema) negate over that same closure, so both
    # kinds of constraint need it too.
    attach_rules = include_rules or include_constraints or include_schema_constraints
    facts = collect_facts(
        directory, include_taxonomy=attach_rules, keep_row=keep_row
    )
    # The curated closures are attached through the rules registry's status gate
    # (rules-layer US-004): only rules whose registry status is ``active`` are emitted,
    # so a retired curated rule is withdrawn without deleting its ``rules.py`` clauses.
    # With the default governance metadata every curated rule is active, so the emitted
    # program is byte-for-byte unchanged.
    base_rules: tuple[Rule, ...] = active_curated_rules() if attach_rules else ()
    # The file-web reasoning rides only with the personal-tier export — never with
    # the public program — so the ingested file web (and only it) gets lineage
    # transitivity and the refers_to/co_refers join.
    file_web_rules: tuple[Rule, ...] = FILE_WEB_RULES if personal else ()
    prolog_rules = base_rules + file_web_rules
    souffle_rules = base_rules + file_web_rules
    if include_constraints:
        translation = constraint_file_rules()
        prolog_rules = base_rules + file_web_rules + translation.prolog_rules()
        souffle_rules = base_rules + file_web_rules + translation.souffle_rules()
    if include_schema_constraints:
        # Soufflé-only: the from/to type, symmetry and csid-uniqueness rules use
        # negation / inequality (see the module docstring). Prolog receives none.
        souffle_rules = souffle_rules + schema_souffle_rules(
            schema_constraint_file_rules()
        )

    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    programs: dict[Engine, Path] = {}
    # Each streaming writer returns the fact count it emitted; every engine sees
    # the same number of edge/node facts, so any one is authoritative (avoids a
    # separate len() pass over the corpus). ProbLog counts one clause per
    # projected fact too — the confidence rides on the edge relation, not as an
    # extra fact — so its count matches the deterministic engines'.
    fact_count = 0
    for engine in engines:
        if engine is Engine.SWIPL:
            program = out_dir / PROLOG_PROGRAM_NAME
            fact_count = write_program(program, facts, prolog_rules)
        elif engine is Engine.PROBLOG:
            program = out_dir / PROBLOG_PROGRAM_NAME
            fact_count = write_problog_program(
                program,
                collect_problog_facts(directory, keep_row=keep_row),
                base_rules + file_web_rules,
            )
        else:
            program = out_dir / SOUFFLE_PROGRAM_NAME
            fact_count = write_souffle_program(out_dir, facts, souffle_rules)
        programs[engine] = program

    return ExportResult(fact_count=fact_count, programs=programs)


__all__ = [
    "CONTAINED_TIERS",
    "PERSONAL_TIER",
    "SYNTHETIC_TIER",
    "PROBLOG_PROGRAM_NAME",
    "PROLOG_PROGRAM_NAME",
    "DatalogExportError",
    "Engine",
    "ExportResult",
    "collect_facts",
    "engines_for_choice",
    "export_dataset",
    "tier_row_filter",
]
