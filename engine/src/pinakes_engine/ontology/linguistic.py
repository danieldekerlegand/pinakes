"""The linguistic linker: ``DESCENDS_FROM`` / ``SPOKEN_IN`` / ``BORROWED_FROM`` /
``COGNATE_WITH``.

Turns the linguistic dimension of the canonical schema (``docs/data-model.md``)
into edges so the network is navigable by language and word origin. The source
chosen in US-005 (``docs/sources-linguistic.md``) is Wikidata's language-family
``subclass of`` chain, so a **language** node references its ancestor by QID
(``parent_qid``) or by language code (``parent_code``, an ISO 639-3 / Glottocode,
the form a later Glottolog adapter will use). Given the node and edge sets the
linker:

* resolves each **language** node's ancestor reference to an ancestor language
  node — *reusing* an existing language that already carries that QID or code, or
  *creating* a minimal one — and links the two with **``DESCENDS_FROM``**, so a
  family tree's parent pointers become a connected descent chain;
* resolves each language node's place reference(s) (``place_qid``) to **place**
  nodes and links them with **``SPOKEN_IN``**;
* for **term** nodes carrying etymology (an ``etymon_qid`` pointing at the source
  lexeme, per Wikidata ``P5191``), emits **``BORROWED_FROM``** when the
  ``derivation_mode`` (``P5886``) marks a borrowing, and emits **``COGNATE_WITH``**
  between every pair of terms that share the same etymon (the inference
  ``docs/sources-linguistic.md`` records: two lexemes sharing a ``P5191`` etymon
  are cognate);
* for **wordform** nodes carrying a **cognate-set id** (``cognateset`` — a
  Lexibank CLDF ``Cognateset_ID``, source-breadth US-003), emits
  **``COGNATE_WITH``** linking every member of a cognate set to that set's
  representative form. A Lexibank cognate class can span *thousands* of doculects,
  so the fully-connected clique the etymon inference emits (``O(n²)`` per set) is
  intractable — a single ABVD cognate set of 1,500 forms would be ~1.1M edges. A
  **representative star** (each member → the lexicographically-first member's csid,
  ``n-1`` edges) keeps materialisation linear while preserving the cognate class as
  one connected component; cognacy is transitive within a set, so co-membership is
  still recoverable by following two hops through the representative.

Node creation needs more than the :class:`~pinakes_engine.ontology.linker.Linker`
contract returns (which is edges only), so the full result — new language / place
nodes *and* edges — is exposed through :meth:`LinguisticLinker.link_linguistic`;
:meth:`link` satisfies the pipeline interface by returning just that result's
edges.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar, Protocol

from pinakes_engine.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    LinkResult,
    Node,
    inferred_edge,
)
from pinakes_engine.ontology.registry import Dimension
from pinakes_engine.schema.ids import IdError, mint_csid, normalize_qid
from pinakes_engine.schema.kaikki_etymology import parse_relations_cell

#: The ``:LABEL`` token a language node carries.
LANGUAGE_LABEL = "Language"

#: The ``:LABEL`` token a term node carries.
TERM_LABEL = "Term"

#: The canonical edge ``:TYPE``s a kaikki etymology relation may emit — a guard so
#: a corrupt cell can never inject a non-registered type (see ``kaikki_etymology``).
ETYMOLOGY_EDGE_TYPES = frozenset({"BORROWED_FROM", "DERIVED_FROM", "COGNATE_WITH"})

#: Node overflow column (``schema.mapper.OVERFLOW_KEY``) holding unmapped source
#: cells as JSON — where a Lexibank ``cognateset`` id survives the normalize→disk→
#: link round-trip that a non-persisted dimension ref would not.
OVERFLOW_KEY = "extra"

#: ``derivation_mode`` values that mark a term as borrowed rather than inherited.
DEFAULT_BORROW_MODES = frozenset({"borrowing", "loanword"})

#: Runs of non-slug characters in a language code, collapsed to ``-``.
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


class _Emit(Protocol):
    """The callback the cognate pass adds an inferred edge with."""

    def __call__(
        self, start: str, end: str, rel: str, confidence: float
    ) -> None: ...


def _overflow(node: Node) -> dict[str, object]:
    """Parse a node's ``extra`` overflow JSON into a dict (``{}`` when absent)."""
    raw = node.get(OVERFLOW_KEY)
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _multi(row: Node | Edge, key: str) -> list[str]:
    """Return *row*'s cell for *key* as a list (tolerating a scalar or missing)."""
    value = row.get(key)
    if isinstance(value, list):
        return [v for v in value if v]
    if isinstance(value, str) and value:
        return [value]
    return []


