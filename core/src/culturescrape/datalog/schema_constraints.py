"""Compile the canonical schema's own constraints into Soufflé violation rules.

``shared/canonical-schema.json`` machine-readably declares, for every edge type,
which node ``:LABEL``\\ s its endpoints may carry (``from`` / ``to``), whether it is
``symmetric``, and — schema-wide — that a ``csid`` identifies exactly one node.
Those constraints have always existed as JSON but were never *checked logically*: an
edge whose start node is the wrong type was as valid to the logic program as any
other. This module is the "acquire the rules, don't hand-write them" move (rules-layer
US-001/US-002) applied to the schema itself — it turns each declared constraint into a
Datalog rule whose **output relation enumerates the violations**, so a real engine (or
the engine-free evaluator below) reports exactly which edges break the schema.

Like :mod:`culturescrape.datalog.constraints`, this is the datalog boundary and stays
**self-contained**: it reads a committed, provenanced replay artifact
(:data:`EDGE_CONSTRAINTS_TSV`) rather than reaching out to the TypeScript-side schema
at runtime. :func:`extract_edge_constraints` compiles that artifact from
``shared/canonical-schema.json`` when the monorepo checkout is present (resolving each
node-type *name* — ``culture`` — to its ``:LABEL`` — ``Culture`` — so the datalog reader
translates from resolved labels alone); a test ties the two together, the same pattern
the taxonomy and property-constraint extractors use.

Four translations, mirroring the schema's constraint kinds — all **Soufflé-only**
(negation-as-failure / inequality, which SWI-Prolog's untabled SLD resolution cannot
express safely), matching the integrity-rule direction of US-002:

* **from-type** → ``t_from_type_violation(X, Y) :- t(X, Y), !from_ok_t(X, Y).`` where
  the support relation ``from_ok_t(X, Y) :- t(X, Y), instance_of(X, "L").`` collects the
  edges whose start is (transitively, over the P279 ``instance_of`` closure) one of the
  allowed labels ``L``. The violation is the edges with no allowed start label.
* **to-type** → the same on the object ``Y`` (``to_ok_t`` / ``t_to_type_violation``).
* **symmetry** → ``t_symmetry_violation(X, Y) :- t(X, Y), !t(Y, X).`` — a
  declared-symmetric edge missing its reverse. (No corpus edge declares ``symmetric``
  today, so this fires for none; it is compiled for forward safety.)
* **csid-uniqueness** → ``csid_uniqueness_violation(C, N) :- node(C, T1, N),
  node(C, T2, M), N != M.`` — one ``csid`` projected under two different names, i.e. a
  duplicate identity.

Every generated rule keeps **binary** heads and predicates (the support relations carry
both endpoints so ``!from_ok_t`` negates over the ``(X, Y)`` pair rather than an unsafe
unary ``!from_ok_t(X)``), so the emitters' arity-2 assumption holds unchanged.

Each rule carries the provenance of the schema it came from (``source =
canonical-schema``, ``source_url``, ``schema_version``, ``confidence``), so the compiled
rules flow through the rules registry (rules-layer US-004) with the discipline facts
already have. :func:`evaluate_schema_violations` is the **engine-free** authoritative
check — a small direct evaluator (the generic naive-fixpoint materialiser cannot express
negation) that computes each violation relation over projected facts, powering the
``schema-constraints`` CLI report and its CI ratchet.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from culturescrape.datalog import Fact
from culturescrape.datalog.edges import predicate_for_type
from culturescrape.datalog.rules import Rule
from culturescrape.schema.tsvio import encode_value, open_rows

#: The canonical schema in the monorepo checkout (the compile source). Absent in a
#: standalone vendored checkout — the extractor is then simply not runnable, and the
#: committed replay artifact remains the source of truth.
CANONICAL_SCHEMA_JSON = (
    Path(__file__).resolve().parents[4] / "shared" / "canonical-schema.json"
)

#: The committed replay artifact: the schema's edge constraints with node-type names
#: already resolved to ``:LABEL``\\ s, plus provenance. Read at runtime so this module
#: never depends on the monorepo layout.
EDGE_CONSTRAINTS_TSV = (
    Path(__file__).resolve().parent / "schema" / "edge_constraints.tsv"
)

#: The committed draft rules registry for the schema-derived rules (rules-layer US-004,
#: draft form) — mirrors :data:`~culturescrape.datalog.constraints.RULES_REGISTRY_TSV`.
SCHEMA_RULES_REGISTRY_TSV = (
    Path(__file__).resolve().parent / "schema" / "rules_registry.tsv"
)

#: Provenance for a schema-derived rule. The schema is *our own* set of axioms (not an
#: external acquisition), so confidence is ``1.0`` — the weak link the
#: property-constraint rules have (the property↔edge backing map) does not exist here.
SCHEMA_SOURCE = "canonical-schema"
SCHEMA_SOURCE_URL = "shared/canonical-schema.json"
SCHEMA_CONSTRAINT_CONFIDENCE = 1.0

#: The columns the committed edge-constraints artifact carries, in order.
#: ``from_labels`` / ``to_labels`` are ``;``-joined ``:LABEL``\\ s (blank when the
#: schema leaves that side unconstrained — its empty ``from``/``to`` list).
EDGE_CONSTRAINT_COLUMNS: tuple[str, ...] = (
    "edge_type",
    "from_labels",
    "to_labels",
    "symmetric",
    "source",
    "source_url",
    "schema_version",
    "confidence",
)

#: The columns the draft schema rules registry carries (dialect-neutral + provenance).
#: Soufflé-only rules, so only a ``clause_souffle`` column (no ``clause_prolog``).
SCHEMA_RULES_REGISTRY_COLUMNS: tuple[str, ...] = (
    "rule_id",
    "kind",
    "head",
    "clause_souffle",
    "edge_type",
    "source",
    "source_url",
    "schema_version",
    "confidence",
    "status",
)

_LABEL_SEP = ";"


class SchemaConstraintError(ValueError):
    """Raised when the schema or its edge-constraint artifact is malformed."""


@dataclass(frozen=True)
class EdgeConstraint:
    """One edge type's resolved schema constraints, pre-translation.

    *from_labels* / *to_labels* are the node ``:LABEL``\\ s the endpoints may carry (an
    empty tuple means the schema leaves that side unconstrained). *symmetric* is the
    schema's declared symmetry. The Wikidata↔corpus resolution the property constraints
    need has no analogue here — the schema already speaks in corpus node types — but the
    node-type *name* → ``:LABEL`` mapping is still resolved at extract time.
    """

    edge_type: str
    from_labels: tuple[str, ...]
    to_labels: tuple[str, ...]
    symmetric: bool
    source: str
    source_url: str
    schema_version: str
    confidence: float


@dataclass(frozen=True)
class SchemaConstraintRule:
    """A provenanced Soufflé rule compiled from one schema constraint.

    Schema rules are Soufflé-only (negation / inequality), so there is a single
    *souffle_clauses* tuple and :meth:`souffle_rule` yields the plain
    :class:`~culturescrape.datalog.rules.Rule` the emitter renders. The provenance
    fields mirror a schema axiom's, so the rule can flow through the registry gate.
    """

    rule_id: str
    kind: str
    head: str
    depends: tuple[str, ...]
    intent: str
    example: str
    souffle_clauses: tuple[str, ...]
    edge_type: str
    source: str
    source_url: str
    schema_version: str
    confidence: float
    status: str = "active"

    def souffle_rule(self) -> Rule:
        """The :class:`~culturescrape.datalog.rules.Rule` a Soufflé program receives."""
        return Rule(
            name=self.head,
            intent=self.intent,
            example=self.example,
            depends=self.depends,
            clauses=self.souffle_clauses,
        )

    def registry_row(self) -> dict[str, str]:
        """This rule as a draft schema-rules-registry row."""
        return {
            "rule_id": self.rule_id,
            "kind": self.kind,
            "head": self.head,
            "clause_souffle": " ".join(self.souffle_clauses),
            "edge_type": self.edge_type,
            "source": self.source,
            "source_url": self.source_url,
            "schema_version": self.schema_version,
            "confidence": repr(float(self.confidence)),
            "status": self.status,
        }


# --- extracting the constraints from the canonical schema -------------------


def extract_edge_constraints(
    schema_path: str | Path = CANONICAL_SCHEMA_JSON,
) -> list[EdgeConstraint]:
    """Compile the edge constraints from the canonical schema JSON at *schema_path*.

    Resolves every ``from``/``to`` node-type *name* to its ``:LABEL`` (so the datalog
    reader translates from resolved labels alone) and reads the declared ``symmetric``
    flag. Rows are returned sorted by ``edge_type`` for a deterministic artifact.

    Raises:
        SchemaConstraintError: If *schema_path* is missing, malformed, or names a
            ``from``/``to`` node type the schema does not declare.
    """
    path = Path(schema_path)
    if not path.exists():
        raise SchemaConstraintError(
            f"canonical schema not found at {path} (standalone checkout?)"
        )
    schema = json.loads(path.read_text(encoding="utf-8"))
    version = str(schema.get("version", ""))
    name_to_label = {
        node["name"]: node["label"] for node in schema.get("nodeTypes", [])
    }

    def resolve(names: Sequence[str], edge_type: str, role: str) -> tuple[str, ...]:
        labels: list[str] = []
        for name in names:
            try:
                labels.append(name_to_label[name])
            except KeyError as exc:
                raise SchemaConstraintError(
                    f"edge {edge_type!r} {role} references unknown node type {name!r}"
                ) from exc
        return tuple(labels)

    constraints: list[EdgeConstraint] = []
    for edge in schema.get("edgeTypes", []):
        edge_type = edge["type"]
        constraints.append(
            EdgeConstraint(
                edge_type=edge_type,
                from_labels=resolve(edge.get("from", []), edge_type, "from"),
                to_labels=resolve(edge.get("to", []), edge_type, "to"),
                symmetric=bool(edge.get("symmetric")),
                source=SCHEMA_SOURCE,
                source_url=SCHEMA_SOURCE_URL,
                schema_version=version,
                confidence=SCHEMA_CONSTRAINT_CONFIDENCE,
            )
        )
    return sorted(constraints, key=lambda c: c.edge_type)


# --- reading / writing the committed replay artifact ------------------------


def _cell(row: dict[str, str | list[str]], key: str) -> str:
    value = row.get(key, "")
    if isinstance(value, list):
        raise SchemaConstraintError(
            f"column {key!r} is multi-valued, expected a scalar"
        )
    return value


def _split_labels(cell: str) -> tuple[str, ...]:
    return tuple(part for part in cell.split(_LABEL_SEP) if part)


def render_edge_constraints(constraints: Sequence[EdgeConstraint]) -> str:
    """Render *constraints* as the committed edge-constraints TSV (header + rows).

    Rows are sorted by ``edge_type``; the ``;``-joined label lists and every cell go
    through the strict TSV encoder, so the artifact is deterministic and idempotent.
    """
    ordered = sorted(constraints, key=lambda c: c.edge_type)
    lines = ["\t".join(EDGE_CONSTRAINT_COLUMNS)]
    for c in ordered:
        cells = {
            "edge_type": c.edge_type,
            "from_labels": _LABEL_SEP.join(c.from_labels),
            "to_labels": _LABEL_SEP.join(c.to_labels),
            "symmetric": "true" if c.symmetric else "false",
            "source": c.source,
            "source_url": c.source_url,
            "schema_version": c.schema_version,
            "confidence": repr(float(c.confidence)),
        }
        lines.append(
            "\t".join(encode_value(cells[col]) for col in EDGE_CONSTRAINT_COLUMNS)
        )
    return "\n".join(lines) + "\n"


def write_edge_constraints(
    constraints: Sequence[EdgeConstraint], path: str | Path
) -> int:
    """Write the edge-constraints artifact for *constraints*; return the row count."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_edge_constraints(constraints), encoding="utf-8")
    return len(constraints)


