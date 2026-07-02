"""Emit a runnable Soufflé Datalog program (``.dl`` + ``.facts``) from facts.

This is the second concrete engine target for the engine-neutral :class:`Fact`
model (``__init__.py``), alongside the SWI-Prolog emitter (``prolog.py``).
Soufflé splits a program into two artefacts, and so do we:

* a **``.dl`` source file** — declarations and I/O directives only. For every
  predicate that appears it emits a ``.decl`` with typed attributes, a
  ``.input`` directive (so Soufflé loads that relation's rows at start-up) and a
  ``.output`` directive (so running the program materialises it);
* one **``<predicate>.facts`` file** per relation — the rows themselves, in
  Soufflé's native tab-separated format, written through the strict TSV encoder
  (:func:`culturescrape.schema.tsvio.encode_value`) so a field containing a tab,
  newline, or backslash cannot corrupt the file.

**Soufflé is strongly typed**, unlike Prolog: every attribute is a ``symbol``
(string), ``number`` (signed int) or ``float``. We infer each attribute's type
from the values that occur at that position across all facts of the predicate,
widening on conflict via :func:`_join` (``number`` ⊑ ``float`` ⊑ ``symbol``).

**Soufflé relations are keyed by name, not name/arity** (again unlike Prolog),
so the same predicate appearing with two arities is a hard error here rather
than two declarations.

:func:`render_souffle_program` builds the ``.dl`` text (handy to assert on in
tests without touching disk); :func:`write_souffle_program` writes the ``.dl``
and every ``.facts`` file into one directory, ready for
``souffle <dir>/graph.dl -F <dir>``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from culturescrape.datalog import Atom, DatalogError, Dialect, Fact, render_predicate
from culturescrape.datalog.rules import Rule, render_rule
from culturescrape.schema.headers import DELIMITER
from culturescrape.schema.tsvio import encode_value

#: Filename of the generated Soufflé program inside the output directory.
SOUFFLE_PROGRAM_NAME = "graph.dl"

#: Soufflé primitive attribute types we emit, ranked from most specific to most
#: general for the type-join: a position that mixes ints and floats widens to
#: ``float`` (Soufflé reads an int where a float is wanted); mixing in any
#: string widens to ``symbol``.
_NUMBER, _FLOAT, _SYMBOL = "number", "float", "symbol"
_RANK = {_NUMBER: 0, _FLOAT: 1, _SYMBOL: 2}

#: The ``//``-comment header documenting the emitted program. Static (the full
#: vocabulary the projection can emit) so the file is self-describing.
_HEADER = """\
// culture-scrape — Soufflé Datalog program
// =========================================
// Auto-generated from the canonical TSV graph (docs/data-model.md); a derived,
// mechanical projection — do not edit by hand.
//
// Layout
// ------
//   This .dl declares each predicate (.decl) and marks it .input (rows are
//   loaded from <predicate>.facts at start-up) and .output (running the program
//   materialises it). The rows live in the sibling <predicate>.facts files,
//   tab-separated in Soufflé's native format.
//
// Attribute types
// ---------------
//   symbol  — a string constant (csids like cs:dish:Q42, names, type labels)
//   number  — a signed integer (e.g. a year; negative = BCE)
//   float   — a coordinate or edge weight/confidence
//
// Run:  souffle graph.dl -F <dir-holding-the-.facts> -D <output-dir>"""


def _atom_type(value: Atom) -> str:
    """The Soufflé attribute type a single *value* implies.

    ``bool`` is rejected for parity with
    :func:`culturescrape.datalog.render_atom`: it is an ``int`` subclass in
    Python but has no meaningful Datalog term.
    """
    if isinstance(value, bool):
        raise DatalogError("bool is not a valid Soufflé term")
    if isinstance(value, int):
        return _NUMBER
    if isinstance(value, float):
        return _FLOAT
    if isinstance(value, str):
        return _SYMBOL
    raise DatalogError(
        f"cannot type {type(value).__name__} as a Soufflé attribute"
    )


