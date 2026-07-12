"""Shared inference-rule library for the Datalog/Prolog export (T5-US-006).

The fact projection (``nodes.py``, ``edges.py``) puts the *raw* graph into logic;
this module adds the layer that makes the logic program worth more than the TSV
it came from. A :class:`Rule` is an engine-neutral, documented template — an
intended meaning, a worked example query, the base predicates it reads, and the
Horn clauses themselves — that *attaches* to any generated program so the same
derived relations are available whichever engine a researcher loads.

Seven rules ship in :data:`RULES`. The first five are closures over the base
ontology (``docs/data-model.md``); the last two port LinguaScrape's cross-domain
and genetic–linguistic correlation logic (T-LS-US-005) so those correlations
become derived, queryable facts over the merged graph:

* :data:`ANCESTOR` — ``ancestor/2``, the transitive closure of ``descends_from``;
* :data:`WITHIN_REGION` — ``within_region/2``, the transitive closure of
  ``located_in``;
* :data:`CONTEMPORARY` — ``contemporary/2``, the symmetric closure of the
  ``contemporary_with`` edge;
* :data:`INFLUENCED_TRANSITIVELY` — ``influenced_transitively/2``, the transitive
  closure of ``derived_from`` ∪ ``influenced_by``;
* :data:`COMPONENT_OF` — ``component_of/2``, the transitive closure of
  ``part_of``;
* :data:`SAME_REGION` — ``same_region/2``, entities that share an enclosing
  region (both ``within_region`` the same place) — the geographic half of the
  cross-domain correlation;
* :data:`GENETIC_LINGUISTIC_CORRELATION` —
  ``genetic_linguistic_correlation/2``, a haplogroup and a language correlated
  by originating from / being spoken in the same region (the symbolic core of
  LinguaScrape's genetic–linguistic correlation; the numeric overlap score stays
  a CPU-domain computation in the TypeScript engine).

**Why one clause text serves both dialects.** A pure Horn rule — a head and a
body of positive literals over *variables* — is written identically in ISO-Prolog
and in Soufflé: ``ancestor(X, Y) :- descends_from(X, Y).`` parses in both. The
dialects diverge only on *constants* (atom quoting), and rules contain none, so
:attr:`Rule.clauses` is shared verbatim. The engines still need different
scaffolding around the clauses — Prolog wants ``:- dynamic``/``:- discontiguous``
directives, Soufflé wants ``.decl``/``.output`` — which the emitters
(``prolog.py``, ``souffle.py``) add using :func:`rule_signatures` and the
predicate names below. :func:`render_rule` renders one rule's documentation block
and clauses for a chosen :class:`~culturescrape.datalog.Dialect`.

Every rule relation is **binary** over csids, so a single :data:`ARITY` and the
Soufflé attribute type ``symbol`` describe them all; that assumption lives here
(in :data:`ARITY`) rather than being scattered through the emitters.
"""

from __future__ import annotations

import textwrap
from collections.abc import Iterable
from dataclasses import dataclass

from culturescrape.datalog import Dialect

#: Arity shared by every derived and base predicate the rules touch. They all
#: relate two csids (``ancestor(Lang, Ancestor)``, ``within_region(X, Region)``,
#: …), so the emitters can declare them uniformly without per-rule arity data.
ARITY = 2


@dataclass(frozen=True)
class Rule:
    """One named inference rule: a documented template of Horn clauses.

    *name* is the derived (binary) predicate the rule defines. *intent* is a
    prose statement of what the relation means; *example* is a worked example
    query with its expected answers. *depends* names the base predicates the
    body reads (so an emitter can declare them even when the current graph has no
    such facts). *clauses* are the Horn clauses themselves, shared verbatim by
    both dialects (see the module docstring).
    """

    name: str
    intent: str
    example: str
    depends: tuple[str, ...]
    clauses: tuple[str, ...]


ANCESTOR = Rule(
    name="ancestor",
    intent=(
        "ancestor(X, Y): language Y is an ancestor of language X — the "
        "transitive closure of descends_from/2. A language descends from its "
        "parent, that parent from a grandparent, and so on; ancestor/2 collapses "
        "the whole chain so a single query reaches every forebear, not just the "
        "immediate parent."
    ),
    example=(
        "?- ancestor('cs:lang:spa', X).   % every ancestor of Spanish\n"
        "Following descends_from('cs:lang:spa', 'cs:lang:lat') and "
        "descends_from('cs:lang:lat', 'cs:lang:itc') yields\n"
        "X = 'cs:lang:lat' ; X = 'cs:lang:itc'."
    ),
    depends=("descends_from",),
    clauses=(
        "ancestor(X, Y) :- descends_from(X, Y).",
        "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y).",
    ),
)

