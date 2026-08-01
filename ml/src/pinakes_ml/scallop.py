"""Scallop context export from the canonical relations (neurosymbolic roadmap Phase 5).

The neurosymbolic pilot loads the corpus into `scallopy <https://scallop-lang.org>`_
as its differentiable-logic substrate. This module is the **pure, engine-free core**
of that bridge (US-001):

* :func:`load_relations` reads the canonical **edge** export
  (``export/culturescrape/edges/*.tsv``) into per-relation ``(head, tail)`` fact
  lists — the same header-driven parse as :mod:`pinakes_ml.triples`, keyed by
  the lower-cased ``:TYPE`` so the predicate names line up with the Datalog rules.
* :func:`intern_symbols` assigns every csid a deterministic integer id (sorted
  vocab → index) so the relations can be exported as integer CSVs / tensors.
* :func:`translate_registry` translates the provenanced Horn-rule registry
  (``core/.../datalog/rules_registry.tsv``) into Scallop ``.scl``
  rules, **skipping and reporting** any rule it cannot express (see
  :class:`SkippedRule`).
* :func:`transitive_closure` is the engine-free reference derivation the scallopy
  smoke run is spot-checked against (:mod:`pinakes_ml.export_scallop`).

Everything here is a pure function over its inputs (no wall-clock, no network, no
``scallopy`` import) so the CI suite drives it with tiny fixtures and the committed
artifacts are byte-reproducible. The thin CLI + the *actual* scallopy smoke run
(local-only — the sole published ``scallopy`` wheel is macOS/arm64) live in
:mod:`pinakes_ml.export_scallop`.

**Why the translation is faithful.** A pure Horn clause — a head and positive
predicate literals over *variables* — plus comparison guards and stratified
negation is expressible identically in Soufflé and in Scallop: only the surface
syntax differs (``:-`` → ``=``, ``,`` → ``and``, ``!p`` → ``not p``, upper-case
variables → lower-case). The registry stores each rule's Soufflé clause text
(the most complete dialect — it carries the negation the Prolog column omits), so
we translate from :data:`_CLAUSE_COLUMN`. The single translatability constraint —
**every predicate literal must be binary** — is exactly the one the culture-scrape
materializer already imposes (``rules.ARITY == 2``); the one registry rule that
breaks it (``csid_uniqueness_violation`` reads the arity-3 ``node/3``) is skipped
and reported.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from pinakes_ml.triples import load_triples

# --- Registry columns --------------------------------------------------------

#: The registry column we translate from. Soufflé is the most complete dialect —
#: the schema/wikidata violation rules use negation, which the Prolog column
#: leaves blank (Soufflé-only). Curated rules are byte-identical across dialects,
#: so this is a superset choice, never a loss.
_CLAUSE_COLUMN = "clause_souffle"

#: Only ``active`` rules are emitted (the exporter's governance stance — mirrors
#: culture-scrape's ``active_curated_rules``). ``retired``/``proposed`` rules keep
#: their clauses in the registry but do not reach the program.
_ACTIVE_STATUS = "active"

# --- Type inference ----------------------------------------------------------

#: Base predicates whose SECOND argument is an integer value (a year), not a csid
#: entity — so the emitted ``.scl`` types them ``(<entity>, i32)`` and the temporal
#: comparison guards (``Ex >= Sy``) type-check. These dimension facts are not part
#: of the binary edge export, so they are declared-but-empty in the program.
_INT_SECOND_ARG = frozenset({"time_start", "time_end"})

#: The Scallop type of an entity argument. Csids are strings; keeping them strings
#: (rather than the interned ints) makes the ``.scl`` self-describing and lets a
#: mixed ``instance_of(Entity, "Culture")`` literal stay uniformly typed.
_ENTITY_TYPE = "String"

# --- Clause parsing ----------------------------------------------------------

# A predicate literal, optionally negated: ``!from_ok_x(X, Y)`` / ``edge(X, Y)``.
_PRED_RE = re.compile(r"^(!?)\s*([a-z_][a-zA-Z0-9_]*)\s*\((.*)\)$")
# A comparison guard: ``Ex >= Sy`` / ``N != M``. Longest operators first.
_CMP_RE = re.compile(r"^(.+?)\s*(<=|>=|!=|==|<|>)\s*(.+)$")
# A Prolog/Soufflé variable (upper-case or ``_`` initial). Lower-cased for Scallop.
_VAR_RE = re.compile(r"^[A-Z_][A-Za-z0-9_]*$")


class UntranslatableClause(ValueError):
    """Raised when a Horn clause cannot be expressed as a Scallop rule.

    The message is the human-readable reason recorded in :class:`SkippedRule`.
    """


@dataclass(frozen=True)
class RegistryRule:
    """One row of the provenanced rules registry (``rules_registry.tsv``)."""

    rule_id: str
    layer: str
    head: str
    clause: str
    depends: tuple[str, ...]
    status: str


@dataclass(frozen=True)
class TranslatedRule:
    """A registry rule successfully translated to Scallop ``rel`` clause(s)."""

    rule_id: str
    layer: str
    head: str
    #: One Scallop rule body per source clause (``head(args) = lit and lit``),
    #: WITHOUT the leading ``rel`` keyword (added by :func:`build_scl` / stripped
    #: for ``scallopy.add_rule``).
    rules: tuple[str, ...]
    #: Every predicate name the rule reads or defines (for type declaration).
    predicates: tuple[str, ...]


@dataclass(frozen=True)
class SkippedRule:
    """A registry rule the translator could not express, with the reason."""

    rule_id: str
    reason: str


@dataclass
class TranslationResult:
    """The outcome of translating a registry: the translated + skipped rules."""

    translated: list[TranslatedRule] = field(default_factory=list)
    skipped: list[SkippedRule] = field(default_factory=list)


# --- Corpus loading ----------------------------------------------------------


def relation_name(edge_type: str) -> str:
    """Map an edge ``:TYPE`` (``DESCENDS_FROM``) to its predicate (``descends_from``).

    Identical to the Datalog projection's ``predicate_for_type`` for the corpus's
    typed edges, so the loaded relations line up with the registry rule bodies.
    """
    return edge_type.lower()


def load_relations(edges_dir: Path | str) -> dict[str, list[tuple[str, str]]]:
    """Load ``edges/*.tsv`` into ``{relation: sorted [(head, tail), …]}``.

    Reuses :func:`pinakes_ml.triples.load_triples` (the same header-driven,
    dedup-on-``(head, relation, tail)`` parse) and re-keys by the lower-cased
    relation so the predicate names match the Horn rules. Output is sorted so the
    export is byte-reproducible.
    """
    grouped: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for triple in load_triples(edges_dir):
        grouped[relation_name(triple.relation)].add((triple.head, triple.tail))
    return {rel: sorted(pairs) for rel, pairs in sorted(grouped.items())}


def intern_symbols(relations: dict[str, list[tuple[str, str]]]) -> dict[str, int]:
    """Deterministic ``csid → int`` map: sorted unique entities → index.

    Every head/tail across every relation is a symbol; sorting before numbering
    makes the interning reproducible (a byte-identical corpus yields the same ids)
    and independent of relation iteration order.
    """
    symbols: set[str] = set()
    for pairs in relations.values():
        for head, tail in pairs:
            symbols.add(head)
            symbols.add(tail)
    return {sym: i for i, sym in enumerate(sorted(symbols))}


# --- Registry loading + translation -----------------------------------------


def load_registry(registry_path: Path | str) -> list[RegistryRule]:
    """Parse the unified rules registry TSV into :class:`RegistryRule`s.

    Header-driven (column order can't bite us). ``depends`` is the ``;``-joined
    dependency list. Rows are returned in file order.
    """
    lines = Path(registry_path).read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    for required in ("rule_id", "layer", "head", _CLAUSE_COLUMN, "depends", "status"):
        if required not in idx:
            raise ValueError(f"registry missing column {required!r}: {registry_path}")

    out: list[RegistryRule] = []
    for line in lines[1:]:
        if not line.strip():
            continue
        cols = line.split("\t")
        depends = cols[idx["depends"]].strip()
        out.append(
            RegistryRule(
                rule_id=cols[idx["rule_id"]],
                layer=cols[idx["layer"]],
                head=cols[idx["head"]],
                clause=cols[idx[_CLAUSE_COLUMN]],
                depends=tuple(d for d in depends.split(";") if d),
                status=cols[idx["status"]],
            )
        )
    return out


def _split_top(text: str, sep: str = ",") -> list[str]:
    """Split *text* on *sep* only at parenthesis depth 0 (args-safe)."""
    out: list[str] = []
    depth = 0
    cur = ""
    for ch in text:
        if ch == "(":
            depth += 1
            cur += ch
        elif ch == ")":
            depth -= 1
            cur += ch
        elif ch == sep and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return [piece.strip() for piece in out]


def split_clauses(cell: str) -> list[str]:
    """Split a registry clause cell into its ``.``-terminated clauses.

    A cell may hold multiple clauses (``ancestor(X, Y) :- … . ancestor(X, Y) :- … .``);
    registry clauses carry no other ``.`` (variables + quoted ``:LABEL``s only), so
    splitting on a depth-0 ``.`` is safe.
    """
    parts: list[str] = []
    depth = 0
    cur = ""
    for ch in cell:
        if ch == "(":
            depth += 1
            cur += ch
        elif ch == ")":
            depth -= 1
            cur += ch
        elif ch == "." and depth == 0:
            if cur.strip():
                parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def _translate_term(term: str) -> str:
    """Translate one argument: variable → lower-case; quoted constant → verbatim."""
    term = term.strip()
    if _VAR_RE.match(term):
        return term.lower()
    return term  # quoted string constant ("Culture") or literal — kept as-is


def _translate_literal(literal: str) -> tuple[str, list[str]]:
    """Translate one body literal → (scallop text, predicate names it reads).

    Raises :class:`UntranslatableClause` for a non-binary predicate literal or an
    unrecognised literal shape.
    """
    literal = literal.strip()
    pred = _PRED_RE.match(literal)
    if pred:
        negation, name, raw_args = pred.group(1), pred.group(2), pred.group(3)
        args = _split_top(raw_args)
        if len(args) != 2:
            raise UntranslatableClause(
                f"reads non-binary predicate {name}/{len(args)} "
                "(the pilot exports binary relations only)"
            )
        rendered = f"{name}({', '.join(_translate_term(a) for a in args)})"
        if negation:
            rendered = f"not {rendered}"
        return rendered, [name]

    cmp_match = _CMP_RE.match(literal)
    if cmp_match and "(" not in literal:
        lhs, op, rhs = cmp_match.group(1), cmp_match.group(2), cmp_match.group(3)
        return f"{_translate_term(lhs)} {op} {_translate_term(rhs)}", []

    raise UntranslatableClause(f"unrecognised literal {literal!r}")


def translate_clause(clause: str) -> tuple[str, list[str]]:
    """Translate one Horn clause ``head :- body.`` → (scallop rule, predicates).

    The scallop rule is ``head(args) = lit and lit and …`` (no ``rel`` keyword).
    The predicate list is every predicate name the clause reads or defines (head
    plus every body predicate literal) for type declaration.
    """
    head_str, sep, body_str = clause.partition(":-")
    if not sep:
        raise UntranslatableClause(f"not a Horn rule (no ':-'): {clause!r}")

    head_lit, head_preds = _translate_literal(head_str.strip())
    if head_preds and head_lit.startswith("not "):
        raise UntranslatableClause("negated head")

    predicates = list(head_preds)
    body_parts: list[str] = []
    for literal in _split_top(body_str):
        rendered, preds = _translate_literal(literal)
        body_parts.append(rendered)
        predicates.extend(preds)

    if not body_parts:
        raise UntranslatableClause(f"empty body: {clause!r}")

    return f"{head_lit} = {' and '.join(body_parts)}", predicates


def translate_rule(rule: RegistryRule) -> TranslatedRule:
    """Translate every clause of a registry rule; raises on an untranslatable clause."""
    rules: list[str] = []
    predicates: list[str] = []
    for clause in split_clauses(rule.clause):
        scallop_rule, preds = translate_clause(clause)
        rules.append(scallop_rule)
        predicates.extend(preds)
    if not rules:
        raise UntranslatableClause(f"no clauses: {rule.rule_id}")
    # Stable, de-duplicated predicate list.
    seen: dict[str, None] = {}
    for name in predicates:
        seen.setdefault(name, None)
    return TranslatedRule(
        rule_id=rule.rule_id,
        layer=rule.layer,
        head=rule.head,
        rules=tuple(rules),
        predicates=tuple(seen),
    )


def translate_registry(rules: list[RegistryRule]) -> TranslationResult:
    """Translate the active rules; collect the untranslatable ones with a reason.

    Non-``active`` rules are dropped silently (governance, not a translation
    failure). Output lists are sorted by ``rule_id`` for a reproducible manifest.
    """
    result = TranslationResult()
    for rule in rules:
        if rule.status != _ACTIVE_STATUS:
            continue
        try:
            result.translated.append(translate_rule(rule))
        except UntranslatableClause as exc:
            result.skipped.append(SkippedRule(rule_id=rule.rule_id, reason=str(exc)))
    result.translated.sort(key=lambda r: r.rule_id)
    result.skipped.sort(key=lambda r: r.rule_id)
    return result


# --- Scallop program emission ------------------------------------------------


def _base_predicates(translated: list[TranslatedRule]) -> list[str]:
    """Predicates read in some body but never defined by a rule head.

    These need an explicit ``type`` declaration in the ``.scl`` (a rule head is
    declared by its own rule). Sorted for determinism.
    """
    heads = {t.head for t in translated}
    used: set[str] = set()
    for t in translated:
        used.update(t.predicates)
    return sorted(used - heads)


def _type_decl(name: str) -> str:
    """The ``type`` declaration line for a base predicate."""
    second = "i32" if name in _INT_SECOND_ARG else _ENTITY_TYPE
    return f"type {name}({_ENTITY_TYPE}, {second})"


def build_scl(translated: list[TranslatedRule]) -> str:
    """Render the translated rules as a Scallop ``.scl`` program.

    Layout: a header comment, ``type`` declarations for every base predicate
    (so a rule body over an unpopulated relation compiles + answers empty rather
    than erroring), then the ``rel`` rules grouped by ``rule_id``. Deterministic
    (sorted decls, rule order) and ends with a trailing newline.
    """
    lines: list[str] = [
        "// Scallop program — canonical Horn rules (neurosymbolic roadmap Phase 5).",
        "// Generated from the provenanced rules registry by",
        "// pinakes_ml.export_scallop — do not edit by hand.",
        "",
    ]

    base = _base_predicates(translated)
    if base:
        lines.append("// Base relations (loaded from the canonical export as facts).")
        lines.extend(_type_decl(name) for name in base)
        lines.append("")

    for rule in translated:
        lines.append(f"// {rule.rule_id} ({rule.layer})")
        lines.extend(f"rel {clause}" for clause in rule.rules)
        lines.append("")

    body = "\n".join(lines).rstrip("\n") + "\n"
    return body


# --- Engine-free reference derivation (spot-check oracle) ---------------------


def transitive_closure(edges: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """Least-fixpoint transitive closure of a binary relation.

    The engine-free reference the scallopy smoke run is checked against — same
    semantics as culture-scrape's naive-fixpoint materializer for the recursive
    closure rules (``ancestor`` = closure of ``descends_from``,
    ``influenced_transitively`` = closure of ``derived_from ∪ influenced_by``).
    Terminates on cyclic input (the corpus ``descends_from`` carries a data-error
    cycle) — a set fixpoint, so a cycle just stops adding new pairs.
    """
    closure = set(edges)
    # successors[x] = {y : (x, y) in closure}
    while True:
        successors: dict[str, set[str]] = defaultdict(set)
        for head, tail in closure:
            successors[head].add(tail)
        new: set[tuple[str, str]] = set()
        for head, mid in closure:
            for tail in successors.get(mid, ()):
                if (head, tail) not in closure:
                    new.add((head, tail))
        if not new:
            return closure
        closure |= new


#: The rules the scallopy smoke run exercises over the real corpus: the acceptance
#: criterion's ``ancestor/2`` plus one cross-domain closure (``influenced_transitively``
#: mixes lineage ``derived_from`` and influence ``influenced_by``). Each maps its
#: derived head to the base relation(s) whose union it closes.
SMOKE_TARGETS: dict[str, tuple[str, ...]] = {
    "ancestor": ("descends_from",),
    "influenced_transitively": ("derived_from", "influenced_by"),
}


def reference_derivations(
    relations: dict[str, list[tuple[str, str]]],
) -> dict[str, set[tuple[str, str]]]:
    """Compute the reference extension of every :data:`SMOKE_TARGETS` head.

    A missing base relation contributes no edges (a rule body over an unpopulated
    relation answers empty), so this never raises on a sparse corpus.
    """
    out: dict[str, set[tuple[str, str]]] = {}
    for head, bases in SMOKE_TARGETS.items():
        edges: set[tuple[str, str]] = set()
        for base in bases:
            edges.update(relations.get(base, ()))
        out[head] = transitive_closure(edges)
    return out


# --- Manifest ----------------------------------------------------------------


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_manifest(
    relations: dict[str, list[tuple[str, str]]],
    symbols: dict[str, int],
    translation: TranslationResult,
    program_scl: str,
) -> dict[str, object]:
    """Deterministic export manifest: interning + relation counts + translation.

    Committed to git and snapshot-tested against a fresh build, so a corpus or
    registry change that moves the export fails CI. Contains NO wall-clock or
    environment data — only functions of the corpus + registry.
    """
    relation_counts = {rel: len(pairs) for rel, pairs in sorted(relations.items())}
    references = reference_derivations(relations)
    smoke = {
        head: {
            "baseRelations": list(SMOKE_TARGETS[head]),
            "baseFacts": sum(len(relations.get(b, ())) for b in SMOKE_TARGETS[head]),
            "derived": len(references[head]),
        }
        for head in sorted(SMOKE_TARGETS)
    }
    return {
        "counts": {
            "symbols": len(symbols),
            "relations": len(relation_counts),
            "facts": sum(relation_counts.values()),
            "rulesTranslated": len(translation.translated),
            "rulesSkipped": len(translation.skipped),
        },
        "relationCounts": relation_counts,
        "translatedRuleIds": [t.rule_id for t in translation.translated],
        "skippedRules": [
            {"ruleId": s.rule_id, "reason": s.reason} for s in translation.skipped
        ],
        "smoke": smoke,
        "programSha256": _sha256_text(program_scl),
    }


__all__ = [
    "RegistryRule",
    "SkippedRule",
    "SMOKE_TARGETS",
    "TranslatedRule",
    "TranslationResult",
    "UntranslatableClause",
    "build_manifest",
    "build_scl",
    "intern_symbols",
    "load_registry",
    "load_relations",
    "reference_derivations",
    "relation_name",
    "split_clauses",
    "transitive_closure",
    "translate_clause",
    "translate_registry",
    "translate_rule",
]
