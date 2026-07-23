"""Offline-capable Datalog/Prolog console for the explorer (T7-US-008).

Mirrors :mod:`culturescrape.explorer.live`: the explorer reads the symbolic layer
the same way it reads Neo4j. It lists the shipped ``datalog/examples/*.pl``
queries with their descriptions, projects the corpus to a ``graph.pl`` on demand,
and runs a selected example — or an ad-hoc ``main/0`` goal — through SWI-Prolog,
reusing :mod:`culturescrape.datalog.examples` for both running and linting.

When ``swipl`` is absent the view still works: the query is linted offline (the
same check the example tests use) and the result explains why it did not run, so
everything is exercisable against the fixture corpus with no engine installed.
"""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from culturescrape.datalog.examples import (
    EXAMPLES,
    iter_example_files,
    lint_example,
    run_example,
)
from culturescrape.datalog.export import (
    DatalogExportError,
    Engine,
    export_dataset,
)


@dataclass(frozen=True)
class DatalogExample:
    """One shipped ``datalog/examples/*.pl`` query, parsed for display.

    *slug* is the query file's stem, *title* and *focus* its documented summary
    (from :data:`culturescrape.datalog.examples.EXAMPLES`), and *source* the full
    query text shown in the console and run on demand.
    """

    slug: str
    title: str
    focus: str
    source: str


@dataclass(frozen=True)
class DatalogOutcome:
    """The result of running (or linting) one query in the console.

    When ``swipl`` ran the query, *ran* is true and *rows* holds the answer rows
    (each a tuple of tab-separated columns) or *error* the failure swipl reported.
    When ``swipl`` is absent, *ran* is false, *reason* explains that, and
    *problems* carries the offline lint findings (empty means it linted clean).
    """

    ran: bool
    rows: tuple[tuple[str, ...], ...]
    problems: tuple[str, ...]
    error: str | None
    reason: str | None


class _Auto:
    """Sentinel for "resolve ``swipl`` from PATH" (distinct from ``None``)."""


_AUTO = _Auto()


def load_examples(root: str | Path | None = None) -> tuple[DatalogExample, ...]:
    """Parse the shipped example query files into displayable examples."""
    meta = {example.slug: example for example in EXAMPLES}
    out: list[DatalogExample] = []
    for path in iter_example_files(root):
        described = meta.get(path.stem)
        out.append(
            DatalogExample(
                slug=path.stem,
                title=described.title if described else path.stem,
                focus=described.focus if described else "",
                source=path.read_text(encoding="utf-8"),
            )
        )
    return tuple(out)


class Datalog:
    """The explorer's handle on the symbolic layer for one corpus.

    Lists the shipped example queries and runs a query — a selected example or an
    ad-hoc goal — against a ``graph.pl`` projected from *corpus_dir* on first use.
    *swipl* defaults to the ``swipl`` on PATH; pass an explicit path to pin it, or
    ``None`` to force the offline (lint-only) path. The projected program lives in
    a temp directory held for the app's lifetime.
    """

    def __init__(
        self,
        corpus_dir: str | Path,
        *,
        swipl: str | None | _Auto = _AUTO,
        examples_root: str | Path | None = None,
    ) -> None:
        self._corpus_dir = Path(corpus_dir)
        self._examples_root = examples_root
        self._swipl: str | None = (
            shutil.which("swipl") if isinstance(swipl, _Auto) else swipl
        )
        self._tmp: tempfile.TemporaryDirectory[str] | None = None
        self._program: Path | None = None

    def available(self) -> bool:
        """True when ``swipl`` is resolvable and queries can actually run."""
        return self._swipl is not None

    def status_message(self) -> str:
        """A one-line, user-facing description of the symbolic backend."""
        if self._swipl is None:
            return (
                "swipl not found — queries are linted offline but not run. Install "
                "SWI-Prolog to run them against a graph.pl projected from this corpus."
            )
        return (
            f"swipl at {self._swipl}; queries run against a "
            "graph.pl projected from this corpus."
        )

    def examples(self) -> tuple[DatalogExample, ...]:
        """The shipped example queries, in documentation order."""
        return load_examples(self._examples_root)

    def example(self, slug: str) -> DatalogExample | None:
        """The shipped example with *slug*, or ``None``."""
        return next((e for e in self.examples() if e.slug == slug), None)

    def _program_path(self) -> Path:
        """Project the corpus to a rule-bearing ``graph.pl`` once, then reuse it."""
        if self._program is None:
            self._tmp = tempfile.TemporaryDirectory(prefix="cs-explorer-datalog-")
            result = export_dataset(
                self._corpus_dir, self._tmp.name, [Engine.SWIPL], include_rules=True
            )
            self._program = result.programs[Engine.SWIPL]
        return self._program

    def run(self, source: str) -> DatalogOutcome:
        """Run *source* (a query defining ``main/0``) against the corpus program.

        Always lints *source* offline first. When ``swipl`` is absent the query is
        not run — the outcome carries the lint findings and a reason. Otherwise the
        query is written beside the projected ``graph.pl`` and run through
        :func:`culturescrape.datalog.examples.run_example`, exactly as a shipped
        example is; a load or query failure is captured as the outcome's *error*.
        """
        problems = tuple(lint_example(source))
        if self._swipl is None:
            return DatalogOutcome(
                ran=False,
                rows=(),
                problems=problems,
                error=None,
                reason=(
                    "swipl not found, so the query was linted offline but not run."
                ),
            )
        try:
            program = self._program_path()
        except DatalogExportError as exc:
            return DatalogOutcome(
                ran=True, rows=(), problems=problems, error=str(exc), reason=None
            )
        with tempfile.NamedTemporaryFile(
            "w", suffix=".pl", dir=program.parent, delete=False, encoding="utf-8"
        ) as handle:
            handle.write(source)
            query_path = Path(handle.name)
        try:
            rows = run_example(program, query_path, swipl=self._swipl)
        except RuntimeError as exc:
            return DatalogOutcome(
                ran=True, rows=(), problems=problems, error=str(exc), reason=None
            )
        finally:
            query_path.unlink(missing_ok=True)
        return DatalogOutcome(
            ran=True,
            rows=tuple(sorted(rows)),
            problems=problems,
            error=None,
            reason=None,
        )


__all__ = [
    "Datalog",
    "DatalogExample",
    "DatalogOutcome",
    "load_examples",
]
