"""EXPERIMENTAL — a YAGO 4.5 facts+SHACL evaluation prototype (rules-layer US-005).

YAGO 4.5 (Suchanek et al., SIGIR 2024) is a packaged, Wikidata-derived knowledge base:
~50M entities, ~132M facts, a ~133k-class taxonomy rooted at schema.org, and a set of
SHACL shapes that enforce logical consistency. The rules layer asks: is it a shortcut
to breadth *and* axioms, or is it redundant with the Wikidata path we already run?

This module answers that empirically over a small, committed sample (``yago_sample/``,
hand-authored to mimic YAGO 4.5's structure — see its ``README.md``; a real ingestion
would ``rdflib``-parse the CC-BY-SA dumps). It:

1. **parses** a YAGO facts + taxonomy N-Triples slice and a SHACL Turtle slice with
   dependency-free mini-parsers (:func:`parse_ntriples`, :func:`parse_turtle`);
2. **maps the taxonomy** onto the canonical schema — each class carries a
   ``ys:fromClass`` link to its Wikidata class, so :func:`map_taxonomy` resolves it to a
   corpus ``:LABEL`` via the corpus' own class-QID table and classifies every
   ``rdfs:subClassOf`` edge as *redundant* (already in our P279 artifact), *novel*
   (both ends map, new to us) or *partial/unmapped*;
3. **translates a subset of SHACL shapes** into registry-style violation rules
   (:func:`translate_shapes`) — subject/value-type → ``!instance_of`` integrity rules
   (the US-002/US-003 shape), ``sh:maxCount 1`` → a functional-violation rule; ``sh:or``
   ranges, literal ``sh:datatype`` constraints, out-of-vocabulary properties and
   unmapped subject classes are skipped and *reported*, never guessed;
4. **measures overlap / added value** vs the current corpus (:func:`evaluate`) — how
   much of YAGO's taxonomy and how many of its shapes are things we already have.

**Not production.** Nothing here is imported by the acquisition/export path or the
CLI's live commands; the write-up (``docs/yago-evaluation.md``) is the deliverable and
this is its evidence. The measured summary is pinned to
``docs/yago-evaluation-report.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from pinakes_engine.acquire.taxonomy import CORPUS_CLASS_QIDS
from pinakes_engine.datalog.edges import predicate_for_type
from pinakes_engine.datalog.registry import load_registry
from pinakes_engine.datalog.taxonomy import load_subclass_edges

# --- the committed sample ----------------------------------------------------

SAMPLE_DIR = Path(__file__).resolve().parent / "yago_sample"
TAXONOMY_NT = SAMPLE_DIR / "yago-taxonomy.nt"
FACTS_NT = SAMPLE_DIR / "yago-facts.nt"
SHAPES_TTL = SAMPLE_DIR / "yago-shapes.ttl"

#: Provenance stamped on rules translated from the sample (a live re-ingest would set
#: ``retrieved_at`` to the download date and ``source_url`` unchanged).
SOURCE = "yago-4.5"
SOURCE_URL = "https://yago-knowledge.org/downloads/yago-4-5"
SAMPLE_RETRIEVED_AT = "2026-07-13T00:00:00Z"
RULE_CONFIDENCE = 0.9

#: The evaluation's bottom line, cross-checked against ``docs/yago-evaluation.md``.
RECOMMENDATION = "partially-adopt"

# --- well-known IRIs ---------------------------------------------------------

RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf"
YS_FROM_CLASS = "http://yago-knowledge.org/schema#fromClass"
YS_FROM_PROPERTY = "http://yago-knowledge.org/schema#fromProperty"
WIKIDATA_ENTITY_PREFIX = "http://www.wikidata.org/entity/"

_SH = "http://www.w3.org/ns/shacl#"
SH_NODE_SHAPE = _SH + "NodeShape"
SH_TARGET_CLASS = _SH + "targetClass"
SH_PROPERTY = _SH + "property"
SH_PATH = _SH + "path"
SH_NODE = _SH + "node"
SH_CLASS = _SH + "class"
SH_DATATYPE = _SH + "datatype"
SH_MAX_COUNT = _SH + "maxCount"
SH_MIN_COUNT = _SH + "minCount"
SH_OR = _SH + "or"

#: Corpus ``:LABEL`` for each Wikidata class QID — the inverse of the corpus' own
#: class-QID table, so this prototype never drifts from the map the taxonomy acquirer
#: uses. YAGO's ``ys:fromClass`` gives us the QID; this gives us the label.
QID_TO_LABEL: dict[str, str] = {qid: label for label, qid in CORPUS_CLASS_QIDS.items()}

#: YAGO/schema.org property IRI → canonical-schema edge ``:TYPE``. Deliberately small:
#: YAGO's 108 properties are schema.org-centric (person/organization/creative-work), so
#: few align with the corpus' socio-cultural edge vocabulary — a finding the evaluation
#: measures, not a gap to paper over.
YAGO_PROPERTY_MAP: dict[str, str] = {
    "http://schema.org/containedInPlace": "LOCATED_IN",
    "http://schema.org/location": "LOCATED_IN",
}


class YagoParseError(ValueError):
    """Raised when a sample file cannot be parsed."""


# --- N-Triples ---------------------------------------------------------------


@dataclass(frozen=True)
class Triple:
    """One N-Triples statement. *obj* is the object IRI or, for a literal, its lexical
    value; *obj_is_literal* distinguishes the two."""

    subject: str
    predicate: str
    obj: str
    obj_is_literal: bool


_NT_IRI = r"<([^>]*)>"
_NT_LITERAL = r'"((?:[^"\\]|\\.)*)"(?:\^\^<[^>]*>|@[A-Za-z][A-Za-z0-9-]*)?'
_NT_LINE = re.compile(
    rf"\A\s*{_NT_IRI}\s+{_NT_IRI}\s+(?:{_NT_IRI}|{_NT_LITERAL})\s*\.\s*\Z"
)


def parse_ntriples(text: str) -> list[Triple]:
    """Parse an N-Triples document (IRI subject/predicate; IRI or literal object).

    Blank lines and ``#`` comment lines are skipped. Any non-blank, non-comment line
    that is not a well-formed triple raises :class:`YagoParseError` — the sample is
    meant to be clean.
    """
    triples: list[Triple] = []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _NT_LINE.match(line)
        if match is None:
            raise YagoParseError(f"line {lineno}: not a valid N-Triple: {raw!r}")
        subject, predicate, obj_iri, obj_lit = match.groups()
        if obj_iri is not None:
            triples.append(Triple(subject, predicate, obj_iri, obj_is_literal=False))
        else:
            triples.append(Triple(subject, predicate, obj_lit, obj_is_literal=True))
    return triples


# --- a Turtle subset (enough for YAGO's SHACL shapes) ------------------------


@dataclass(frozen=True)
class Literal:
    """A Turtle literal (its lexical value; datatype/lang are irrelevant here)."""

    value: str


@dataclass(frozen=True)
class BlankNode:
    """An inline ``[ ... ]`` blank node: its predicate→objects map."""

    predicates: dict[str, list[TurtleObject]]


@dataclass(frozen=True)
class Collection:
    """An RDF ``( ... )`` collection."""

    items: list[TurtleObject]


#: A parsed Turtle object: a resolved IRI (``str``), a literal, a blank node, or a list.
TurtleObject = str | Literal | BlankNode | Collection

#: One parsed top-level statement: subject IRI → predicate IRI → objects.
TurtleStatement = tuple[str, dict[str, list[TurtleObject]]]

_PREFIX_RE = re.compile(r"@prefix\s+([A-Za-z][\w-]*):\s+<([^>]*)>\s*\.")
_TOKEN_RE = re.compile(
    r"""
      (?P<WS>\s+)
    | (?P<COMMENT>\#[^\n]*)
    | (?P<IRI><[^>]*>)
    | (?P<STRING>"(?:[^"\\]|\\.)*")
    | (?P<LANG>@[A-Za-z][A-Za-z0-9-]*)
    | (?P<CARET>\^\^)
    | (?P<NUMBER>-?\d+(?:\.\d+)?)
    | (?P<PNAME>[A-Za-z][\w.-]*:[A-Za-z_][\w.\-]*)
    | (?P<A>a(?=[\s;,.\]]|\Z))
    | (?P<PUNCT>[;,.\[\]()])
    """,
    re.VERBOSE,
)


class _Turtle:
    """A tiny recursive-descent parser for the Turtle subset YAGO's SHACL uses.

    Handles ``@prefix`` directives, prefixed names / IRIs / string+number literals, the
    ``a`` keyword, ``;``/``,`` predicate-object lists, ``[ ... ]`` blank nodes and
    ``( ... )`` collections — no more. Anything outside the subset raises.
    """

    def __init__(self, text: str) -> None:
        self.prefixes: dict[str, str] = {}
        body = _PREFIX_RE.sub(self._record_prefix, text)
        self.tokens: list[tuple[str, str]] = []
        pos = 0
        length = len(body)
        while pos < length:
            match = _TOKEN_RE.match(body, pos)
            if match is None:
                raise YagoParseError(
                    f"unexpected character at offset {pos}: {body[pos]!r}"
                )
            pos = match.end()
            kind = match.lastgroup
            assert kind is not None
            if kind in ("WS", "COMMENT"):
                continue
            self.tokens.append((kind, match.group()))
        self.index = 0

    def _record_prefix(self, match: re.Match[str]) -> str:
        self.prefixes[match.group(1)] = match.group(2)
        return ""

    def _resolve(self, kind: str, value: str) -> str:
        if kind == "IRI":
            return value[1:-1]
        prefix, _, local = value.partition(":")
        if prefix not in self.prefixes:
            raise YagoParseError(f"unknown prefix {prefix!r} in {value!r}")
        return self.prefixes[prefix] + local

    def _peek(self) -> tuple[str, str] | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def _next(self) -> tuple[str, str]:
        token = self._peek()
        if token is None:
            raise YagoParseError("unexpected end of input")
        self.index += 1
        return token

    def _expect_punct(self, value: str) -> None:
        kind, got = self._next()
        if kind != "PUNCT" or got != value:
            raise YagoParseError(f"expected {value!r}, got {got!r}")

    def parse(self) -> list[TurtleStatement]:
        statements: list[TurtleStatement] = []
        while self._peek() is not None:
            subject_kind, subject_value = self._next()
            if subject_kind not in ("IRI", "PNAME"):
                raise YagoParseError(f"expected a subject, got {subject_value!r}")
            predicates = self._parse_predicate_object_list()
            self._expect_punct(".")
            statements.append((self._resolve(subject_kind, subject_value), predicates))
        return statements

    def _parse_predicate_object_list(self) -> dict[str, list[TurtleObject]]:
        result: dict[str, list[TurtleObject]] = {}
        while True:
            kind, value = self._next()
            predicate = RDF_TYPE if kind == "A" else self._resolve(kind, value)
            result.setdefault(predicate, []).extend(self._parse_object_list())
            nxt = self._peek()
            if nxt is not None and nxt == ("PUNCT", ";"):
                self._next()
                following = self._peek()
                closers = (("PUNCT", "."), ("PUNCT", "]"))
                if following is not None and following in closers:
                    break  # trailing ';'
                continue
            break
        return result

    def _parse_object_list(self) -> list[TurtleObject]:
        objects = [self._parse_object()]
        while self._peek() == ("PUNCT", ","):
            self._next()
            objects.append(self._parse_object())
        return objects

    def _parse_object(self) -> TurtleObject:
        kind, value = self._next()
        if kind == "PUNCT" and value == "[":
            predicates = self._parse_predicate_object_list()
            self._expect_punct("]")
            return BlankNode(predicates)
        if kind == "PUNCT" and value == "(":
            items: list[TurtleObject] = []
            while self._peek() != ("PUNCT", ")"):
                items.append(self._parse_object())
            self._next()
            return Collection(items)
        if kind == "STRING":
            nxt = self._peek()
            if nxt is not None and nxt[0] == "LANG":
                self._next()
            elif nxt is not None and nxt[0] == "CARET":
                self._next()
                self._next()  # the datatype IRI/pname
            return Literal(value[1:-1])
        if kind == "NUMBER":
            return Literal(value)
        if kind in ("IRI", "PNAME"):
            return self._resolve(kind, value)
        raise YagoParseError(f"unexpected object token {value!r}")


def parse_turtle(text: str) -> list[TurtleStatement]:
    """Parse the Turtle subset YAGO's SHACL shapes use into resolved statements."""
    return _Turtle(text).parse()


