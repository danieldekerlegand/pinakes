"""Engine-free materialisation of the inference rules (T-LS-US-004).

``rules.py`` defines the derived relations (``ancestor``, ``within_region``,
``same_region``, ``genetic_linguistic_correlation``, …) as pure Horn clauses;
``export.py`` attaches them to a program a logic engine loads. But neither
``swipl`` nor ``souffle`` is installed in CI, so the derived facts those rules
*compute* were only ever checked by ad-hoc, per-rule Python in the tests. This
module is the general version: a small, dependency-free Datalog evaluator that
**materialises** every rule's extension over a set of projected :class:`Fact`\\ s
by naive fixpoint, so the four inference targets can be produced, counted, and
validated at scale without an engine.

The evaluator is deliberately narrow to the shape the rule library actually uses:
every *predicate* literal relates two terms (``ARITY == 2``), bodies are positive
Horn goals over variables (a leading upper-case letter or ``_``) and constants,
plus — since T-SR-US-001 — **comparison literals** (``Ex < Sy``, ``Ex >= Sy``).
A comparison is not a predicate goal (it carries no relation, so the arity-2
constraint does not apply to it); it is evaluated as a numeric filter once its
operands are bound by the predicate literals, which is what lets the temporal
rules (``contemporary``/``precedes``/``follows``) derive from ``time_start`` /
``time_end`` facts without a stored edge. The evaluator keeps fact arguments in
their native type (an int year stays an int) so those comparisons are numeric.
It rebuilds a per-predicate index each round and joins body literals by binding
propagation, so a two-literal join
(``same_region(X, Y) :- within_region(X, R), within_region(Y, R)``) is grouped on
the shared region rather than scanned as a cross product. Recursion
(``ancestor``, ``within_region``, ``influenced_transitively``) converges when a
round adds no new tuple.

:func:`materialize` returns the derived relations only (the rule heads);
:func:`summarize` pairs those counts with the base-relation counts the rules read
into a :class:`MaterializationSummary` whose :meth:`~MaterializationSummary.to_json`
is the manifest body the ``datalog-materialize`` CLI writes and
``docs/datalog-materialization-manifest.json`` records for a full-corpus build.
"""

from __future__ import annotations

import operator
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from pinakes_engine.datalog import Atom, Fact
from pinakes_engine.datalog.rules import ARITY, RULES, Rule

#: A materialised binary tuple: one term per argument position. Rule heads always
#: bind csids (strings), but fact arguments keep their native type (an int year),
#: so a tuple element may be a str, int, or float during evaluation.
Pair = tuple[Atom, Atom]

#: A parsed body/head literal: predicate name and its two argument tokens (each a
#: variable — upper-case-initial or ``_`` — or a constant).
_Literal = tuple[str, tuple[str, str]]

#: A parsed comparison literal: ``(left_token, op, right_token)`` (e.g. the
#: ``Ex < Sy`` guard of the temporal rules). Not a predicate goal — it filters
#: bindings numerically once both operands are bound.
_Comparison = tuple[str, str, str]

#: ``head(A, B) :- l1, l2, ....`` split into the head text and the body text.
_CLAUSE_RE = re.compile(r"\A(?P<head>[^:]+?):-\s*(?P<body>.+?)\.\s*\Z", re.DOTALL)
#: One ``predicate(arg0, arg1)`` literal.
_LITERAL_RE = re.compile(r"\A(?P<pred>[a-z][a-zA-Z0-9_]*)\((?P<args>[^()]*)\)\Z")
#: A token that is a logic *variable* (Prolog convention): upper-case-initial or ``_``.
_VARIABLE_RE = re.compile(r"\A(?:[A-Z_][A-Za-z0-9_]*)\Z")
#: A comparison literal ``left <op> right`` — operands are single whitespace-free
#: tokens (a variable, a number, or a constant). Multi-character operators are
#: listed before their single-character prefixes so the longest match wins.
_COMPARISON_RE = re.compile(
    r"\A(?P<left>\S+)\s*(?P<op>=<|>=|<=|==|\\==|!=|\\=|<|>|=)\s*(?P<right>\S+)\Z"
)

