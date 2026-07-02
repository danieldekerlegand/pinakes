import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
} from "./types";
import { linksFromSharedTags } from "./project-helpers";

interface LiteraryTradition {
  id: string;
  name: string;
  region: string;
  originDate: number;
  endDate: number | null;
  originCoordinates: { lat: number; lng: number } | null;
  associatedLanguageIds: string[];
  genreFocus: string[];
  keyThemes: string[];
  description: string;
  notableAuthors: string[];
  influences: string[];
  sources: string[];
}

function matchesQuery(t: LiteraryTradition, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    t.name.toLowerCase().includes(ql) ||
    t.region?.toLowerCase().includes(ql) ||
    t.genreFocus.some((g) => g.toLowerCase().includes(ql)) ||
    t.keyThemes.some((k) => k.toLowerCase().includes(ql)) ||
    t.notableAuthors.some((a) => a.toLowerCase().includes(ql))
  );
}

function project(
  rows: LiteraryTradition[],
  opts: ProjectionOptions
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((t) => {
    if (facets.region && t.region !== facets.region) return false;
    if (facets.genre && !t.genreFocus.includes(facets.genre)) return false;
    if (!matchesQuery(t, opts.searchQuery ?? "")) return false;
    return true;
  });

  const temporal = filtered
    .filter((t) => Number.isFinite(t.originDate))
    .map((t) => ({
      id: t.id,
      label: t.name,
      startYear: t.originDate,
      endYear: t.endDate !== null && Number.isFinite(t.endDate) ? t.endDate : null,
      group: t.region ?? "Other",
      payload: t,
    }));

  const spatial = filtered.flatMap((t) => {
    if (!t.originCoordinates) return [];
    return [{
      id: t.id,
      label: t.name,
      lat: t.originCoordinates.lat,
      lng: t.originCoordinates.lng,
      region: t.region,
      magnitude: t.notableAuthors.length,
      startYear: Number.isFinite(t.originDate) ? t.originDate : undefined,
      endYear: t.endDate,
      payload: t,
    }];
  });

  const relational = {
    nodes: filtered.map((t) => ({
      id: t.id,
      label: t.name,
      group: t.region ?? "Other",
      magnitude: t.genreFocus.length + t.keyThemes.length,
      payload: t,
    })),
    links: linksFromSharedTags(
      filtered,
      (t) => t.id,
      (t) => [...t.genreFocus, ...t.keyThemes],
      "shared-genre-or-theme"
    ),
  };

  const categorical = filtered.map((t) => ({
    id: t.id,
    label: t.name,
    facets: {
      region: t.region,
      genres: t.genreFocus,
      themes: t.keyThemes,
      authors: t.notableAuthors,
      languages: t.associatedLanguageIds,
      influences: t.influences,
    },
    payload: t,
  }));

  return { temporal, spatial, relational, categorical };
}

export const literaryTraditionsAdapter: DatasetAdapter<LiteraryTradition> = {
  id: "literary-traditions",
  name: "Literary Traditions",
  category: "Culture",
  endpoint: "/api/literary-traditions",
  unwrap: (resp) => (resp as { traditions?: LiteraryTradition[] })?.traditions ?? [],
  dimensions: ["temporal", "spatial", "relational", "categorical"],
  filterableFacets: [
    { key: "region", label: "Region" },
    { key: "genre", label: "Genre" },
  ],
  project,
  detail: (t) => ({
    title: t.name,
    subtitle: t.region,
    fields: [
      {
        label: "Period",
        value: `${t.originDate} – ${t.endDate ?? "present"}`,
      },
      { label: "Genres", value: t.genreFocus },
      { label: "Key themes", value: t.keyThemes },
      { label: "Notable authors", value: t.notableAuthors },
      { label: "Influences", value: t.influences },
      { label: "Languages", value: t.associatedLanguageIds },
      { label: "Description", value: t.description },
    ],
  }),
};