# --- SHACL shapes ------------------------------------------------------------


@dataclass(frozen=True)
class PropertyShape:
    """One ``sh:property`` block of a node shape."""

    path: str | None
    value_class: str | None
    datatype: str | None
    max_count: int | None
    min_count: int | None
    has_or: bool
    from_property: str | None


@dataclass(frozen=True)
class NodeShape:
    """A ``sh:NodeShape`` — a class and the property shapes constraining it."""

    shape_iri: str
    target_class: str | None
    properties: tuple[PropertyShape, ...]


def _first_iri(objects: list[TurtleObject]) -> str | None:
    for obj in objects:
        if isinstance(obj, str):
            return obj
    return None


def _first_int(objects: list[TurtleObject]) -> int | None:
    for obj in objects:
        if isinstance(obj, Literal) and obj.value.lstrip("-").isdigit():
            return int(obj.value)
    return None


def _property_shape(node: BlankNode) -> PropertyShape:
    preds = node.predicates
    value_class = _first_iri(preds.get(SH_NODE, [])) or _first_iri(
        preds.get(SH_CLASS, [])
    )
    return PropertyShape(
        path=_first_iri(preds.get(SH_PATH, [])),
        value_class=value_class,
        datatype=_first_iri(preds.get(SH_DATATYPE, [])),
        max_count=_first_int(preds.get(SH_MAX_COUNT, [])),
        min_count=_first_int(preds.get(SH_MIN_COUNT, [])),
        has_or=SH_OR in preds,
        from_property=_first_iri(preds.get(YS_FROM_PROPERTY, [])),
    )