#: Comparison operator token → the Python predicate that evaluates it. Both the
#: Soufflé spellings (``<=``, ``!=``, ``=``) and the Prolog ones (``=<``, ``\=``,
#: ``\==``) map to the same semantics so a rule written for either dialect
#: materialises identically.
_COMPARATORS: dict[str, Callable[[Atom, Atom], bool]] = {
    "<": operator.lt,
    ">": operator.gt,
    ">=": operator.ge,
    "<=": operator.le,
    "=<": operator.le,
    "==": operator.eq,
    "=": operator.eq,
    "!=": operator.ne,
    "\\=": operator.ne,
    "\\==": operator.ne,
}


class MaterializeError(ValueError):
    """Raised when a rule clause is outside the shape the evaluator supports."""


def _parse_literal(text: str) -> _Literal:
    """Parse one ``predicate(arg0, arg1)`` literal into ``(predicate, (a, b))``."""
    match = _LITERAL_RE.match(text.strip())
    if match is None:
        raise MaterializeError(f"cannot parse literal {text!r}")
    args = tuple(arg.strip() for arg in match["args"].split(","))
    if len(args) != ARITY:
        raise MaterializeError(
            f"literal {text!r} is not binary (the evaluator only handles arity {ARITY})"
        )
    return match["pred"], (args[0], args[1])


def _split_body(body: str) -> list[str]:
    """Split a clause body into its literals, honouring nested parentheses.

    A predicate literal (``time_start(Y, Sy)``) carries an internal comma at paren
    depth 1; a comparison literal (``Ex < Sy``) carries none. Splitting only on
    commas at depth 0 keeps each literal intact regardless of its internal commas.
    """
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if current:
        parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def _parse_clause(
    clause: str,
) -> tuple[_Literal, tuple[_Literal, ...], tuple[_Comparison, ...]]:
    """Parse a ``head :- body.`` clause into head, predicate literals, comparisons.

    The body is split into its literals at top-level commas (:func:`_split_body`);
    each part is either a ``pred(a, b)`` predicate goal or a comparison
    (``left <op> right``). Raises :class:`MaterializeError` for a fact (no ``:-``)
    or a part that is neither shape.
    """
    match = _CLAUSE_RE.match(clause.strip())
    if match is None:
        raise MaterializeError(f"not a rule clause: {clause!r}")
    head = _parse_literal(match["head"])
    body: list[_Literal] = []
    comparisons: list[_Comparison] = []
    for part in _split_body(match["body"]):
        comparison = _COMPARISON_RE.match(part)
        if comparison is not None and "(" not in part:
            comparisons.append(
                (comparison["left"], comparison["op"], comparison["right"])
            )
        else:
            body.append(_parse_literal(part))
    return head, tuple(body), tuple(comparisons)


def _is_variable(token: str) -> bool:
    return bool(_VARIABLE_RE.match(token))


def _as_number(value: Atom) -> Atom:
    """Coerce *value* to a number when it reads as one, else return it unchanged.

    Fact arguments keep their native type, so a year is already an ``int``; a
    numeric *constant* written in a clause (``-1200``) arrives as a ``str`` and is
    parsed here so the comparison is numeric, not lexical.
    """
    if isinstance(value, (int, float)):
        return value
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def _comparison_operand(token: str, binding: dict[str, Atom]) -> Atom:
    """Resolve a comparison operand *token* to a comparable value under *binding*.

    A variable must already be bound (a comparison over a still-free variable is
    an unsafe rule); a constant is coerced to a number when it reads as one.
    """
    if _is_variable(token):
        if token not in binding:
            raise MaterializeError(
                f"comparison operand {token!r} is unbound (unsafe rule)"
            )
        return _as_number(binding[token])
    return _as_number(token)