def load_edge_constraints(
    path: str | Path = EDGE_CONSTRAINTS_TSV,
) -> list[EdgeConstraint]:
    """Read the committed edge-constraints artifact at *path*.

    Validates the header carries ``edge_type`` and parses the ``;``-joined label lists,
    the ``symmetric`` flag and the ``confidence`` float. A missing artifact yields an
    empty list (schema constraints are optional — a dataset without the artifact simply
    gains no rules), so the export never fails on its absence.
    """
    file = Path(path)
    if not file.exists():
        return []
    columns, rows = open_rows(file)
    names = {getattr(column, "name", "") for column in columns}
    if "edge_type" not in names:
        raise SchemaConstraintError(
            f"{file} is missing the 'edge_type' column "
            f"(have: {', '.join(sorted(names))})"
        )
    constraints: list[EdgeConstraint] = []
    for row in rows:
        edge_type = _cell(row, "edge_type")
        if not edge_type:
            raise SchemaConstraintError(
                f"edge-constraint row has a blank edge_type: {row!r}"
            )
        confidence_cell = _cell(row, "confidence")
        try:
            confidence = float(confidence_cell) if confidence_cell else 1.0
        except ValueError as exc:
            raise SchemaConstraintError(
                f"edge-constraint row has a non-numeric confidence {confidence_cell!r}"
            ) from exc
        constraints.append(
            EdgeConstraint(
                edge_type=edge_type,
                from_labels=_split_labels(_cell(row, "from_labels")),
                to_labels=_split_labels(_cell(row, "to_labels")),
                symmetric=_cell(row, "symmetric").strip().lower() == "true",
                source=_cell(row, "source") or SCHEMA_SOURCE,
                source_url=_cell(row, "source_url") or SCHEMA_SOURCE_URL,
                schema_version=_cell(row, "schema_version"),
                confidence=confidence,
            )
        )
    return constraints


