"""The word-form table — `loadForms` and the three reads built on it.

The one loader every slice of the cutover so far has deferred, because it is the
only one whose file is measured in megabytes rather than rows: `words.tsv` is the
NorthEuraLex form list, ~140k rows, and it is the spine under
`GET /api/scraping/coverage`, `GET /api/word-comparisons` and
`GET /api/languages/{id}/word-list`.

Three shapes are reproduced rather than tidied:

* **A missing or broken `words.tsv` is an empty table, not an error.**
  `loadForms` wraps the whole read in a try/catch that only warns — unlike
  `loadBaseWords`, whose `readFileOrThrow` really does raise. So a corpus with no
  forms answers "nobody has any words" with a 200, and that is what the scraper
  dashboard is built to show. :func:`load_base_words` next door still raises;
  the asymmetry is Express's.
* **The "scraped" merge reads the same directory the corpus lives in.**
  `loadScrapedForms` walks `data/source/lexicons/*.tsv`, skips four files by
  name, and treats every *other* filename as a language id — so it tries the
  whole corpus and discards each file whose header has no `Concept_ID`, per file,
  with a warning. On the shipped corpus that is all fifty-odd of them and the
  merge contributes nothing; it is kept because the day a per-language form file
  lands there it must win over the NorthEuraLex row, which is the order below.
* **Nothing is cached**, per the rest of :mod:`pinakes.lexicons.storage` — the
  lexicons directory is re-resolved per call because that override is the test
  seam. This is the loader where that costs something real (a few hundred
  milliseconds per request against the live corpus, where Express memoised on
  the storage singleton). Recorded as a known cost rather than fixed here: a
  cache keyed on anything but the resolved directory would serve one test's
  temporary corpus to the next.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pinakes.analytics import tsv
from pinakes.analytics.jsmath import js_round
from pinakes.lexicons.storage import Record, load_base_words, load_languages

logger = logging.getLogger("pinakes.lexicons.forms")

#: `conceptId -> languageId -> {form, ipa}`, the nested `Map` Express built.
Forms = dict[str, dict[str, dict[str, Any]]]

#: The four files `loadScrapedForms` refuses to read as a per-language form
#: list. Everything else in the directory is offered to the parser and rejected
#: by its own header if it is not one.
NOT_A_LANGUAGE_FILE = frozenset(
    {"families.tsv", "languages.tsv", "words.tsv", "words-base.tsv"}
)


def load_forms(lexicons: Path) -> Forms:
    """`words.tsv` + every per-language file → the form table (``loadForms``).

    A row missing its language, concept or form is dropped; a blank `IPA` is
    ``None``. The scraped merge is applied last and **overwrites** a concept ×
    language cell the NorthEuraLex list already filled.
    """
    forms: Forms = {}
    try:
        path = Path(lexicons) / "words.tsv"
        if not path.is_file():
            raise FileNotFoundError(f"Required data file not found: {path}")
        header, rows = tsv.parse_tsv(path.read_text(encoding="utf-8"))
        language_index = tsv.required_index(header, "Language_ID")
        concept_index = tsv.required_index(header, "Concept_ID")
        form_index = tsv.required_index(header, "Word_Form")
        ipa_index = tsv.required_index(header, "IPA")

        for row in rows:
            language_id = tsv.cell(row, language_index).strip()
            concept_id = tsv.cell(row, concept_index).strip()
            word_form = tsv.cell(row, form_index).strip()
            ipa = tsv.cell(row, ipa_index).strip() or None
            if not language_id or not concept_id or not word_form:
                continue
            forms.setdefault(concept_id, {})[language_id] = {
                "form": word_form,
                "ipa": ipa,
            }
    except Exception:  # noqa: BLE001 - `catch { console.warn(...) }`, verbatim
        logger.warning(
            "Forms data not available, word comparisons will be limited",
            exc_info=True,
        )

    for concept_id, by_language in load_scraped_forms(lexicons).items():
        forms.setdefault(concept_id, {}).update(by_language)
    return forms


def load_scraped_forms(lexicons: Path) -> Forms:
    """Every `<language-id>.tsv` in the corpus directory (``loadScrapedForms``).

    `Concept_ID` and `Word_Form` are required (``getIdx``) and `IPA` is optional
    (``indexOf``), so a file that is not a form list raises on its own header and
    is skipped with a warning rather than failing the request.
    """
    scraped: Forms = {}
    directory = Path(lexicons)
    if not directory.is_dir():
        return scraped

    try:
        names = sorted(entry.name for entry in directory.iterdir())
    except OSError:
        logger.warning("Failed to read scraped directory", exc_info=True)
        return scraped

    for name in names:
        if not name.endswith(".tsv") or name in NOT_A_LANGUAGE_FILE:
            continue
        language_id = name[: -len(".tsv")]
        try:
            header, rows = tsv.parse_tsv(
                (directory / name).read_text(encoding="utf-8")
            )
            concept_index = tsv.required_index(header, "Concept_ID")
            form_index = tsv.required_index(header, "Word_Form")
            ipa_index = tsv.index_of(header, "IPA")

            for row in rows:
                concept_id = tsv.cell(row, concept_index).strip()
                word_form = tsv.cell(row, form_index).strip()
                ipa = (
                    (tsv.cell(row, ipa_index).strip() or None)
                    if ipa_index >= 0
                    else None
                )
                if not concept_id or not word_form:
                    continue
                scraped.setdefault(concept_id, {})[language_id] = {
                    "form": word_form,
                    "ipa": ipa,
                }
        except Exception:  # noqa: BLE001 - one unreadable file is not a failure
            # `console.warn` over there, `debug` here, and the difference is the
            # cache. Express memoised the table on its storage singleton and so
            # emitted these ~50 lines once per *process*; nothing is cached here,
            # so at warning level every `/api/scraping/coverage` request would
            # print a screenful. The response is identical either way.
            logger.debug("Failed to load scraped forms for %s", language_id)
    return scraped


def word_coverage_by_language(lexicons: Path) -> list[Record]:
    """How much of the concept list each language has forms for.

    ``getWordCoverageByLanguage``: historical variants and dialects are excluded
    (the dashboard orchestrates scraping per *living* language), the percentage
    is a ``Math.round`` of the ratio, and the result is sorted by raw word count
    descending. A language with no forms is still listed, at zero — that is the
    row the dashboard exists to show.
    """
    languages = load_languages(lexicons)
    base_words = load_base_words(lexicons)
    forms = load_forms(lexicons)
    total_base_words = len(base_words)

    counts: dict[str, int] = {}
    for by_language in forms.values():
        for language_id in by_language:
            counts[language_id] = counts.get(language_id, 0) + 1

    coverage = [
        {
            "languageId": language["id"],
            "languageName": language["name"],
            "familyId": language["familyId"],
            "wordCount": counts.get(language["id"], 0),
            "totalBaseWords": total_base_words,
            "coveragePercent": (
                js_round(counts.get(language["id"], 0) / total_base_words * 100)
                if total_base_words > 0
                else 0
            ),
        }
        for language in languages
        if not language.get("isHistoricalVariant") and not language.get("isDialect")
    ]
    coverage.sort(key=lambda entry: entry["wordCount"], reverse=True)
    return coverage


def language_word_list(lexicons: Path, language_id: str) -> list[Record]:
    """Every concept, with this language's form or ``None`` (``getLanguageWordList``).

    Unfiltered on purpose: the list is the *concept spine* annotated with what
    the language has, so a concept with no form is a row with `translation:
    null`, not an omission. That is what makes the length stable across
    languages, which the client's pagination depends on.
    """
    forms = load_forms(lexicons)
    return [
        {
            "baseWord": word["word"],
            "conceptId": word["id"],
            "translation": entry["form"] if entry else None,
            "ipa": entry["ipa"] if entry else None,
        }
        for word in load_base_words(lexicons)
        for entry in [forms.get(word["id"], {}).get(language_id)]
    ]


def word_comparisons(lexicons: Path, language_ids: list[str]) -> list[Record]:
    """The concepts at least one of *language_ids* has a form for.

    ``getWordComparisons``: a concept nobody in the selection attests is dropped
    entirely, and `translations` carries only the languages that do — so the key
    set varies row to row, which is the shape the comparison table renders.
    """
    forms = load_forms(lexicons)
    comparisons: list[Record] = []
    for word in load_base_words(lexicons):
        by_language = forms.get(word["id"])
        if not by_language:
            continue
        translations = {
            language_id: by_language[language_id]
            for language_id in language_ids
            if language_id in by_language
        }
        if translations:
            comparisons.append(
                {
                    "baseWord": word["word"],
                    "conceptId": word["id"],
                    "translations": translations,
                }
            )
    return comparisons


__all__ = [
    "Forms",
    "language_word_list",
    "load_forms",
    "load_scraped_forms",
    "word_comparisons",
    "word_coverage_by_language",
    "word_coverage_by_language",
]
