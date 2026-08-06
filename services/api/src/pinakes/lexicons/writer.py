"""The corpus's writer — the part of `server/services/tsv-writer.ts` a route reaches.

:mod:`pinakes.lexicons.storage` reads the corpus; this writes it. Only the three
methods the two TSV generators call came across (`writeTSV`,
`writeLanguageFamilyTSV`, `writeLanguageTSV`) — the other nine in that file
belonged to scrapers `pinakes:70` deleted, and porting a method no caller
reaches would be adding a write surface rather than moving one.

Three things about it are worth knowing before using it anywhere else:

* **It replaces the whole file.** There is no append and no merge: whatever the
  caller passes *is* the table afterwards. That is what makes
  `POST /api/scraping/families` a corpus-destroying operation rather than an
  enrichment (:mod:`pinakes.ingest.family_scraper` says so at length), and it is
  the TypeScript's behaviour, not a simplification.
* **The write is atomic and the temp file is a sibling.** ``<path>.tmp`` is
  written in full and then renamed, so a reader never sees half a table — but it
  lands *in the corpus directory*, which is why the name ends in `.tmp` rather
  than `.tsv`: every loader in :mod:`pinakes.lexicons.storage` addresses a file
  by name, and :func:`pinakes.lexicons.forms.load_scraped_forms` walks the
  directory for `*.tsv` specifically.
* **A cell is joined, never escaped.** A value containing a tab or a newline
  corrupts the table, exactly as it did over there — the escaping that
  :func:`pinakes.media.images.escape_tsv_field` performs is the *prompt*
  ledger's, and this writer has no counterpart. Callers serialise their own
  JSON columns before handing rows over.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pinakes.authoring._js import number_text
from pinakes.contributions.store import js_truthy

#: `writeLanguageFamilyTSV`'s header, in its order.
FAMILY_HEADERS: tuple[str, ...] = (
    "id",
    "name",
    "parent_id",
    "description",
    "taxonomic_level",
    "region",
    "total_speakers",
    "language_count",
)

#: `writeLanguageTSV`'s header. Twenty-two columns — note it splits coordinates
#: into `latitude`/`longitude` where `deities.tsv` keeps a JSON `coordinates`
#: cell, which is the corpus's own inconsistency and not this writer's.
LANGUAGE_HEADERS: tuple[str, ...] = (
    "id",
    "name",
    "native_name",
    "iso639_1",
    "iso639_2",
    "family_id",
    "parent_language_id",
    "region",
    "countries",
    "native_speakers",
    "total_speakers",
    "status",
    "time_origin",
    "time_end",
    "classification",
    "writing_system",
    "is_historical_variant",
    "is_dialect",
    "chronological_order",
    "historical_context",
    "latitude",
    "longitude",
)


class TsvWriteError(RuntimeError):
    """``Failed to write TSV file <path>: <reason>`` — the wrapper the TS threw.

    The message is the contract: the generators let it propagate into the job
    ledger's `errorMessage`, which is the only place a dashboard sees it.
    """


def cell(value: Any) -> str:
    """One record field as the TypeScript rendered it into a cell.

    Every column in the two headers above is spelled either ``v ?? ""`` or
    ``v?.toString() ?? ""`` over there, and for the value domain these
    generators produce — ``str | int | float | None`` — the two agree, so one
    conversion covers both. The numeric leg is `String(n)`, not `str(n)`: an
    integral double prints ``25000000``, never ``25000000.0``.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return number_text(value)
    return str(value)


def write_tsv(path: Path, headers: list[str], rows: list[list[str]]) -> None:
    """Write *headers* + *rows* to *path* atomically, creating the directory.

    A zero-row table is a header line and nothing else — ``[header,
    ...rows].join("\\n") + "\\n"`` — so an empty write still leaves a readable
    file rather than an empty one.
    """
    temp = path.with_name(path.name + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        content = "\n".join(["\t".join(headers), *["\t".join(row) for row in rows]])
        with open(temp, "w", encoding="utf-8", newline="") as handle:
            handle.write(content + "\n")
        temp.replace(path)
    except OSError as error:
        # `fs.promises.unlink` in a catch that swallows its own failure.
        try:
            temp.unlink()
        except OSError:
            pass
        raise TsvWriteError(f"Failed to write TSV file {path}: {error}") from error


def write_language_family_tsv(families: list[dict[str, Any]], path: Path) -> None:
    """`families.tsv`, from the `LanguageFamily` records the generator built."""
    rows = [
        [
            cell(family.get("id")),
            cell(family.get("name")),
            cell(family.get("parentId")),
            cell(family.get("description")),
            cell(family.get("taxonomicLevel")),
            cell(family.get("region")),
            cell(family.get("totalSpeakers")),
            cell(family.get("languageCount")),
        ]
        for family in families
    ]
    write_tsv(path, list(FAMILY_HEADERS), rows)


def write_language_tsv(languages: list[dict[str, Any]], path: Path) -> None:
    """`languages.tsv`, from the `Language` records the generator built.

    ``countries`` is joined with ``;`` and a non-list is the empty cell;
    ``chronological_order`` falls back to the string ``"0"`` rather than blank,
    alone among the numeric columns. Both are the TypeScript's.
    """
    rows = []
    for language in languages:
        countries = language.get("countries")
        order = language.get("chronologicalOrder")
        coordinates = language.get("coordinates")
        rows.append(
            [
                cell(language.get("id")),
                cell(language.get("name")),
                cell(language.get("nativeName")),
                cell(language.get("iso639_1")),
                cell(language.get("iso639_2")),
                cell(language.get("familyId")),
                cell(language.get("parentLanguageId")),
                cell(language.get("region")),
                ";".join(cell(item) for item in countries)
                if isinstance(countries, list)
                else "",
                cell(language.get("nativeSpeakers")),
                cell(language.get("totalSpeakers")),
                cell(language.get("status")),
                cell(language.get("timeOrigin")),
                cell(language.get("timeEnd")),
                cell(language.get("classification")),
                cell(language.get("writingSystem")),
                "true" if js_truthy(language.get("isHistoricalVariant")) else "false",
                "true" if js_truthy(language.get("isDialect")) else "false",
                cell(order) if order is not None else "0",
                cell(language.get("historicalContext")),
                cell(coordinates.get("lat")) if isinstance(coordinates, dict) else "",
                cell(coordinates.get("lng")) if isinstance(coordinates, dict) else "",
            ]
        )
    write_tsv(path, list(LANGUAGE_HEADERS), rows)


__all__ = [
    "FAMILY_HEADERS",
    "LANGUAGE_HEADERS",
    "TsvWriteError",
    "cell",
    "write_language_family_tsv",
    "write_language_tsv",
    "write_tsv",
]
