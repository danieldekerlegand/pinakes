"""Emit a ProbLog probabilistic logic program (``.problog.pl``) from facts.

ProbLog (https://dtai.cs.kuleuven.be/problog/) is Prolog with **annotated
facts**: a fact may carry a probability, written ``0.8::edge(a, b).``. This
module is the third engine target for the engine-neutral :class:`Fact` model
(``__init__.py``) — the probabilistic on-ramp to DeepProbLog, which consumes the
same syntax. Two things distinguish it from the plain SWI-Prolog emitter
(``prolog.py``):

* **Confidence becomes probability.** An edge's ``confidence`` (the strength the
  :class:`~culturescrape.datalog.Fact` companion ``rel_conf/4`` carries) is lifted
  onto the edge relation itself: ``rel(t, A, B)`` and the typed ``t(A, B)`` are
  emitted as annotated facts ``W::rel(t, A, B).``. A confidence of ``1.0`` — or an
  absent one — is a *certain* fact, written unannotated (there is no need to write
  ``1.0::``). Node, dimension and provenance facts are always certain, so they too
  are unannotated. The result is that a ProbLog query returns a marginal
  probability that propagates the graph's per-edge confidences.
* **No Prolog directives.** ProbLog's parser rejects ``:- dynamic`` /
  ``:- discontiguous`` / ``:- table`` (they raise ``ParseError``), so the program
  is *just* a header comment, the facts, and — when ``--rules`` is passed — the
  shared Horn rules. Because ProbLog also raises ``UnknownClause`` when a query
  grounds through a predicate that has **no** clauses, attaching rules additionally
  emits a never-firing stub (``pred(_, _) :- fail.``) for every base predicate the
  rules read, so a query over an unpopulated base relation answers ``false``
  (probability ``0``) rather than erroring — the ProbLog analogue of the SWI
  ``:- dynamic`` declaration.

The Horn rules themselves are ProbLog-compatible *verbatim*: a pure Horn clause
and the comparison guards (``<``, ``>``, ``>=``) the temporal rules use parse and
evaluate identically in ProbLog, so :func:`culturescrape.datalog.render_rule` in
the :data:`~culturescrape.datalog.Dialect.PROLOG` dialect is reused unchanged.

:func:`render_problog_program` builds the program text (handy to parse/assert in
tests); :func:`write_problog_program` streams the byte-identical bytes to a path.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from culturescrape.datalog import DatalogError, Dialect, Fact
from culturescrape.datalog.edges import edge_facts
from culturescrape.datalog.nodes import node_file_facts
from culturescrape.datalog.rules import ARITY, Rule, render_rule
from culturescrape.schema.headers import EdgeSchema
from culturescrape.schema.tsvio import open_rows

#: Filename of the generated ProbLog program inside the output directory. It is
#: deliberately distinct from the SWI-Prolog ``graph.pl`` so both dialects can be
#: written side by side into one ``--out`` without colliding.
PROBLOG_PROGRAM_NAME = "graph.problog.pl"

#: The edge companion facts (``rel_conf/4``, ``rel_source/4``) that ride alongside
#: the edge relation but are *metadata*, not the edge itself, so they stay certain
#: (unannotated) rather than inheriting the edge's confidence.
_EDGE_COMPANIONS = frozenset({"rel_conf", "rel_source"})

#: The ``%``-comment header documenting the ProbLog dialect and how confidence maps
#: to probability. Static (like the SWI-Prolog header) so the file is
#: self-describing even for a sparse graph.
_HEADER = """\
% culture-scrape — ProbLog probabilistic fact base
% ================================================
% Auto-generated from the canonical TSV graph (docs/data-model.md); a derived,
% mechanical projection — do not edit by hand.
%
% ProbLog dialect (https://dtai.cs.kuleuven.be/problog/): Prolog syntax with
% annotated facts. An edge's confidence becomes the fact's probability:
%   0.8::located_in('cs:dish:Q42', 'cs:place:Q123').
% A confidence of 1.0 (or none) is a certain fact, written unannotated. Node,
% dimension and provenance facts are certain. The shared Horn inference rules
% (--rules) are ProbLog-compatible verbatim.
%
% Predicate schema (see graph.pl's header for the full vocabulary):
%   node(Csid, Type, Name)        entity: csid, primary label, display name
%   instance_of(Csid, Label)      one per label
%   <dimension>(Csid, Value)      time_start/2, language_code/2, derived_from/2, ...
%   W::rel(Type, A, B)            generic edge, W = confidence (omitted when 1.0)
%   W::<type>(A, B)               typed edge, one binary predicate per :TYPE
%   rel_conf(Type, A, B, W)       queryable confidence companion (certain)
%   rel_source(Type, A, B, Src)   queryable provenance companion (certain)
%
% Query: add e.g. `query(within_region('cs:dish:Q42', X)).`, then run
%        `problog this_file.problog.pl` (pip install problog).
"""


class ProblogError(DatalogError):
    """Raised when facts cannot be rendered to a valid ProbLog program."""


@dataclass(frozen=True)
class AnnotatedFact:
    """A :class:`Fact` paired with an optional ProbLog probability.

    *probability* is the annotation written before ``::``. ``None`` (or exactly
    ``1.0``) marks a *certain* fact, rendered as a bare clause with no annotation.
    Any other value must lie in ``[0, 1]`` — a real probability — or rendering
    raises :class:`ProblogError`.
    """

    fact: Fact
    probability: float | None = None


def _render_probability(value: float) -> str:
    """Render *value* as a ProbLog probability literal (a decimal float).

    Mirrors the dialect float rules: a digit on each side of the decimal point,
    and a decimal point in the mantissa of any exponent form, so ``repr`` output
    like ``1e-05`` becomes ``1.0e-05``.
    """
    text = repr(float(value))
    mantissa, sep, exponent = text.partition("e")
    if "." not in mantissa:
        mantissa += ".0"
    return f"{mantissa}{sep}{exponent}"


def render_annotated_fact(annotated: AnnotatedFact) -> str:
    """Render *annotated* as a ProbLog clause (annotated iff it is uncertain).

    The clause body is the ordinary :func:`~culturescrape.datalog.render_fact`
    output in the Prolog dialect (single-quoted atoms, a trailing ``% source:``
    comment when the fact carries provenance); a probability other than ``None``
    or ``1.0`` is prefixed as ``W::``.

        >>> render_annotated_fact(
        ...     AnnotatedFact(Fact("rel", ("located_in", "cs:a", "cs:b")), 0.8)
        ... )
        "0.8::rel(located_in, 'cs:a', 'cs:b')."
        >>> render_annotated_fact(AnnotatedFact(Fact("node", ("cs:a", "Dish", "A"))))
        "node('cs:a', 'Dish', 'A')."
    """
    clause = annotated.fact.render(Dialect.PROLOG)
    probability = annotated.probability
    if probability is None or probability == 1.0:
        return clause
    if not 0.0 <= probability <= 1.0:
        raise ProblogError(
            f"confidence {probability!r} for {annotated.fact.predicate!r} is not "
            "a probability in [0, 1]"
        )
    return f"{_render_probability(probability)}::{clause}"


def annotate_edge_group(facts: Iterable[Fact]) -> list[AnnotatedFact]:
    """Annotate one edge row's facts with that edge's confidence.

    *facts* is the group :func:`~culturescrape.datalog.edge_facts` projects from a
    single row — the generic ``rel/3``, the typed ``t/2``, and the optional
    ``rel_conf/4`` / ``rel_source/4`` companions. The confidence carried by
    ``rel_conf/4`` (its last argument) is lifted onto the two edge-relation facts;
    the companions stay certain (metadata about the edge, not the edge itself). A
    group with no ``rel_conf/4`` leaves the edge unannotated (absent confidence →
    certain).
    """
    group = list(facts)
    confidence: float | None = next(
        (float(fact.args[-1]) for fact in group if fact.predicate == "rel_conf"),
        None,
    )
    annotated: list[AnnotatedFact] = []
    for fact in group:
        if fact.predicate in _EDGE_COMPANIONS:
            annotated.append(AnnotatedFact(fact, None))  # certain companion
        else:
            annotated.append(AnnotatedFact(fact, confidence))  # the edge itself
    return annotated


def _problog_edge_file_facts(path: str | Path) -> Iterator[AnnotatedFact]:
    """Stream an edge TSV file, projecting each row to annotated facts.

    Mirrors :func:`~culturescrape.datalog.edge_file_facts` but groups each row's
    facts so the edge's confidence can be lifted onto its relation facts
    (:func:`annotate_edge_group`). The header is validated as an edge schema
    before any row is read, and rows are read one at a time, so a dump-scale file
    never lands whole in memory.
    """
    columns, rows = open_rows(path)
    EdgeSchema(tuple(columns))  # validate the header; raises on a malformed file
    for row in rows:
        yield from annotate_edge_group(edge_facts(row))


@dataclass(frozen=True)
class _ProblogDatasetFacts:
    """A re-iterable, lazy stream of a dataset's projected :class:`AnnotatedFact`.

    Node facts are always certain; edge facts carry their edge's confidence.
    Iterating re-reads the files from disk (``nodes/*.tsv`` then ``edges/*.tsv``,
    each in filename order), so the whole corpus is never materialised — the same
    O(1)-memory property the SWI-Prolog/Soufflé emitters keep.
    """

    node_files: tuple[Path, ...]
    edge_files: tuple[Path, ...]

    def __iter__(self) -> Iterator[AnnotatedFact]:
        for path in self.node_files:
            for fact in node_file_facts(path):
                yield AnnotatedFact(fact, None)
        for path in self.edge_files:
            yield from _problog_edge_file_facts(path)


def collect_problog_facts(directory: str | Path) -> _ProblogDatasetFacts:
    """Project every node and edge row under *directory* into annotated facts.

    Reuses :func:`~culturescrape.datalog.export.collect_facts` for discovery and
    validation (so a bad dataset fails on the call, not mid-iteration) and returns
    a re-iterable :class:`_ProblogDatasetFacts` whose edge facts carry their
    edge's confidence as a ProbLog probability.

    Raises:
        DatalogExportError: If *directory* is not a directory or holds no
            ``nodes/*.tsv`` (see :func:`collect_facts`).
    """
    from culturescrape.datalog.export import collect_facts

    dataset = collect_facts(directory)
    return _ProblogDatasetFacts(dataset.node_files, dataset.edge_files)


def _base_predicate_stubs(rules: list[Rule]) -> list[str]:
    """Never-firing stub clauses for every base predicate the *rules* read.

    ProbLog raises ``UnknownClause`` when a query grounds through a predicate with
    no clauses, and it has no ``:- dynamic`` directive to pre-declare one. So for
    every base predicate a rule body reads that is not itself a rule head, emit
    ``pred(_, _) :- fail.`` — a clause that defines the predicate but never
    succeeds, so a query over an unpopulated base relation answers ``false``
    (probability ``0``) instead of erroring. A populated relation is unaffected:
    its real (probabilistic) facts still fire; the stub never does.
    """
    heads = {rule.name for rule in rules}
    base = {dep for rule in rules for dep in rule.depends} - heads
    args = ", ".join(["_"] * ARITY)
    return [f"{name}({args}) :- fail." for name in sorted(base)]


def _rule_lines(rules: list[Rule]) -> list[str]:
    """The base-relation stubs + documented ``% Inference rules`` section.

    Empty when *rules* is empty. Otherwise the never-firing base-predicate stubs
    (so a query never hits an ``UnknownClause``) precede the documented rule
    clauses, which are ProbLog-compatible verbatim (rendered in the Prolog
    dialect).
    """
    if not rules:
        return []
    lines: list[str] = ["", "% Base-relation declarations (ProbLog has no"]
    lines.append("% :- dynamic; a never-firing stub keeps a query over an")
    lines.append("% unpopulated base relation false instead of raising UnknownClause).")
    lines += _base_predicate_stubs(rules)
    lines += ["", "% Inference rules (derived relations)", "% " + "=" * 35]
    for rule in rules:
        lines.append("")
        lines.append(render_rule(rule, Dialect.PROLOG))
    return lines


def _write_problog(
    handle: TextIO, facts: Iterable[AnnotatedFact], rules: list[Rule]
) -> int:
    """Stream the program for *facts*/*rules* to *handle*; return the fact count.

    ProbLog needs no directive preamble, so *facts* is iterated **once** and only
    one fact is held in memory at a time. Each logical line is written followed by
    ``\\n``, which is byte-for-byte ``"\\n".join(lines) + "\\n"`` — exactly what
    :func:`render_problog_program` produces.
    """
    handle.write(_HEADER)
    handle.write("\n")
    count = 0
    for annotated in facts:
        handle.write(render_annotated_fact(annotated))
        handle.write("\n")
        count += 1
    for line in _rule_lines(rules):
        handle.write(line)
        handle.write("\n")
    return count


def render_problog_program(
    facts: Iterable[AnnotatedFact], rules: Iterable[Rule] = ()
) -> str:
    """Render *facts* (and optional *rules*) as a loadable ProbLog program.

    The text is the schema header, then one clause per fact in the given order
    (an edge annotated ``W::`` when its confidence is neither absent nor ``1.0``),
    then — when *rules* are supplied — a never-firing stub for every base
    predicate the rules read and a documented ``% Inference rules`` section. The
    result ends with a trailing newline. This is the in-memory convenience form
    (handy in tests); :func:`write_problog_program` streams the identical bytes to
    a file.

        >>> facts = [AnnotatedFact(Fact("rel", ("located_in", "cs:a", "cs:b")), 0.8)]
        >>> print(render_problog_program(facts).rstrip().splitlines()[-1])
        0.8::rel(located_in, 'cs:a', 'cs:b').
    """
    facts = list(facts)
    rules = list(rules)
    lines = [_HEADER]
    lines += [render_annotated_fact(annotated) for annotated in facts]
    lines += _rule_lines(rules)
    return "\n".join(lines) + "\n"


def write_problog_program(
    path: str | Path, facts: Iterable[AnnotatedFact], rules: Iterable[Rule] = ()
) -> int:
    """Write a ProbLog program for *facts* to *path*; return the fact count.

    Parent directories are created as needed. The file is streamed line by line
    (:func:`_write_problog`) — byte-identical to :func:`render_problog_program`
    but never holding the whole program string in memory — encoded UTF-8 (ProbLog
    reads UTF-8 source, and the renderer passes printable Unicode through
    verbatim).
    """
    rules = list(rules)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as handle:
        return _write_problog(handle, facts, rules)


__all__ = [
    "PROBLOG_PROGRAM_NAME",
    "AnnotatedFact",
    "ProblogError",
    "annotate_edge_group",
    "collect_problog_facts",
    "render_annotated_fact",
    "render_problog_program",
    "write_problog_program",
]
