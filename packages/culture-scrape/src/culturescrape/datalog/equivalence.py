"""Cross-engine equivalence check for the Datalog/Prolog export (T5-US-007).

The two emitters (``prolog.py``, ``souffle.py``) project the *same* fact base
and attach the *same* rule library (``rules.py``), so loading either program and
querying a derived relation must yield the *same* tuples. This module turns that
promise into something checkable: it extracts a derived relation's full extension
from each engine as a set of tuples, then compares the two sets and reports any
divergence tuple-by-tuple.

The pieces are deliberately split so the comparison is testable without either
engine installed (the engines are absent in many environments, and the smoke
test skips with a logged reason when they are):

* :func:`prolog_tuples` enumerates a relation by loading the ``.pl`` in ``swipl``
  and printing every solution, one tab-separated tuple per line;
* :func:`run_souffle` runs the ``.dl`` once (materialising every ``.output``
  relation) and :func:`souffle_tuples` reads one relation's ``.csv``;
* :func:`compare_relation` diffs two tuple sets into a :class:`Divergence`, whose
  :meth:`~Divergence.report` names the diverging tuples on each side.

Both engines print a symbolic constant in the same bare form (``cs:lang:spa``,
no quotes) and separate columns with a tab, so the two extractions are directly
comparable as ``set[tuple[str, ...]]``.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

#: A single derived tuple, one string per argument position.
Tuple = tuple[str, ...]


def _enumeration_goal(predicate: str, arity: int) -> str:
    """A ``swipl`` goal that prints every ``predicate/arity`` solution.

    Each solution is written as its arguments separated by tabs and terminated
    by a newline — the same shape Soufflé writes to its ``.csv`` — so the two
    engines' output parses identically. ``write/1`` prints atoms unquoted, so a
    csid carried as the atom ``'cs:lang:spa'`` prints bare as ``cs:lang:spa``.
    """
    variables = [f"V{i}" for i in range(arity)]
    head = f"{predicate}({', '.join(variables)})"
    cells = ", write('\\t'), ".join(f"write({v})" for v in variables)
    return f"forall({head}, ({cells}, nl)), halt"


def _parse_rows(text: str) -> set[Tuple]:
    """Parse tab-separated, newline-terminated *text* into a set of tuples."""
    return {tuple(line.split("\t")) for line in text.splitlines() if line}


def prolog_tuples(
    program: str | Path, predicate: str, arity: int, *, swipl: str = "swipl"
) -> set[Tuple]:
    """The full extension of *predicate*/*arity* from the SWI-Prolog *program*.

    Loads the ``.pl`` at *program* in *swipl* and enumerates every solution of
    the relation, returning them as a set of tuples. Raises :class:`RuntimeError`
    if ``swipl`` exits non-zero (a load error or a failed goal), with its output
    attached so the cause is visible.
    """
    goal = _enumeration_goal(predicate, arity)
    result = subprocess.run(
        [swipl, "-q", "-g", goal, "-t", "halt(1)", str(program)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"swipl failed to enumerate {predicate}/{arity} "
            f"(exit {result.returncode}):\n{result.stdout}{result.stderr}"
        )
    return _parse_rows(result.stdout)


def run_souffle(
    program_dir: str | Path,
    output_dir: str | Path,
    *,
    souffle: str = "souffle",
    program_name: str = "graph.dl",
) -> None:
    """Run the Soufflé program in *program_dir*, writing outputs to *output_dir*.

    Executes ``souffle <program_dir>/<program_name> -F <program_dir> -D
    <output_dir>``, materialising every ``.output`` relation as a ``.csv`` under
    *output_dir*. Raises :class:`RuntimeError` if ``souffle`` exits non-zero.
    """
    program_dir = Path(program_dir)
    result = subprocess.run(
        [
            souffle,
            str(program_dir / program_name),
            "-F",
            str(program_dir),
            "-D",
            str(output_dir),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"souffle failed (exit {result.returncode}):\n"
            f"{result.stdout}{result.stderr}"
        )


def souffle_tuples(output_dir: str | Path, predicate: str) -> set[Tuple]:
    """The materialised extension of *predicate* from a :func:`run_souffle` output.

    Reads ``<output_dir>/<predicate>.csv`` (tab-separated, headerless) into a set
    of tuples. The file is written by Soufflé for every ``.output`` relation, so
    an empty relation yields an empty set rather than a missing file.
    """
    csv = Path(output_dir) / f"{predicate}.csv"
    return _parse_rows(csv.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Divergence:
    """The tuple-level difference between two engines' view of one relation.

    *only_in_prolog* and *only_in_souffle* hold the tuples present in exactly one
    engine's result; both empty means the engines :attr:`agree`.
    """

    predicate: str
    only_in_prolog: frozenset[Tuple]
    only_in_souffle: frozenset[Tuple]

    @property
    def agree(self) -> bool:
        """Whether the two engines produced identical tuple sets."""
        return not self.only_in_prolog and not self.only_in_souffle

    def report(self) -> str:
        """A human-readable account of the divergence (empty string if none).

        Each diverging tuple is listed under the engine that uniquely produced
        it, so a reviewer can see exactly which inferences the engines dispute.
        """
        if self.agree:
            return ""
        lines = [f"{self.predicate}: engines disagree"]
        for label, tuples in (
            ("only in swipl", self.only_in_prolog),
            ("only in souffle", self.only_in_souffle),
        ):
            if tuples:
                lines.append(f"  {label} ({len(tuples)}):")
                lines += [f"    ({', '.join(t)})" for t in sorted(tuples)]
        return "\n".join(lines)


def compare_relation(
    predicate: str, prolog: set[Tuple], souffle: set[Tuple]
) -> Divergence:
    """Diff *predicate*'s extension as seen by Prolog and Soufflé.

    Returns a :class:`Divergence` recording the tuples unique to each side; it
    :attr:`~Divergence.agree`\\ s when the two sets are equal.
    """
    return Divergence(
        predicate=predicate,
        only_in_prolog=frozenset(prolog - souffle),
        only_in_souffle=frozenset(souffle - prolog),
    )


__all__ = [
    "Divergence",
    "Tuple",
    "compare_relation",
    "prolog_tuples",
    "run_souffle",
    "souffle_tuples",
]
