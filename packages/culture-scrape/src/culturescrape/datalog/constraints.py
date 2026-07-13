"""Translate Wikidata property constraints (P2302) into inference/integrity rules.

Wikidata's *property constraint* statements (``P2302``) are machine-readable axioms
about a property: that it is **symmetric** (``A REL B`` ⇒ ``B REL A``), the **inverse**
of another property, or that its **subject**/**value** must be an instance of a given
class. The corpus's edge vocabulary (:mod:`culturescrape.ontology.registry`) is built
from these very properties, so their constraints are rules waiting to be lifted into
the logic program — the same "acquire the rules, don't hand-write them" move US-001
made for the P279 taxonomy.

This module is the **datalog boundary**: it reads a committed, provenanced replay
artifact (:data:`PROPERTY_CONSTRAINTS_TSV`, written by
:mod:`culturescrape.acquire.constraints` from a WDQS ``P2302`` query) and
:func:`translate`\\ s each constraint into a :class:`ConstraintRule`. All
Wikidata↔corpus
resolution (property → edge ``:TYPE``, constraint-class QID → node ``:LABEL``) happens
in the acquire step and is baked into the artifact's resolved columns, so this module
never imports :mod:`culturescrape.acquire` (no cycle) and translates from resolved
names alone.

Three translations, mirroring the constraint types:

* **symmetric** → a bidirectional Horn rule ``t(X, Y) :- t(Y, X).`` — a genuine
  derivation, emitted to every engine (self-recursive, so SWI-Prolog tables it
  automatically);
* **inverse** → an inverse Horn rule ``t(X, Y) :- u(Y, X).`` (when the inverse
  property is also in the corpus vocabulary) — emitted **only** to Soufflé: an
  inverse *pair* is mutually recursive (``t :- u`` and ``u :- t``), which Soufflé's
  set semantics evaluate to a fixpoint but naive SWI SLD resolution would loop on
  (the cross-rule recursion is invisible to the single-rule tabling heuristic);
* **subject/value-type** → an **integrity** rule whose head enumerates violations —
  ``t_subject_type_violation(X, Y) :- t(X, Y), !instance_of(X, "C").`` (value-type
  negates on the object ``Y``). Negation-as-failure over the ``instance_of`` closure
  is Soufflé-only (stratified negation; ``!``), matching US-003's violation-rules
  direction.

A constraint whose type is none of the above (single-value, distinct-values, allowed
qualifiers, …), or whose inverse property / type class is outside the corpus
vocabulary, is **skipped and reported** as a :class:`SkippedConstraint` — never guessed
at, the same conservatism the taxonomy's backing-class map uses.

Every :class:`ConstraintRule` carries the provenance of the constraint statement it
came from (``constraint_statement_id``, ``retrieved_at``, ``source``, ``confidence``),
so the generated rules can flow through the rules registry (rules-layer US-004) with
the same discipline facts already have. :func:`render_rules_registry` renders that
draft registry table.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from culturescrape.datalog.edges import predicate_for_type
from culturescrape.datalog.rules import RULES, Rule
from culturescrape.schema.tsvio import encode_value, open_rows

#: The committed P2302 replay artifact (resolved constraints + provenance).
PROPERTY_CONSTRAINTS_TSV = (
    Path(__file__).resolve().parent / "constraints" / "property_constraints.tsv"
)

#: The committed draft rules registry (the constraint rules + provenance), the
#: rules-layer US-004 registry in draft form.
RULES_REGISTRY_TSV = (
    Path(__file__).resolve().parent / "constraints" / "rules_registry.tsv"
)

#: The columns the property-constraint artifact carries, in order. ``edge_type``,
#: ``inverse_edge_type`` and ``class_label`` are the corpus-resolved names the
#: acquire step baked in (blank when the Wikidata property/class is outside the
#: corpus vocabulary — the translator then skips-and-reports).
PROPERTY_CONSTRAINT_COLUMNS: tuple[str, ...] = (
    "property_id",
    "edge_type",
    "constraint_kind",
    "constraint_qid",
    "statement_id",
    "inverse_pid",
    "inverse_edge_type",
    "class_qid",
    "class_label",
    "relation_qid",
    "source",
    "source_url",
    "retrieved_at",
    "confidence",
)

#: The Wikidata constraint-type QIDs we translate, mapped to a stable token. Any
#: other value is an untranslatable constraint type (reported, never guessed).
SYMMETRIC_CONSTRAINT_QID = "Q21510862"
INVERSE_CONSTRAINT_QID = "Q21510855"
SUBJECT_TYPE_CONSTRAINT_QID = "Q21503250"
VALUE_TYPE_CONSTRAINT_QID = "Q21510865"

CONSTRAINT_KIND_BY_QID: dict[str, str] = {
    SYMMETRIC_CONSTRAINT_QID: "symmetric",
    INVERSE_CONSTRAINT_QID: "inverse",
    SUBJECT_TYPE_CONSTRAINT_QID: "subject-type",
    VALUE_TYPE_CONSTRAINT_QID: "value-type",
}

#: The default confidence a translated constraint rule carries (a machine-read
#: axiom — high, but the property↔edge backing map is the weak link, so not 1.0).
DEFAULT_CONFIDENCE = 0.9

#: The columns the draft rules registry (rules-layer US-004, draft form) carries.
RULES_REGISTRY_COLUMNS: tuple[str, ...] = (
    "rule_id",
    "kind",
    "head",
    "clause_prolog",
    "clause_souffle",
    "property_id",
    "constraint_statement_id",
    "source",
    "source_url",
    "retrieved_at",
    "confidence",
    "status",
)


class ConstraintError(ValueError):
    """Raised when the property-constraint artifact is malformed."""


@dataclass(frozen=True)
class PropertyConstraint:
    """One resolved P2302 constraint statement, pre-translation.

    The Wikidata↔corpus resolution is already done (by the acquire step):
    *edge_type* is the corpus ``:TYPE`` the *property_id* backs, *inverse_edge_type*
    the ``:TYPE`` of the inverse property (blank if it is not in the vocabulary), and
    *class_label* the node ``:LABEL`` the type constraint's class maps to (blank if
    unmapped). *statement_id* is the constraint statement's identity — its provenance.
    """

    property_id: str
    edge_type: str
    constraint_kind: str
    constraint_qid: str
    statement_id: str
    inverse_pid: str
    inverse_edge_type: str
    class_qid: str
    class_label: str
    relation_qid: str
    source: str
    source_url: str
    retrieved_at: str
    confidence: float


@dataclass(frozen=True)
class SkippedConstraint:
    """A constraint the translator could not turn into a rule, with the reason."""

    property_id: str
    edge_type: str
    constraint_kind: str
    statement_id: str
    reason: str


@dataclass(frozen=True)
class ConstraintRule:
    """A provenanced rule translated from one property constraint.

    *prolog_clauses* / *souffle_clauses* are the Horn clauses for each engine —
    identical for a dialect-neutral derivation (symmetric), but one side is empty
    when a rule is emitted to a single engine (inverse and the integrity rules are
    Soufflé-only; see the module docstring). The provenance fields mirror an
    acquired fact's, so the rule can flow through the registry gate.
    """

    rule_id: str
    kind: str
    head: str
    depends: tuple[str, ...]
    intent: str
    example: str
    prolog_clauses: tuple[str, ...]
    souffle_clauses: tuple[str, ...]
    property_id: str
    constraint_statement_id: str
    source: str
    source_url: str
    retrieved_at: str
    confidence: float
    status: str = "active"

    def _rule(self, clauses: tuple[str, ...]) -> Rule | None:
        if not clauses:
            return None
        return Rule(
            name=self.head,
            intent=self.intent,
            example=self.example,
            depends=self.depends,
            clauses=clauses,
        )

    def prolog_rule(self) -> Rule | None:
        """The :class:`~culturescrape.datalog.rules.Rule` for SWI-Prolog, or ``None``.

        ``None`` for the Soufflé-only kinds (inverse, integrity), which the Prolog
        emitter must not receive.
        """
        return self._rule(self.prolog_clauses)

    def souffle_rule(self) -> Rule | None:
        """The :class:`~culturescrape.datalog.rules.Rule` for Soufflé, or ``None``."""
        return self._rule(self.souffle_clauses)

    def registry_row(self) -> dict[str, str]:
        """This rule as a draft rules-registry row (dialect-neutral + provenance)."""
        return {
            "rule_id": self.rule_id,
            "kind": self.kind,
            "head": self.head,
            "clause_prolog": " ".join(self.prolog_clauses),
            "clause_souffle": " ".join(self.souffle_clauses),
            "property_id": self.property_id,
            "constraint_statement_id": self.constraint_statement_id,
            "source": self.source,
            "source_url": self.source_url,
            "retrieved_at": self.retrieved_at,
            "confidence": repr(float(self.confidence)),
            "status": self.status,
        }


@dataclass(frozen=True)
class TranslationResult:
    """The outcome of translating a set of property constraints.

    *rules* are the translated :class:`ConstraintRule`\\ s (active *and* those marked
    redundant with a curated rule); *skipped* records every constraint that produced
    no rule, with a reason. The accessors return only the *active* rules ready to
    attach to a program, split by which engine may receive each kind.
    """

    rules: tuple[ConstraintRule, ...]
    skipped: tuple[SkippedConstraint, ...] = field(default_factory=tuple)

    def _active(self) -> tuple[ConstraintRule, ...]:
        return tuple(r for r in self.rules if r.status == "active")

    def prolog_rules(self) -> tuple[Rule, ...]:
        """The active rules SWI-Prolog receives (symmetric derivations only)."""
        return tuple(
            rule
            for cr in self._active()
            if (rule := cr.prolog_rule()) is not None
        )

    def souffle_rules(self) -> tuple[Rule, ...]:
        """The active rules Soufflé receives (symmetric + inverse + integrity)."""
        return tuple(
            rule
            for cr in self._active()
            if (rule := cr.souffle_rule()) is not None
        )


# --- reading the committed replay artifact ----------------------------------


def _cell(row: dict[str, str | list[str]], key: str) -> str:
    """The scalar cell at *key* (``""`` if absent), rejecting a list column."""
    value = row.get(key, "")
    if isinstance(value, list):
        raise ConstraintError(f"column {key!r} is multi-valued, expected a scalar")
    return value


def load_property_constraints(
    path: str | Path = PROPERTY_CONSTRAINTS_TSV,
) -> list[PropertyConstraint]:
    """Read the committed property-constraint artifact at *path*.

    Validates that the header carries at least ``property_id``/``edge_type``/
    ``constraint_qid`` and parses ``confidence`` as a float. A row with a blank
    ``property_id`` or ``edge_type`` is rejected (a constraint must name the
    corpus property it constrains).
    """
    columns, rows = open_rows(path)
    names = {getattr(column, "name", "") for column in columns}
    for required in ("property_id", "edge_type", "constraint_qid"):
        if required not in names:
            raise ConstraintError(
                f"{path} is missing the {required!r} column "
                f"(have: {', '.join(sorted(names))})"
            )
    constraints: list[PropertyConstraint] = []
    for row in rows:
        property_id, edge_type = _cell(row, "property_id"), _cell(row, "edge_type")
        if not property_id or not edge_type:
            raise ConstraintError(
                f"property-constraint row has a blank property_id/edge_type: {row!r}"
            )
        confidence_cell = _cell(row, "confidence")
        try:
            confidence = float(confidence_cell) if confidence_cell else 1.0
        except ValueError as exc:
            raise ConstraintError(
                f"property-constraint row has a non-numeric confidence "
                f"{confidence_cell!r}"
            ) from exc
        constraints.append(
            PropertyConstraint(
                property_id=property_id,
                edge_type=edge_type,
                constraint_kind=_cell(row, "constraint_kind"),
                constraint_qid=_cell(row, "constraint_qid"),
                statement_id=_cell(row, "statement_id"),
                inverse_pid=_cell(row, "inverse_pid"),
                inverse_edge_type=_cell(row, "inverse_edge_type"),
                class_qid=_cell(row, "class_qid"),
                class_label=_cell(row, "class_label"),
                relation_qid=_cell(row, "relation_qid"),
                source=_cell(row, "source") or "wikidata",
                source_url=_cell(row, "source_url"),
                retrieved_at=_cell(row, "retrieved_at"),
                confidence=confidence,
            )
        )
    return constraints


# --- translation ------------------------------------------------------------


def _curated_clauses() -> frozenset[str]:
    """Every clause text a curated (``rules.py``) rule already ships.

    Used to mark a generated rule *redundant* when it would duplicate a
    hand-written one, so the registry records it rather than the emitter shipping
    a duplicate clause.
    """
    return frozenset(clause for rule in RULES for clause in rule.clauses)


def _quote_souffle_label(label: str) -> str:
    """A Soufflé string constant for a node ``:LABEL`` (double-quoted)."""
    escaped = label.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _symmetric_rule(
    c: PropertyConstraint, predicate: str, curated: frozenset[str]
) -> ConstraintRule:
    clause = f"{predicate}(X, Y) :- {predicate}(Y, X)."
    status = "redundant" if clause in curated else "active"
    intent = (
        f"{predicate}(X, Y): {c.edge_type} reads the same in both directions "
        f"(Wikidata symmetric constraint on {c.property_id}), so every edge implies "
        "its reverse."
    )
    example = (
        f"?- {predicate}(A, B).\n"
        f"Given {predicate}('cs:x', 'cs:y'), the symmetric rule also yields "
        f"{predicate}('cs:y', 'cs:x')."
    )
    return ConstraintRule(
        rule_id=f"wd-{c.property_id.lower()}-symmetric-{predicate}",
        kind="symmetric",
        head=predicate,
        depends=(predicate,),
        intent=intent,
        example=example,
        prolog_clauses=(clause,),
        souffle_clauses=(clause,),
        property_id=c.property_id,
        constraint_statement_id=c.statement_id,
        source=c.source,
        source_url=c.source_url,
        retrieved_at=c.retrieved_at,
        confidence=c.confidence,
        status=status,
    )


def _inverse_rule(
    c: PropertyConstraint,
    predicate: str,
    inverse_predicate: str,
    curated: frozenset[str],
) -> ConstraintRule:
    clause = f"{predicate}(X, Y) :- {inverse_predicate}(Y, X)."
    status = "redundant" if clause in curated else "active"
    intent = (
        f"{predicate}(X, Y): {c.edge_type} is the inverse of {c.inverse_edge_type} "
        f"(Wikidata inverse constraint on {c.property_id}), so a {c.inverse_edge_type} "
        "edge implies the reversed edge. Emitted to Soufflé only — an inverse pair is "
        "mutually recursive."
    )
    example = (
        f"?- {predicate}(A, B).\n"
        f"Given {inverse_predicate}('cs:y', 'cs:x'), the inverse rule yields "
        f"{predicate}('cs:x', 'cs:y')."
    )
    return ConstraintRule(
        rule_id=f"wd-{c.property_id.lower()}-inverse-{predicate}",
        kind="inverse",
        head=predicate,
        depends=(inverse_predicate,),
        intent=intent,
        example=example,
        prolog_clauses=(),  # Soufflé-only (see module docstring)
        souffle_clauses=(clause,),
        property_id=c.property_id,
        constraint_statement_id=c.statement_id,
        source=c.source,
        source_url=c.source_url,
        retrieved_at=c.retrieved_at,
        confidence=c.confidence,
        status=status,
    )


def _type_violation_rule(
    c: PropertyConstraint, predicate: str, *, on_subject: bool
) -> ConstraintRule:
    role = "subject" if on_subject else "value"
    var = "X" if on_subject else "Y"
    head = f"{predicate}_{role}_type_violation"
    clause = (
        f"{head}(X, Y) :- {predicate}(X, Y), "
        f"!instance_of({var}, {_quote_souffle_label(c.class_label)})."
    )
    intent = (
        f"{head}(X, Y): a {c.edge_type} edge whose {role} is not (transitively) an "
        f"instance of {c.class_label} — a violation of the Wikidata "
        f"{'subject' if on_subject else 'value'}-type constraint on {c.property_id}. "
        "Integrity rule (Soufflé stratified negation over the instance_of closure)."
    )
    example = (
        f"?- {head}(X, Y).\n"
        f"With {predicate}('cs:a', 'cs:b') where instance_of('cs:{var.lower()}', "
        f"{_quote_souffle_label(c.class_label)}) does not hold, ('cs:a', 'cs:b') is "
        "enumerated as a violation."
    )
    return ConstraintRule(
        rule_id=f"wd-{c.property_id.lower()}-{role}-type-{predicate}",
        kind=f"{role}-type",
        head=head,
        depends=(predicate, "instance_of"),
        intent=intent,
        example=example,
        prolog_clauses=(),  # Soufflé-only (stratified negation)
        souffle_clauses=(clause,),
        property_id=c.property_id,
        constraint_statement_id=c.statement_id,
        source=c.source,
        source_url=c.source_url,
        retrieved_at=c.retrieved_at,
        confidence=c.confidence,
        status="active",
    )


def _kind_of(c: PropertyConstraint) -> str:
    """The constraint token, from the resolved column or the QID (column wins)."""
    if c.constraint_kind:
        return c.constraint_kind
    return CONSTRAINT_KIND_BY_QID.get(c.constraint_qid, "")


def translate(
    constraints: Iterable[PropertyConstraint],
    *,
    curated: frozenset[str] | None = None,
) -> TranslationResult:
    """Translate resolved *constraints* into rules, reporting the untranslatable.

    Each constraint becomes a :class:`ConstraintRule` (symmetric/inverse
    derivations, subject/value-type integrity rules) or a
    :class:`SkippedConstraint`. A constraint whose type is not one of the four we
    translate, or whose inverse property / type class is outside the corpus
    vocabulary (a blank resolved column), is skipped and reported. *curated*
    overrides the set of clause texts a rule is deemed *redundant* against
    (defaults to the shipped :data:`~culturescrape.datalog.rules.RULES`).
    """
    if curated is None:
        curated = _curated_clauses()
    rules: list[ConstraintRule] = []
    skipped: list[SkippedConstraint] = []

    def skip(c: PropertyConstraint, reason: str) -> None:
        skipped.append(
            SkippedConstraint(
                property_id=c.property_id,
                edge_type=c.edge_type,
                constraint_kind=_kind_of(c) or c.constraint_qid,
                statement_id=c.statement_id,
                reason=reason,
            )
        )

    for c in constraints:
        predicate = predicate_for_type(c.edge_type)
        kind = _kind_of(c)
        if kind == "symmetric":
            rules.append(_symmetric_rule(c, predicate, curated))
        elif kind == "inverse":
            if not c.inverse_edge_type:
                skip(
                    c,
                    f"inverse property {c.inverse_pid or '(none)'} is not in the "
                    "corpus edge vocabulary",
                )
                continue
            inverse_predicate = predicate_for_type(c.inverse_edge_type)
            rules.append(_inverse_rule(c, predicate, inverse_predicate, curated))
        elif kind in ("subject-type", "value-type"):
            if not c.class_label:
                skip(
                    c,
                    f"constraint class {c.class_qid or '(none)'} is not mapped to a "
                    "corpus :LABEL",
                )
                continue
            rules.append(
                _type_violation_rule(
                    c, predicate, on_subject=(kind == "subject-type")
                )
            )
        else:
            skip(c, f"untranslatable constraint type {c.constraint_qid or kind!r}")

    return TranslationResult(rules=tuple(rules), skipped=tuple(skipped))


# --- the draft rules registry -----------------------------------------------


def render_rules_registry(rules: Sequence[ConstraintRule]) -> str:
    """Render *rules* as the draft rules-registry TSV (header + rows).

    The registry mirrors the edge schema's provenance discipline (rules-layer
    US-004, draft form): one row per generated rule with its dialect clauses,
    source property, constraint statement id, retrieval time, confidence and
    status. Rows are sorted by ``rule_id`` for a deterministic, idempotent
    artifact; cells go through the strict TSV encoder.
    """
    ordered = sorted(rules, key=lambda r: r.rule_id)
    lines = ["\t".join(RULES_REGISTRY_COLUMNS)]
    for rule in ordered:
        cells = rule.registry_row()
        lines.append(
            "\t".join(encode_value(cells[c]) for c in RULES_REGISTRY_COLUMNS)
        )
    return "\n".join(lines) + "\n"


def write_rules_registry(rules: Sequence[ConstraintRule], path: str | Path) -> int:
    """Write the draft rules registry for *rules*; return the row count."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_rules_registry(rules), encoding="utf-8")
    return len(rules)