def _join(left: str, right: str) -> str:
    """The narrowest Soufflé type admitting values of both *left* and *right*.

    Widening follows the rank ``number`` ⊑ ``float`` ⊑ ``symbol``: an int and a
    float at the same position widen to ``float``; anything mixed with a string
    widens to ``symbol``.
    """
    return left if _RANK[left] >= _RANK[right] else right


@dataclass(frozen=True)
class Relation:
    """A Soufflé relation: a predicate functor and its per-position types.

    *types* has one entry per argument position, each ``"symbol"``,
    ``"number"`` or ``"float"`` (the inferred attribute type for that column).
    """

    predicate: str
    types: tuple[str, ...]

    def declaration(self) -> str:
        """The ``.decl`` line for this relation (attributes named ``x0..xN``).

        >>> Relation("located_at", ("symbol", "float", "float")).declaration()
        '.decl located_at(x0: symbol, x1: float, x2: float)'
        """
        attrs = ", ".join(f"x{i}: {t}" for i, t in enumerate(self.types))
        return f".decl {self.predicate}({attrs})"


def souffle_relations(facts: Iterable[Fact]) -> list[Relation]:
    """Derive the typed relations present in *facts*, sorted by predicate.

    Each argument position's type is inferred from the values that occur there
    and widened on conflict (:func:`_join`). Because Soufflé keys relations by
    name alone, a predicate appearing with two different arities is rejected.
    """
    by_name: dict[str, tuple[str, ...]] = {}
    for fact in facts:
        if not fact.args:
            raise DatalogError(f"fact {fact.predicate!r} has no arguments")
        render_predicate(fact.predicate, Dialect.DATALOG)  # validate the functor
        types = tuple(_atom_type(arg) for arg in fact.args)
        existing = by_name.get(fact.predicate)
        if existing is None:
            by_name[fact.predicate] = types
        elif len(existing) != len(types):
            raise DatalogError(
                f"predicate {fact.predicate!r} appears with arity {len(existing)} "
                f"and {len(types)}; Soufflé relations are keyed by name, so a "
                "single arity is required"
            )
        else:
            by_name[fact.predicate] = tuple(
                _join(a, b) for a, b in zip(existing, types, strict=True)
            )
    return [Relation(name, by_name[name]) for name in sorted(by_name)]


def _render_rules(rules: list[Rule], declared: set[str]) -> list[str]:
    """The ``.dl`` lines for *rules*, given the predicates *declared* by facts.

    Every rule relation is binary over csids, so a predicate the fact base did
    not already declare (a derived head, or a base predicate the current graph
    has no facts for) is declared here as ``(symbol, symbol)``. Each derived head
    is also marked ``.output`` so running the program materialises it (unless the
    fact base already output it). The clauses follow, rendered for Soufflé.
    """
    extra = sorted({n for rule in rules for n in (rule.name, *rule.depends)} - declared)
    lines = [Relation(name, ("symbol", "symbol")).declaration() for name in extra]
    outputs = [f".output {rule.name}" for rule in rules if rule.name not in declared]
    if outputs:
        if lines:
            lines.append("")
        lines += outputs
    for rule in rules:
        lines.append("")
        lines.append(render_rule(rule, Dialect.DATALOG))
    return lines


