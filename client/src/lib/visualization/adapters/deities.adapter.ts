import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
  RelationalLink,
} from "./types";

interface Deity {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  coordinates: { lat: number; lng: number } | null;
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  equivalentDeityIds: string[];
  attributes: string[];
  symbols: string[];
  description: string;
  sources: string[];
}

function matchesQuery(d: Deity, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    d.name.toLowerCase().includes(ql) ||
    d.nativeName?.toLowerCase().includes(ql) ||
    d.mythology.toLowerCase().includes(ql) ||
    d.domain.some((dm) => dm.toLowerCase().includes(ql))
  );
}

function project(rows: Deity[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((d) => {
    if (facets.mythology && d.mythology !== facets.mythology) return false;
    if (facets.domain && !d.domain.includes(facets.domain)) return false;
    if (!matchesQuery(d, opts.searchQuery ?? "")) return false;
    return true;
  });

  const filteredIds = new Set(filtered.map((d) => d.id));

  const temporal = filtered
    .filter((d) => d.timeOrigin !== null && Number.isFinite(d.timeOrigin))
    .map((d) => ({
      id: d.id,
      label: d.name,
      startYear: d.timeOrigin as number,
      endYear: d.timeEnd !== null && Number.isFinite(d.timeEnd) ? d.timeEnd : null,
      group: d.mythology,
      payload: d,
    }));

  const spatial = filtered.flatMap((d) => {
    if (!d.coordinates) return [];
    return [{
      id: d.id,
      label: d.name,
      lat: d.coordinates.lat,
      lng: d.coordinates.lng,
      region: d.mythology,
      magnitude: d.attributes.length + d.symbols.length,
      startYear: d.timeOrigin ?? undefined,
      endYear: d.timeEnd,
      payload: d,
    }];
  });

  const relationalLinks: RelationalLink[] = [];
  const seen = new Set<string>();
  for (const d of filtered) {
    for (const otherId of d.equivalentDeityIds) {
      if (!filteredIds.has(otherId)) continue;
      const [a, b] = d.id < otherId ? [d.id, otherId] : [otherId, d.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationalLinks.push({ source: a, target: b, kind: "equivalent" });
    }
  }

  const relational = {
    nodes: filtered.map((d) => ({
      id: d.id,
      label: d.name,
      group: d.mythology,
      magnitude: d.equivalentDeityIds.length,
      payload: d,
    })),
    links: relationalLinks,
  };

  const categorical = filtered.map((d) => ({
    id: d.id,
    label: d.name,
    facets: {
      mythology: d.mythology,
      domain: d.domain,
      attributes: d.attributes,
      symbols: d.symbols,
      languages: d.associatedLanguageIds,
    },
    payload: d,
  }));

  return { temporal, spatial, relational, categorical };
}

export const deitiesAdapter: DatasetAdapter<Deity> = {
  id: "deities",
  name: "Deities",
  category: "Religion",
  endpoint: "/api/deities",
  unwrap: (resp) => (resp as { deities?: Deity[] })?.deities ?? [],
  dimensions: ["temporal", "spatial", "relational", "categorical"],
  filterableFacets: [
    { key: "mythology", label: "Mythology" },
    { key: "domain", label: "Domain" },
  ],
  project,
  detail: (d) => ({
    title: d.name,
    subtitle: d.nativeName ? `${d.mythology} · ${d.nativeName}` : d.mythology,
    fields: [
      { label: "Domain", value: d.domain },
      {
        label: "Time",
        value: `${d.timeOrigin ?? "?"} – ${d.timeEnd ?? "present"}`,
      },
      { label: "Attributes", value: d.attributes },
      { label: "Symbols", value: d.symbols },
      { label: "Equivalent deities", value: d.equivalentDeityIds },
      { label: "Description", value: d.description },
    ],
  }),
};
