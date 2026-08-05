"""Field-level review of AI drafts, and their promotion into the lexicon TSVs.

The port of `server/services/ai-review.ts`. AI-extracted drafts (the URL and text
extractors) sit in the queue flagged ``entityData.aiGenerated`` with a per-field
confidence map; this module turns one into a **field-level review model** — a
human accepts, edits, or rejects each field — and, on approval, appends the
accepted content to the matching ``data/source/lexicons/*.tsv`` with provenance
naming *both* the AI source and the human reviewer.

Everything is pure over an explicit ``lexicons_dir`` and ``now``, so the whole
workflow is exercised against a temp directory. That injectability is not a
nicety here: a test that promoted into the live corpus would leave a fixture row
visible to every other reader of it (`server/CLAUDE.md`).

One deliberate divergence from the TypeScript original: a required field whose
accepted value is ``null`` fails validation here, where JS only rejected
``undefined`` and ``""``. A JSON ``null`` and an absent value are the same value
in Python, and promoting a null `name` would write an empty id into the corpus —
so the stricter reading is the one that keeps the corpus honest.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes.contributions.store import Contribution

#: Per-field confidence at or below this (0..1) is flagged for the reviewer.
LOW_CONFIDENCE_THRESHOLD = 0.5

#: `entityData` keys that are provenance/metadata rather than reviewable
#: content. Everything else in `entityData` is projected as a review field.
METADATA_KEYS = frozenset(
    {
        "source",
        "aiGenerated",
        "autoDerived",
        "provenanceKind",
        "wikidataQid",
        "sourceUrl",
        "relationships",
        "perFieldConfidence",
    }
)

#: Minimal required content fields per promotable entity type.
REQUIRED_CONTENT: dict[str, tuple[str, ...]] = {
    "civilization": ("name",),
    "language": ("name",),
    "archaeological-site": ("name", "coordinates"),
    "trade-good": ("name",),
    "historical-figure": ("name",),
}

#: The companion ledger every promotion is recorded in, whatever the target's
#: own columns look like.
PROVENANCE_LEDGER = "contribution-provenance.tsv"
PROVENANCE_HEADER = (
    "contribution_id",
    "entity_type",
    "target_file",
    "target_id",
    "ai_source",
    "reviewer",
    "reviewed_at",
    "confidence",
)


class AiReviewError(Exception):
    """A review that cannot be applied — a 400, never a 500."""


@dataclass(frozen=True, slots=True)
class AppliedReview:
    """The outcome of applying per-field decisions to a draft."""

    accepted_data: dict[str, Any]
    field_reviews: dict[str, dict[str, Any]]
    rejected_fields: list[str]


# ── Projection ───────────────────────────────────────────────────────────────


def is_ai_draft(contribution: Contribution) -> bool:
    """True when a contribution is an AI-extracted draft."""
    entity_data = contribution.get("entityData")
    return isinstance(entity_data, dict) and entity_data.get("aiGenerated") is True


def _per_field_confidence(contribution: Contribution) -> dict[str, Any]:
    entity_data = contribution.get("entityData")
    if not isinstance(entity_data, dict):
        return {}
    raw = entity_data.get("perFieldConfidence")
    return raw if isinstance(raw, dict) else {}


def project_draft(contribution: Contribution) -> dict[str, Any]:
    """Project a draft into the field-level review view the client renders.

    Insertion order of `entityData` is the field order, which is the order the
    extractor wrote — same as `Object.keys` gives the TypeScript projection.
    """
    entity_data = contribution.get("entityData")
    data: dict[str, Any] = entity_data if isinstance(entity_data, dict) else {}
    confidences = _per_field_confidence(contribution)

    fields: list[dict[str, Any]] = []
    for field in data:
        if field in METADATA_KEYS:
            continue
        raw = confidences.get(field)
        confidence: float | None = None
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            confidence = float(raw)
        fields.append(
            {
                "field": field,
                "value": data[field],
                "confidence": confidence,
                "lowConfidence": confidence is not None
                and confidence < LOW_CONFIDENCE_THRESHOLD,
            }
        )

    source = data.get("source")
    relationships = data.get("relationships")
    view: dict[str, Any] = {
        "id": contribution.get("id"),
        "entityType": contribution.get("entityType"),
        "action": contribution.get("action"),
        "status": contribution.get("status"),
        "aiGenerated": is_ai_draft(contribution),
        "aiSource": source if isinstance(source, str) else None,
        "overallConfidence": contribution.get("confidence"),
        "submittedAt": contribution.get("submittedAt"),
        "reviewedAt": contribution.get("reviewedAt"),
        "reviewer": contribution.get("reviewer"),
        "fields": fields,
        "relationships": relationships if isinstance(relationships, list) else [],
        "promotable": is_promotable(str(contribution.get("entityType"))),
        "promotion": contribution.get("promotion"),
    }
    # `reviewedAt`, `reviewer` and `promotion` are optional on the TypeScript
    # view and absent — not null — until a reviewer has acted.
    for optional in ("reviewedAt", "reviewer", "promotion"):
        if view[optional] is None:
            del view[optional]
    return view


# ── Field decisions ──────────────────────────────────────────────────────────


def apply_field_reviews(
    contribution: Contribution, decisions: dict[str, Any] | None = None
) -> AppliedReview:
    """Apply accept/edit/reject decisions; an undecided field is accepted.

    Raises :class:`AiReviewError` if a decision names a field the draft does not
    have — a reviewer editing a field that is not there is a client bug worth
    reporting, not a silent no-op.
    """
    decisions = decisions or {}
    view = project_draft(contribution)
    known = {field["field"] for field in view["fields"]}

    for field in decisions:
        if field not in known:
            raise AiReviewError(
                f"Unknown field '{field}' for contribution {contribution.get('id')}"
            )

    accepted: dict[str, Any] = {}
    reviews: dict[str, dict[str, Any]] = {}
    rejected: list[str] = []

    for entry in view["fields"]:
        field = entry["field"]
        decision = decisions.get(field) or {"decision": "accept"}
        kind = decision.get("decision") if isinstance(decision, dict) else "accept"
        if kind == "reject":
            reviews[field] = {"decision": "reject"}
            rejected.append(field)
            continue
        if kind == "edit":
            value = decision.get("value") if isinstance(decision, dict) else None
            accepted[field] = value
            reviews[field] = {"decision": "edit", "value": value}
            continue
        accepted[field] = entry["value"]
        reviews[field] = {"decision": "accept"}

    return AppliedReview(
        accepted_data=accepted, field_reviews=reviews, rejected_fields=rejected
    )


def validate_accepted_draft(
    entity_type: str, accepted_data: dict[str, Any]
) -> list[str]:
    """Required fields the reviewer rejected or emptied. Empty list ⇒ promotable."""
    errors: list[str] = []
    for field in REQUIRED_CONTENT.get(entity_type, ("name",)):
        value = accepted_data.get(field)
        if field not in accepted_data or value is None or value == "":
            errors.append(f"Required field '{field}' was rejected or is empty")
    return errors


# ── Promotion targets ────────────────────────────────────────────────────────


def _str(value: Any) -> str:
    """``String(v)`` for a cell, with null/undefined rendering empty.

    A whole-number float renders without its ``.0``: JSON has one number type and
    JavaScript prints `3000.0` as `3000`, so a year read back out of a draft must
    not gain a decimal point on its way into the corpus.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _coord_cell(value: Any) -> str:
    """The corpus's coordinate cell — `{"lat":..,"lng":..}` or empty."""
    if isinstance(value, dict):
        lat = value.get("lat")
        lng = value.get("lng")
        if _is_number(lat) and _is_number(lng):
            return json.dumps({"lat": lat, "lng": lng}, separators=(",", ":"))
    return ""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _time_period_range(data: dict[str, Any]) -> str:
    start = data.get("timePeriodStart")
    end = data.get("timePeriodEnd")
    if "timePeriodStart" not in data and "timePeriodEnd" not in data:
        return ""
    return f"{_str(start)} to {_str(end)}".strip()


