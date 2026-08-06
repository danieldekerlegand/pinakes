"""The descriptive-linguistics reads — texts, phonology, grammar, contact.

The cutover's fourth slice, first half (pinakes:80 US-1): seven `list` + `{id}`
groups from `server/routes.ts` plus the five `/api/languages/{id}/*`
sub-resources that read the same seven files. Everything under HTTP is
:mod:`pinakes.lexicons.storage` (the loaders, new in this slice) and
:mod:`pinakes.lexicons.ethnography` (the filters); the work here is the
envelopes and the query-string dialect.

Three things in this file are load-bearing and easy to lose:

* **A language sub-resource is not a filtered list, and its 404 says so.**
  `/api/languages/{id}/verb-paradigms` and `/api/languages/{id}/contacts`
  answer **404** for a language with no rows, where `/api/verb-paradigms?
  language_id=…` answers an empty list. The two sample-text and phonology
  siblings do neither consistently — sample-texts answers ``{texts: [], count:
  0, languageId}`` and phonology answers a 404. Copied one by one.
* **The `filters` echo uses the *local variable* names**, not the query
  parameters. `/api/sample-texts?language_id=` echoes `languageId`, and
  `/api/etymology-relations?source_language=` echoes `sourceLanguage`. Three of
  the seven groups have no echo at all.
* **`/api/etymology-relations/trace/{word}` echoes with `??`, not `||`.** An
  explicitly blank `?language=` comes back as ``""``; only an *absent* one comes
  back as ``null``. Same for `direction`, whose default is the string
  ``"ancestors"`` — so `?direction=` answers a blank direction while walking the
  ancestor tree, because the branch tests `=== "descendants"`.

One deliberate divergence, shared with the rest of the flat-catalog ports: a
**repeated** query parameter (`?genre=a&genre=b`) reaches Express as an array,
whose `.toLowerCase()` throws and yields a 500. Starlette hands back the first
value and the filter applies. Reproducing a `TypeError` was judged not worth a
branch in every handler; `routers/map_layers._string_param` exists where the
distinction actually changes an answer.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request

from pinakes.lexicons import ethnography, storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.linguistics")

router = APIRouter(tags=["catalog"])


def _failed(context: str, message: str, error: Exception) -> Any:
    return _reads.failed(logger, context, message, error)


# ── Sample texts ─────────────────────────────────────────────────────────────


@router.get("/api/sample-texts")
def sample_texts(request: Request) -> Any:
    """Attested passages, filtered by language, genre and script."""
    language_id = _reads.text(request, "language_id")
    genre = _reads.text(request, "genre")
    script = _reads.text(request, "script")
    try:
        found = ethnography.filter_sample_texts(
            storage.load_sample_texts(lexicons_dir()),
            language_id=language_id,
            genre=genre,
            script=script,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching sample texts", "Failed to fetch sample texts", error)
    return {
        "texts": found,
        "count": len(found),
        "filters": _reads.echo(languageId=language_id, genre=genre, script=script),
    }


@router.get("/api/sample-texts/{id}")
def sample_text(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_sample_texts(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching sample text", "Failed to fetch sample text", error)
    if found is None:
        return _reads.missing(f"Sample text '{id}' not found")
    return found


@router.get("/api/languages/{id}/sample-texts")
def language_sample_texts(id: str) -> Any:
    """This language's passages — an empty list, never a 404."""
    try:
        found = ethnography.filter_sample_texts(
            storage.load_sample_texts(lexicons_dir()), language_id=id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language sample texts",
            "Failed to fetch sample texts for language",
            error,
        )
    return {"texts": found, "count": len(found), "languageId": id}


# ── Phonological inventories ─────────────────────────────────────────────────


@router.get("/api/phonological-inventories")
def phonological_inventories(request: Request) -> Any:
    """The consonant/vowel/tone inventories. No `filters` echo on this one."""
    language_id = _reads.text(request, "language_id")
    try:
        found = ethnography.filter_phonological_inventories(
            storage.load_phonological_inventories(lexicons_dir()),
            language_id=language_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching phonological inventories",
            "Failed to fetch phonological inventories",
            error,
        )
    return {"inventories": found, "count": len(found)}