WITHIN_REGION = Rule(
    name="within_region",
    intent=(
        "within_region(X, Y): X lies within region Y, directly or through a "
        "chain of located_in/2 containments — the transitive closure of "
        "located_in/2. A dish located in a city that is located in a country is "
        "thereby within that country, so one query gathers every enclosing place."
    ),
    example=(
        "?- within_region('cs:dish:Q42', X).   % every region containing the dish\n"
        "With located_in('cs:dish:Q42', 'cs:place:Q123') and "
        "located_in('cs:place:Q123', 'cs:place:Q200') yields\n"
        "X = 'cs:place:Q123' ; X = 'cs:place:Q200'."
    ),
    depends=("located_in",),
    clauses=(
        "within_region(X, Y) :- located_in(X, Y).",
        "within_region(X, Y) :- located_in(X, Z), within_region(Z, Y).",
    ),
)

CONTEMPORARY = Rule(
    name="contemporary",
    intent=(
        "contemporary(X, Y): X and Y overlap in time — the symmetric closure of "
        "the contemporary_with/2 edge. The source edge records the relation in "
        "one direction only; contemporary/2 adds the mirror so the relation can "
        "be queried from either endpoint. It is deliberately a new predicate, not "
        "a rule on contemporary_with/2 itself, so the closure stays terminating "
        "in Prolog (a self-mirroring clause would loop) while agreeing with "
        "Soufflé."
    ),
    example=(
        "?- contemporary('cs:dish:Q42', X).   % everything contemporaneous\n"
        "Given the single edge contemporary_with('cs:battle:Q47', 'cs:dish:Q42'), "
        "contemporary('cs:dish:Q42', 'cs:battle:Q47') holds even though no edge "
        "was stored in that direction, yielding X = 'cs:battle:Q47'."
    ),
    depends=("contemporary_with",),
    clauses=(
        "contemporary(X, Y) :- contemporary_with(X, Y).",
        "contemporary(X, Y) :- contemporary_with(Y, X).",
    ),
)

INFLUENCED_TRANSITIVELY = Rule(
    name="influenced_transitively",
    intent=(
        "influenced_transitively(X, Y): Y is a direct or indirect cultural "
        "forebear of X — the transitive closure of the union of derived_from/2 "
        "and influenced_by/2. Either an artifact deriving from an ancestor or an "
        "entity influenced by another counts as one step, so the predicate "
        "follows mixed lineage-and-influence chains of any length."
    ),
    example=(
        "?- influenced_transitively('cs:dish:Q99', X).   % the whole influence chain\n"
        "With derived_from('cs:dish:Q99', 'cs:dish:Q42') and "
        "influenced_by('cs:dish:Q42', 'cs:dish:Q07') yields\n"
        "X = 'cs:dish:Q42' ; X = 'cs:dish:Q07'."
    ),
    depends=("derived_from", "influenced_by"),
    clauses=(
        "influenced_transitively(X, Y) :- derived_from(X, Y).",
        "influenced_transitively(X, Y) :- influenced_by(X, Y).",
        "influenced_transitively(X, Y) :- derived_from(X, Z), "
        "influenced_transitively(Z, Y).",
        "influenced_transitively(X, Y) :- influenced_by(X, Z), "
        "influenced_transitively(Z, Y).",
    ),
)

COMPONENT_OF = Rule(
    name="component_of",
    intent=(
        "component_of(X, Y): X is a component of whole Y, directly or through a "
        "chain of part_of/2 containments — the transitive closure of part_of/2. A "
        "piston that is part of an engine that is part of a car is thereby a "
        "component of the car, so one query gathers every enclosing whole."
    ),
    example=(
        "?- component_of('cs:part:Q11', X).   % every whole containing the part\n"
        "With part_of('cs:part:Q11', 'cs:part:Q12') and "
        "part_of('cs:part:Q12', 'cs:part:Q13') yields\n"
        "X = 'cs:part:Q12' ; X = 'cs:part:Q13'."
    ),
    depends=("part_of",),
    clauses=(
        "component_of(X, Y) :- part_of(X, Y).",
        "component_of(X, Y) :- part_of(X, Z), component_of(Z, Y).",
    ),
)

SAME_REGION = Rule(
    name="same_region",
    intent=(
        "same_region(X, Y): X and Y sit within a common region — both reach the "
        "same enclosing place through within_region/2 (the transitive closure of "
        "located_in). It is the geographic half of LinguaScrape's cross-domain "
        "correlation: entities co-located in one region are candidates to be "
        "correlated across dimensions. The relation is reflexive (a node shares "
        "its own region) and symmetric, so a caller filters X = Y when only "
        "distinct pairs are wanted."
    ),
    example=(
        "?- same_region('cs:dish:Q42', X).   % everything sharing the dish's region\n"
        "With located_in('cs:dish:Q42', 'cs:place:Q123') and "
        "located_in('cs:culture:Q7', 'cs:place:Q123'), both lie within Q123, so\n"
        "X = 'cs:dish:Q42' ; X = 'cs:culture:Q7'."
    ),
    depends=("within_region",),
    clauses=("same_region(X, Y) :- within_region(X, R), within_region(Y, R).",),
)

