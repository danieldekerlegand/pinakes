import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
} from "./types";

interface Religion {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  coordinates: { lat: number; lng: number } | null;
  timeOrigin: number | null;
  timeEnd: number | null;
  sacredTexts: string[];
  associatedLanguageIds: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
  sources: string[];
}

function matchesQuery(r: Religion, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    r.name.toLowerCase().includes(ql) ||
    r.nativeName?.toLowerCase().includes(ql) ||
    r.religionType.toLowerCase().includes(ql) ||
    r.originRegion.toLowerCase().includes(ql)
  );
}

function project(rows: Religion[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((r) => {
    if (facets.type && r.religionType !== facets.type) return false;
    if (facets.region && r.originRegion !== facets.region) return false;
    if (!matchesQuery(r, opts.searchQuery ?? "")) return false;
    return true;
  });

  const temporal = filtered
    .filter((r) => r.timeOrigin !== null && Number.isFinite(r.timeOrigin))
    .map((r) => ({
      id: r.id,
      label: r.name,
      startYear: r.timeOrigin as number,
      endYear: r.timeEnd !== null && Number.isFinite(r.timeEnd) ? r.timeEnd : null,
      group: r.religionType,
      payload: r,
    }));

  const spatial = filtered.flatMap((r) => {
    if (!r.coordinates) return [];
    return [{
      id: r.id,
      label: r.name,
      lat: r.coordinates.lat,
      lng: r.coordinates.lng,
      region: r.originRegion,
      magnitude: r.deityPantheon.length + r.sacredTexts.length,
      startYear: r.timeOrigin ?? undefined,
      endYear: r.timeEnd,
      payload: r,
    }];
  });

  const categorical = filtered.map((r) => ({
    id: r.id,
    label: r.name,
    facets: {
      type: r.religionType,
      region: r.originRegion,
      sacredTexts: r.sacredTexts,
      deities: r.deityPantheon,
      practices: r.ritualPractices,
      languages: r.associatedLanguageIds,
    },
    payload: r,
  }));

  return { temporal, spatial, categorical };
}

export const religionsAdapter: DatasetAdapter<Religion> = {
  id: "religions",
  name: "Religions",
  category: "Religion",
  endpoint: "/api/religions",
  unwrap: (resp) => (resp as { religions?: Religion[] })?.religions ?? [],
  dimensions: ["temporal", "spatial", "categorical"],
  filterableFacets: [
    { key: "type", label: "Type" },
    { key: "region", label: "Origin Region" },
  ],
  project,
  detail: (r) => ({
    title: r.name,
    subtitle: r.nativeName ? `${r.religionType} · ${r.nativeName}` : r.religionType,
    fields: [
      { label: "Origin", value: r.originRegion },
      {
        label: "Time",
        value: `${r.timeOrigin ?? "?"} – ${r.timeEnd ?? "present"}`,
      },
      { label: "Sacred texts", value: r.sacredTexts },
      { label: "Pantheon", value: r.deityPantheon },
      { label: "Ritual practices", value: r.ritualPractices },
      { label: "Description", value: r.description },
    ],
  }),
};