@router.get("/api/phonological-inventories/{id}")
def phonological_inventory(id: str) -> Any:
    try:
        found = storage.find_by_id(
            storage.load_phonological_inventories(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching phonological inventory",
            "Failed to fetch phonological inventory",
            error,
        )
    if found is None:
        return _reads.missing(f"Phonological inventory '{id}' not found")
    return found


@router.get("/api/languages/{id}/phonological-inventory")
def language_phonological_inventory(id: str) -> Any:
    """This language's inventory — a **404** when there is none."""
    try:
        found = ethnography.inventory_for_language(
            storage.load_phonological_inventories(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching phonological inventory for language",
            "Failed to fetch phonological inventory for language",
            error,
        )
    if found is None:
        return _reads.missing(f"No phonological inventory found for language '{id}'")
    return found


# ── Etymology relations ──────────────────────────────────────────────────────


@router.get("/api/etymology-relations")
def etymology_relations(request: Request) -> Any:
    source_language = _reads.text(request, "source_language")
    target_language = _reads.text(request, "target_language")
    relation_type = _reads.text(request, "relation_type")
    try:
        found = ethnography.filter_etymology_relations(
            storage.load_etymology_relations(lexicons_dir()),
            source_language=source_language,
            target_language=target_language,
            relation_type=relation_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching etymology relations", "Failed to fetch etymology relations", error
        )
    return {
        "relations": found,
        "count": len(found),
        "filters": _reads.echo(
            sourceLanguage=source_language,
            targetLanguage=target_language,
            relationType=relation_type,
        ),
    }


@router.get("/api/etymology-relations/word/{word}")
def etymology_relations_for_word(word: str) -> Any:
    """Every relation naming this word at **either** end, case-insensitively."""
    try:
        found = ethnography.relations_for_word(
            storage.load_etymology_relations(lexicons_dir()), word
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching etymology relations for word",
            "Failed to fetch etymology relations for word",
            error,
        )
    return {"relations": found, "count": len(found), "word": word}


@router.get("/api/etymology-relations/trace/{word}")
def etymology_trace(word: str, request: Request) -> Any:
    """The ancestor (or, with `?direction=descendants`, the descendant) tree."""
    language = _reads.text(request, "language")
    direction = _reads.text(request, "direction")
    try:
        relations = storage.load_etymology_relations(lexicons_dir())
        tree = (
            ethnography.trace_descendants(relations, word, language)
            if direction == "descendants"
            else ethnography.trace_etymology(relations, word, language)
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("tracing etymology", "Failed to trace etymology", error)
    return {
        "tree": tree,
        "word": word,
        # `??`, so an explicitly blank parameter echoes as blank rather than
        # taking the default. Only an absent one is null / "ancestors".
        "language": language,
        "direction": "ancestors" if direction is None else direction,
    }


# ── Grammar features ─────────────────────────────────────────────────────────


@router.get("/api/grammar-features")
def grammar_features(request: Request) -> Any:
    language_id = _reads.text(request, "language_id")
    word_order = _reads.text(request, "word_order")
    morphological_type = _reads.text(request, "morphological_type")
    try:
        found = ethnography.filter_grammar_features(
            storage.load_grammar_features(lexicons_dir()),
            language_id=language_id,
            word_order=word_order,
            morphological_type=morphological_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching grammar features", "Failed to fetch grammar features", error
        )
    return {"features": found, "count": len(found)}


@router.get("/api/grammar-features/{id}")
def grammar_feature(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_grammar_features(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching grammar features", "Failed to fetch grammar features", error
        )
    if found is None:
        return _reads.missing(f"Grammar features '{id}' not found")
    return found


@router.get("/api/languages/{id}/grammar-features")
def language_grammar_features(id: str) -> Any:
    """This language's typological profile — a **404** when there is none."""
    try:
        found = ethnography.features_for_language(
            storage.load_grammar_features(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching grammar features for language",
            "Failed to fetch grammar features for language",
            error,
        )
    if found is None:
        return _reads.missing(f"No grammar features found for language '{id}'")
    return found


# ── Verb paradigms ───────────────────────────────────────────────────────────


@router.get("/api/verb-paradigms")
def verb_paradigms(request: Request) -> Any:
    language_id = _reads.text(request, "language_id")
    verb_concept = _reads.text(request, "verb_concept")
    try:
        found = ethnography.filter_verb_paradigms(
            storage.load_verb_paradigms(lexicons_dir()),
            language_id=language_id,
            verb_concept=verb_concept,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching verb paradigms", "Failed to fetch verb paradigms", error
        )
    return {"paradigms": found, "count": len(found)}


@router.get("/api/verb-paradigms/{id}")
def verb_paradigm(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_verb_paradigms(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching verb paradigm", "Failed to fetch verb paradigm", error)
    if found is None:
        return _reads.missing(f"Verb paradigm '{id}' not found")
    return found


@router.get("/api/languages/{id}/verb-paradigms")
def language_verb_paradigms(id: str) -> Any:
    """This language's paradigms — a **404** when the list comes back empty."""
    try:
        found = ethnography.filter_verb_paradigms(
            storage.load_verb_paradigms(lexicons_dir()), language_id=id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching verb paradigms for language",
            "Failed to fetch verb paradigms for language",
            error,
        )
    if not found:
        return _reads.missing(f"No verb paradigms found for language '{id}'")
    return {"paradigms": found, "count": len(found)}


# ── Language contacts ────────────────────────────────────────────────────────


@router.get("/api/language-contacts")
def language_contacts(request: Request) -> Any:
    source_language_id = _reads.text(request, "source_language_id")
    target_language_id = _reads.text(request, "target_language_id")
    contact_type = _reads.text(request, "contact_type")
    intensity = _reads.text(request, "intensity")
    try:
        found = ethnography.filter_language_contacts(
            storage.load_language_contacts(lexicons_dir()),
            source_language_id=source_language_id,
            target_language_id=target_language_id,
            contact_type=contact_type,
            intensity=intensity,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language contacts", "Failed to fetch language contacts", error
        )
    return {"contacts": found, "count": len(found)}


@router.get("/api/language-contacts/{id}")
def language_contact(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_language_contacts(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language contact", "Failed to fetch language contact", error
        )
    if found is None:
        return _reads.missing(f"Language contact '{id}' not found")
    return found


@router.get("/api/languages/{id}/contacts")
def contacts_for_language(id: str) -> Any:
    """Contacts naming this language at either end — a **404** when there are none."""
    try:
        found = ethnography.contacts_for_language(
            storage.load_language_contacts(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language contacts for language",
            "Failed to fetch language contacts for language",
            error,
        )
    if not found:
        return _reads.missing(f"No language contacts found for language '{id}'")
    return {"contacts": found, "count": len(found)}


# ── Sound changes ────────────────────────────────────────────────────────────


@router.get("/api/sound-changes")
def sound_changes(request: Request) -> Any:
    family_id = _reads.text(request, "family_id")
    source_language_id = _reads.text(request, "source_language_id")
    target_language_id = _reads.text(request, "target_language_id")
    try:
        found = ethnography.filter_sound_changes(
            storage.load_sound_changes(lexicons_dir()),
            family_id=family_id,
            source_language_id=source_language_id,
            target_language_id=target_language_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching sound changes", "Failed to fetch sound changes", error)
    return {"changes": found, "count": len(found)}


@router.get("/api/sound-changes/{id}")
def sound_change(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_sound_changes(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching sound change", "Failed to fetch sound change", error)
    if found is None:
        return _reads.missing(f"Sound change '{id}' not found")
    return found
