"""Engine-neutral fact representation for Datalog/Prolog export.

The canonical store is TSV (``docs/data-model.md``); Datalog is a *derived*,
mechanical projection of it. Before targeting any specific engine (SWI-Prolog,
Soufflé, …) we need one in-memory shape for a logical fact that renders validly
into either syntax. That shape is :class:`Fact`: a ``predicate`` functor, a
tuple of ``args``, and an optional ``source`` for provenance.

The predicate schema this module emits is documented in ``docs/datalog.md``;
the short version is ``node/3+`` for entities, ``instance_of/2`` for typing,
``rel/3`` (or typed predicates such as ``located_in/2``) for edges, and one
binary predicate per dimension (``time_start/2``, ``descends_from/2``, …).

Rendering is the delicate part. Prolog and Soufflé Datalog disagree on how a
symbolic constant is written:

* **Prolog** — a lowercase-initial token (``dish``) is a bare atom; anything
  else (a ``csid`` like ``cs:dish:Q42``, a name like ``Ceviche`` whose capital
  would otherwise read as a variable, or a string with spaces/quotes/Unicode)
  must be a single-quoted, escaped atom: ``'cs:dish:Q42'``.
* **Soufflé Datalog** — every symbolic constant is a double-quoted string:
  ``"cs:dish:Q42"``.

:func:`render_atom` hides that difference, and :func:`render_fact` (also
:meth:`Fact.render`) assembles a complete, terminated clause for the chosen
:class:`Dialect`.
"""

from __future__ import annotations

import enum
import re
from collections.abc import Sequence
from dataclasses import dataclass

#: A term that may appear as a predicate argument. Strings become symbolic
#: constants (atoms / quoted strings); ints and floats become numeric literals.
Atom = str | int | float


class DatalogError(ValueError):
    """Raised when a fact or atom cannot be rendered to valid syntax."""


class Dialect(enum.Enum):
    """Target syntax for rendering.

    :data:`PROLOG` writes ISO-Prolog clauses (bare or single-quoted atoms,
    ``%`` line comments); :data:`DATALOG` writes Soufflé-style clauses
    (double-quoted string constants, ``//`` line comments).
    """

    PROLOG = "prolog"
    DATALOG = "datalog"


#: A token that is a valid *unquoted* Prolog atom (lowercase-initial name).
_UNQUOTED_ATOM_RE = re.compile(r"[a-z][a-zA-Z0-9_]*\Z")

#: A predicate functor accepted by both engines (lowercase-initial identifier).
_PREDICATE_RE = re.compile(r"[a-z][a-zA-Z0-9_]*\Z")

#: Character → escape sequence shared by Prolog and Soufflé quoted forms (the
#: surrounding quote character itself is escaped separately, per dialect).
_ESCAPES = {
    "\\": "\\\\",
    "\n": "\\n",
    "\t": "\\t",
    "\r": "\\r",
}


def _escape_quoted(text: str, quote: str) -> str:
    """Escape *text* for use inside *quote* delimiters (``'`` or ``"``).

    Backslash and the C0 controls handled by :data:`_ESCAPES` are escaped, as is
    the active *quote* character. Printable Unicode is passed through verbatim:
    both SWI-Prolog and Soufflé read UTF-8 source, so ``café`` need not be
    mangled into escapes.
    """
    out: list[str] = []
    for ch in text:
        if ch == quote:
            out.append("\\" + quote)
        elif ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        else:
            out.append(ch)
    return "".join(out)


def _render_float(value: float) -> str:
    """Render *value* as a float literal valid in both dialects.

    Both engines require a digit on each side of the decimal point and a
    mantissa with a decimal point in exponent form, so ``1e+20`` (which
    :func:`repr` may produce) is normalised to ``1.0e+20``.
    """
    text = repr(value)
    mantissa, sep, exponent = text.partition("e")
    if "." not in mantissa:
        mantissa += ".0"
    return f"{mantissa}{sep}{exponent}"


def render_atom(value: Atom, dialect: Dialect = Dialect.PROLOG) -> str:
    """Render a single term as a valid atom/literal for *dialect*.

    Strings become symbolic constants — a bare atom when Prolog allows it,
    otherwise a quoted, escaped form (always double-quoted in Datalog). Ints and
    floats become numeric literals. ``bool`` is rejected: it is an ``int``
    subclass in Python but has no meaningful Datalog term.

        >>> render_atom("dish")
        'dish'
        >>> render_atom("cs:dish:Q42")
        "'cs:dish:Q42'"
        >>> render_atom("cs:dish:Q42", Dialect.DATALOG)
        '"cs:dish:Q42"'
        >>> render_atom(-1438)
        '-1438'
    """
    if isinstance(value, bool):
        raise DatalogError("bool is not a valid Datalog term")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _render_float(value)
    if isinstance(value, str):
        if dialect is Dialect.PROLOG and _UNQUOTED_ATOM_RE.match(value):
            return value
        quote = "'" if dialect is Dialect.PROLOG else '"'
        return f"{quote}{_escape_quoted(value, quote)}{quote}"
    raise DatalogError(f"cannot render {type(value).__name__} as an atom")


