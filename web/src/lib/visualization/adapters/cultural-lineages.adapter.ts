import type {
  DatasetAdapter,
  DimensionProjections,
  HierarchicalNode,
  ProjectionOptions,
  RelationalLink,
  RelationalNode,
  TemporalItem,
} from "./types";

interface CulturalLineageEdge {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  relationshipType: string;
  timeStart: number;
  timeEnd: number;
  confidence: number;
  evidenceTypes: string[];
  description: string;
  sources: string[];
}

const PARENT_RELATIONSHIPS = new Set([
  "split-from",
  "descended-from",
  "evolved-from",
  "ancestor-of",
  "branch-of",
]);

function matchesQuery(edge: CulturalLineageEdge, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    edge.sourceName.toLowerCase().includes(ql) ||
    edge.targetName.toLowerCase().includes(ql) ||
    edge.relationshipType.toLowerCase().includes(ql)
  );
}

function project(
  edges: CulturalLineageEdge[],
  opts: ProjectionOptions
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = edges.filter((e) => {
    if (facets.relationshipType && e.relationshipType !== facets.relationshipType) return false;
    if (!matchesQuery(e, opts.searchQuery ?? "")) return false;
    return true;
  });

  // Collect unique entities (sources + targets)
  const entities = new Map<string, { id: string; name: string }>();
  for (const e of filtered) {
    if (!entities.has(e.sourceId)) entities.set(e.sourceId, { id: e.sourceId, name: e.sourceName });
    if (!entities.has(e.targetId)) entities.set(e.targetId, { id: e.targetId, name: e.targetName });
  }

  // Hierarchical: pick the earliest parent edge per target (oldest split/descent wins)
  const parentByChild = new Map<string, { parentId: string; timeStart: number }>();
  for (const e of filtered) {
    if (!PARENT_RELATIONSHIPS.has(e.relationshipType)) continue;
    const existing = parentByChild.get(e.targetId);
    if (!existing || e.timeStart < existing.timeStart) {
      parentByChild.set(e.targetId, { parentId: e.sourceId, timeStart: e.timeStart });
    }
  }

  // Compute depth via memoized walk (cycle-safe)
  const depthCache = new Map<string, number>();
  const computeDepth = (id: string, visiting: Set<string>): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    const parent = parentByChild.get(id)?.parentId;
    if (!parent || !entities.has(parent)) {
      depthCache.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const d = computeDepth(parent, visiting) + 1;
    visiting.delete(id);
    depthCache.set(id, d);
    return d;
  };

  const hierarchical: HierarchicalNode[] = Array.from(entities.values()).map((e) => ({
    id: e.id,
    label: e.name,
    parentId: parentByChild.get(e.id)?.parentId ?? null,
    depth: computeDepth(e.id, new Set()),
    payload: e,
  }));

  // Relational: every edge becomes a link, regardless of type
  const relationalNodes: RelationalNode[] = Array.from(entities.values()).map((e) => ({
    id: e.id,
    label: e.name,
    group: parentByChild.get(e.id)?.parentId ?? e.id,
    payload: e,
  }));
  const relationalLinks: RelationalLink[] = filtered.map((e) => ({
    source: e.sourceId,
    target: e.targetId,
    kind: e.relationshipType,
    weight: e.confidence / 100,
    payload: e,
  }));

  // Temporal: each edge as a span (with the full edge as payload — clicking shows the relationship)
  const temporal: TemporalItem[] = filtered
    .filter((e) => Number.isFinite(e.timeStart))
    .map((e) => ({
      id: e.id,
      label: `${e.sourceName} → ${e.targetName}`,
      startYear: e.timeStart,
      endYear: Number.isFinite(e.timeEnd) ? e.timeEnd : null,
      group: e.relationshipType,
      payload: e,
    }));

  const categorical = filtered.map((e) => ({
    id: e.id,
    label: `${e.sourceName} → ${e.targetName}`,
    facets: {
      relationshipType: e.relationshipType,
      timeStart: e.timeStart,
      timeEnd: e.timeEnd,
      confidence: e.confidence,
      evidenceTypes: e.evidenceTypes,
    },
    payload: e,
  }));

  return {
    hierarchical,
    relational: { nodes: relationalNodes, links: relationalLinks },
    temporal,
    categorical,
  };
}

export const culturalLineagesAdapter: DatasetAdapter<CulturalLineageEdge> = {
  id: "cultural-lineages",
  name: "Cultural Lineages",
  category: "Culture",
  endpoint: "/api/cultural-lineages",
  unwrap: (resp) => (Array.isArray(resp) ? (resp as CulturalLineageEdge[]) : []),
  dimensions: ["temporal", "relational", "hierarchical", "categorical"],
  filterableFacets: [{ key: "relationshipType", label: "Relationship" }],
  project,
  detail: (e) => ({
    title: `${e.sourceName} → ${e.targetName}`,
    subtitle: e.relationshipType,
    fields: [
      { label: "Time", value: `${e.timeStart} – ${e.timeEnd}` },
      { label: "Confidence", value: `${e.confidence}%` },
      { label: "Evidence", value: e.evidenceTypes },
      { label: "Description", value: e.description },
      { label: "Sources", value: e.sources },
    ],
  }),
};