GENETIC_LINGUISTIC_CORRELATION = Rule(
    name="genetic_linguistic_correlation",
    intent=(
        "genetic_linguistic_correlation(H, L): a genetic entity H (a haplogroup) "
        "and a linguistic entity L (a language or language family) are correlated "
        "because H originates from the same region L is spoken in — the symbolic "
        "core of LinguaScrape's genetic–linguistic correlation. The numeric "
        "overlap score (region-polygon intersection, notable divergences) stays a "
        "CPU-domain computation in the TypeScript engine; the logic layer derives "
        "only the qualitative pairing, so one query surfaces every "
        "genetics/language co-occurrence over the merged graph."
    ),
    example=(
        "?- genetic_linguistic_correlation('cs:haplogroup:r1b', L).\n"
        "With originates_from('cs:haplogroup:r1b', 'cs:place:western-europe') and "
        "spoken_in('cs:language:proto-celtic', 'cs:place:western-europe') yields\n"
        "L = 'cs:language:proto-celtic'."
    ),
    depends=("originates_from", "spoken_in"),
    clauses=(
        "genetic_linguistic_correlation(X, Y) :- "
        "originates_from(X, R), spoken_in(Y, R).",
    ),
)

#: The shared rule library, attached to a program by passing it as ``rules=`` to
#: the emitters (:func:`culturescrape.datalog.render_program`,
#: :func:`culturescrape.datalog.render_souffle_program`).
RULES: tuple[Rule, ...] = (
    ANCESTOR,
    WITHIN_REGION,
    CONTEMPORARY,
    INFLUENCED_TRANSITIVELY,
    COMPONENT_OF,
    SAME_REGION,
    GENETIC_LINGUISTIC_CORRELATION,
)


def is_recursive(rule: Rule) -> bool:
    """Whether *rule*'s head predicate appears in any of its own clause bodies.

    A recursive rule is a transitive/fixpoint closure (``ancestor`` reads
    ``ancestor``, ``within_region`` reads ``within_region``, …). Naive Prolog
    (SLD) evaluation of such a rule does **not terminate** when the base relation
    contains a cycle — ``descends_from`` carries a data-error cycle and
    ``influenced_by`` is legitimately cyclic (mutual influence), so a full
    enumeration of ``ancestor``/``influenced_transitively`` loops forever. The
    Prolog emitter therefore *tables* these predicates (SLG resolution computes
    the least fixpoint and terminates, matching Soufflé's set semantics). A
    non-recursive rule (the symmetric ``contemporary``, the join ``same_region``,
    ``genetic_linguistic_correlation``) terminates without tabling.
    """
    for clause in rule.clauses:
        _head, sep, body = clause.partition(":-")
        if sep and f"{rule.name}(" in body:
            return True
    return False


def tabled_signatures(rules: Iterable[Rule]) -> set[tuple[str, int]]:
    """The ``(predicate, arity)`` of every recursive rule head in *rules*.

    These are the derived predicates the Prolog emitter must declare ``:- table``
    (rather than ``:- dynamic``) so a cyclic base relation cannot make evaluation
    loop. See :func:`is_recursive`.
    """
    return {(rule.name, ARITY) for rule in rules if is_recursive(rule)}


def rule_signatures(rules: Iterable[Rule]) -> set[tuple[str, int]]:
    """The ``(predicate, arity)`` pairs the *rules* define and read.

    Returns the derived head predicates together with every base predicate named
    in :attr:`Rule.depends`, each paired with :data:`ARITY`. The Prolog emitter
    declares all of them ``:- dynamic``/``:- discontiguous`` so a rule body
    calling a base predicate the current graph happens not to populate answers
    ``false`` instead of raising an existence error.
    """
    signatures: set[tuple[str, int]] = set()
    for rule in rules:
        signatures.add((rule.name, ARITY))
        for dependency in rule.depends:
            signatures.add((dependency, ARITY))
    return signatures


def _comment_marker(dialect: Dialect) -> str:
    """The line-comment marker for *dialect* (``%`` Prolog, ``//`` Soufflé)."""
    return "%" if dialect is Dialect.PROLOG else "//"


def render_rule(rule: Rule, dialect: Dialect = Dialect.PROLOG) -> str:
    """Render *rule* as a documented block of clauses for *dialect*.

    The block is the intended meaning and the worked example query as line
    comments (wrapped to stay readable), then the rule's clauses verbatim. The
    clause text is identical across dialects; only the comment marker differs.

        >>> print(render_rule(ANCESTOR).splitlines()[-1])
        ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y).
    """
    marker = _comment_marker(dialect)
    lines: list[str] = [f"{marker} {line}" for line in textwrap.wrap(rule.intent, 74)]
    lines.append(marker)
    lines.append(f"{marker} Example query:")
    for example_line in rule.example.splitlines():
        wrapped = textwrap.wrap(example_line, 72, subsequent_indent="  ") or [""]
        lines += [f"{marker}   {piece}".rstrip() for piece in wrapped]
    lines += list(rule.clauses)
    return "\n".join(lines)


__all__ = [
    "ANCESTOR",
    "ARITY",
    "COMPONENT_OF",
    "CONTEMPORARY",
    "GENETIC_LINGUISTIC_CORRELATION",
    "INFLUENCED_TRANSITIVELY",
    "RULES",
    "SAME_REGION",
    "WITHIN_REGION",
    "Rule",
    "is_recursive",
    "render_rule",
    "rule_signatures",
    "tabled_signatures",
]
