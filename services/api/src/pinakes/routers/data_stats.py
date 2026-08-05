"""`GET /api/data/stats` — the corpus inventory the data page renders.

Its own file because it is its own port unit (`data`), and its own *reader*
because it does not use one: the Express handler imports `node:fs` inline and
counts **lines**, deliberately never touching `tsv-storage.ts`. That is what
makes it an inventory rather than a report — it answers "how many rows are in
this file" for forty-odd files without parsing any of them, so a file with a
broken required column still has a count.

Three consequences of counting that way, all of them reproduced:

* **A row is a non-blank line minus the header**, so a quoted cell containing a
  newline counts as two rows and a file with only a header counts as zero. No
  loader here agrees with that; nothing has to.
* **An unreadable file is `0`, never an error.** `countRows` swallows everything,
  so a missing `wikimedia-commons-images.tsv` is a dataset with no rows rather
  than a 500 — the opposite of `lexicons/storage.py`'s "a missing required column
  is an error".
* **`languages.tsv` gets a second pass** for the coverage triple, and its column
  reads are `indexOf`-optional: a corpus that lost `writingSystem` reports zero
  writing systems, not a failure.

The catalog is a literal list in source, and `deities`/`myth-motifs` appear
**twice** — once under Religion and once under Mythology. The dedup key is
`category:file`, not `file`, so both survive; deduping by file alone would
silently drop the Mythology section.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.data_stats")

router = APIRouter(tags=["data"])

#: `(category, name, file, unit)` for every file the inventory reports, in the
#: TypeScript's order. `unit` is emitted only where it is set — `JSON.stringify`
#: drops an `undefined` key, and only `words.tsv` has one.
DATASETS: tuple[tuple[str, str, str, str | None], ...] = (
    ("Linguistics", "Language Families", "families.tsv", None),
    ("Linguistics", "Languages", "languages.tsv", None),
    ("Linguistics", "Base Words (Concepts)", "words-base.tsv", None),
    ("Linguistics", "Word Forms", "words.tsv", "forms"),
    ("Linguistics", "Etymology Relations", "etymology-relations.tsv", None),
    ("Linguistics", "Sample Texts", "sample-texts.tsv", None),
    (
        "Linguistics",
        "Phonological Inventories",
        "phonological-inventories.tsv",
        None,
    ),
    ("Linguistics", "Grammar Features", "grammar-features.tsv", None),
    ("Linguistics", "Writing Systems", "writing-systems.tsv", None),
    ("Linguistics", "Verb Paradigms", "verb-paradigms.tsv", None),
    ("Linguistics", "Language Contacts", "language-contacts.tsv", None),
    ("Linguistics", "Sound Changes", "sound-changes.tsv", None),
    ("Genetics", "Haplogroups", "haplogroups.tsv", None),
    ("Culture", "Art Traditions", "art-traditions.tsv", None),
    ("Culture", "Architectural Styles", "architectural-styles.tsv", None),
    ("Culture", "Literary Traditions", "literary-traditions.tsv", None),
    ("Culture", "Literary Works", "literary-works.tsv", None),
    ("Culture", "Music Traditions", "music-traditions.tsv", None),
    ("Culture", "Musical Instruments", "musical-instruments.tsv", None),
    ("Culture", "Dance Traditions", "dance-traditions.tsv", None),
    ("Religion", "Religions", "religions.tsv", None),
    ("Religion", "Deities", "deities.tsv", None),
    ("Religion", "Myth Motifs", "myth-motifs.tsv", None),
    ("History", "Archaeological Cultures", "archaeological-cultures.tsv", None),
    ("History", "Battles", "battles.tsv", None),
    ("History", "Migration Routes", "migration-routes.tsv", None),
    ("History", "Trade Goods", "trade-goods.tsv", None),
    ("History", "Trade Routes", "trade-routes.tsv", None),
    ("History", "Urheimat Hypotheses", "urheimat-hypotheses.tsv", None),
    ("History", "Civilizations", "civilizations.tsv", None),
    ("History", "Civilization Boundaries", "civilization-boundaries.tsv", None),
    ("Food", "Cuisines", "cuisines.tsv", None),
    ("Food", "Cuisine Items", "cuisine-items.tsv", None),
    ("Food", "Ingredient Origins", "ingredient-origins.tsv", None),
    ("Food", "Cooking Techniques", "cooking-techniques.tsv", None),
    ("Food", "Foodway Events", "foodway-events.tsv", None),
    ("Culture", "Material Culture", "material-culture.tsv", None),
    ("Social", "Kinship Systems", "kinship-systems.tsv", None),
    ("Social", "Cultural Lineages", "cultural-lineages.tsv", None),
    ("Social", "Narratives", "narratives.tsv", None),
    ("Mythology", "Deities", "deities.tsv", None),
    ("Mythology", "Myth Motifs", "myth-motifs.tsv", None),
    ("Geography", "Language Ranges", "language-ranges.tsv", None),
    ("Geography", "Range Polygons", "language-range-polygons.tsv", None),
)


def _lines(path: Path) -> list[str]:
    """Non-blank lines of a file, or none at all if it cannot be read.

    ``newline=""`` is load-bearing, for the reason `analytics/quality.py`
    documents: the split is on ``"\\n"`` alone — not ``/\\r?\\n/`` like the TSV
    reader's — so a CRLF file keeps a ``\\r`` on the end of every line, and
    therefore on its **last header cell**. `families.tsv` is CRLF today. Python's
    universal-newline translation would silently "fix" that, and the only symptom
    would be a column this handler finds that node does not.
    """
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            text = handle.read()
    except Exception:  # noqa: BLE001 - `catch { return 0 }`, verbatim
        return []
    return [line for line in text.split("\n") if line.strip()]


def count_rows(lexicons: Path, filename: str) -> int:
    """``countRows`` — non-blank lines minus the header, floored at zero."""
    return max(0, len(_lines(lexicons / filename)) - 1)


def language_coverage(lexicons: Path) -> dict[str, int]:
    """``languageCoverage`` — how many languages carry each optional field.

    A language counts toward `coordinates` only when **both** latitude and
    longitude are non-blank; `temporal` and `writingSystem` are single columns.
    A file with fewer than two lines (header only, or absent) is all zeroes.
    """
    empty = {"coordinates": 0, "temporal": 0, "writingSystem": 0}
    lines = _lines(lexicons / "languages.tsv")
    if len(lines) < 2:
        return empty

    header = lines[0].split("\t")
    latitude = header.index("latitude") if "latitude" in header else -1
    longitude = header.index("longitude") if "longitude" in header else -1
    origin = header.index("originYear") if "originYear" in header else -1
    writing = header.index("writingSystem") if "writingSystem" in header else -1

    def filled(columns: list[str], index: int) -> bool:
        """``cols[idx]?.trim()`` — a short row is `undefined`, which is falsy."""
        return 0 <= index < len(columns) and bool(columns[index].strip())

    counts = dict(empty)
    for line in lines[1:]:
        columns = line.split("\t")
        if (
            latitude >= 0
            and longitude >= 0
            and filled(columns, latitude)
            and filled(columns, longitude)
        ):
            counts["coordinates"] += 1
        if origin >= 0 and filled(columns, origin):
            counts["temporal"] += 1
        if writing >= 0 and filled(columns, writing):
            counts["writingSystem"] += 1
    return counts


@router.get("/api/data/stats")
def data_stats() -> Any:
    """Row counts for every corpus file the data page lists."""
    try:
        lexicons = lexicons_dir()
        seen: set[str] = set()
        datasets: list[dict[str, Any]] = []
        for category, name, filename, unit in DATASETS:
            key = f"{category}:{filename}"
            if key in seen:
                continue
            seen.add(key)
            entry: dict[str, Any] = {
                "category": category,
                "name": name,
                "count": count_rows(lexicons, filename),
                "file": filename,
            }
            if unit:
                entry["unit"] = unit
            if name == "Languages":
                entry["coverage"] = language_coverage(lexicons)
            datasets.append(entry)
        return {"datasets": datasets}
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "getting data stats", "Failed to get data stats"
        )