def render_predicate(name: str, dialect: Dialect = Dialect.PROLOG) -> str:
    """Validate and return a predicate functor for *dialect*.

    The functor must be a lowercase-initial identifier — the intersection of
    what Prolog and Soufflé accept as a bare relation name — so it is returned
    unchanged. Anything else raises :class:`DatalogError` rather than emitting a
    clause one of the engines would reject.
    """
    if not _PREDICATE_RE.match(name):
        raise DatalogError(
            f"predicate {name!r} is not a valid identifier "
            "(expected a lowercase-initial name like 'located_in')"
        )
    return name


@dataclass(frozen=True)
class Fact:
    """One logical fact: ``predicate(*args)`` with optional provenance.

    *args* is coerced to a tuple so the fact is hashable and immutable. *source*
    records where the fact came from (an adapter id or source URL); when present
    it is emitted as a trailing line comment, keeping the clause's arity stable.
    """

    predicate: str
    args: Sequence[Atom]
    source: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "args", tuple(self.args))

    def render(self, dialect: Dialect = Dialect.PROLOG) -> str:
        """Render this fact as a terminated clause (see :func:`render_fact`)."""
        return render_fact(self, dialect)


def render_fact(fact: Fact, dialect: Dialect = Dialect.PROLOG) -> str:
    """Render *fact* as a complete, ``.``-terminated clause for *dialect*.

    The functor is validated by :func:`render_predicate` and each argument by
    :func:`render_atom`. A :attr:`Fact.source`, if set, follows as a line
    comment (``%`` for Prolog, ``//`` for Datalog) with internal whitespace
    collapsed so it stays on one line.

        >>> Fact("located_in", ("cs:dish:Q42", "cs:place:Q123")).render()
        "located_in('cs:dish:Q42', 'cs:place:Q123')."
        >>> Fact("time_start", ("cs:battle:Q7", -480), source="wikidata").render()
        "time_start('cs:battle:Q7', -480).  % source: wikidata"
        >>> Fact("instance_of", ("cs:dish:Q42", "dish")).render(Dialect.DATALOG)
        'instance_of("cs:dish:Q42", "dish").'
    """
    if not fact.args:
        raise DatalogError(f"fact {fact.predicate!r} has no arguments")
    functor = render_predicate(fact.predicate, dialect)
    rendered_args = ", ".join(render_atom(arg, dialect) for arg in fact.args)
    clause = f"{functor}({rendered_args})."
    if fact.source is not None:
        marker = "%" if dialect is Dialect.PROLOG else "//"
        comment = " ".join(fact.source.split())
        clause = f"{clause}  {marker} source: {comment}"
    return clause


# Imported at the bottom: nodes.py and edges.py depend on the Fact/render API
# defined above, so these re-exports must follow those definitions (hence the
# E402 suppression).
from culturescrape.datalog.edges import (  # noqa: E402
    edge_facts,
    edge_file_facts,
    predicate_for_type,
)
from culturescrape.datalog.equivalence import (  # noqa: E402
    Divergence,
    compare_relation,
    prolog_tuples,
    run_souffle,
    souffle_tuples,
)
from culturescrape.datalog.nodes import node_facts, node_file_facts  # noqa: E402
from culturescrape.datalog.prolog import render_program, write_program  # noqa: E402
from culturescrape.datalog.rules import (  # noqa: E402
    RULES,
    Rule,
    render_rule,
    rule_signatures,
)
from culturescrape.datalog.souffle import (  # noqa: E402
    SOUFFLE_PROGRAM_NAME,
    Relation,
    render_souffle_program,
    souffle_relations,
    write_souffle_facts,
    write_souffle_program,
)

__all__ = [
    "SOUFFLE_PROGRAM_NAME",
    "Atom",
    "DatalogError",
    "RULES",
    "Dialect",
    "Divergence",
    "Fact",
    "Relation",
    "Rule",
    "compare_relation",
    "edge_facts",
    "edge_file_facts",
    "node_facts",
    "node_file_facts",
    "predicate_for_type",
    "prolog_tuples",
    "render_atom",
    "render_fact",
    "render_predicate",
    "render_program",
    "render_rule",
    "render_souffle_program",
    "rule_signatures",
    "run_souffle",
    "souffle_relations",
    "souffle_tuples",
    "write_program",
    "write_souffle_facts",
    "write_souffle_program",
]