# --- translation to Soufflé rules -------------------------------------------


def _quote_label(label: str) -> str:
    """A Soufflé string constant for a node ``:LABEL`` (double-quoted, escaped)."""
    escaped = label.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _type_rules(
    c: EdgeConstraint, predicate: str, *, on_subject: bool
) -> tuple[SchemaConstraintRule, SchemaConstraintRule]:
    """The (support, violation) rule pair for one edge type's from/to constraint."""
    role = "from" if on_subject else "to"
    var = "X" if on_subject else "Y"
    labels = c.from_labels if on_subject else c.to_labels
    support_head = f"{role}_ok_{predicate}"
    violation_head = f"{predicate}_{role}_type_violation"

    support_clauses = tuple(
        f"{support_head}(X, Y) :- {predicate}(X, Y), "
        f"instance_of({var}, {_quote_label(label)})."
        for label in labels
    )
    allowed = ", ".join(labels)
    support = SchemaConstraintRule(
        rule_id=f"schema-{predicate}-{role}-ok",
        kind=f"{role}-type-support",
        head=support_head,
        depends=(predicate, "instance_of"),
        intent=(
            f"{support_head}(X, Y): a {c.edge_type} edge whose {role} endpoint is "
            f"(transitively) an instance of one of its allowed types ({allowed}). The "
            f"support relation the {role}-type violation rule negates over."
        ),
        example=(
            f"?- {support_head}(X, Y).\n"
            f"Given {predicate}('cs:a', 'cs:b') and instance_of('cs:{var.lower()}', "
            f"{_quote_label(labels[0])}), ('cs:a', 'cs:b') is a permitted edge."
        ),
        souffle_clauses=support_clauses,
        edge_type=c.edge_type,
        source=c.source,
        source_url=c.source_url,
        schema_version=c.schema_version,
        confidence=c.confidence,
    )
    violation = SchemaConstraintRule(
        rule_id=f"schema-{predicate}-{role}-type",
        kind=f"{role}-type",
        head=violation_head,
        depends=(predicate, support_head),
        intent=(
            f"{violation_head}(X, Y): a {c.edge_type} edge whose {role} endpoint is "
            f"not (transitively) any of its schema-allowed types ({allowed}) — a "
            f"violation "
            f"of the canonical schema's {role} constraint. Integrity rule (Soufflé "
            "stratified negation over the instance_of closure)."
        ),
        example=(
            f"?- {violation_head}(X, Y).\n"
            f"With {predicate}('cs:a', 'cs:b') where {support_head}('cs:a', 'cs:b') "
            "does not hold, ('cs:a', 'cs:b') is enumerated as a violation."
        ),
        souffle_clauses=(
            f"{violation_head}(X, Y) :- {predicate}(X, Y), !{support_head}(X, Y).",
        ),
        edge_type=c.edge_type,
        source=c.source,
        source_url=c.source_url,
        schema_version=c.schema_version,
        confidence=c.confidence,
    )
    return support, violation


