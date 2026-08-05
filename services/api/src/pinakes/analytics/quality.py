"""Data-quality scoring — the port of `server/services/data-quality-scorer.ts`.

`GET /api/data-quality` grades the whole lexicon corpus in four sections:

* **per-file quality** — field completeness, id uniqueness, row adequacy, and a
  weighted `overallScore` per TSV;
* **referential integrity** — the six foreign keys between the language files;
* **coverage** — actual row counts against the roadmap / breadth targets
  (:data:`ROADMAP_TARGETS`); and
* **tier composition** — every node row classified by its *intrinsic* provenance,
  i.e. auto-admission readiness.

Three things here are contract rather than implementation detail:

* **The tier classification is imported, not restated.**
  :func:`pinakes_engine.orchestrate.tiers.classify_tier` is the same policy
  `@contracts/trust-tier`'s `classifyTrustTier` mirrors, so this report labels a
  row the way the corpus build does. Only the **trust** rungs are bucketed
  (:data:`TRUST_TIERS`): personal and synthetic are provenance partitions on a
  different axis, no lexicon row can be either, and the published `byTier` array
  is four entries long.
* **The whole app corpus is `curated`, and the breakdown is something else.**
  Auto-admission never writes `data/source/lexicons/*.tsv`, so `graphTier` is
  `curated` unconditionally; `byTier` classifies each curated row with `source`
  *omitted* to ask a different question — would this row admit to the graph on
  its own merits?
* **This module carries its own TSV split, and that is deliberate.** The
  TypeScript scorer had a private `parseTsvFile` that differs from the storage
  reader's: an empty file yields **no header at all** (`columnCount: 0`), not one
  blank column. `columnCount` is published per file, so the difference is
  observable and :mod:`pinakes.analytics.tsv` is not a drop-in here.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pinakes_contracts import lexicon_mapping
from pinakes_engine.orchestrate.tiers import (
    TIER_AUTO_ADMITTED,
    TIER_CURATED,
    TIER_INFERRED,
    TIER_QUARANTINE,
    classify_tier,
)

from pinakes.analytics.jsmath import round_to
from pinakes.analytics.tsv import js_number

#: The trust axis, most-to-least trusted — `@contracts/trust-tier`'s
#: `ALL_TRUST_TIERS`, and the stable order the report's buckets render in.
TRUST_TIERS: tuple[str, ...] = (
    TIER_CURATED,
    TIER_AUTO_ADMITTED,
    TIER_QUARANTINE,
    TIER_INFERRED,
)

#: The foreign keys checked between lexicon files, in report order.
FOREIGN_KEYS: tuple[tuple[str, str, str, str], ...] = (
    ("languages.tsv", "family_id", "families.tsv", "id"),
    ("languages.tsv", "parent_language_id", "languages.tsv", "id"),
    ("families.tsv", "parent_id", "families.tsv", "id"),
    ("grammar-features.tsv", "language_id", "languages.tsv", "id"),
    ("phonological-inventories.tsv", "language_id", "languages.tsv", "id"),
    ("words.tsv", "Language_ID", "languages.tsv", "id"),
)

#: Per-domain population targets, ordered as the roadmap §15 table lists them
#: (hard roadmap numbers first, then the story-breadth domains). Kept in sync with
#: `docs/prd-pinakes-deep-history-roadmap.md`; add a domain by extending this
#: tuple and regenerating the committed report.
ROADMAP_TARGETS: tuple[dict[str, Any], ...] = (
    {"domain": "civilizations", "file": "civilizations.tsv", "target": 150, "targetLabel": "150+", "kind": "roadmap", "source": "roadmap §8.1 / §15"},  # noqa: E501
    {"domain": "archaeological-sites", "file": "archaeological-sites.tsv", "target": 500, "targetLabel": "500+", "kind": "roadmap", "source": "roadmap §8.2 / §15"},  # noqa: E501
    {"domain": "archaeological-cultures", "file": "archaeological-cultures.tsv", "target": 200, "targetLabel": "200+", "kind": "roadmap", "source": "roadmap §15"},  # noqa: E501
    {"domain": "migration-routes", "file": "migration-routes.tsv", "target": 100, "targetLabel": "100+", "kind": "roadmap", "source": "roadmap §8.3 / §15"},  # noqa: E501
    {"domain": "cuisines", "file": "cuisines.tsv", "target": 80, "targetLabel": "80+", "kind": "roadmap", "source": "roadmap §15"},  # noqa: E501
    {"domain": "language-range-polygons", "file": "language-range-polygons.tsv", "target": 200, "targetLabel": "200+", "kind": "roadmap", "source": "roadmap §8.4"},  # noqa: E501
    {"domain": "trade-routes", "file": "trade-routes.tsv", "target": 30, "targetLabel": "expanded (30+)", "kind": "breadth", "source": "US-003 breadth (roadmap: named corridors)"},  # noqa: E501
    {"domain": "ingredient-origins", "file": "ingredient-origins.tsv", "target": 100, "targetLabel": "100+", "kind": "breadth", "source": "US-004 food-drink breadth"},  # noqa: E501
    {"domain": "cooking-techniques", "file": "cooking-techniques.tsv", "target": 80, "targetLabel": "80+", "kind": "breadth", "source": "US-004 food-drink breadth"},  # noqa: E501
    {"domain": "writing-systems", "file": "writing-systems.tsv", "target": 100, "targetLabel": "100+", "kind": "breadth", "source": "US-005 breadth"},  # noqa: E501
    {"domain": "deities", "file": "deities.tsv", "target": 200, "targetLabel": "200+", "kind": "breadth", "source": "US-005 breadth"},  # noqa: E501
    {"domain": "architectural-styles", "file": "architectural-styles.tsv", "target": 90, "targetLabel": "90+", "kind": "breadth", "source": "US-005 breadth"},  # noqa: E501
    {"domain": "dance-traditions", "file": "dance-traditions.tsv", "target": 90, "targetLabel": "90+", "kind": "breadth", "source": "US-005 breadth"},  # noqa: E501
    {"domain": "literary-traditions", "file": "literary-traditions.tsv", "target": 50, "targetLabel": "50+ (foundational corpus)", "kind": "breadth", "source": "US-005 breadth (roadmap: foundational corpus)"},  # noqa: E501
    {"domain": "myth-motifs", "file": "myth-motifs.tsv", "target": 60, "targetLabel": "60+", "kind": "breadth", "source": "US-005 breadth"},  # noqa: E501
)


def parse_tsv_file(path: Path) -> tuple[list[str], list[list[str]]]:
    """This scorer's own TSV split (see the module docstring).

    ``text.split("\\n")`` with blank lines dropped, then a plain ``split("\\t")``.
    Two details are load-bearing and both are visible in the published report:

    * An empty file has **no header**, which is what makes its `columnCount` 0.
    * The split is on ``"\\n"`` alone, so a CRLF file keeps a ``\\r`` on its last
      column — `families.tsv` really does report a `language_count\\r` field. Hence
      ``newline=""``: Python's universal-newline translation would silently
      "fix" that and disagree with the TypeScript on one field name per CRLF
      file. (:mod:`pinakes.analytics.tsv` splits on ``\\r?\\n`` instead, because
      the storage reader it ports does.)
    """
    with path.open(encoding="utf-8", newline="") as handle:
        text = handle.read()
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return [], []
    return lines[0].split("\t"), [line.split("\t") for line in lines[1:]]


def _cell(row: Sequence[str], index: int) -> str:
    """One cell; a short row reads blank, as ``row[i] ?? ""`` did."""
    return row[index] if 0 <= index < len(row) else ""


def _index_of(header: Sequence[str], name: str) -> int:
    return header.index(name) if name in header else -1


def score_file(
    file_name: str, header: Sequence[str], rows: Sequence[Sequence[str]]
) -> dict[str, Any]:
    """Grade one lexicon file: per-field completeness, id uniqueness, adequacy.

    The weighting is 60% completeness, 20% id uniqueness, 20% row adequacy (a
    file reaches full adequacy at ten rows). A file with no id column is scored
    as perfectly unique rather than penalised — it has no ids to collide.
    """
    row_count = len(rows)

    fields: list[dict[str, Any]] = []
    for column_index, column in enumerate(header):
        values = [_cell(row, column_index) for row in rows]
        filled = [value for value in values if value.strip()]
        fields.append(
            {
                "column": column,
                "filledCount": len(filled),
                "totalCount": row_count,
                "completeness": len(filled) / row_count if row_count > 0 else 0,
                # Distinct over the *raw* filled cells, not the trimmed ones.
                "distinctValues": len(set(filled)),
            }
        )

    # An explicit loop, not `sum`: `Array.reduce` does not compensate, and this
    # mean is published (`services/api/CLAUDE.md`).
    completeness_total = 0.0
    for entry in fields:
        completeness_total += float(entry["completeness"])
    completeness = completeness_total / len(fields) if fields else 0

    # `id`, else the CLDF-style `Language_ID` that `words.tsv` keys on.
    id_index = (
        _index_of(header, "id")
        if _index_of(header, "id") != -1
        else _index_of(header, "Language_ID")
    )
    unique_id_rate = 1.0
    duplicate_ids: list[str] = []
    if id_index != -1 and row_count > 0:
        ids = [
            value
            for value in (_cell(row, id_index) for row in rows)
            if value.strip()
        ]
        seen: dict[str, int] = {}
        for identifier in ids:
            seen[identifier] = seen.get(identifier, 0) + 1
        duplicate_ids = [key for key, count in seen.items() if count > 1]
        unique_id_rate = len(seen) / len(ids) if ids else 1.0

    row_adequacy = min(row_count / 10, 1)
    overall = completeness * 0.6 + unique_id_rate * 0.2 + row_adequacy * 0.2

    return {
        "file": file_name,
        "rowCount": row_count,
        "columnCount": len(header),
        "completeness": round_to(completeness, 4),
        "uniqueIdRate": round_to(unique_id_rate, 4),
        "duplicateIds": duplicate_ids[:20],
        "fields": fields,
        "overallScore": round_to(overall, 4),
    }


def check_referential_integrity(lexicons: Path) -> list[dict[str, Any]]:
    """Grade every foreign key in :data:`FOREIGN_KEYS` against the corpus.

    A missing source file or a missing source column drops the check entirely
    (there is nothing to grade); a missing *target* file or column instead yields
    an empty id set, so every reference reads as broken — which is the honest
    answer when the thing referenced is gone.
    """
    results: list[dict[str, Any]] = []
    id_cache: dict[str, set[str]] = {}

    def target_ids(file_name: str, column: str) -> set[str]:
        key = f"{file_name}:{column}"
        if key in id_cache:
            return id_cache[key]
        path = lexicons / file_name
        if not path.is_file():
            id_cache[key] = set()
            return id_cache[key]
        header, rows = parse_tsv_file(path)
        column_index = _index_of(header, column)
        if column_index == -1:
            id_cache[key] = set()
            return id_cache[key]
        id_cache[key] = {
            value
            for value in (_cell(row, column_index) for row in rows)
            if value.strip()
        }
        return id_cache[key]

    for source_file, source_column, target_file, target_column in FOREIGN_KEYS:
        source_path = lexicons / source_file
        if not source_path.is_file():
            continue

        header, rows = parse_tsv_file(source_path)
        source_index = _index_of(header, source_column)
        if source_index == -1:
            continue

        known = target_ids(target_file, target_column)
        values = [
            value
            for value in (_cell(row, source_index) for row in rows)
            if value.strip()
        ]

        missing: dict[str, None] = {}
        valid = 0
        for value in values:
            if value in known:
                valid += 1
            else:
                missing[value] = None

        results.append(
            {
                "sourceFile": source_file,
                "sourceColumn": source_column,
                "targetFile": target_file,
                "targetColumn": target_column,
                "totalRefs": len(values),
                "validRefs": valid,
                "missingRefs": list(missing)[:20],
            }
        )

    return results


# ── Coverage against the roadmap targets ─────────────────────────────────────


def compute_coverage(row_counts: Mapping[str, int]) -> dict[str, Any]:
    """Actual row counts against :data:`ROADMAP_TARGETS`. Pure — no clock, no fs.

    A domain absent from *row_counts* scores zero actual, and a domain exactly at
    its target counts as met (``>=``, not ``>``).
    """
    domains: list[dict[str, Any]] = []
    for target in ROADMAP_TARGETS:
        actual = row_counts.get(str(target["file"]), 0)
        goal = int(target["target"])
        domains.append(
            {
                "domain": target["domain"],
                "file": target["file"],
                "actual": actual,
                "target": goal,
                "targetLabel": target["targetLabel"],
                "kind": target["kind"],
                "source": target["source"],
                "met": actual >= goal,
                "percentOfTarget": round_to(actual / goal, 3) if goal > 0 else 1,
            }
        )
    under_target = [
        str(domain["domain"]) for domain in domains if not domain["met"]
    ]
    return {
        "domains": domains,
        "domainsMet": len(domains) - len(under_target),
        "domainsUnderTarget": len(under_target),
        "underTarget": under_target,
        "allMet": not under_target,
    }


def build_coverage_report(lexicons: Path) -> dict[str, Any]:
    """Read the target lexicons and build the deterministic coverage report."""
    row_counts: dict[str, int] = {}
    for target in ROADMAP_TARGETS:
        path = lexicons / str(target["file"])
        row_counts[str(target["file"])] = (
            len(parse_tsv_file(path)[1]) if path.is_file() else 0
        )
    return compute_coverage(row_counts)


# ── Corpus composition by trust tier ─────────────────────────────────────────


def normalise_confidence(raw: str) -> float | None:
    """A confidence cell as 0–1. ``None`` when it is blank or unparseable.

    Several archaeological files store confidence on a 0–100 scale, so anything
    above 1 is divided down before it is averaged.
    """
    trimmed = raw.strip()
    if not trimmed:
        return None
    value = js_number(trimmed)
    if not math.isfinite(value):
        return None
    return value / 100 if value > 1 else value


def node_files() -> list[dict[str, str]]:
    """`nodeFiles()` — the mapped lexicon files that project canonical nodes.

    Read out of `contracts/lexicon-mapping.json` rather than listed here: the
    generated bindings embed the file list but not each file's node type, and the
    node type is published per file in this report.
    """
    document = lexicon_mapping.document()
    files = document.get("files", [])
    return [
        {"file": str(entry["file"]), "node": str(entry["node"])}
        for entry in files
        if entry.get("kind") == "node" and entry.get("node") is not None
    ]


def compute_corpus_tiers(
    files: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Classify every node row by intrinsic provenance and aggregate by tier.

    Rows are classified with ``source`` **omitted** — the export stamps `pinakes`
    on the way out, and the question this report asks is the readiness one: would
    the row auto-admit on its own merits (QID-anchored *and* reference-backed) or
    quarantine? Deterministic: no clock, no filesystem.
    """
    buckets: dict[str, dict[str, float]] = {
        tier: {"rows": 0, "qid": 0, "url": 0, "conf": 0, "confSum": 0.0, "full": 0}
        for tier in TRUST_TIERS
    }
    total_node_rows = 0
    summaries: list[dict[str, Any]] = []

    for entry in files:
        header: Sequence[str] = entry["header"]
        rows: Sequence[Sequence[str]] = entry["rows"]
        qid_index = _index_of(header, "wikidata_qid")
        url_index = _index_of(header, "source_url")
        conf_index = _index_of(header, "confidence")
        ready = 0
        for row in rows:
            qid = _cell(row, qid_index).strip() if qid_index != -1 else ""
            url = _cell(row, url_index).strip() if url_index != -1 else ""
            raw_confidence = _cell(row, conf_index) if conf_index != -1 else ""
            confidence = normalise_confidence(raw_confidence)
            tier = classify_tier({"wikidata_qid": qid, "source_url": url})
            bucket = buckets[tier]
            bucket["rows"] += 1
            if qid:
                bucket["qid"] += 1
            if url:
                bucket["url"] += 1
            if confidence is not None:
                bucket["conf"] += 1
                bucket["confSum"] += confidence
            if qid and url and confidence is not None:
                bucket["full"] += 1
            if tier == TIER_AUTO_ADMITTED:
                ready += 1
            total_node_rows += 1
        summaries.append(
            {
                "file": entry["file"],
                "node": entry["node"],
                "nodeRows": len(rows),
                "autoAdmissionReady": ready,
            }
        )

    by_tier = [
        {
            "tier": tier,
            "nodeRows": int(buckets[tier]["rows"]),
            "withWikidataQid": int(buckets[tier]["qid"]),
            "withSourceUrl": int(buckets[tier]["url"]),
            "withConfidence": int(buckets[tier]["conf"]),
            "avgConfidence": (
                round_to(buckets[tier]["confSum"] / buckets[tier]["conf"], 4)
                if buckets[tier]["conf"] > 0
                else None
            ),
            "fullyProvenanced": int(buckets[tier]["full"]),
        }
        for tier in TRUST_TIERS
    ]

    ready_rows = buckets[TIER_AUTO_ADMITTED]["rows"]
    return {
        "totalNodeRows": total_node_rows,
        # Every lexicon row came through the human-curation gate, whatever its
        # own provenance says — that is what `byTier` is *not* measuring.
        "graphTier": TIER_CURATED,
        "byTier": by_tier,
        "autoAdmissionReadyRate": (
            round_to(ready_rows / total_node_rows, 4) if total_node_rows > 0 else 0
        ),
        "files": sorted(summaries, key=lambda summary: str(summary["file"])),
    }


