"""Schema and referential-integrity validation — `services/data-validation.ts`.

Ported for the three `/api/data-validation/*` reads (pinakes:80 US-1, the tenth
slice). Thirty-eight file schemas, sixty-odd cross-reference rules, and a
per-row walk that reports what disagrees with them.

**This is not `analytics/quality.py`.** That module grades the corpus it finds
(completeness, uniqueness, tiers) and is generated into a committed snapshot;
this one checks the corpus against a *declared* schema and answers live. They
read the same files with two private TSV readers that differ, which is the same
situation `quality.py` documents — and the difference is real: this reader drops
**every** blank line rather than just trailing ones, and it `trim()`s each cell
at read time, so a cell of spaces is empty here and is not there.

Four rules that a rewrite would quietly change:

* **`optional` and `isJsonArray` are absent, not false, when unset.**
  `JSON.stringify` writes no key for an `undefined`, and
  `GET /api/data-validation/cross-references` publishes these rules verbatim —
  so a rule dict here omits them, and :data:`CROSS_REFERENCES` is built that way
  rather than defaulted.
* **A missing *column* is an issue with no row number; a missing *file* is a
  single error issue and a `rowCount` of 0.** Neither is an exception.
* **The `id` uniqueness check runs inside the per-column loop**, so it only
  fires for a file whose schema *declares* an `id` column — and the duplicate is
  reported on the second row, not the first.
* **`Number(val)` must match the whole cell** where `parseInt` would read a
  prefix, so `1e3` is a valid number and `12px` is not. `analytics.tsv.js_number`
  is that rule.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from pinakes.analytics import tsv
from pinakes.analytics.jsmath import js_number

Record = dict[str, Any]


def _iso_now() -> str:
    """``new Date().toISOString()`` — the only clock this module reads."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _column(name: str, **rules: Any) -> Record:
    """A column rule with its unset keys omitted, as the TypeScript literal is."""
    return {"name": name, **{key: value for key, value in rules.items() if value}}


def _reference(
    source_file: str,
    source_column: str,
    target_file: str,
    target_column: str = "id",
    *,
    is_json_array: bool = False,
    optional: bool = False,
) -> Record:
    """One cross-reference rule. Unset flags emit **no key** — see the docstring."""
    rule: Record = {
        "sourceFile": source_file,
        "sourceColumn": source_column,
        "targetFile": target_file,
        "targetColumn": target_column,
    }
    if is_json_array:
        rule["isJsonArray"] = True
    if optional:
        rule["optional"] = True
    return rule