def render_souffle_program(facts: Iterable[Fact], rules: Iterable[Rule] = ()) -> str:
    """Render the ``.dl`` declarations, I/O directives and *rules* for *facts*.

    The text is the schema header, then one ``.decl``/``.input``/``.output``
    block per fact relation (sorted by predicate). When *rules* are supplied, a
    documented ``// Inference rules`` section follows: a ``.decl`` for every rule
    predicate the fact base did not already declare, a ``.output`` per derived
    relation, and the rule clauses. The facts themselves are *not* inlined — they
    belong in the sibling ``.facts`` files. The result ends with a trailing
    newline.

    >>> from culturescrape.datalog import Fact
    >>> program = render_souffle_program([Fact("instance_of", ("cs:dish:Q42", "Dish"))])
    >>> for line in program.splitlines():
    ...     if line.startswith("."):
    ...         print(line)
    .decl instance_of(x0: symbol, x1: symbol)
    .input instance_of
    .output instance_of
    """
    relations = souffle_relations(facts)
    rules = list(rules)
    lines = [_HEADER, ""]
    for relation in relations:
        lines.append(relation.declaration())
        lines.append(f".input {relation.predicate}")
        lines.append(f".output {relation.predicate}")
        lines.append("")
    if rules:
        lines.append("// Inference rules (derived relations)")
        lines.append("// " + "=" * 35)
        lines += _render_rules(rules, {relation.predicate for relation in relations})
    return "\n".join(lines).rstrip("\n") + "\n"


def _render_cell(value: Atom, col_type: str) -> str:
    """Render *value* for a ``.facts`` cell under its resolved *col_type*.

    Rendering follows the relation's resolved column type, not the value's own
    type, so an int sitting in a ``float`` column is written ``5.0`` and matches
    its ``.decl``. ``symbol`` cells go through the strict TSV encoder so a tab,
    newline, or backslash in the string cannot break the tab-separated format.
    """
    if col_type == _SYMBOL:
        text = value if isinstance(value, str) else str(value)
        return encode_value(text)
    if col_type == _NUMBER:
        return str(int(value))
    text = repr(float(value))  # _FLOAT
    if not any(c in text for c in ".eE"):
        text += ".0"  # keep a decimal point so it reads as a float, not an int
    return text


def write_souffle_facts(path: str | Path, facts: Iterable[Fact]) -> dict[str, int]:
    """Write one ``<predicate>.facts`` file per relation into directory *path*.

    Returns the row count written for each predicate. Cells are encoded with the
    strict TSV writer (:func:`culturescrape.schema.tsvio.encode_value`), so the
    files are lossless; each file is headerless, as Soufflé's native fact format
    expects. Facts keep their given order (the source TSV is already canonically
    sorted).
    """
    facts = list(facts)
    relations = souffle_relations(facts)
    grouped: dict[str, list[Fact]] = {relation.predicate: [] for relation in relations}
    for fact in facts:
        grouped[fact.predicate].append(fact)

    directory = Path(path)
    directory.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for relation in relations:
        rows = grouped[relation.predicate]
        out = directory / f"{relation.predicate}.facts"
        with out.open("w", encoding="utf-8", newline="") as handle:
            for fact in rows:
                cells = [
                    _render_cell(arg, col_type)
                    for arg, col_type in zip(fact.args, relation.types, strict=True)
                ]
                handle.write(DELIMITER.join(cells))
                handle.write("\n")
        counts[relation.predicate] = len(rows)
    return counts


def write_souffle_program(
    path: str | Path, facts: Iterable[Fact], rules: Iterable[Rule] = ()
) -> int:
    """Write the full Soufflé program for *facts* into directory *path*.

    Writes the ``.dl`` source (:data:`SOUFFLE_PROGRAM_NAME`, including *rules*
    when supplied) and every ``<predicate>.facts`` file into *path*, and returns
    the total fact count. The directory is then ready for
    ``souffle <path>/graph.dl -F <path>``.
    """
    facts = list(facts)
    directory = Path(path)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / SOUFFLE_PROGRAM_NAME).write_text(
        render_souffle_program(facts, rules), encoding="utf-8"
    )
    write_souffle_facts(directory, facts)
    return len(facts)


__all__ = [
    "SOUFFLE_PROGRAM_NAME",
    "Relation",
    "render_souffle_program",
    "souffle_relations",
    "write_souffle_facts",
    "write_souffle_program",
]
