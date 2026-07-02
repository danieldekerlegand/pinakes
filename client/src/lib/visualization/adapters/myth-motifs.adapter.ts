import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
  RelationalLink,
} from "./types";

interface MythMotif {
  id: string;
  name: string;
  motifType: string;
  thompsonIndex: string;
  mythologyIds: string[];
  associatedDeityIds: string[];
  region: string;
  timeOrigin: number | null;
  timeEnd: number | null;
  relatedMotifIds: string[];
  description: string;
  sources: string[];
}

function matchesQuery(m: MythMotif, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    m.name.toLowerCase().includes(ql) ||
    m.motifType?.toLowerCase().includes(ql) ||
    m.region?.toLowerCase().includes(ql) ||
    m.thompsonIndex?.toLowerCase().includes(ql)
  );
}

function project(rows: MythMotif[], opts: ProjectionOptions): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((m) => {
    if (facets.motifType && m.motifType !== facets.motifType) return false;
    if (facets.region && m.region !== facets.region) return false;
    if (!matchesQuery(m, opts.searchQuery ?? "")) return false;
    return true;
  });

  const filteredIds = new Set(filtered.map((m) => m.id));

  const temporal = filtered
    .filter((m) => m.timeOrigin !== null && Number.isFinite(m.timeOrigin))
    .map((m) => ({
      id: m.id,
      label: m.name,
      startYear: m.timeOrigin as number,
      endYear: m.timeEnd !== null && Number.isFinite(m.timeEnd) ? m.timeEnd : null,
      group: m.motifType ?? "Other",
      payload: m,
    }));

  const relationalLinks: RelationalLink[] = [];
  const seen = new Set<string>();
  for (const m of filtered) {
    for (const otherId of m.relatedMotifIds) {
      if (!filteredIds.has(otherId)) continue;
      const [a, b] = m.id < otherId ? [m.id, otherId] : [otherId, m.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationalLinks.push({ source: a, target: b, kind: "related" });
    }
  }

  const relational = {
    nodes: filtered.map((m) => ({
      id: m.id,
      label: m.name,
      group: m.motifType ?? "Other",
      magnitude: m.relatedMotifIds.length,
      payload: m,
    })),
    links: relationalLinks,
  };

  const categorical = filtered.map((m) => ({
    id: m.id,
    label: m.name,
    facets: {
      motifType: m.motifType,
      thompsonIndex: m.thompsonIndex,
      region: m.region,
      mythologies: m.mythologyIds,
      associatedDeities: m.associatedDeityIds,
    },
    payload: m,
  }));

  return { temporal, relational, categorical };
}

export const mythMotifsAdapter: DatasetAdapter<MythMotif> = {
  id: "myth-motifs",
  name: "Myth Motifs",
  category: "Religion",
  endpoint: "/api/myth-motifs",
  unwrap: (resp) => (resp as { motifs?: MythMotif[] })?.motifs ?? [],
  dimensions: ["temporal", "relational", "categorical"],
  filterableFacets: [
    { key: "motifType", label: "Motif Type" },
    { key: "region", label: "Region" },
  ],
  project,
  detail: (m) => ({
    title: m.name,
    subtitle: m.thompsonIndex ? `${m.motifType} · Thompson ${m.thompsonIndex}` : m.motifType,
    fields: [
      { label: "Region", value: m.region },
      {
        label: "Time",
        value: `${m.timeOrigin ?? "?"} – ${m.timeEnd ?? "present"}`,
      },
      { label: "Mythologies", value: m.mythologyIds },
      { label: "Associated deities", value: m.associatedDeityIds },
      { label: "Related motifs", value: m.relatedMotifIds },
      { label: "Description", value: m.description },
    ],
  }),
};
