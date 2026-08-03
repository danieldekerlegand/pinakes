import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
} from "./types";

interface ArtTradition {
  id: string;
  name: string;
  category: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number } | null;
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
}

function matchesQuery(t: ArtTradition, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    t.name.toLowerCase().includes(ql) ||
    t.category.toLowerCase().includes(ql) ||
    t.stylePeriod.toLowerCase().includes(ql) ||
    t.associatedCivilizations.toLowerCase().includes(ql)
  );
}

function project(rows: ArtTradition[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((t) => {
    if (facets.category && t.category !== facets.category) return false;
    if (facets.stylePeriod && t.stylePeriod !== facets.stylePeriod) return false;
    if (!matchesQuery(t, opts.searchQuery ?? "")) return false;
    return true;
  });

  const temporal = filtered
    .filter((t) => Number.isFinite(t.originDate))
    .map((t) => ({
      id: t.id,
      label: t.name,
      startYear: t.originDate,
      endYear: Number.isFinite(t.endDate) ? t.endDate : null,
      group: t.category,
      payload: t,
    }));

  const spatial = filtered.flatMap((t) => {
    if (!t.originCoordinates) return [];
    return [{
      id: t.id,
      label: t.name,
      lat: t.originCoordinates.lat,
      lng: t.originCoordinates.lng,
      region: t.associatedCivilizations,
      magnitude: t.notableExamples?.length ?? 0,
      startYear: Number.isFinite(t.originDate) ? t.originDate : undefined,
      endYear: Number.isFinite(t.endDate) ? t.endDate : null,
      payload: t,
    }];
  });

  const categorical = filtered.map((t) => ({
    id: t.id,
    label: t.name,
    facets: {
      category: t.category,
      stylePeriod: t.stylePeriod,
      civilizations: t.associatedCivilizations,
      keyFeatures: t.keyFeatures,
      notableExamples: t.notableExamples,
      languages: t.associatedLanguages,
    },
    payload: t,
  }));

  return { temporal, spatial, categorical };
}

export const artTraditionsAdapter: DatasetAdapter<ArtTradition> = {
  id: "art-traditions",
  name: "Art Traditions",
  category: "Culture",
  endpoint: "/api/art-traditions",
  unwrap: (resp) => (resp as { traditions?: ArtTradition[] })?.traditions ?? [],
  dimensions: ["temporal", "spatial", "categorical"],
  filterableFacets: [
    { key: "category", label: "Category" },
    { key: "stylePeriod", label: "Style Period" },
  ],
  project,
  detail: (t) => ({
    title: t.name,
    subtitle: `${t.category} · ${t.stylePeriod}`,
    fields: [
      { label: "Period", value: `${t.originDate} – ${t.endDate}` },
      { label: "Civilizations", value: t.associatedCivilizations },
      { label: "Key features", value: t.keyFeatures },
      { label: "Notable examples", value: t.notableExamples },
      { label: "Description", value: t.description },
    ],
  }),
};
