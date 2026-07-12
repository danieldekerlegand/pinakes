"""Emit a loadable SWI-Prolog program (``.pl``) from projected facts.

This is the first concrete engine target for the engine-neutral :class:`Fact`
model (``__init__.py``): it serialises a stream of facts into a single ``.pl``
source file a researcher can ``swipl``-load and query interactively.

Two things make a generated file load *cleanly* (no warnings):

* **Directives.** SWI-Prolog warns when clauses of one predicate are not
  contiguous in the source, and raises an existence error for a predicate that
  is queried but has no clauses. We therefore emit, for every predicate/arity
  that appears, a ``:- discontiguous`` directive (facts may be interleaved by
  row) and a ``:- dynamic`` directive (the predicate is known even with zero
  clauses, so an empty relation answers ``false`` instead of erroring).
* **A schema header.** A leading ``%`` comment block documents the predicate
  schema and the csid↔atom convention, so the file is self-describing.

:func:`render_program` builds the program text (handy to parse/assert in tests
without touching disk); :func:`write_program` writes it to a path and returns the
fact count. Facts render via :func:`culturescrape.datalog.render_fact` in the
:data:`~culturescrape.datalog.Dialect.PROLOG` dialect.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import TextIO

from culturescrape.datalog import Dialect, Fact
from culturescrape.datalog.rules import (
    Rule,
    render_rule,
    rule_signatures,
    tabled_signatures,
)

#: The ``%``-comment header documenting the emitted predicate schema. It is
#: static (the full vocabulary the projection can emit) rather than derived from
#: the facts at hand, so the file is self-describing even for a sparse graph.
_HEADER = """\
% culture-scrape — SWI-Prolog fact base
% =====================================
% Auto-generated from the canonical TSV graph (docs/data-model.md); a derived,
% mechanical projection — do not edit by hand.
%
% Predicate schema
% ----------------
%   node(Csid, Type, Name)        entity: csid, primary :LABEL, display name
%   instance_of(Csid, Label)      one per :LABEL (a multi-label node repeats)
%   located_at(Csid, Lat, Lon)    geographic coordinate (floats)
%   <dimension>(Csid, Value)      binary dimension facts, e.g. time_start/2,
%                                 time_end/2, part_of_period/2, language_code/2,
%                                 derived_from/2, ...
%   rel(Type, A, B)               generic edge: type atom + endpoint csids
%   <type>(A, B)                  typed edge, one binary predicate per :TYPE
%                                 (e.g. located_in/2, adjacent_to/2)
%   rel_conf(Type, A, B, Weight)  optional edge weight/confidence (float)
%
% Csids are carried verbatim as single-quoted atoms ('cs:dish:Q42'); the same
% csid always renders to the same atom, so the mapping is reversible.
%
% Load:  swipl this_file.pl
% Query: ?- node(X, 'Dish', Name).
"""


def _signatures(facts: Iterable[Fact]) -> list[tuple[str, int]]:
    """The distinct ``(predicate, arity)`` pairs in *facts*, sorted.

    One directive is emitted per pair, so two predicates sharing a name but
    differing in arity each get their own (correct) declaration.
    """
    return sorted({(fact.predicate, len(fact.args)) for fact in facts})


def _preamble_lines(
    signatures: Iterable[tuple[str, int]], tabled: list[tuple[str, int]]
) -> list[str]:
    """The header + directive lines preceding the fact clauses.

    *signatures* is every ``(predicate, arity)`` the program declares; *tabled*
    is the subset that is recursive (tabled, never dynamic — see below). The
    result is a small list (bounded by the number of predicates, not facts), so
    both the streaming writer and :func:`render_program` build it eagerly.

    Recursive derived predicates (transitive closures) are TABLED, not dynamic.
    SWI-Prolog's naive SLD resolution does not terminate on a closure rule when
    the base relation carries a cycle (descends_from has a data-error cycle;
    influenced_by is legitimately cyclic — mutual influence), so a full
    enumeration of ancestor/influenced_transitively loops. Tabling (SLG
    resolution) computes the least fixpoint and terminates, matching Soufflé's
    set semantics. It is a Prolog-only directive — the shared clause text and the
    Soufflé emitter are untouched — and a tabled predicate must NOT also be
    ``:- dynamic`` (SWI forbids tabling a dynamic procedure).
    """
    tabled_set = set(tabled)
    declared = [sig for sig in signatures if sig not in tabled_set]
    lines = [_HEADER, ""]
    if tabled:
        lines += [f":- table {name}/{arity}." for name, arity in tabled]
        lines.append("")
    if declared:
        lines += [f":- discontiguous {name}/{arity}." for name, arity in declared]
        lines.append("")
        lines += [f":- dynamic {name}/{arity}." for name, arity in declared]
        lines.append("")
    return lines


def _rule_lines(rules: list[Rule]) -> list[str]:
    """The documented ``% Inference rules`` section for *rules* (empty if none)."""
    if not rules:
        return []
    lines = ["", "% Inference rules (derived relations)", "% " + "=" * 35]
    for rule in rules:
        lines.append("")
        lines.append(render_rule(rule, Dialect.PROLOG))
    return lines


def _write_program(handle: TextIO, facts: Iterable[Fact], rules: list[Rule]) -> int:
    """Stream the program for *facts*/*rules* to *handle*; return the fact count.

    *facts* is iterated **twice** — once to collect the ``(predicate, arity)``
    signatures for the directives, once to emit the clauses — so it must be a
    re-iterable source (a list, or the disk-backed stream :func:`collect_facts`
    returns), never a one-shot generator. Only one fact is held in memory at a
    time; the giant program string is never built. Each logical line is written
    followed by ``\\n``, which is byte-for-byte ``"\\n".join(lines) + "\\n"`` —
    exactly what :func:`render_program` produces.
    """
    signatures = sorted(set(_signatures(facts)) | rule_signatures(rules))
    tabled = sorted(tabled_signatures(rules))
    for line in _preamble_lines(signatures, tabled):
        handle.write(line)
        handle.write("\n")
    count = 0
    for fact in facts:
        handle.write(fact.render(Dialect.PROLOG))
        handle.write("\n")
        count += 1
    for line in _rule_lines(rules):
        handle.write(line)
        handle.write("\n")
    return count


def render_program(facts: Iterable[Fact], rules: Iterable[Rule] = ()) -> str:
    """Render *facts* (and optional *rules*) as a loadable SWI-Prolog program.

    The text is the schema header, then ``:- discontiguous`` and ``:- dynamic``
    directives for every predicate/arity present, then one clause per fact in the
    given order. When *rules* are supplied, their derived and base predicates are
    declared alongside the fact predicates (so a rule body over an unpopulated
    base relation answers ``false`` rather than erroring), and a documented
    ``% Inference rules`` section with each rule's clauses follows the facts. The
    result ends with a trailing newline.

    This is the in-memory convenience form (handy in tests); :func:`write_program`
    streams the identical bytes straight to a file for dump-scale graphs.

        >>> facts = [Fact("node", ("cs:dish:Q42", "Dish", "Ceviche"))]
        >>> print(render_program(facts).rstrip().splitlines()[-1])
        node('cs:dish:Q42', 'Dish', 'Ceviche').
    """
    facts = list(facts)
    rules = list(rules)
    signatures = sorted(set(_signatures(facts)) | rule_signatures(rules))
    tabled = sorted(tabled_signatures(rules))
    lines = _preamble_lines(signatures, tabled)
    lines += [fact.render(Dialect.PROLOG) for fact in facts]
    lines += _rule_lines(rules)
    return "\n".join(lines) + "\n"


def write_program(
    path: str | Path, facts: Iterable[Fact], rules: Iterable[Rule] = ()
) -> int:
    """Write a SWI-Prolog program for *facts* to *path*; return the fact count.

    Parent directories are created as needed. The file is streamed line by line
    (:func:`_write_program`) — byte-identical to :func:`render_program` but never
    holding the whole program string in memory — encoded UTF-8 (both SWI-Prolog
    and the renderer pass printable Unicode through verbatim). *facts* is iterated
    twice, so pass a re-iterable source (a list, or :func:`collect_facts`), not a
    one-shot generator.
    """
    rules = list(rules)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as handle:
        return _write_program(handle, facts, rules)


__all__ = ["render_program", "write_program"]
