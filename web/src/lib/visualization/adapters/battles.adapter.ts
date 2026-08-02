import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
} from "./types";
import { linksFromSharedTags, parseYear } from "./project-helpers";

interface Belligerent {
  name: string;
  civilization_id: string | null;
}

interface Battle {
  id: string;
  name: string;
  date: string | number;
  coordinates: [number, number] | null;
  belligerents: Belligerent[];
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

function matchesQuery(b: Battle, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    b.name.toLowerCase().includes(ql) ||
    b.warName?.toLowerCase().includes(ql) ||
    b.outcome?.toLowerCase().includes(ql) ||
    b.belligerents.some((bel) => bel.name.toLowerCase().includes(ql))
  );
}

function project(rows: Battle[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((b) => {
    if (facets.warName && b.warName !== facets.warName) return false;
    if (facets.outcome && b.outcome !== facets.outcome) return false;
    if (!matchesQuery(b, opts.searchQuery ?? "")) return false;
    return true;
  });

  const temporal = filtered.flatMap((b) => {
    const year = parseYear(b.date);
    if (year === null) return [];
    return [{
      id: b.id,
      label: b.name,
      startYear: year,
      endYear: year,
      group: b.warName ?? "Other",
      payload: b,
    }];
  });

  const spatial = filtered.flatMap((b) => {
    if (!b.coordinates || b.coordinates.length !== 2) return [];
    const [lat, lng] = b.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const year = parseYear(b.date);
    return [{
      id: b.id,
      label: b.name,
      lat,
      lng,
      region: b.warName,
      magnitude: b.belligerents.length,
      startYear: year ?? undefined,
      endYear: year,
      payload: b,
    }];
  });

  // Relational: battles share an edge if they share at least one belligerent civilization
  const relational = {
    nodes: filtered.map((b) => ({
      id: b.id,
      label: b.name,
      group: b.warName,
      magnitude: b.belligerents.length,
      payload: b,
    })),
    links: linksFromSharedTags(
      filtered,
      (b) => b.id,
      (b) =>
        b.belligerents
          .map((bel) => bel.civilization_id)
          .filter((id): id is string => Boolean(id)),
      "shared-belligerent"
    ),
  };

  const categorical = filtered.map((b) => ({
    id: b.id,
    label: b.name,
    facets: {
      war: b.warName,
      outcome: b.outcome,
      date: typeof b.date === "string" ? b.date : String(b.date),
      casualties: b.casualtiesEstimate,
      belligerents: b.belligerents.map((bel) => bel.name),
      civilizations: b.belligerents
        .map((bel) => bel.civilization_id)
        .filter((id): id is string => Boolean(id)),
    },
    payload: b,
  }));

  return { temporal, spatial, relational, categorical };
}

export const battlesAdapter: DatasetAdapter<Battle> = {
  id: "battles",
  name: "Battles",
  category: "Military",
  endpoint: "/api/battles",
  unwrap: (resp) => (resp as { battles?: Battle[] })?.battles ?? [],
  dimensions: ["temporal", "spatial", "relational", "categorical"],
  filterableFacets: [
    { key: "warName", label: "War" },
    { key: "outcome", label: "Outcome" },
  ],
  project,
  detail: (b) => ({
    title: b.name,
    subtitle: b.warName,
    fields: [
      { label: "Date", value: typeof b.date === "string" ? b.date : String(b.date) },
      { label: "Outcome", value: b.outcome },
      { label: "Casualties", value: b.casualtiesEstimate },
      { label: "Belligerents", value: b.belligerents.map((bel) => bel.name) },
      { label: "Significance", value: b.significance },
      { label: "Language changes", value: b.associatedLanguageChanges },
    ],
  }),
};