def _civilization_cells(data: dict[str, Any], _confidence: Any) -> dict[str, str]:
    return {
        "name": _str(data.get("name")),
        "time_period_start": _str(data.get("timePeriodStart")),
        "time_period_end": _str(data.get("timePeriodEnd")),
        "description": _str(data.get("description")),
    }


def _language_cells(data: dict[str, Any], _confidence: Any) -> dict[str, str]:
    cells = {
        "name": _str(data.get("name")),
        "historical_context": _str(data.get("description")),
        "time_origin": _str(data.get("timePeriodStart")),
        "time_end": _str(data.get("timePeriodEnd")),
    }
    coord = data.get("coordinates")
    if isinstance(coord, dict) and _is_number(coord.get("lat")) and _is_number(
        coord.get("lng")
    ):
        cells["latitude"] = _str(coord["lat"])
        cells["longitude"] = _str(coord["lng"])
    return cells


def _site_cells(data: dict[str, Any], confidence: Any) -> dict[str, str]:
    return {
        "name": _str(data.get("name")),
        "coordinates": _coord_cell(data.get("coordinates")),
        "time_period_start": _str(data.get("timePeriodStart")),
        "time_period_end": _str(data.get("timePeriodEnd")),
        "confidence": _str(confidence),
        "description": _str(data.get("description")),
    }


