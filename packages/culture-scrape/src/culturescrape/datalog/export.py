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
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from culturescrape.datalog import Fact, edge_file_facts, node_file_facts
from culturescrape.datalog.prolog import write_program
from culturescrape.datalog.rules import RULES, Rule
from culturescrape.datalog.souffle import SOUFFLE_PROGRAM_NAME, write_souffle_program

#: Filename of the generated SWI-Prolog program inside the output directory
#: (parallel to :data:`~culturescrape.datalog.SOUFFLE_PROGRAM_NAME` for Soufflé).
PROLOG_PROGRAM_NAME = "graph.pl"


class DatalogExportError(ValueError):
    """Raised when a dataset cannot be projected to a logic program."""


class Engine(enum.Enum):
    """A logic engine the projection can target.

    The ``value`` is the ``--engine`` token a user types (``swipl``/``souffle``);
    ``both`` on the command line expands to the full pair, not a member here.
    """

    SWIPL = "swipl"
    SOUFFLE = "souffle"


def engines_for_choice(choice: str) -> tuple[Engine, ...]:
    """Expand an ``--engine`` token into the engines to emit, in stable order.

    ``"swipl"`` / ``"souffle"`` select one engine; ``"both"`` selects the pair
    (SWI-Prolog first, then Soufflé). An unknown token raises.

        >>> engines_for_choice("both")
        (<Engine.SWIPL: 'swipl'>, <Engine.SOUFFLE: 'souffle'>)
    """
    if choice == "both":
        return (Engine.SWIPL, Engine.SOUFFLE)
    try:
        return (Engine(choice),)
    except ValueError:
        raise DatalogExportError(
            f"unknown engine {choice!r} (choose from swipl, souffle, both)"
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
        # Soufflé loads facts from, and writes outputs into, the program's dir.
        directory = path.parent
        return f"souffle {path} -F {directory} -D {directory}"


def collect_facts(directory: str | Path) -> list[Fact]:
    """Project every node and edge row under *directory* into facts.

    Reads ``nodes/*.tsv`` then ``edges/*.tsv`` (each sorted by filename, so the
    output is deterministic) and concatenates their projected facts. Node files
    come first so entity-defining facts precede the edges that reference them.

    Raises:
        DatalogExportError: If *directory* is not a directory or holds no
            ``nodes/*.tsv`` (a logic program needs at least its entities).
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise DatalogExportError(f"{directory} is not a directory")
    node_files = sorted((directory / "nodes").glob("*.tsv"))
    edge_files = sorted((directory / "edges").glob("*.tsv"))
    if not node_files:
        raise DatalogExportError(f"{directory} holds no nodes/*.tsv to project")

    facts: list[Fact] = []
    for path in node_files:
        facts.extend(node_file_facts(path))
    for path in edge_files:
        facts.extend(edge_file_facts(path))
    return facts


def export_dataset(
    directory: str | Path,
    out: str | Path,
    engines: Iterable[Engine],
    *,
    include_rules: bool = False,
) -> ExportResult:
    """Export the dataset at *directory* to a logic program under *out*.

    Projects the dataset once (:func:`collect_facts`) and writes a program for
    each engine in *engines* into *out* (created as needed): SWI-Prolog to
    :data:`PROLOG_PROGRAM_NAME`, Soufflé to
    :data:`~culturescrape.datalog.SOUFFLE_PROGRAM_NAME` (plus its ``.facts``
    files). When *include_rules* is set, the shared inference library
    (:data:`~culturescrape.datalog.RULES`) is attached to every program.

    Raises:
        DatalogExportError: If *engines* is empty, or the dataset cannot be read
            (see :func:`collect_facts`).
    """
    engines = tuple(engines)
    if not engines:
        raise DatalogExportError("no engine selected")

    facts = collect_facts(directory)
    rules: tuple[Rule, ...] = RULES if include_rules else ()

    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    programs: dict[Engine, Path] = {}
    for engine in engines:
        if engine is Engine.SWIPL:
            program = out_dir / PROLOG_PROGRAM_NAME
            write_program(program, facts, rules)
        else:
            program = out_dir / SOUFFLE_PROGRAM_NAME
            write_souffle_program(out_dir, facts, rules)
        programs[engine] = program

    return ExportResult(fact_count=len(facts), programs=programs)


__all__ = [
    "PROLOG_PROGRAM_NAME",
    "DatalogExportError",
    "Engine",
    "ExportResult",
    "collect_facts",
    "engines_for_choice",
    "export_dataset",
]