def extract_shapes(statements: list[TurtleStatement]) -> list[NodeShape]:
    """The ``sh:NodeShape``s among *statements*, with their property shapes."""
    shapes: list[NodeShape] = []
    for subject, preds in statements:
        types = [obj for obj in preds.get(RDF_TYPE, []) if isinstance(obj, str)]
        if SH_NODE_SHAPE not in types:
            continue
        properties = tuple(
            _property_shape(obj)
            for obj in preds.get(SH_PROPERTY, [])
            if isinstance(obj, BlankNode)
        )
        shapes.append(
            NodeShape(
                shape_iri=subject,
                target_class=_first_iri(preds.get(SH_TARGET_CLASS, [])),
                properties=properties,
            )
        )
    return shapes


# --- taxonomy mapping --------------------------------------------------------


@dataclass(frozen=True)
class SubclassClassification:
    """A YAGO ``rdfs:subClassOf`` edge, resolved and classified against the corpus."""

    child_iri: str
    parent_iri: str
    child_label: str | None
    parent_label: str | None
    #: ``redundant`` (both map, already in our P279 artifact), ``novel`` (both map,
    #: new), ``partial`` (one end maps) or ``unmapped`` (neither maps).
    status: str


@dataclass(frozen=True)
class TaxonomyMapping:
    """The result of mapping a YAGO taxonomy slice onto the canonical schema."""

    class_to_label: dict[str, str]
    classes_with_fromclass: int
    classes_mapped: int
    classes_unmapped: int
    edges: tuple[SubclassClassification, ...]

    @property
    def novel_edges(self) -> tuple[SubclassClassification, ...]:
        return tuple(e for e in self.edges if e.status == "novel")