def _trade_good_cells(data: dict[str, Any], _confidence: Any) -> dict[str, str]:
    return {
        "name": _str(data.get("name")),
        "origin_coordinates": _coord_cell(data.get("coordinates")),
        "time_period": _time_period_range(data),
        "economic_significance": _str(data.get("description")),
    }


@dataclass(frozen=True, slots=True)
class PromotionTarget:
    """Where one entity type lands, and how its accepted fields map to columns."""

    file: str
    header: tuple[str, ...]
    cells: Callable[[dict[str, Any], Any], dict[str, str]]


#: The promotable types, and only those. `historical-figure` has no TSV of its
#: own, so it is *reviewable* but not promotable — approving one is a 400, not a
#: silent write into the wrong file.
PROMOTION_TARGETS: dict[str, PromotionTarget] = {
    "civilization": PromotionTarget(
        file="civilizations.tsv",
        header=(
            "id", "name", "native_name", "time_period_start", "time_period_end",
            "time_period_label", "associated_language_ids", "writing_systems",
            "political_structure", "capital", "population", "haplogroup_ids",
            "cuisine_id", "sources", "description",
        ),
        cells=_civilization_cells,
    ),
    "language": PromotionTarget(
        file="languages.tsv",
        header=(
            "id", "name", "native_name", "iso639_1", "iso639_2", "family_id",
            "parent_language_id", "region", "countries", "native_speakers",
            "total_speakers", "status", "time_origin", "time_end", "classification",
            "writing_system", "is_historical_variant", "is_dialect",
            "chronological_order", "historical_context", "latitude", "longitude",
        ),
        cells=_language_cells,
    ),
    "archaeological-site": PromotionTarget(
        file="archaeological-sites.tsv",
        header=(
            "id", "name", "coordinates", "site_type", "time_period_start",
            "time_period_end", "time_period_label", "associated_language_ids",
            "associated_culture_ids", "associated_civilization_ids",
            "excavation_status", "findings", "importance", "confidence", "sources",
            "description",
        ),
        cells=_site_cells,
    ),
    "trade-good": PromotionTarget(
        file="trade-goods.tsv",
        header=(
            "id", "name", "category", "origin_region", "origin_coordinates",
            "trade_routes", "time_period", "economic_significance",
            "associated_languages",
        ),
        cells=_trade_good_cells,
    ),
}