def _labels(node: Node) -> list[str]:
    """Return *node*'s ``:LABEL`` tokens (tolerating a scalar or missing cell)."""
    value = node.get(":LABEL")
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []


def _code_local(code: str) -> str | None:
    """Return the ``csid`` local part for a language code, or ``None`` if empty."""
    safe = _NON_SLUG_RE.sub("-", code.lower()).strip("-")
    return f"lang-{safe}" if safe else None


def _form_key(lang: str, term: str) -> str:
    """A case-folded ``(language, term)`` key for indexing a term/wordform node."""
    return f"{lang.casefold()}\x1f{term.casefold()}"


@dataclass(frozen=True)
class LinguisticResult:
    """The linguistic linker's full output: new nodes plus inferred edges.

    *nodes* are the language and place nodes the linker had to create (reused
    nodes are already in the input and are not repeated here); *edges* are the
    ``DESCENDS_FROM`` / ``SPOKEN_IN`` / ``BORROWED_FROM`` / ``COGNATE_WITH`` edges.
    The edges carry ``confidence`` but not ``source`` — when run through the
    pipeline that tag is stamped from the linker name; callers using
    :meth:`LinguisticLinker.link` directly get the same untagged edges.
    """

    nodes: list[Node]
    edges: list[Edge]


class LinguisticLinker(Linker):
    """Infers linguistic edges, creating ancestor language and place nodes.

    Configuration:

    * *ancestor_qid_field* / *ancestor_code_field* — the language cells naming a
      node's ancestor language (by Wikidata QID, then by language code);
    * *place_field* — the language cell(s) naming the place(s) the language is
      spoken in;
    * *etymon_field* — the term cell naming the source lexeme it derives from;
    * *mode_field* / *borrow_modes* — the term cell whose value marks a derivation
      as a borrowing (any value in *borrow_modes*) versus an inheritance;
    * *cognateset_field* — the cell naming the **cognate set** a wordform belongs
      to (a Lexibank ``Cognateset_ID``); forms sharing one are linked into a
      ``COGNATE_WITH`` representative star. A node without this cell is unaffected,
      so the pass is a no-op for every non-Lexibank corpus;
    * *etymology_field* — the cell carrying a wordform's kaikki etymology relations
      (a JSON list of ``{rel, lang, term}``, source-breadth US-004); each relation
      links the form to the source-side term it names with the relation's canonical
      ``:TYPE`` (``BORROWED_FROM`` / ``DERIVED_FROM`` / ``COGNATE_WITH``), minting a
      minimal ``Term`` node for the target keyed by ``(lang, term)`` so the same
      etymon referenced by many forms is one node. A node without this cell is
      unaffected, so the pass is a no-op for every non-kaikki corpus;
    * *descends_confidence* / *spoken_confidence* / *borrowed_confidence* /
      *derived_confidence* — confidence for an identifier-based descent / spoken-in /
      borrowing / derivation edge (a reference is a strong signal);
    * *cognate_confidence* — confidence for a derived ``COGNATE_WITH`` (lower,
      flagging the weaker shared-etymon inference / cognate-set membership).
    """

    name: ClassVar[str] = "linguistic"
    dimension: ClassVar[Dimension] = Dimension.LINGUISTIC

    def __init__(
        self,
        *,
        ancestor_qid_field: str = "parent_qid",
        ancestor_code_field: str = "parent_code",
        place_field: str = "place_qid",
        etymon_field: str = "etymon_qid",
        mode_field: str = "derivation_mode",
        cognateset_field: str = "cognateset",
        etymology_field: str = "etymology_relations",
        borrow_modes: frozenset[str] = DEFAULT_BORROW_MODES,
        descends_confidence: float = 0.9,
        spoken_confidence: float = 0.85,
        borrowed_confidence: float = 0.85,
        derived_confidence: float = 0.8,
        cognate_confidence: float = 0.6,
    ) -> None:
        self.ancestor_qid_field = ancestor_qid_field
        self.ancestor_code_field = ancestor_code_field
        self.place_field = place_field
        self.etymon_field = etymon_field
        self.mode_field = mode_field
        self.cognateset_field = cognateset_field
        self.etymology_field = etymology_field
        self.borrow_modes = borrow_modes
        self.descends_confidence = descends_confidence
        self.spoken_confidence = spoken_confidence
        self.borrowed_confidence = borrowed_confidence
        self.derived_confidence = derived_confidence
        self.cognate_confidence = cognate_confidence
        #: Canonical ``:TYPE`` → the confidence a kaikki etymology edge carries.
        self._etymology_confidence = {
            "BORROWED_FROM": borrowed_confidence,
            "DERIVED_FROM": derived_confidence,
            "COGNATE_WITH": cognate_confidence,
        }

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_linguistic(nodes, edges).edges

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges plus the language/place nodes created."""
        result = self.link_linguistic(nodes, edges)
        return LinkResult(edges=result.edges, nodes=result.nodes)

    def link_linguistic(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinguisticResult:
        """Infer linguistic edges and resolve nodes from *nodes* and *edges*."""
        # Index existing languages/places/terms by the identifiers a referencing
        # node names them with, so a reference reuses a node instead of cloning.
        lang_by_qid: dict[str, str] = {}
        lang_by_code: dict[str, str] = {}
        place_by_qid: dict[str, str] = {}
        term_by_qid: dict[str, str] = {}
        term_by_form: dict[str, str] = {}
        for node in nodes:
            labels = _labels(node)
            csid = _scalar(node, "csid")
            qid = self._norm_qid(_scalar(node, "wikidata_qid"))
            if LANGUAGE_LABEL in labels:
                if qid:
                    lang_by_qid[qid] = csid
                if code := _scalar(node, "language_code"):
                    lang_by_code[code] = csid
            if "Place" in labels and qid:
                place_by_qid[qid] = csid
            if TERM_LABEL in labels and qid:
                term_by_qid[qid] = csid
            # Index every term/wordform by its (language, form) so a kaikki
            # etymology relation naming an existing term reuses it as an endpoint
            # instead of minting a duplicate stub.
            if (TERM_LABEL in labels or "Wordform" in labels) and (
                name := _scalar(node, "name")
            ):
                term_by_form.setdefault(_form_key(_scalar(node, "lang"), name), csid)

        created: dict[str, Node] = {}
        emitted: set[tuple[str, str, str]] = {
            (_scalar(e, ":START_ID"), _scalar(e, ":END_ID"), _scalar(e, ":TYPE"))
            for e in edges
        }
        result_edges: list[Edge] = []

        def emit(start: str, end: str, rel: str, confidence: float) -> None:
            key = (start, end, rel)
            if start and end and start != end and key not in emitted:
                emitted.add(key)
                result_edges.append(inferred_edge(start, end, rel, confidence))

        # Group deriving terms by their shared etymon to infer cognacy, and
        # wordforms by their explicit cognate-set id (Lexibank). The two groupings
        # are independent: the etymon inference is a clique, the cognate-set
        # materialisation a linear star (see the class docstring).
        cognates: dict[str, list[str]] = {}
        cognate_sets: dict[str, list[str]] = {}
        for node in nodes:
            labels = _labels(node)
            source = _scalar(node, "csid")
            if not source:
                continue
            if LANGUAGE_LABEL in labels:
                self._link_language(node, source, lang_by_qid, lang_by_code,
                                    place_by_qid, created, emit)
            if TERM_LABEL in labels:
                self._link_term(node, source, term_by_qid, created, emit, cognates)
            if cognate_set := self._cognate_set(node):
                cognate_sets.setdefault(cognate_set, []).append(source)
            self._link_etymology(node, source, term_by_form, created, emit)

        self._emit_cognates(cognates, emit)
        self._emit_cognate_sets(cognate_sets, emit)
        return LinguisticResult(nodes=list(created.values()), edges=result_edges)

    def _link_language(
        self,
        node: Node,
        source: str,
        lang_by_qid: dict[str, str],
        lang_by_code: dict[str, str],
        place_by_qid: dict[str, str],
        created: dict[str, Node],
        emit: _Emit,
    ) -> None:
        """Emit a language's ``DESCENDS_FROM`` ancestor and ``SPOKEN_IN`` places."""
        ancestor = self._resolve_ancestor(node, lang_by_qid, lang_by_code, created)
        if ancestor is not None:
            emit(source, ancestor, "DESCENDS_FROM", self.descends_confidence)
        for place_qid in _multi(node, self.place_field):
            qid = self._norm_qid(place_qid)
            if qid is None:
                continue
            place = self._reuse_or_create(
                place_by_qid, qid, "Place", "wikidata_qid", qid, created
            )
            emit(source, place, "SPOKEN_IN", self.spoken_confidence)

    def _link_term(
        self,
        node: Node,
        source: str,
        term_by_qid: dict[str, str],
        created: dict[str, Node],
        emit: _Emit,
        cognates: dict[str, list[str]],
    ) -> None:
        """Emit a term's ``BORROWED_FROM`` etymon and record it for cognacy."""
        qid = self._norm_qid(_scalar(node, self.etymon_field))
        if qid is None:
            return
        etymon = self._reuse_or_create(
            term_by_qid, qid, "Term", "wikidata_qid", qid, created
        )
        if _scalar(node, self.mode_field) in self.borrow_modes:
            emit(source, etymon, "BORROWED_FROM", self.borrowed_confidence)
        cognates.setdefault(qid, []).append(source)

    def _link_etymology(
        self,
        node: Node,
        source: str,
        term_by_form: dict[str, str],
        created: dict[str, Node],
        emit: _Emit,
    ) -> None:
        """Emit a kaikki wordform's etymology edges to its source-side terms.

        Reads the node's ``etymology_relations`` cell (a JSON list of
        ``{rel, lang, term}``) and, for each relation, resolves the target term —
        reusing an existing ``(lang, term)`` node or minting a minimal ``Term`` —
        and emits an edge of the relation's canonical ``:TYPE``. The ``:TYPE`` is
        re-checked against :data:`ETYMOLOGY_EDGE_TYPES` so a corrupt cell can never
        introduce a non-registered edge type.
        """
        for relation in self._etymology_relations(node):
            edge_type = relation["rel"]
            if edge_type not in ETYMOLOGY_EDGE_TYPES:
                continue
            lang, term = relation["lang"], relation["term"]
            target = self._reuse_or_create_form(term_by_form, lang, term, created)
            emit(source, target, edge_type, self._etymology_confidence[edge_type])

    def _etymology_relations(self, node: Node) -> list[dict[str, str]]:
        """Return *node*'s kaikki etymology relations (``[]`` when it has none).

        Checks a direct field first (in-memory link stage), then the ``extra``
        overflow JSON — the relations cell is unmapped, so after ``build_corpus``
        re-reads the normalized TSV from disk it lives only there.
        """
        direct = _scalar(node, self.etymology_field)
        if direct:
            return parse_relations_cell(direct)
        value = _overflow(node).get(self.etymology_field, "")
        return parse_relations_cell(value) if isinstance(value, str) else []

    def _reuse_or_create_form(
        self,
        term_by_form: dict[str, str],
        lang: str,
        term: str,
        created: dict[str, Node],
    ) -> str:
        """Return the ``Term`` csid for *(lang, term)*, minting one if unseen."""
        key = _form_key(lang, term)
        if key in term_by_form:
            return term_by_form[key]
        csid = mint_csid("term", name=term, lang=lang or None)
        term_by_form[key] = csid
        if csid not in created:
            node: Node = {
                "csid": csid,
                ":LABEL": [TERM_LABEL],
                "name": term,
                "source": f"inferred:{self.name}",
                "confidence": str(self.borrowed_confidence),
            }
            if lang:
                node["lang"] = lang
            created[csid] = node
        return csid

    def _resolve_ancestor(
        self,
        node: Node,
        lang_by_qid: dict[str, str],
        lang_by_code: dict[str, str],
        created: dict[str, Node],
    ) -> str | None:
        """Resolve *node*'s ancestor language by QID, falling back to its code."""
        if qid := self._norm_qid(_scalar(node, self.ancestor_qid_field)):
            return self._reuse_or_create(
                lang_by_qid, qid, LANGUAGE_LABEL, "wikidata_qid", qid, created
            )
        if code := _scalar(node, self.ancestor_code_field):
            local = _code_local(code)
            csid = f"cs:language:{local}" if local is not None else None
            return self._reuse_or_create(
                lang_by_code, code, LANGUAGE_LABEL, "language_code", code,
                created, csid,
            )
        return None

    def _reuse_or_create(
        self,
        index: dict[str, str],
        key: str,
        label: str,
        id_column: str,
        id_value: str,
        created: dict[str, Node],
        csid: str | None = None,
    ) -> str:
        """Return the *label* node's ``csid`` for *key*, creating it if unseen.

        *index* maps an identifier value to the ``csid`` of a node already
        carrying it; on a miss a minimal node is minted (at *csid*, or a
        QID-anchored id when *csid* is ``None``) and recorded so a second
        reference to the same identifier reuses it within the run.
        """
        if key in index:
            return index[key]
        if csid is None:
            csid = mint_csid(label.lower(), qid=id_value)
        index[key] = csid
        if csid not in created:
            created[csid] = {
                "csid": csid,
                ":LABEL": [label],
                "name": id_value,
                id_column: id_value,
                "source": f"inferred:{self.name}",
                "confidence": str(self.descends_confidence),
            }
        return csid

    def _emit_cognates(self, cognates: dict[str, list[str]], emit: _Emit) -> None:
        """Emit ``COGNATE_WITH`` between terms that share an etymon."""
        for members in cognates.values():
            ordered = sorted(set(members))
            for i, left in enumerate(ordered):
                for right in ordered[i + 1 :]:
                    emit(left, right, "COGNATE_WITH", self.cognate_confidence)

    def _cognate_set(self, node: Node) -> str:
        """Return *node*'s cognate-set id (Lexibank ``Cognateset_ID``), else ``""``.

        Checks a direct field first (in-memory link stage), then the ``extra``
        overflow JSON — the cognate-set id is an unmapped cell, so after
        ``build_corpus`` re-reads the normalized TSV from disk it lives only there.
        """
        direct = _scalar(node, self.cognateset_field)
        if direct:
            return direct
        value = _overflow(node).get(self.cognateset_field, "")
        return value if isinstance(value, str) else ""

    def _emit_cognate_sets(
        self, cognate_sets: dict[str, list[str]], emit: _Emit
    ) -> None:
        """Emit a ``COGNATE_WITH`` **star** per Lexibank cognate set.

        Each set's members are linked to the set's representative (its
        lexicographically-first csid), so a set of *n* forms yields *n-1* edges
        rather than the ``n(n-1)/2`` of a clique — the only tractable shape when a
        cognate class can span thousands of doculects. A singleton set (or one
        that survives dedup as a single csid) contributes no edge.
        """
        for members in cognate_sets.values():
            ordered = sorted(set(members))
            if len(ordered) < 2:
                continue
            representative = ordered[0]
            for member in ordered[1:]:
                emit(member, representative, "COGNATE_WITH", self.cognate_confidence)

    @staticmethod
    def _norm_qid(value: str) -> str | None:
        """Normalize a QID cell to ``Q<number>``, or ``None`` if not a QID."""
        if not value:
            return None
        try:
            return normalize_qid(value)
        except IdError:
            return None


#: Register a default-config linguistic linker into the process-wide registry.
DEFAULT_REGISTRY.register(LinguisticLinker())