def _qid_of(entity_iri: str) -> str | None:
    if entity_iri.startswith(WIKIDATA_ENTITY_PREFIX):
        return entity_iri[len(WIKIDATA_ENTITY_PREFIX) :]
    return None


def map_taxonomy(
    triples: list[Triple],
    existing_edges: frozenset[tuple[str, str]] | None = None,
) -> TaxonomyMapping:
    """Resolve a YAGO taxonomy slice onto corpus ``:LABEL``s and classify its edges.

    ``ys:fromClass`` triples give each class its Wikidata QID → corpus ``:LABEL``;
    ``rdfs:subClassOf`` triples are then classified. *existing_edges* is the set of
    ``(child_label, parent_label)`` pairs already in our P279 artifact (defaults to the
    committed ``subclass_of.tsv``); an edge whose ends both map is *redundant* if it is
    in that set, else *novel*.
    """
    if existing_edges is None:
        existing_edges = frozenset(
            (edge.child, edge.parent) for edge in load_subclass_edges()
        )
    class_to_label: dict[str, str] = {}
    mapped = 0
    with_fromclass = 0
    for triple in triples:
        if triple.predicate != YS_FROM_CLASS or triple.obj_is_literal:
            continue
        with_fromclass += 1
        qid = _qid_of(triple.obj)
        label = QID_TO_LABEL.get(qid) if qid is not None else None
        if label is not None:
            class_to_label[triple.subject] = label
            mapped += 1

    edges: list[SubclassClassification] = []
    for triple in triples:
        if triple.predicate != RDFS_SUBCLASS_OF or triple.obj_is_literal:
            continue
        child_label = class_to_label.get(triple.subject)
        parent_label = class_to_label.get(triple.obj)
        if child_label is not None and parent_label is not None:
            status = (
                "redundant"
                if (child_label, parent_label) in existing_edges
                else "novel"
            )
        elif child_label is not None or parent_label is not None:
            status = "partial"
        else:
            status = "unmapped"
        edges.append(
            SubclassClassification(
                child_iri=triple.subject,
                parent_iri=triple.obj,
                child_label=child_label,
                parent_label=parent_label,
                status=status,
            )
        )
    return TaxonomyMapping(
        class_to_label=class_to_label,
        classes_with_fromclass=with_fromclass,
        classes_mapped=mapped,
        classes_unmapped=with_fromclass - mapped,
        edges=tuple(edges),
    )