def _satisfies(comparisons: tuple[_Comparison, ...], binding: dict[str, Atom]) -> bool:
    """Whether every comparison holds under *binding*.

    Operands that resolve to values of different, incomparable types (a number vs
    a string) fail the comparison rather than raising — the join simply drops that
    binding, matching an engine that finds no matching tuple.
    """
    for left, op, right in comparisons:
        lhs = _comparison_operand(left, binding)
        rhs = _comparison_operand(right, binding)
        try:
            if not _COMPARATORS[op](lhs, rhs):
                return False
        except TypeError:
            return False
    return True


#: Per-predicate indexes: tuples by their first element and by their second.
_Index = tuple[dict[Atom, list[Atom]], dict[Atom, list[Atom]]]


def _resolve(token: str, binding: dict[str, Atom]) -> Atom | None:
    """The known value of *token* under *binding*, or ``None`` if still free.

    A constant resolves to itself; a bound variable to its value; an unbound
    variable to ``None`` (so the caller scans rather than indexes on it).
    """
    if not _is_variable(token):
        return token
    return binding.get(token)


def _unify(binding: dict[str, Atom], token: str, value: Atom) -> dict[str, Atom] | None:
    """Extend *binding* so *token* equals *value*, or ``None`` on a clash.

    A constant token must equal *value*; a variable is bound if free, else must
    already equal *value* (which enforces repeated-variable joins, e.g. the shared
    ``R`` across two ``within_region`` literals or an ``X == X`` self literal).
    """
    if not _is_variable(token):
        return binding if token == value else None
    if token in binding:
        return binding if binding[token] == value else None
    extended = dict(binding)
    extended[token] = value
    return extended


def _index(pairs: set[Pair]) -> _Index:
    """Index *pairs* by first and by second element for narrowed lookups."""
    by_first: dict[Atom, list[Atom]] = {}
    by_second: dict[Atom, list[Atom]] = {}
    for a, b in pairs:
        by_first.setdefault(a, []).append(b)
        by_second.setdefault(b, []).append(a)
    return by_first, by_second


def _candidates(
    literal: _Literal,
    binding: dict[str, Atom],
    store: dict[str, set[Pair]],
    indexes: dict[str, _Index],
) -> Iterable[Pair]:
    """The tuples of *literal*'s predicate that can match under *binding*.

    Narrows on whichever argument is already known (a constant or a bound
    variable) using the predicate's index, falling back to a full scan when both
    arguments are free. An unknown predicate yields nothing.
    """
    pred, (a, b) = literal
    pairs = store.get(pred)
    if not pairs:
        return ()
    by_first, by_second = indexes[pred]
    known_a, known_b = _resolve(a, binding), _resolve(b, binding)
    if known_a is not None:
        return [(known_a, y) for y in by_first.get(known_a, ())]
    if known_b is not None:
        return [(x, known_b) for x in by_second.get(known_b, ())]
    return pairs


def _derive_head(
    head: _Literal,
    body: tuple[_Literal, ...],
    comparisons: tuple[_Comparison, ...],
    store: dict[str, set[Pair]],
    indexes: dict[str, _Index],
) -> set[Pair]:
    """All head tuples one clause derives from the current *store*.

    Predicate literals are joined by binding propagation; the *comparisons* then
    filter the surviving bindings (their operands are bound by the literals), so a
    guard like ``Ex < Sy`` keeps only the tuples that satisfy it.
    """
    bindings: list[dict[str, Atom]] = [{}]
    for literal in body:
        _pred, (a, b) = literal
        nxt: list[dict[str, Atom]] = []
        for binding in bindings:
            for x, y in _candidates(literal, binding, store, indexes):
                after_a = _unify(binding, a, x)
                if after_a is None:
                    continue
                after_b = _unify(after_a, b, y)
                if after_b is not None:
                    nxt.append(after_b)
        bindings = nxt
    if comparisons:
        bindings = [b for b in bindings if _satisfies(comparisons, b)]
    ha, hb = head[1]
    return {(binding[ha], binding[hb]) for binding in bindings}