FILE_SCHEMAS: Final[list[Record]] = [
    {
        "file": "languages.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("family_id"),
            _column("parent_language_id", allowEmpty=True),
            _column("region"),
            _column("status"),
            _column("time_origin", type="number", allowEmpty=True),
            _column("time_end", type="number", allowEmpty=True),
            _column("latitude", type="number", allowEmpty=True),
            _column("longitude", type="number", allowEmpty=True),
        ],
    },
    {
        "file": "families.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("parent_id", allowEmpty=True),
            _column("total_speakers", type="number", allowEmpty=True),
            _column("language_count", type="number", allowEmpty=True),
        ],
    },
    {
        "file": "civilizations.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("time_period_start", type="number"),
            _column("time_period_end", type="number", allowEmpty=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
            _column("haplogroup_ids", type="json-array", allowEmpty=True),
            _column("cuisine_id", allowEmpty=True),
        ],
    },
    {
        "file": "archaeological-sites.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("coordinates", type="json"),
            _column("time_period_start", type="number", allowEmpty=True),
            _column("time_period_end", type="number", allowEmpty=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
            _column("associated_culture_ids", type="json-array", allowEmpty=True),
            _column("associated_civilization_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "archaeological-cultures.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("coordinates", type="json", allowEmpty=True),
            _column("time_period_start", type="number", allowEmpty=True),
            _column("time_period_end", type="number", allowEmpty=True),
            _column("predecessor_culture_ids", type="json-array", allowEmpty=True),
            _column("successor_culture_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "haplogroups.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("parent_id", allowEmpty=True),
            _column("haplogroup_type"),
            _column(
                "associated_language_family_ids", type="json-array", allowEmpty=True
            ),
            _column("associated_civilization_ids", type="json-array", allowEmpty=True),
            _column("time_origin", type="number", allowEmpty=True),
        ],
    },
    {
        "file": "religions.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("coordinates", type="json", allowEmpty=True),
            _column("time_origin", type="number", allowEmpty=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "deities.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_religion_ids", type="json-array", allowEmpty=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "myth-motifs.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_religion_ids", type="json-array", allowEmpty=True),
            _column("associated_deity_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "cuisines.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
            _column("time_origin", type="number", allowEmpty=True),
        ],
    },
    {
        "file": "cuisine-items.tsv",
        "columns": [
            _column("id", required=True),
            _column("cuisine_id", required=True),
        ],
    },
    {
        "file": "cooking-techniques.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("cuisine_id", required=True),
        ],
    },
    {
        "file": "ingredient-origins.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("cuisine_id", allowEmpty=True),
        ],
    },
    {
        "file": "music-traditions.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
            _column("time_origin", type="number", allowEmpty=True),
        ],
    },
    {
        "file": "musical-instruments.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_tradition_ids", type="json-array", allowEmpty=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "dance-traditions.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
            _column(
                "associated_music_tradition_ids", type="json-array", allowEmpty=True
            ),
        ],
    },
    {
        "file": "trade-routes.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("traded_goods", type="json-array", allowEmpty=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "trade-goods.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("trade_routes", type="json-array", allowEmpty=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "migration-routes.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "sound-changes.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("family_id"),
            _column("source_language_id"),
            _column("target_language_id"),
        ],
    },
    {
        "file": "language-contacts.tsv",
        "columns": [
            _column("id", required=True),
            _column("source_language_id", required=True),
            _column("target_language_id", required=True),
        ],
    },
    {
        "file": "phonological-inventories.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", required=True),
            _column("consonants", type="json-array"),
            _column("vowels", type="json-array"),
        ],
    },
    {
        "file": "grammar-features.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", required=True),
            _column("word_order"),
        ],
    },
    {
        "file": "writing-systems.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("parent_system_id", allowEmpty=True),
            _column("language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "verb-paradigms.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", required=True),
        ],
    },
    {
        "file": "sample-texts.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", required=True),
        ],
    },
    {
        "file": "urheimat-hypotheses.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_family_id", required=True),
        ],
    },
    {
        "file": "literary-traditions.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "literary-works.tsv",
        "columns": [
            _column("id", required=True),
            _column("title", required=True),
            _column("tradition_id", allowEmpty=True),
            _column("language_id", allowEmpty=True),
        ],
    },
    {
        "file": "civilization-boundaries.tsv",
        "columns": [
            _column("id", required=True),
            _column("civilization_id", required=True),
        ],
    },
    {
        "file": "kinship-systems.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_ids", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "language-ranges.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", allowEmpty=True),
            _column("family_id", allowEmpty=True),
        ],
    },
    {
        "file": "language-range-polygons.tsv",
        "columns": [
            _column("id", required=True),
            _column("language_id", allowEmpty=True),
            _column("family_id", allowEmpty=True),
        ],
    },
    {
        "file": "battles.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("coordinates", type="json"),
        ],
    },
    {
        "file": "material-culture.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "art-traditions.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_civilizations", type="json-array", allowEmpty=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "architectural-styles.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_civilizations", type="json-array", allowEmpty=True),
            _column("associated_languages", type="json-array", allowEmpty=True),
        ],
    },
    {
        "file": "foodway-events.tsv",
        "columns": [
            _column("id", required=True),
            _column("name", required=True),
            _column("associated_route_id", allowEmpty=True),
        ],
    },
]