# --- SHACL → registry-style rules --------------------------------------------


@dataclass(frozen=True)
class YagoRule:
    """A provenanced violation rule translated from one SHACL property constraint."""

    rule_id: str
    kind: str
    head: str
    clause_souffle: str
    depends: tuple[str, ...]
    from_property: str
    #: ``novel`` (head not in the committed registry) or ``redundant`` (already there).
    novelty: str

    def registry_row(self) -> dict[str, str]:
        return {
            "rule_id": self.rule_id,
            "kind": self.kind,
            "head": self.head,
            "clause_prolog": "",
            "clause_souffle": self.clause_souffle,
            "depends": ";".join(self.depends),
            "source": SOURCE,
            "source_url": SOURCE_URL,
            "retrieved_at": SAMPLE_RETRIEVED_AT,
            "confidence": repr(RULE_CONFIDENCE),
            "novelty": self.novelty,
        }


@dataclass(frozen=True)
class SkippedShape:
    """A property shape the translator could not turn into a rule, with the reason."""

    target_class: str | None
    path: str | None
    reason: str


@dataclass(frozen=True)
class ShapeTranslation:
    """The outcome of translating a set of node shapes."""

    rules: tuple[YagoRule, ...] = field(default_factory=tuple)
    skipped: tuple[SkippedShape, ...] = field(default_factory=tuple)

    @property
    def novel_rules(self) -> tuple[YagoRule, ...]:
        return tuple(r for r in self.rules if r.novelty == "novel")

    @property
    def redundant_rules(self) -> tuple[YagoRule, ...]:
        return tuple(r for r in self.rules if r.novelty == "redundant")