def _symmetry_rule(c: EdgeConstraint, predicate: str) -> SchemaConstraintRule:
    head = f"{predicate}_symmetry_violation"
    return SchemaConstraintRule(
        rule_id=f"schema-{predicate}-symmetry",
        kind="symmetry",
        head=head,
        depends=(predicate,),
        intent=(
            f"{head}(X, Y): a {c.edge_type} edge with no reverse edge, though the "
            "schema declares the type symmetric — a violation. Integrity rule "
            "(Soufflé negation)."
        ),
        example=(
            f"?- {head}(X, Y).\n"
            f"With {predicate}('cs:a', 'cs:b') but no {predicate}('cs:b', 'cs:a'), "
            "('cs:a', 'cs:b') is enumerated as a violation."
        ),
        souffle_clauses=(f"{head}(X, Y) :- {predicate}(X, Y), !{predicate}(Y, X).",),
        edge_type=c.edge_type,
        source=c.source,
        source_url=c.source_url,
        schema_version=c.schema_version,
        confidence=c.confidence,
    )


def _csid_uniqueness_rule(schema_version: str) -> SchemaConstraintRule:
    head = "csid_uniqueness_violation"
    return SchemaConstraintRule(
        rule_id="schema-csid-uniqueness",
        kind="csid-uniqueness",
        head=head,
        depends=("node",),
        intent=(
            f"{head}(C, N): a csid projected under two different names — a duplicate "
            "identity, violating the schema's rule that a csid identifies exactly one "
            "node. Integrity rule (Soufflé inequality)."
        ),
        example=(
            f"?- {head}(C, N).\n"
            "With node('cs:x', T1, 'Alpha') and node('cs:x', T2, 'Beta'), both "
            "('cs:x', 'Alpha') and ('cs:x', 'Beta') are enumerated as violations."
        ),
        souffle_clauses=(
            f"{head}(C, N) :- node(C, T1, N), node(C, T2, M), N != M.",
        ),
        edge_type="",
        source=SCHEMA_SOURCE,
        source_url=SCHEMA_SOURCE_URL,
        schema_version=schema_version,
        confidence=SCHEMA_CONSTRAINT_CONFIDENCE,
    )


