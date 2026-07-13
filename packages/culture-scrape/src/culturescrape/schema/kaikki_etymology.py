"""Map kaikki.org (wiktextract) etymology templates onto canonical edge types.

kaikki.org publishes machine-parsed Wiktionary extracts as JSONL — one JSON object
per word sense group — sidestepping the "wikitext parsing is a research effort"
blocker (``docs/sources-linguistic.md``). The structured etymology signal lives in
each entry's ``etymology_templates`` list: the Wiktionary etymology templates
(``{{bor|…}}``, ``{{inh|…}}``, ``{{cog|…}}``, …) wiktextract preserves verbatim,
each a ``{"name": <token>, "args": {"1": …, "2": …, "3": …}}`` object.

This module is the single, pure bridge from that template vocabulary to the
canonical ontology edge ``:TYPE`` vocabulary
(:mod:`culturescrape.ontology.registry`). It maps only the tokens whose meaning is
an unambiguous **directed** etymological relation between two terms:

* borrowings — ``bor`` / ``lbor`` / ``slbor`` / ``obor`` / ``ubor`` → ``BORROWED_FROM``;
* inheritances & derivations — ``inh`` / ``der`` (and their ``+`` display variants)
  → ``DERIVED_FROM``;
* cognates — ``cog`` → ``COGNATE_WITH``.

Every other template token (``m``/``l``/``mention`` display helpers, ``cal``/``clq``
calques whose direction is ambiguous, and — critically — ``ncog``/``noncog``
*non*-cognate assertions) is **not** mapped: :func:`extract_relations` skips it and
records it in :attr:`ExtractResult.skipped_tokens` so the driver can report exactly
which relation tokens were dropped, and no token is ever silently coerced onto the
wrong edge type. The borrowing/derivation templates carry the *destination* language
in arg ``1`` and the source language / term in args ``2`` / ``3``; the cognate
templates carry the cognate language / term in args ``1`` / ``2``. Extraction reads
whichever layout the token uses, so the resulting :class:`EtymologyRelation` always
names the *target* (source-side) language and term of the edge.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

#: The canonical edge ``:TYPE`` tokens this module can emit (all registered in
#: :mod:`culturescrape.ontology.registry`). No other value is ever produced.
BORROWED_FROM = "BORROWED_FROM"
DERIVED_FROM = "DERIVED_FROM"
COGNATE_WITH = "COGNATE_WITH"

#: The three arg-layouts a template can use. ``source`` = ``{1: dest, 2: lang,
#: 3: term}`` (borrowing / derivation); ``cognate`` = ``{1: lang, 2: term}``.
_SOURCE_LAYOUT = "source"
_COGNATE_LAYOUT = "cognate"


@dataclass(frozen=True)
class _TemplateSpec:
    """How to read one etymology template: its canonical edge type + arg layout."""

    edge_type: str
    layout: str


#: Etymology-template token → (canonical edge ``:TYPE``, arg layout). Only tokens
#: whose meaning is an unambiguous directed relation between two terms appear; a
#: token absent from this map is deliberately unmappable (skipped + reported).
KAIKKI_RELATION_MAP: dict[str, _TemplateSpec] = {
    # Borrowings (all folded onto BORROWED_FROM — the loan sub-types are a nuance
    # the canonical vocabulary does not model separately).
    "bor": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    "borrowed": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    "lbor": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    "slbor": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    "obor": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    "ubor": _TemplateSpec(BORROWED_FROM, _SOURCE_LAYOUT),
    # Inheritance / derivation (both are "this term derives from that ancestor").
    "inh": _TemplateSpec(DERIVED_FROM, _SOURCE_LAYOUT),
    "inherited": _TemplateSpec(DERIVED_FROM, _SOURCE_LAYOUT),
    "der": _TemplateSpec(DERIVED_FROM, _SOURCE_LAYOUT),
    "derived": _TemplateSpec(DERIVED_FROM, _SOURCE_LAYOUT),
    # Cognates (a symmetric shared-ancestor assertion). ``ncog``/``noncog`` are the
    # explicit *negation* and are intentionally NOT here — mapping them would invert
    # the assertion.
    "cog": _TemplateSpec(COGNATE_WITH, _COGNATE_LAYOUT),
    "cognate": _TemplateSpec(COGNATE_WITH, _COGNATE_LAYOUT),
}

#: kaikki entry keys the extractor reads.
_TEMPLATES_KEY = "etymology_templates"
_NAME_KEY = "name"
_ARGS_KEY = "args"


def map_relation(token: str) -> str | None:
    """Return the canonical edge ``:TYPE`` for a template *token*, or ``None``.

    ``None`` marks an unmappable token — the caller must skip it (and should record
    it), never coerce it onto an edge type.
    """
    spec = KAIKKI_RELATION_MAP.get(token.strip().lstrip("+").rstrip("+"))
    return spec.edge_type if spec is not None else None


@dataclass(frozen=True)
class EtymologyRelation:
    """One directed etymological edge extracted from a kaikki entry.

    *edge_type* is a canonical ontology ``:TYPE``; *target_lang* / *target_term*
    name the source-side language code and term the edge points at (the etymon a
    ``BORROWED_FROM`` / ``DERIVED_FROM`` runs to, or the cognate a ``COGNATE_WITH``
    links). *token* is the originating template name, kept for reporting.
    """

    edge_type: str
    target_lang: str
    target_term: str
    token: str


@dataclass(frozen=True)
class ExtractResult:
    """The relations extracted from one entry plus the tokens skipped as unmappable.

    *skipped_tokens* holds an entry for every ``etymology_templates`` token that
    named no canonical relation (display helpers, ambiguous calques, non-cognate
    assertions) — so a driver can report precisely which relation tokens were
    dropped rather than silently losing them.
    """

    relations: list[EtymologyRelation]
    skipped_tokens: list[str]


def _arg(args: Mapping[str, Any], key: str) -> str:
    """Return template *args*[*key*] as a stripped string (``""`` when absent)."""
    value = args.get(key)
    return str(value).strip() if value not in (None, "") else ""


def _normalise_token(name: Any) -> str:
    """Normalise a template name to its base token (drop a ``+`` display suffix)."""
    return str(name).strip().lstrip("+").rstrip("+")


def extract_relations(entry: Mapping[str, Any]) -> ExtractResult:
    """Extract canonical etymology relations from one kaikki JSONL *entry*.

    Reads ``entry["etymology_templates"]``; for each template whose token
    :data:`KAIKKI_RELATION_MAP` recognises, builds an :class:`EtymologyRelation`
    naming the target language + term (dropping one whose target term is blank —
    it cannot form an edge). Every unrecognised token is recorded in
    :attr:`ExtractResult.skipped_tokens`. An entry with no templates yields an
    empty result.
    """
    templates = entry.get(_TEMPLATES_KEY)
    if not isinstance(templates, list):
        return ExtractResult(relations=[], skipped_tokens=[])

    relations: list[EtymologyRelation] = []
    skipped: list[str] = []
    for template in templates:
        if not isinstance(template, Mapping):
            continue
        token = _normalise_token(template.get(_NAME_KEY, ""))
        if not token:
            continue
        spec = KAIKKI_RELATION_MAP.get(token)
        if spec is None:
            skipped.append(token)
            continue
        args = template.get(_ARGS_KEY)
        if not isinstance(args, Mapping):
            skipped.append(token)
            continue
        if spec.layout == _COGNATE_LAYOUT:
            lang, term = _arg(args, "1"), _arg(args, "2")
        else:
            lang, term = _arg(args, "2"), _arg(args, "3")
        if not term:
            # A recognised relation with no target term cannot form an edge; count
            # it as skipped so the report never overstates edge volume.
            skipped.append(token)
            continue
        relations.append(
            EtymologyRelation(
                edge_type=spec.edge_type,
                target_lang=lang,
                target_term=term,
                token=token,
            )
        )
    return ExtractResult(relations=relations, skipped_tokens=skipped)


def relations_cell(relations: Iterable[EtymologyRelation]) -> str:
    """Serialise *relations* to the compact JSON string a node cell carries.

    The kaikki adapter stores this under an unmapped ``etymology_relations`` field
    so it rides into the node's ``extra`` overflow (surviving the normalize → disk
    → link round-trip), and the linguistic linker reads it back with
    :func:`parse_relations_cell` to emit the edges.
    """
    payload = [
        {"rel": r.edge_type, "lang": r.target_lang, "term": r.target_term}
        for r in relations
    ]
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def parse_relations_cell(cell: str) -> list[dict[str, str]]:
    """Parse an ``etymology_relations`` node cell back into relation dicts.

    Tolerant of a blank / malformed cell (returns ``[]``); each returned dict has
    ``rel`` (a canonical ``:TYPE``), ``lang``, and ``term`` string values, and only
    a well-formed item naming a recognised edge type with a non-blank term survives.
    """
    if not cell:
        return []
    try:
        data = json.loads(cell)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    parsed: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, Mapping):
            continue
        rel = str(item.get("rel", "")).strip()
        term = str(item.get("term", "")).strip()
        if rel not in _CANONICAL_EDGE_TYPES or not term:
            continue
        parsed.append(
            {"rel": rel, "lang": str(item.get("lang", "")).strip(), "term": term}
        )
    return parsed


#: The exact set of edge types :func:`parse_relations_cell` will admit — a guard so
#: a corrupt cell can never inject a non-canonical ``:TYPE`` into the linker.
_CANONICAL_EDGE_TYPES = frozenset({BORROWED_FROM, DERIVED_FROM, COGNATE_WITH})