def translate_shapes(
    shapes: list[NodeShape],
    class_to_label: dict[str, str],
    known_heads: frozenset[str] | None = None,
) -> ShapeTranslation:
    """Translate SHACL shapes into registry-style violation rules.

    A shape's ``sh:targetClass`` must map to a corpus ``:LABEL`` (else the whole shape
    is skipped). For each property whose ``sh:path`` maps to a corpus edge:

    * the subject class → a ``{pred}_from_type_violation`` integrity rule;
    * ``sh:node``/``sh:class`` (range) mapping to a label → a
      ``{pred}_to_type_violation``;
    * ``sh:maxCount 1`` → a ``{pred}_functional_violation`` rule.

    A rule whose head already exists in the committed rules registry is *redundant*;
    ``sh:or`` ranges, literal ``sh:datatype``-only constraints, properties outside the
    corpus edge vocabulary and unmapped subject classes are skipped and reported.
    """
    if known_heads is None:
        known_heads = frozenset(entry.head for entry in load_registry())
    rules: list[YagoRule] = []
    skipped: list[SkippedShape] = []

    def novelty(head: str) -> str:
        return "redundant" if head in known_heads else "novel"

    for shape in shapes:
        subject_label = (
            class_to_label.get(shape.target_class)
            if shape.target_class is not None
            else None
        )
        if subject_label is None:
            for prop in shape.properties:
                skipped.append(
                    SkippedShape(
                        shape.target_class,
                        prop.path,
                        f"subject class {shape.target_class} not in corpus",
                    )
                )
            continue
        for prop in shape.properties:
            if prop.has_or:
                skipped.append(
                    SkippedShape(
                        shape.target_class,
                        prop.path,
                        "disjunctive range (sh:or) unsupported",
                    )
                )
                continue
            edge_type = YAGO_PROPERTY_MAP.get(prop.path or "")
            if edge_type is None:
                skipped.append(
                    SkippedShape(
                        shape.target_class,
                        prop.path,
                        f"property {prop.path} outside corpus edge vocabulary",
                    )
                )
                continue
            predicate = predicate_for_type(edge_type)
            slug = prop.from_property or (prop.path or "")

            head = f"{predicate}_from_type_violation"
            rules.append(
                YagoRule(
                    rule_id=f"yago-{predicate}-from-{subject_label}",
                    kind="subject-type",
                    head=head,
                    clause_souffle=(
                        f'{head}(X, Y) :- {predicate}(X, Y), '
                        f'!instance_of(X, "{subject_label}").'
                    ),
                    depends=(predicate, "instance_of"),
                    from_property=slug,
                    novelty=novelty(head),
                )
            )

            value_label = (
                class_to_label.get(prop.value_class)
                if prop.value_class is not None
                else None
            )
            if value_label is not None:
                head = f"{predicate}_to_type_violation"
                rules.append(
                    YagoRule(
                        rule_id=f"yago-{predicate}-to-{value_label}",
                        kind="value-type",
                        head=head,
                        clause_souffle=(
                            f'{head}(X, Y) :- {predicate}(X, Y), '
                            f'!instance_of(Y, "{value_label}").'
                        ),
                        depends=(predicate, "instance_of"),
                        from_property=slug,
                        novelty=novelty(head),
                    )
                )
            elif prop.value_class is not None:
                skipped.append(
                    SkippedShape(
                        shape.target_class,
                        prop.path,
                        f"value class {prop.value_class} not in corpus",
                    )
                )

            if prop.max_count == 1:
                head = f"{predicate}_functional_violation"
                rules.append(
                    YagoRule(
                        rule_id=f"yago-{predicate}-functional",
                        kind="functional",
                        head=head,
                        clause_souffle=(
                            f"{head}(X) :- {predicate}(X, Y1), "
                            f"{predicate}(X, Y2), Y1 != Y2."
                        ),
                        depends=(predicate,),
                        from_property=slug,
                        novelty=novelty(head),
                    )
                )

    return ShapeTranslation(rules=tuple(rules), skipped=tuple(skipped))


