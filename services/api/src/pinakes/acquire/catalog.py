"""The four acquirable Wikidata domains, and the query each one runs.

A straight port of `ACQUISITION_CATALOG` / `buildAcquisitionQuery` /
`buildCategorySpecYaml` from `server/services/engine-acquisition.ts`. One thing
changed shape and it is the point of the flatten: the spec is built as a **dict**
rather than serialized to YAML, because :func:`pinakes.engine.acquisition.fetch`
takes the mapping directly — the YAML only ever existed to hand a file to a child
process. The keys are the shipped `engine/inputs/categories/*.yml` shape, so the
spec still parses through the engine's own `parse_category`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AcquisitionCategory:
    """One acquirable domain: what to fetch, and where the rows are filed."""

    domain: str
    """The token a caller names (`?domain=` / the MCP tool's `domain` argument)."""

    id: str
    """The engine category id — also the cache key for the run."""

    label: str
    description: str

    wikidata_class: str
    """The `wdt:P31` target QID the SPARQL selects instances of."""

    node_label: str
    """The engine's `label:` — a `;`-joined ontology label list."""

    require_coordinates: bool
    """Coordinates bound (not OPTIONAL) in the query, and required on a row."""

    entity_type: str
    """The contribution bucket acquired records are filed under."""


ACQUISITION_CATALOG: dict[str, AcquisitionCategory] = {
    "civilizations": AcquisitionCategory(
        domain="civilizations",
        id="wikidata-civilizations",
        label="Civilizations",
        description="Ancient civilizations and cultures (Wikidata P31 → Q11772).",
        wikidata_class="Q11772",
        node_label="Concept;CulturalArtifact",
        require_coordinates=False,
        entity_type="civilization",
    ),
    "sites": AcquisitionCategory(
        domain="sites",
        id="wikidata-archaeological-sites",
        label="Archaeological sites",
        description="Archaeological sites with coordinates (Wikidata P31 → Q839954).",
        wikidata_class="Q839954",
        node_label="Building;CulturalArtifact",
        require_coordinates=True,
        entity_type="archaeological-site",
    ),
    "figures": AcquisitionCategory(
        domain="figures",
        id="wikidata-historical-figures",
        label="Historical & legendary figures",
        description="Legendary and historical figures (Wikidata P31 → Q13002315).",
        wikidata_class="Q13002315",
        node_label="Concept;CulturalArtifact",
        require_coordinates=False,
        entity_type="historical-figure",
    ),
    "trade-goods": AcquisitionCategory(
        domain="trade-goods",
        id="wikidata-trade-goods",
        label="Trade goods",
        description="Trade goods and commodities (Wikidata P31 → Q28877).",
        wikidata_class="Q28877",
        node_label="CulturalArtifact",
        require_coordinates=False,
        entity_type="trade-good",
    ),
}


def list_acquisition_categories() -> list[AcquisitionCategory]:
    """Every acquirable domain, in catalog order."""
    return list(ACQUISITION_CATALOG.values())


def resolve_acquisition_category(domain: str | None) -> AcquisitionCategory | None:
    """Look a domain token up; ``None`` for an absent or unknown one."""
    if not domain:
        return None
    return ACQUISITION_CATALOG.get(domain)


def build_acquisition_query(
    category: AcquisitionCategory, limit: int | None = None
) -> str:
    """The SPARQL for a category.

    Coordinates are a **bound** triple for coordinate-required domains (so every
    returned row has them) and OPTIONAL otherwise; an optional ``LIMIT`` bounds a
    dashboard- or tool-triggered run.
    """
    coord_line = (
        "  ?item wdt:P625 ?coord ."
        if category.require_coordinates
        else "  OPTIONAL { ?item wdt:P625 ?coord . }"
    )
    lines = [
        "SELECT ?item ?itemLabel ?image ?coord WHERE {",
        f"  ?item wdt:P31 wd:{category.wikidata_class} .",
        coord_line,
        "  OPTIONAL { ?item wdt:P18 ?image . }",
        '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
        "}",
    ]
    if limit is not None and limit > 0:
        lines.append(f"LIMIT {int(limit)}")
    return "\n".join(lines)


def category_spec(
    category: AcquisitionCategory, limit: int | None = None
) -> dict[str, Any]:
    """The engine category spec for a run — the `inputs/categories/*.yml` shape."""
    return {
        "id": category.id,
        "label": category.node_label,
        "description": category.description,
        "source": {
            "type": "wikidata-sparql",
            "query": build_acquisition_query(category, limit),
        },
        "dimensions": ["temporal", "geographic"],
    }