def constraint_file_rules(
    path: str | Path = PROPERTY_CONSTRAINTS_TSV,
) -> TranslationResult:
    """Load and translate the committed property-constraint artifact at *path*.

    A missing artifact yields an empty result (property constraints are optional —
    a graph with no constraint rules simply gains none), so the export never fails
    on its absence.
    """
    file = Path(path)
    if not file.exists():
        return TranslationResult(rules=(), skipped=())
    return translate(load_property_constraints(file))


def _iter_rules() -> Iterator[ConstraintRule]:  # pragma: no cover - convenience
    yield from constraint_file_rules().rules


__all__ = [
    "CONSTRAINT_KIND_BY_QID",
    "DEFAULT_CONFIDENCE",
    "INVERSE_CONSTRAINT_QID",
    "PROPERTY_CONSTRAINTS_TSV",
    "PROPERTY_CONSTRAINT_COLUMNS",
    "RULES_REGISTRY_COLUMNS",
    "RULES_REGISTRY_TSV",
    "SUBJECT_TYPE_CONSTRAINT_QID",
    "SYMMETRIC_CONSTRAINT_QID",
    "VALUE_TYPE_CONSTRAINT_QID",
    "ConstraintError",
    "ConstraintRule",
    "PropertyConstraint",
    "SkippedConstraint",
    "TranslationResult",
    "constraint_file_rules",
    "load_property_constraints",
    "render_rules_registry",
    "translate",
    "write_rules_registry",
]