def schema_constraint_rules(
    constraints: Sequence[EdgeConstraint],
) -> tuple[SchemaConstraintRule, ...]:
    """Compile *constraints* into the Soufflé violation-rule set.

    For each edge type: a from-type support+violation pair (when ``from`` is
    constrained), a to-type pair (when ``to`` is constrained), and a symmetry-violation
    rule (when declared symmetric). One schema-wide csid-uniqueness rule is appended.
    """
    rules: list[SchemaConstraintRule] = []
    version = ""
    for c in constraints:
        version = version or c.schema_version
        predicate = predicate_for_type(c.edge_type)
        if c.from_labels:
            rules.extend(_type_rules(c, predicate, on_subject=True))
        if c.to_labels:
            rules.extend(_type_rules(c, predicate, on_subject=False))
        if c.symmetric:
            rules.append(_symmetry_rule(c, predicate))
    rules.append(_csid_uniqueness_rule(version))
    return tuple(rules)


def schema_constraint_file_rules(
    path: str | Path = EDGE_CONSTRAINTS_TSV,
) -> tuple[SchemaConstraintRule, ...]:
    """Load the committed edge-constraints artifact and compile its rules.

    A missing artifact yields an empty tuple (schema constraints are optional), so the
    export never fails on its absence.
    """
    constraints = load_edge_constraints(path)
    if not constraints:
        return ()
    return schema_constraint_rules(constraints)


