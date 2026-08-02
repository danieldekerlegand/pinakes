import type { Provenance } from "@/lib/graph/provenance";
import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
  SpatialItem,
  TemporalItem,
} from "./types";

/**
 * Explorer adapter for the civilizations corpus (`lexicons/civilizations.tsv`),
 * served as GeoJSON by `/api/map/civilizations`. This is what surfaces the
 * data-population-pilot's expanded civilizations (89 → 170, incl. the Wikidata
 * write-back) in the UnifiedExplorer — with provenance shown in the detail
 * panel via `detail().provenance` (US-005).
 *
 * The endpoint returns a `FeatureCollection`; each feature carries the
 * civilization metadata in `properties`, and (for civs with a curated boundary)
 * a real polygon geometry. Civs without a boundary get a tiny placeholder
 * polygon near the origin — those are excluded from the SPATIAL projection so
 * they don't pile up at null island, but still appear in temporal/categorical.
 */

interface TimePeriod {
  start: number;
  end: number | null;
  label: string;
}

interface CivilizationProps {
  civilizationId: string;
  name: string;
  nativeName?: string;
  timePeriod: TimePeriod;
  associatedLanguageIds: string[];
  writingSystems: string[];
  politicalStructure?: string;
  capital?: string;
  population?: number;
  sources: string[];
  description?: string;
  wikidataQid?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  confidence?: number;
}

type Ring = number[][];

interface CivilizationFeatureRaw {
  type: "Feature";
  id: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: Ring[] | Ring[][];
  } | null;
  properties: CivilizationProps;
}

/** Exterior rings of a Polygon/MultiPolygon geometry, flattened to one list. */
function exteriorRings(geometry: CivilizationFeatureRaw["geometry"]): Ring[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as Ring[])[0];
    return ring ? [ring] : [];
  }
  // MultiPolygon: first ring of each polygon.
  return (geometry.coordinates as Ring[][])
    .map((poly) => poly[0])
    .filter((r): r is Ring => Array.isArray(r) && r.length > 0);
}

/**
 * The loader stamps `[[[0,0],[0,1],[1,1],[1,0],[0,0]]]` for a civilization with
 * no curated boundary. Detect it so those rows are dropped from the spatial
 * projection (every one would otherwise render at ~[0.5,0.5]).
 */
function isPlaceholderGeometry(geometry: CivilizationFeatureRaw["geometry"]): boolean {
  const rings = exteriorRings(geometry);
  if (rings.length !== 1) return false;
  const [ring] = rings;
  if (ring.length !== 5) return false;
  return ring.every(([lng, lat]) => lng >= 0 && lng <= 1 && lat >= 0 && lat <= 1);
}

/** Centroid (mean vertex) of a geometry's exterior rings, or null when empty. */
function centroid(
  geometry: CivilizationFeatureRaw["geometry"],
): { lat: number; lng: number } | null {
  const rings = exteriorRings(geometry);
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        sumLng += lng;
        sumLat += lat;
        n += 1;
      }
    }
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lng: sumLng / n };
}

function matchesQuery(c: CivilizationProps, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    c.name.toLowerCase().includes(ql) ||
    (c.nativeName?.toLowerCase().includes(ql) ?? false) ||
    (c.capital?.toLowerCase().includes(ql) ?? false) ||
    (c.politicalStructure?.toLowerCase().includes(ql) ?? false) ||
    (c.timePeriod.label?.toLowerCase().includes(ql) ?? false)
  );
}

/**
 * Where a civilization's facts came from. Wikidata-acquired rows carry a QID +
 * canonical source URL + retrieval timestamp + confidence; hand-curated rows
 * fall back to their bibliographic `sources[]`. Returns null when there is
 * nothing to attribute (so the detail panel omits the provenance block).
 */
function toProvenance(c: CivilizationProps): Provenance | undefined {
  const source = c.wikidataQid ? "Wikidata" : c.sources?.[0] ?? null;
  const prov: Provenance = {
    source,
    sourceUrl: c.sourceUrl ?? null,
    retrievedAt: c.retrievedAt ?? null,
    confidence: typeof c.confidence === "number" ? c.confidence : null,
    wikidataQid: c.wikidataQid ?? null,
  };
  const hasAny =
    prov.source !== null ||
    prov.sourceUrl !== null ||
    prov.retrievedAt !== null ||
    prov.confidence !== null;
  return hasAny ? prov : undefined;
}

function project(
  features: CivilizationFeatureRaw[],
  opts: ProjectionOptions,
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = features.filter((f) => {
    const c = f.properties;
    if (
      facets.politicalStructure &&
      (c.politicalStructure ?? "") !== facets.politicalStructure
    ) {
      return false;
    }
    return matchesQuery(c, opts.searchQuery ?? "");
  });

  const temporal: TemporalItem[] = filtered
    .filter((f) => Number.isFinite(f.properties.timePeriod.start))
    .map((f) => ({
      id: f.properties.civilizationId,
      label: f.properties.name,
      startYear: f.properties.timePeriod.start,
      endYear: f.properties.timePeriod.end,
      group: f.properties.politicalStructure || "Unknown structure",
      payload: f,
    }));

  const spatial: SpatialItem[] = filtered.flatMap((f) => {
    if (isPlaceholderGeometry(f.geometry)) return [];
    const c = centroid(f.geometry);
    if (!c) return [];
    return [
      {
        id: f.properties.civilizationId,
        label: f.properties.name,
        lat: c.lat,
        lng: c.lng,
        region: f.properties.politicalStructure,
        startYear: f.properties.timePeriod.start,
        endYear: f.properties.timePeriod.end,
        payload: f,
      },
    ];
  });

  const categorical = filtered.map((f) => {
    const c = f.properties;
    return {
      id: c.civilizationId,
      label: c.name,
      facets: {
        politicalStructure: c.politicalStructure ?? "",
        timePeriod: c.timePeriod.label,
        capital: c.capital ?? "",
        languages: c.associatedLanguageIds,
        writingSystems: c.writingSystems,
        sourced: c.wikidataQid ? "Wikidata" : c.sources.length ? "cited" : "—",
      },
      payload: f,
    };
  });

  return { temporal, spatial, categorical };
}

function detail(f: CivilizationFeatureRaw) {
  const c = f.properties;
  return {
    title: c.name,
    subtitle: [c.nativeName, c.timePeriod.label].filter(Boolean).join(" · "),
    fields: [
      {
        label: "Period",
        value: `${c.timePeriod.start ?? "?"} – ${c.timePeriod.end ?? "?"}`,
      },
      { label: "Political structure", value: c.politicalStructure || null },
      { label: "Capital", value: c.capital || null },
      {
        label: "Population",
        value: typeof c.population === "number" ? c.population : null,
      },
      { label: "Languages", value: c.associatedLanguageIds },
      { label: "Writing systems", value: c.writingSystems },
      { label: "Wikidata", value: c.wikidataQid || null },
      { label: "Description", value: c.description || null },
    ],
    provenance: toProvenance(c),
  };
}

export const civilizationsAdapter: DatasetAdapter<CivilizationFeatureRaw> = {
  id: "civilizations",
  name: "Civilizations",
  category: "Culture",
  endpoint: "/api/map/civilizations",
  unwrap: (resp) =>
    (resp as { features?: CivilizationFeatureRaw[] })?.features ?? [],
  dimensions: ["temporal", "spatial", "categorical"],
  filterableFacets: [
    { key: "politicalStructure", label: "Political structure" },
  ],
  project,
  detail,
};
