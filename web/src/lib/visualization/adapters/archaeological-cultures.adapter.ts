import type {
  DatasetAdapter,
  DimensionProjections,
  HierarchicalNode,
  ProjectionOptions,
  RelationalLink,
} from "./types";

interface ArchaeologicalCulture {
  id: string;
  name: string;
  region: string;
  coordinates: { lat: number; lng: number } | null;
  timePeriodStart: number | null;
  timePeriodEnd: number | null;
  timePeriodLabel: string;
  associatedLanguageIds: string[];
  associatedCivilizationIds: string[];
  predecessorCultureId: string;
  successorCultureIds: string[];
  materialGoods: string[];
  description: string;
  confidence: number;
  sources: string[];
}

function matchesQuery(c: ArchaeologicalCulture, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    c.name.toLowerCase().includes(ql) ||
    c.region?.toLowerCase().includes(ql) ||
    c.timePeriodLabel?.toLowerCase().includes(ql) ||
    c.materialGoods.some((g) => g.toLowerCase().includes(ql))
  );
}

function project(
  rows: ArchaeologicalCulture[],
  opts: ProjectionOptions
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((c) => {
    if (facets.region && c.region !== facets.region) return false;
    if (!matchesQuery(c, opts.searchQuery ?? "")) return false;
    return true;
  });

  const filteredIds = new Set(filtered.map((c) => c.id));

  // Hierarchical: predecessorCultureId is the parent (when it exists in the filtered set)
  const depthCache = new Map<string, number>();
  const parentOf = (id: string): string | null => {
    const c = filtered.find((x) => x.id === id);
    if (!c || !c.predecessorCultureId || !filteredIds.has(c.predecessorCultureId)) return null;
    return c.predecessorCultureId;
  };
  const computeDepth = (id: string, visiting: Set<string>): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    const parent = parentOf(id);
    if (!parent) {
      depthCache.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const d = computeDepth(parent, visiting) + 1;
    visiting.delete(id);
    depthCache.set(id, d);
    return d;
  };

  const hierarchical: HierarchicalNode[] = filtered.map((c) => ({
    id: c.id,
    label: c.name,
    parentId: parentOf(c.id),
    depth: computeDepth(c.id, new Set()),
    payload: c,
  }));

  // Relational: both predecessor and successor links
  const relationalLinks: RelationalLink[] = [];
  const seen = new Set<string>();
  const pushLink = (a: string, b: string, kind: string) => {
    const [s, t] = a < b ? [a, b] : [b, a];
    const key = `${s}|${t}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    relationalLinks.push({ source: a, target: b, kind });
  };
  for (const c of filtered) {
    if (c.predecessorCultureId && filteredIds.has(c.predecessorCultureId)) {
      pushLink(c.predecessorCultureId, c.id, "predecessor-of");
    }
    for (const succId of c.successorCultureIds) {
      if (filteredIds.has(succId)) pushLink(c.id, succId, "predecessor-of");
    }
  }

  const relational = {
    nodes: filtered.map((c) => ({
      id: c.id,
      label: c.name,
      group: c.region,
      magnitude: c.successorCultureIds.length + (c.predecessorCultureId ? 1 : 0),
      payload: c,
    })),
    links: relationalLinks,
  };

  const temporal = filtered
    .filter((c) => c.timePeriodStart !== null && Number.isFinite(c.timePeriodStart))
    .map((c) => ({
      id: c.id,
      label: c.name,
      startYear: c.timePeriodStart as number,
      endYear:
        c.timePeriodEnd !== null && Number.isFinite(c.timePeriodEnd)
          ? c.timePeriodEnd
          : null,
      group: c.region,
      payload: c,
    }));

  const spatial = filtered.flatMap((c) => {
    if (!c.coordinates) return [];
    return [{
      id: c.id,
      label: c.name,
      lat: c.coordinates.lat,
      lng: c.coordinates.lng,
      region: c.region,
      magnitude: c.confidence,
      startYear: c.timePeriodStart ?? undefined,
      endYear: c.timePeriodEnd,
      payload: c,
    }];
  });

  const categorical = filtered.map((c) => ({
    id: c.id,
    label: c.name,
    facets: {
      region: c.region,
      timePeriod: c.timePeriodLabel,
      languages: c.associatedLanguageIds,
      civilizations: c.associatedCivilizationIds,
      materialGoods: c.materialGoods,
      confidence: c.confidence,
    },
    payload: c,
  }));

  return { hierarchical, relational, temporal, spatial, categorical };
}

export const archaeologicalCulturesAdapter: DatasetAdapter<ArchaeologicalCulture> = {
  id: "archaeological-cultures",
  name: "Archaeological Cultures",
  category: "Culture",
  endpoint: "/api/archaeological-cultures",
  unwrap: (resp) =>
    (resp as { cultures?: ArchaeologicalCulture[] })?.cultures ?? [],
  dimensions: ["temporal", "spatial", "relational", "hierarchical", "categorical"],
  filterableFacets: [{ key: "region", label: "Region" }],
  project,
  detail: (c) => ({
    title: c.name,
    subtitle: `${c.region} · ${c.timePeriodLabel}`,
    fields: [
      {
        label: "Period",
        value: `${c.timePeriodStart ?? "?"} – ${c.timePeriodEnd ?? "?"}`,
      },
      { label: "Predecessor", value: c.predecessorCultureId || null },
      { label: "Successors", value: c.successorCultureIds },
      { label: "Languages", value: c.associatedLanguageIds },
      { label: "Civilizations", value: c.associatedCivilizationIds },
      { label: "Material goods", value: c.materialGoods },
      { label: "Confidence", value: `${c.confidence}%` },
      { label: "Description", value: c.description },
    ],
  }),
};