@dataclass(frozen=True)
class MaterializationSummary:
    """Base-relation and derived-relation tuple counts for a materialisation.

    *base_relations* counts each base predicate the *rules* read (their
    :attr:`~pinakes_engine.datalog.rules.Rule.depends` that is not itself a rule
    head). *derived_relations* counts the tuples each rule head materialises. Both
    are ordered by count then name, so the JSON body is deterministic.
    """

    base_relations: dict[str, int]
    derived_relations: dict[str, int]

    @property
    def derived_total(self) -> int:
        """Total number of derived tuples across every rule head."""
        return sum(self.derived_relations.values())

    def to_json(self) -> dict[str, object]:
        """The manifest body: base + derived counts and the derived total."""
        return {
            "base_relations": self.base_relations,
            "derived_relations": self.derived_relations,
            "derived_total": self.derived_total,
        }


def _base_relations(rules: tuple[Rule, ...]) -> set[str]:
    """The base predicates *rules* read — dependencies that are not rule heads."""
    heads = {rule.name for rule in rules}
    return {dep for rule in rules for dep in rule.depends} - heads


def materialize(
    facts: Iterable[Fact], rules: Iterable[Rule] = RULES
) -> dict[str, set[Pair]]:
    """Materialise every rule head's extension over *facts* by naive fixpoint.

    Seeds a relation store with the binary *facts*, then repeatedly applies every
    clause of every rule until a round adds no new tuple, and returns just the
    derived relations (keyed by rule-head predicate; a rule that derives nothing
    maps to an empty set). Base facts are dropped from the result — only the
    inference the rules add is returned.

    Raises:
        MaterializeError: If a rule clause is not a binary Horn clause (predicate
            literals plus optional comparison guards).
    """
    rules = tuple(rules)
    store: dict[str, set[Pair]] = {}
    for fact in facts:
        if len(fact.args) == ARITY:
            # Keep the arguments' native type so comparison guards (Ex < Sy) over
            # numeric dimension facts (time_start/time_end) are numeric, not lexical.
            pair = (fact.args[0], fact.args[1])
            store.setdefault(fact.predicate, set()).add(pair)

    heads = {rule.name for rule in rules}
    for name in heads:
        store.setdefault(name, set())
    clauses = [_parse_clause(clause) for rule in rules for clause in rule.clauses]

    changed = True
    while changed:
        changed = False
        indexes = {pred: _index(pairs) for pred, pairs in store.items()}
        for head, body, comparisons in clauses:
            head_pred = head[0]
            derived = _derive_head(head, body, comparisons, store, indexes)
            new = derived - store[head_pred]
            if new:
                store[head_pred] |= new
                changed = True

    return {name: store[name] for name in heads}


def summarize(
    facts: Iterable[Fact], rules: Iterable[Rule] = RULES
) -> MaterializationSummary:
    """Materialise *rules* over *facts* and summarise the base/derived counts.

    Projects the *facts* once into a store, counts the base predicates the rules
    read, materialises the derived relations (:func:`materialize`), and returns a
    :class:`MaterializationSummary` with both count maps ordered by count then
    name.
    """
    rules = tuple(rules)
    fact_list = list(facts)
    base_counts: dict[str, int] = dict.fromkeys(_base_relations(rules), 0)
    for fact in fact_list:
        if fact.predicate in base_counts and len(fact.args) == ARITY:
            base_counts[fact.predicate] += 1

    derived = materialize(fact_list, rules)
    derived_counts = {head: len(pairs) for head, pairs in derived.items()}
    return MaterializationSummary(
        base_relations=_ordered(base_counts),
        derived_relations=_ordered(derived_counts),
    )


def _ordered(counts: dict[str, int]) -> dict[str, int]:
    """Order a count map by descending count, then name, for stable output."""
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


__all__ = [
    "MaterializationSummary",
    "MaterializeError",
    "Pair",
    "materialize",
    "summarize",
]