def is_promotable(entity_type: str) -> bool:
    """Whether an approved draft of this type has somewhere to be written."""
    return entity_type in PROMOTION_TARGETS


# ── Writing the row ──────────────────────────────────────────────────────────


def slugify(value: str) -> str:
    """The corpus id form: lowercase, ASCII-word characters, hyphen-joined."""
    text = unicodedata.normalize("NFKD", value.lower())
    text = re.sub(r"[^\w\s-]", "", text, flags=re.ASCII)
    text = re.sub(r"[\s_]+", "-", text.strip())
    return re.sub(r"-+", "-", text) or "entity"


def _existing_ids(path: Path) -> set[str]:
    """The first column of every data row — a TSV's id set."""
    if not path.is_file():
        return set()
    lines = path.read_text(encoding="utf-8").splitlines()
    return {line.split("\t")[0] for line in lines[1:] if line}


def _unique_id(base: str, existing: set[str]) -> str:
    if base not in existing:
        return base
    index = 2
    while f"{base}-{index}" in existing:
        index += 1
    return f"{base}-{index}"


def append_row(path: Path, header: tuple[str, ...], cells: dict[str, str]) -> None:
    """Append one row aligned to *header*, creating the file with it when absent.

    Tabs and newlines inside a cell become spaces — a TSV has no quoting, so a
    stray one would silently split the row into two.
    """
    row = "\t".join(
        re.sub(r"[\t\n\r]", " ", cells.get(column, "")) for column in header
    )
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\t".join(header) + "\n" + row + "\n", encoding="utf-8")
        return
    existing = path.read_text(encoding="utf-8")
    separator = "\n" if existing and not existing.endswith("\n") else ""
    with path.open("a", encoding="utf-8") as handle:
        handle.write(separator + row + "\n")


def promote_contribution(
    *,
    contribution_id: str,
    entity_type: str,
    accepted_data: dict[str, Any],
    reviewer: str,
    ai_source: str,
    overall_confidence: Any,
    lexicons_dir: Path,
    now: str,
) -> dict[str, Any]:
    """Append an accepted draft to its lexicon and record its provenance.

    Provenance is written twice on purpose: inline in the target's own ``sources``
    column when it has one (so a reader of that file sees it), and as a row in
    the companion ledger (so the record is uniform across targets whose columns
    differ). Raises :class:`AiReviewError` for a non-promotable type or a missing
    required field.
    """
    target = PROMOTION_TARGETS.get(entity_type)
    if target is None:
        raise AiReviewError(
            f"No TSV promotion target for entity type '{entity_type}'"
        )

    errors = validate_accepted_draft(entity_type, accepted_data)
    if errors:
        raise AiReviewError("; ".join(errors))

    path = Path(lexicons_dir) / target.file
    target_id = _unique_id(
        slugify(_str(accepted_data.get("name"))), _existing_ids(path)
    )

    cells: dict[str, str] = target.cells(accepted_data, overall_confidence)
    cells["id"] = target_id
    if "sources" in target.header:
        cells["sources"] = json.dumps(
            [f"AI-extracted via {ai_source}; reviewed by {reviewer}"],
            separators=(",", ":"),
        )

    append_row(path, target.header, cells)
    append_row(
        Path(lexicons_dir) / PROVENANCE_LEDGER,
        PROVENANCE_HEADER,
        {
            "contribution_id": contribution_id,
            "entity_type": entity_type,
            "target_file": target.file,
            "target_id": target_id,
            "ai_source": ai_source,
            "reviewer": reviewer,
            "reviewed_at": now,
            "confidence": _str(overall_confidence),
        },
    )

    return {
        "file": target.file,
        "targetId": target_id,
        "aiSource": ai_source,
        "reviewer": reviewer,
        "reviewedAt": now,
    }