def souffle_rules(rules: Sequence[SchemaConstraintRule]) -> tuple[Rule, ...]:
    """The plain :class:`~culturescrape.datalog.rules.Rule`\\ s a Soufflé run gets."""
    return tuple(r.souffle_rule() for r in rules if r.status == "active")


# --- the draft rules registry -----------------------------------------------


def render_schema_rules_registry(rules: Sequence[SchemaConstraintRule]) -> str:
    """Render *rules* as the draft schema-rules-registry TSV (header + rows)."""
    ordered = sorted(rules, key=lambda r: r.rule_id)
    lines = ["\t".join(SCHEMA_RULES_REGISTRY_COLUMNS)]
    for rule in ordered:
        cells = rule.registry_row()
        lines.append(
            "\t".join(encode_value(cells[c]) for c in SCHEMA_RULES_REGISTRY_COLUMNS)
        )
    return "\n".join(lines) + "\n"


def write_schema_rules_registry(
    rules: Sequence[SchemaConstraintRule], path: str | Path
) -> int:
    """Write the draft schema rules registry for *rules*; return the row count."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_schema_rules_registry(rules), encoding="utf-8")
    return len(rules)


# --- engine-free violation evaluation ---------------------------------------

#: A materialised violation tuple (start, end) — or (csid, name) for csid-uniqueness.
ViolationPair = tuple[str, str]


def _label_closure(
    base: dict[str, set[str]], subclass_of: dict[str, set[str]]
) -> dict[str, set[str]]:
    """Close each csid's base ``:LABEL``\\ s upward over the ``subclass_of`` taxonomy.

    Mirrors the ``instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)`` closure
    the Soufflé rules negate over, so a leaf-class node answers for its ancestors too.
    """
    closed: dict[str, set[str]] = {}
    for csid, labels in base.items():
        seen = set(labels)
        stack = list(labels)
        while stack:
            label = stack.pop()
            for parent in subclass_of.get(label, ()):
                if parent not in seen:
                    seen.add(parent)
                    stack.append(parent)
        closed[csid] = seen
    return closed


def evaluate_schema_violations(
    facts: Iterable[Fact], constraints: Sequence[EdgeConstraint]
) -> dict[str, list[ViolationPair]]:
    """Compute every schema-violation relation's tuples over *facts*, engine-free.

    The generic naive-fixpoint materialiser cannot express the negation the violation
    rules use, so this is a direct evaluator: it projects the base relations
    (``instance_of``/``subclass_of``/``node`` and each edge type's typed predicate),
    closes class membership over the P279 taxonomy, and enumerates, per constraint, the
    edges whose endpoint carries none of the allowed labels (from/to), the symmetric
    edges missing their reverse, and the csids projected under two names. Returns a dict
    keyed by violation-relation head, each mapping to the **sorted** offending tuples —
    the authoritative check the Soufflé program is validated against.
    """
    base_labels: dict[str, set[str]] = {}
    subclass_of: dict[str, set[str]] = {}
    node_names: dict[str, set[str]] = {}
    typed: dict[str, set[ViolationPair]] = {}
    edge_predicates = {predicate_for_type(c.edge_type) for c in constraints}

    for fact in facts:
        predicate = fact.predicate
        if predicate == "instance_of":
            base_labels.setdefault(str(fact.args[0]), set()).add(str(fact.args[1]))
        elif predicate == "subclass_of":
            subclass_of.setdefault(str(fact.args[0]), set()).add(str(fact.args[1]))
        elif predicate == "node":
            node_names.setdefault(str(fact.args[0]), set()).add(str(fact.args[2]))
        if predicate in edge_predicates:
            typed.setdefault(predicate, set()).add(
                (str(fact.args[0]), str(fact.args[1]))
            )

    labels = _label_closure(base_labels, subclass_of)
    result: dict[str, list[ViolationPair]] = {}

    for c in constraints:
        predicate = predicate_for_type(c.edge_type)
        edges = typed.get(predicate, set())
        if c.from_labels:
            allowed = set(c.from_labels)
            result[f"{predicate}_from_type_violation"] = sorted(
                (x, y) for (x, y) in edges if not labels.get(x, set()) & allowed
            )
        if c.to_labels:
            allowed = set(c.to_labels)
            result[f"{predicate}_to_type_violation"] = sorted(
                (x, y) for (x, y) in edges if not labels.get(y, set()) & allowed
            )
        if c.symmetric:
            result[f"{predicate}_symmetry_violation"] = sorted(
                (x, y) for (x, y) in edges if (y, x) not in edges
            )

    result["csid_uniqueness_violation"] = sorted(
        (csid, name)
        for csid, names in node_names.items()
        if len(names) > 1
        for name in names
    )
    return result


@dataclass(frozen=True)
class SchemaViolationReport:
    """A triaged summary of a dataset's schema violations.

    *counts* maps each violation relation to its tuple count (ordered by count then
    name); *total* is their sum; *samples* carries, per relation with violations, up to
    a bounded number of offending tuples with each endpoint's base ``:LABEL``\\ s — the
    triage detail a committed report records.
    """

    schema_version: str
    counts: dict[str, int]
    total: int
    samples: dict[str, list[dict[str, object]]]

    def to_json(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "total": self.total,
            "counts": self.counts,
            "samples": self.samples,
        }


def schema_violation_report(
    facts: Iterable[Fact],
    constraints: Sequence[EdgeConstraint],
    *,
    sample_limit: int = 10,
) -> SchemaViolationReport:
    """Evaluate *constraints* over *facts* and summarise the violations for a report.

    Runs :func:`evaluate_schema_violations`, then attaches per-relation counts and, for
    each relation that has violations, up to *sample_limit* offending tuples annotated
    with the endpoints' base ``:LABEL``\\ s (so the committed report enumerates *and*
    triages what broke). Deterministic: counts are ordered, samples are the sorted head.
    """
    fact_list = list(facts)
    base_labels: dict[str, set[str]] = {}
    for fact in fact_list:
        if fact.predicate == "instance_of":
            base_labels.setdefault(str(fact.args[0]), set()).add(str(fact.args[1]))

    violations = evaluate_schema_violations(fact_list, constraints)
    counts = {head: len(pairs) for head, pairs in violations.items()}
    counts = dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))

    samples: dict[str, list[dict[str, object]]] = {}
    for head, pairs in violations.items():
        if not pairs:
            continue
        rows: list[dict[str, object]] = []
        for start, end in pairs[:sample_limit]:
            rows.append(
                {
                    "start": start,
                    "end": end,
                    "start_labels": sorted(base_labels.get(start, set())),
                    "end_labels": sorted(base_labels.get(end, set())),
                }
            )
        samples[head] = rows

    version = constraints[0].schema_version if constraints else ""
    return SchemaViolationReport(
        schema_version=version,
        counts=counts,
        total=sum(counts.values()),
        samples=samples,
    )


__all__ = [
    "CANONICAL_SCHEMA_JSON",
    "EDGE_CONSTRAINTS_TSV",
    "EDGE_CONSTRAINT_COLUMNS",
    "SCHEMA_CONSTRAINT_CONFIDENCE",
    "SCHEMA_RULES_REGISTRY_COLUMNS",
    "SCHEMA_RULES_REGISTRY_TSV",
    "SCHEMA_SOURCE",
    "SCHEMA_SOURCE_URL",
    "EdgeConstraint",
    "SchemaConstraintError",
    "SchemaConstraintRule",
    "SchemaViolationReport",
    "ViolationPair",
    "evaluate_schema_violations",
    "extract_edge_constraints",
    "load_edge_constraints",
    "render_edge_constraints",
    "render_schema_rules_registry",
    "schema_constraint_file_rules",
    "schema_constraint_rules",
    "schema_violation_report",
    "souffle_rules",
    "write_edge_constraints",
    "write_schema_rules_registry",
]
