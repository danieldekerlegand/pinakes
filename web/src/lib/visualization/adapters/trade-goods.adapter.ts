import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
} from "./types";
import { linksFromSharedTags, parseYearRange } from "./project-helpers";

interface TradeGood {
  id: string;
  name: string;
  category: string;
  originRegion: string;
  originCoordinates: { lat: number; lng: number } | null;
  tradeRoutes: string[];
  timePeriod: string;
  economicSignificance: string;
  associatedLanguages: string[];
}

function matchesQuery(good: TradeGood, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    good.name.toLowerCase().includes(ql) ||
    good.category.toLowerCase().includes(ql) ||
    good.originRegion.toLowerCase().includes(ql)
  );
}

function project(rows: TradeGood[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((g) => {
    if (facets.category && g.category !== facets.category) return false;
    if (facets.originRegion && g.originRegion !== facets.originRegion) return false;
    if (facets.timePeriod && g.timePeriod !== facets.timePeriod) return false;
    if (!matchesQuery(g, opts.searchQuery ?? "")) return false;
    return true;
  });

  const temporal = filtered.flatMap((g) => {
    const range = parseYearRange(g.timePeriod);
    if (!range) return [];
    return [{
      id: g.id,
      label: g.name,
      startYear: range[0],
      endYear: range[1],
      group: g.category,
      payload: g,
    }];
  });

  const spatial = filtered.flatMap((g) => {
    if (!g.originCoordinates) return [];
    const range = parseYearRange(g.timePeriod);
    return [{
      id: g.id,
      label: g.name,
      lat: g.originCoordinates.lat,
      lng: g.originCoordinates.lng,
      region: g.originRegion,
      magnitude: g.tradeRoutes.length,
      startYear: range?.[0],
      endYear: range?.[1] ?? null,
      payload: g,
    }];
  });

  const relational = {
    nodes: filtered.map((g) => ({
      id: g.id,
      label: g.name,
      group: g.category,
      magnitude: g.tradeRoutes.length,
      payload: g,
    })),
    links: linksFromSharedTags(
      filtered,
      (g) => g.id,
      (g) => g.tradeRoutes,
      "shared-route"
    ),
  };

  const categorical = filtered.map((g) => ({
    id: g.id,
    label: g.name,
    facets: {
      category: g.category,
      originRegion: g.originRegion,
      timePeriod: g.timePeriod,
      tradeRoutes: g.tradeRoutes,
      languages: g.associatedLanguages,
    },
    payload: g,
  }));

  return { temporal, spatial, relational, categorical };
}

export const tradeGoodsAdapter: DatasetAdapter<TradeGood> = {
  id: "trade-goods",
  name: "Trade Goods",
  category: "Trade",
  endpoint: "/api/trade-goods",
  unwrap: (resp) => (resp as { goods?: TradeGood[] })?.goods ?? [],
  dimensions: ["temporal", "spatial", "relational", "categorical"],
  filterableFacets: [
    { key: "category", label: "Category" },
    { key: "originRegion", label: "Origin Region" },
    { key: "timePeriod", label: "Time Period" },
  ],
  project,
  detail: (g) => ({
    title: g.name,
    subtitle: `${g.category} · ${g.originRegion}`,
    fields: [
      { label: "Time period", value: g.timePeriod },
      { label: "Economic significance", value: g.economicSignificance },
      { label: "Trade routes", value: g.tradeRoutes },
      { label: "Associated languages", value: g.associatedLanguages },
    ],
  }),
};