CROSS_REFERENCES: Final[list[Record]] = [
    # Language family references
    _reference("languages.tsv", "family_id", "families.tsv", optional=True),
    _reference("languages.tsv", "parent_language_id", "languages.tsv", optional=True),
    _reference("families.tsv", "parent_id", "families.tsv", optional=True),
    # Civilization references
    _reference(
        "civilizations.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "civilizations.tsv",
        "haplogroup_ids",
        "haplogroups.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference("civilizations.tsv", "cuisine_id", "cuisines.tsv", optional=True),
    _reference(
        "civilization-boundaries.tsv", "civilization_id", "civilizations.tsv"
    ),
    # Archaeological references
    _reference(
        "archaeological-sites.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "archaeological-sites.tsv",
        "associated_culture_ids",
        "archaeological-cultures.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "archaeological-sites.tsv",
        "associated_civilization_ids",
        "civilizations.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "archaeological-cultures.tsv",
        "predecessor_culture_ids",
        "archaeological-cultures.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "archaeological-cultures.tsv",
        "successor_culture_ids",
        "archaeological-cultures.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Haplogroup references
    _reference("haplogroups.tsv", "parent_id", "haplogroups.tsv", optional=True),
    _reference(
        "haplogroups.tsv",
        "associated_language_family_ids",
        "families.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "haplogroups.tsv",
        "associated_civilization_ids",
        "civilizations.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Religion / mythology references
    _reference(
        "religions.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "deities.tsv",
        "associated_religion_ids",
        "religions.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "deities.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "myth-motifs.tsv",
        "associated_religion_ids",
        "religions.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "myth-motifs.tsv",
        "associated_deity_ids",
        "deities.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Cuisine references
    _reference(
        "cuisines.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference("cuisine-items.tsv", "cuisine_id", "cuisines.tsv"),
    _reference("cooking-techniques.tsv", "cuisine_id", "cuisines.tsv"),
    _reference(
        "ingredient-origins.tsv", "cuisine_id", "cuisines.tsv", optional=True
    ),
    # Music references
    _reference(
        "music-traditions.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "musical-instruments.tsv",
        "associated_tradition_ids",
        "music-traditions.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "musical-instruments.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "dance-traditions.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "dance-traditions.tsv",
        "associated_music_tradition_ids",
        "music-traditions.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Trade references
    _reference(
        "trade-routes.tsv",
        "traded_goods",
        "trade-goods.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "trade-routes.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "trade-goods.tsv",
        "trade_routes",
        "trade-routes.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "trade-goods.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "migration-routes.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "foodway-events.tsv", "associated_route_id", "trade-routes.tsv", optional=True
    ),
    # Linguistic feature references
    _reference("sound-changes.tsv", "family_id", "families.tsv"),
    _reference("sound-changes.tsv", "source_language_id", "languages.tsv"),
    _reference("sound-changes.tsv", "target_language_id", "languages.tsv"),
    _reference("language-contacts.tsv", "source_language_id", "languages.tsv"),
    _reference("language-contacts.tsv", "target_language_id", "languages.tsv"),
    _reference("phonological-inventories.tsv", "language_id", "languages.tsv"),
    _reference("grammar-features.tsv", "language_id", "languages.tsv"),
    _reference("verb-paradigms.tsv", "language_id", "languages.tsv"),
    _reference("sample-texts.tsv", "language_id", "languages.tsv"),
    # Writing system references
    _reference(
        "writing-systems.tsv", "parent_system_id", "writing-systems.tsv", optional=True
    ),
    _reference(
        "writing-systems.tsv",
        "language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Urheimat references
    _reference("urheimat-hypotheses.tsv", "language_family_id", "families.tsv"),
    # Literary references
    _reference(
        "literary-traditions.tsv",
        "associated_language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "literary-works.tsv",
        "tradition_id",
        "literary-traditions.tsv",
        optional=True,
    ),
    _reference("literary-works.tsv", "language_id", "languages.tsv", optional=True),
    # Geographic references
    _reference("language-ranges.tsv", "language_id", "languages.tsv", optional=True),
    _reference("language-ranges.tsv", "family_id", "families.tsv", optional=True),
    _reference(
        "language-range-polygons.tsv", "language_id", "languages.tsv", optional=True
    ),
    _reference(
        "language-range-polygons.tsv", "family_id", "families.tsv", optional=True
    ),
    # Material culture references
    _reference(
        "material-culture.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Art/architecture references
    _reference(
        "art-traditions.tsv",
        "associated_civilizations",
        "civilizations.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "art-traditions.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "architectural-styles.tsv",
        "associated_civilizations",
        "civilizations.tsv",
        is_json_array=True,
        optional=True,
    ),
    _reference(
        "architectural-styles.tsv",
        "associated_languages",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
    # Kinship references
    _reference(
        "kinship-systems.tsv",
        "language_ids",
        "languages.tsv",
        is_json_array=True,
        optional=True,
    ),
]


# ── The private TSV reader ───────────────────────────────────────────────────


def parse_tsv_file(path: Path) -> tuple[list[str], list[list[str]]] | None:
    """`parseTsvFile` — `None` for a missing file, `([], [])` for an empty one.

    The split is on ``"\\n"`` alone, so a CRLF file keeps a ``\\r`` on its last
    column and `columns` publishes it — which is why this opens with
    ``newline=""``. Every blank line is dropped, anywhere in the file, before the
    header is taken.
    """
    if not path.is_file():
        return None
    with open(path, encoding="utf-8", newline="") as handle:
        text = handle.read()
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return [], []
    return lines[0].split("\t"), [line.split("\t") for line in lines[1:]]


def _cell(row: list[str], index: int) -> str:
    """`getCellValue` — out of range is empty, and every cell is trimmed."""
    if index < 0 or index >= len(row):
        return ""
    return row[index].strip()


def _js_typeof(value: Any) -> str:
    """``typeof`` for a `JSON.parse` result — the message quotes it."""
    if value is None:
        return "object"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "object"


def _json_parse(raw: str) -> tuple[bool, Any]:
    """`JSON.parse`, as a `(ok, value)` pair.

    Python's `json` accepts `NaN`/`Infinity` where JavaScript's rejects them, so
    those three literals are refused here — a cell holding one is `Invalid JSON`
    on both backends.
    """
    stripped = raw.strip()
    if stripped in {"NaN", "Infinity", "-Infinity"}:
        return False, None
    try:
        return True, json.loads(raw)
    except ValueError:
        return False, None


# ── The validator ────────────────────────────────────────────────────────────


class DataValidationService:
    """The port of the TypeScript class, id cache and all.

    The cache is per-instance and cleared at the top of :meth:`validate`, exactly
    as it is over there — it exists so that a cross-reference pass does not
    re-read a file the schema pass already walked, and `validate` clearing it is
    what keeps two calls from disagreeing about a corpus that changed underneath.
    """

    def __init__(self, lexicons_dir: Path) -> None:
        self.lexicons_dir = lexicons_dir
        self._id_cache: dict[str, set[str]] = {}

    # -- public surface ------------------------------------------------------

    def validate(
        self,
        *,
        files: list[str] | None = None,
        skip_cross_references: bool = False,
    ) -> Record:
        """The full report: per-file schema results plus cross-reference results.

        `files` narrows the schema pass by exact file name **and** narrows the
        cross-reference pass to the rules that mention one of them on *either*
        side — so asking for `languages.tsv` still checks everything that points
        at it.
        """
        self._id_cache.clear()

        schemas = (
            [schema for schema in FILE_SCHEMAS if schema["file"] in files]
            if files is not None
            else FILE_SCHEMAS
        )

        file_results: list[Record] = []
        total_rows = 0
        for schema in schemas:
            result = self._validate_file(schema)
            file_results.append(result)
            total_rows += int(result["rowCount"])

        cross_references: list[Record] = []
        if not skip_cross_references:
            rules = (
                [
                    rule
                    for rule in CROSS_REFERENCES
                    if rule["sourceFile"] in files or rule["targetFile"] in files
                ]
                if files is not None
                else CROSS_REFERENCES
            )
            cross_references = self._validate_cross_references(rules)

        issues = [issue for result in file_results for issue in result["issues"]]
        issues += [issue for result in cross_references for issue in result["issues"]]

        by_severity = {"error": 0, "warning": 0, "info": 0}
        for issue in issues:
            by_severity[str(issue["severity"])] += 1

        return {
            "timestamp": _iso_now(),
            "filesValidated": len(file_results),
            "totalRows": total_rows,
            "totalIssues": len(issues),
            "issuesBySeverity": by_severity,
            "fileResults": file_results,
            "crossReferences": cross_references,
        }

    def data_summary(self) -> list[Record]:
        """`getDataSummary` — every declared file, whether or not it is there."""
        summary: list[Record] = []
        for schema in FILE_SCHEMAS:
            parsed = parse_tsv_file(self.lexicons_dir / str(schema["file"]))
            summary.append(
                {
                    "file": schema["file"],
                    "exists": parsed is not None,
                    "rowCount": len(parsed[1]) if parsed is not None else 0,
                    "columnCount": len(parsed[0]) if parsed is not None else 0,
                }
            )
        return summary

    def cross_reference_rules(self) -> list[Record]:
        """`getCrossReferenceRules` — the declared rules, published verbatim."""
        return CROSS_REFERENCES

    # -- the schema pass -----------------------------------------------------

    def _validate_file(self, schema: Record) -> Record:
        name = str(schema["file"])
        parsed = parse_tsv_file(self.lexicons_dir / name)
        if parsed is None:
            return {
                "file": name,
                "rowCount": 0,
                "columns": [],
                "issues": [
                    {
                        "file": name,
                        "severity": "error",
                        "message": f"File not found: {name}",
                    }
                ],
            }

        header, rows = parsed
        columns: list[Record] = list(schema["columns"])
        issues: list[Record] = []

        for column in columns:
            if _index(header, str(column["name"])) < 0:
                issues.append(
                    {
                        "file": name,
                        "column": column["name"],
                        "severity": "error" if column.get("required") else "warning",
                        "message": f"Missing column '{column['name']}'",
                    }
                )

        id_index = _index(header, "id")
        if id_index >= 0:
            self._id_cache[name] = {
                value for row in rows if (value := _cell(row, id_index))
            }

        seen_ids: set[str] = set()
        for position, row in enumerate(rows):
            row_number = position + 2  # 1-indexed, plus the header
            for column in columns:
                index = _index(header, str(column["name"]))
                if index < 0:
                    continue
                value = _cell(row, index)

                if column.get("required") and not value:
                    issues.append(
                        {
                            "file": name,
                            "row": row_number,
                            "column": column["name"],
                            "severity": "error",
                            "message": (
                                f"Required field '{column['name']}' is empty"
                            ),
                        }
                    )
                    continue
                if not value:
                    continue

                if column["name"] == "id":
                    if value in seen_ids:
                        issues.append(
                            {
                                "file": name,
                                "row": row_number,
                                "column": "id",
                                "severity": "error",
                                "message": f"Duplicate ID '{value}'",
                                "value": value,
                            }
                        )
                    seen_ids.add(value)

                kind = column.get("type")
                if kind == "number" and value != "null":
                    number = tsv.js_number(value)
                    if number != number:
                        issues.append(
                            {
                                "file": name,
                                "row": row_number,
                                "column": column["name"],
                                "severity": "error",
                                "message": "Invalid number value",
                                "value": value,
                            }
                        )

                if kind in {"json", "json-array"} and value != "null":
                    ok, decoded = _json_parse(value)
                    if not ok:
                        issues.append(
                            {
                                "file": name,
                                "row": row_number,
                                "column": column["name"],
                                "severity": "error",
                                "message": "Invalid JSON",
                                "value": value[:100],
                            }
                        )
                    elif kind == "json-array" and not isinstance(decoded, list):
                        issues.append(
                            {
                                "file": name,
                                "row": row_number,
                                "column": column["name"],
                                "severity": "warning",
                                "message": (
                                    "Expected JSON array but got "
                                    f"{_js_typeof(decoded)}"
                                ),
                                "value": value[:100],
                            }
                        )

            issues.extend(
                _date_order_issue(
                    name,
                    header,
                    row,
                    row_number,
                    start_column="time_period_start",
                    end_column="time_period_end",
                    label="start date",
                )
            )
            issues.extend(
                _date_order_issue(
                    name,
                    header,
                    row,
                    row_number,
                    start_column="time_origin",
                    end_column="time_end",
                    label="origin date",
                )
            )

        return {
            "file": name,
            "rowCount": len(rows),
            "columns": header,
            "issues": issues,
        }

    # -- the cross-reference pass --------------------------------------------

    def _id_set(self, file: str, column: str = "id") -> set[str]:
        cache_key = f"{file}:{column}"
        if cache_key in self._id_cache:
            return self._id_cache[cache_key]
        if column == "id" and file in self._id_cache:
            return self._id_cache[file]

        parsed = parse_tsv_file(self.lexicons_dir / file)
        if parsed is None:
            return set()
        header, rows = parsed
        index = _index(header, column)
        if index < 0:
            return set()

        ids = {value for row in rows if (value := _cell(row, index))}
        self._id_cache[cache_key] = ids
        if column == "id":
            self._id_cache[file] = ids
        return ids

    def _validate_cross_references(self, rules: list[Record]) -> list[Record]:
        """One result per rule that had something to say.

        Four ways a rule contributes **nothing**: a missing source file, a target
        whose id set is empty (missing *or* genuinely empty — the two are not
        told apart), a source column the file does not have, and a rule whose
        every row was blank. Only the last of those is visible in the report, as
        an absence.
        """
        results: list[Record] = []
        for rule in rules:
            source_file = str(rule["sourceFile"])
            parsed = parse_tsv_file(self.lexicons_dir / source_file)
            if parsed is None:
                continue

            target_ids = self._id_set(
                str(rule["targetFile"]), str(rule["targetColumn"])
            )
            if not target_ids:
                continue

            header, rows = parsed
            column_index = _index(header, str(rule["sourceColumn"]))
            if column_index < 0:
                continue

            issues: list[Record] = []
            total_references = 0
            broken_references = 0

            for position, row in enumerate(rows):
                row_number = position + 2
                raw = _cell(row, column_index)
                if not raw or raw == "null":
                    continue

                if rule.get("isJsonArray"):
                    ok, decoded = _json_parse(raw)
                    if not ok or not isinstance(decoded, list):
                        continue  # the schema pass reports this
                    reference_ids = [
                        text
                        for item in decoded
                        if (text := _js_string(item).strip())
                    ]
                else:
                    reference_ids = [raw]

                for reference in reference_ids:
                    total_references += 1
                    if reference not in target_ids:
                        broken_references += 1
                        issues.append(
                            {
                                "file": source_file,
                                "row": row_number,
                                "column": rule["sourceColumn"],
                                "severity": (
                                    "warning" if rule.get("optional") else "error"
                                ),
                                "message": (
                                    f"Reference '{reference}' not found in "
                                    f"{rule['targetFile']}.{rule['targetColumn']}"
                                ),
                                "value": reference,
                            }
                        )

            if total_references > 0 or issues:
                results.append(
                    {
                        "sourceFile": source_file,
                        "sourceColumn": rule["sourceColumn"],
                        "targetFile": rule["targetFile"],
                        "targetColumn": rule["targetColumn"],
                        "totalReferences": total_references,
                        "brokenReferences": broken_references,
                        "issues": issues,
                    }
                )
        return results


def _index(header: list[str], name: str) -> int:
    """`getCol` — `indexOf`, so a missing column is `-1` and never a throw."""
    return header.index(name) if name in header else -1


def _js_string(value: Any) -> str:
    """``String(v)`` for the items of a parsed JSON array."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return value
    if isinstance(value, float) and value.is_integer() and math.isfinite(value):
        return str(int(value))
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _date_order_issue(
    file: str,
    header: list[str],
    row: list[str],
    row_number: int,
    *,
    start_column: str,
    end_column: str,
    label: str,
) -> list[Record]:
    """The two "end before start" checks, which differ only in their columns.

    Both run for **every** row of a file carrying the pair, whether or not the
    schema declares either column — the check reads the header directly. The
    message prints the *parsed numbers*, not the cells, so a `1e3` end date is
    reported as `1000`.
    """
    start_index = _index(header, start_column)
    end_index = _index(header, end_column)
    if start_index < 0 or end_index < 0:
        return []
    start_value = _cell(row, start_index)
    end_value = _cell(row, end_index)
    if not start_value or not end_value or end_value == "null":
        return []
    start = tsv.js_number(start_value)
    end = tsv.js_number(end_value)
    if start != start or end != end or not end < start:
        return []
    return [
        {
            "file": file,
            "row": row_number,
            "column": end_column,
            "severity": "warning",
            "message": (
                f"End date ({js_number(end)}) before {label} ({js_number(start)})"
            ),
        }
    ]