def build_corpus_tier_report(lexicons: Path) -> dict[str, Any]:
    """Read the node lexicons and build the deterministic tier report."""
    files: list[dict[str, Any]] = []
    for entry in node_files():
        path = lexicons / entry["file"]
        if not path.is_file():
            continue
        header, rows = parse_tsv_file(path)
        files.append(
            {
                "file": entry["file"],
                "node": entry["node"],
                "header": header,
                "rows": rows,
            }
        )
    files.sort(key=lambda entry: str(entry["file"]))
    return compute_corpus_tiers(files)


# ── The whole report ─────────────────────────────────────────────────────────


def _now_iso() -> str:
    """``new Date().toISOString()`` — UTC, milliseconds, a literal ``Z``.

    Not ``datetime.isoformat()``, which emits microseconds and ``+00:00``. The
    same three lines as `contributions.store.iso_now`; they stay apart because
    the only thing the two surfaces share is the JavaScript format, and this
    report has no other business with the contribution queue.
    """
    stamp = datetime.now(UTC)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{stamp.microsecond // 1000:03d}Z"


def generate_data_quality_report(lexicons: Path) -> dict[str, Any]:
    """The whole `/api/data-quality` body.

    The overall score is 70% the mean per-file score and 30% referential
    integrity. A corpus directory that does not exist raises — an absent corpus
    is the one state this endpoint must not report as a clean bill of health.
    """
    names = sorted(
        path.name for path in lexicons.iterdir() if path.name.endswith(".tsv")
    )

    file_scores: list[dict[str, Any]] = []
    total_rows = 0
    for name in names:
        header, rows = parse_tsv_file(lexicons / name)
        score = score_file(name, header, rows)
        file_scores.append(score)
        total_rows += int(score["rowCount"])

    referential_integrity = check_referential_integrity(lexicons)

    integrity_total = 0.0
    for check in referential_integrity:
        integrity_total += (
            int(check["validRefs"]) / int(check["totalRefs"])
            if int(check["totalRefs"]) > 0
            else 1
        )
    integrity_score = (
        integrity_total / len(referential_integrity) if referential_integrity else 1
    )

    score_total = 0.0
    for score in file_scores:
        score_total += float(score["overallScore"])
    average_file_score = score_total / len(file_scores) if file_scores else 0

    row_counts = {str(score["file"]): int(score["rowCount"]) for score in file_scores}

    return {
        "timestamp": _now_iso(),
        "overallScore": round_to(average_file_score * 0.7 + integrity_score * 0.3, 4),
        "fileCount": len(names),
        "totalRows": total_rows,
        "files": file_scores,
        "referentialIntegrity": referential_integrity,
        "coverage": compute_coverage(row_counts),
        "tierComposition": build_corpus_tier_report(lexicons),
    }