# --- the evaluation ----------------------------------------------------------


def _load(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:  # pragma: no cover - defensive
        raise YagoParseError(f"cannot read {path}: {exc}") from exc


def evaluate() -> dict[str, object]:
    """Run the whole evaluation over the committed sample and return a JSON summary.

    The summary quantifies overlap/added value: how much of YAGO's taxonomy is already
    in our P279 artifact vs novel, how many facts carry a Wikidata back-link (so are
    de-dup-able against our Wikidata path), and how many SHACL shapes translate to rules
    we already have vs new ones. Pinned to ``docs/yago-evaluation-report.json``.
    """
    taxonomy_triples = parse_ntriples(_load(TAXONOMY_NT))
    fact_triples = parse_ntriples(_load(FACTS_NT))
    shapes = extract_shapes(parse_turtle(_load(SHAPES_TTL)))

    mapping = map_taxonomy(taxonomy_triples)
    translation = translate_shapes(shapes, mapping.class_to_label)

    type_assertions = [t for t in fact_triples if t.predicate == RDF_TYPE]
    mappable = [t for t in fact_triples if t.predicate in YAGO_PROPERTY_MAP]
    backlinks = [
        t
        for t in fact_triples
        if not t.obj_is_literal and t.obj.startswith(WIKIDATA_ENTITY_PREFIX)
    ]

    edge_status_counts: dict[str, int] = {}
    for edge in mapping.edges:
        edge_status_counts[edge.status] = edge_status_counts.get(edge.status, 0) + 1

    property_shapes_total = sum(len(shape.properties) for shape in shapes)

    return {
        "recommendation": RECOMMENDATION,
        "taxonomy": {
            "classes_with_fromclass": mapping.classes_with_fromclass,
            "classes_mapped": mapping.classes_mapped,
            "classes_unmapped": mapping.classes_unmapped,
            "subclass_edges_total": len(mapping.edges),
            "subclass_edges_by_status": edge_status_counts,
            "novel_edges": [
                f"{e.child_label} subClassOf {e.parent_label}"
                for e in mapping.novel_edges
            ],
        },
        "facts": {
            "triples_total": len(fact_triples),
            "type_assertions": len(type_assertions),
            "typed_entities": len({t.subject for t in type_assertions}),
            "mappable_property_facts": len(mappable),
            "wikidata_backlinks": len(backlinks),
        },
        "shapes": {
            "node_shapes_total": len(shapes),
            "property_shapes_total": property_shapes_total,
            "property_shapes_translated": property_shapes_total
            - len(translation.skipped),
            "property_shapes_skipped": len(translation.skipped),
            "rules_produced": len(translation.rules),
            "rules_novel": len(translation.novel_rules),
            "rules_redundant": len(translation.redundant_rules),
            "skipped_reasons": sorted({s.reason for s in translation.skipped}),
            "rules": [rule.registry_row() for rule in translation.rules],
        },
    }


__all__ = [
    "BlankNode",
    "Collection",
    "Literal",
    "NodeShape",
    "PropertyShape",
    "RECOMMENDATION",
    "ShapeTranslation",
    "SkippedShape",
    "SubclassClassification",
    "TaxonomyMapping",
    "Triple",
    "YagoParseError",
    "YagoRule",
    "evaluate",
    "extract_shapes",
    "map_taxonomy",
    "parse_ntriples",
    "parse_turtle",
    "translate_shapes",
]
