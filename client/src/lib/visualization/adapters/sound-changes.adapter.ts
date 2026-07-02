import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
  RelationalLink,
} from "./types";
import { parseYearRange } from "./project-helpers";

interface SoundChange {
  id: string;
  name: string;
  familyId: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  changeRule: string;
  environment: string;
  dateRange: string;
  examples: Array<{ before: string; after: string; meaning: string }>;
  relatedChanges: string[];
}

function matchesQuery(c: SoundChange, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    c.name.toLowerCase().includes(ql) ||
    c.changeRule?.toLowerCase().includes(ql) ||
    c.environment?.toLowerCase().includes(ql) ||
    c.sourceLanguageId?.toLowerCase().includes(ql) ||
    c.targetLanguageId?.toLowerCase().includes(ql) ||
    c.familyId?.toLowerCase().includes(ql)
  );
}

function project(
  rows: SoundChange[],
  opts: ProjectionOptions
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((c) => {
    if (facets.familyId && c.familyId !== facets.familyId) return false;
    if (facets.sourceLanguageId && c.sourceLanguageId !== facets.sourceLanguageId) return false;
    if (!matchesQuery(c, opts.searchQuery ?? "")) return false;
    return true;
  });

  const filteredIds = new Set(filtered.map((c) => c.id));

  const temporal = filtered.flatMap((c) => {
    const range = parseYearRange(c.dateRange);
    if (!range) return [];
    return [{
      id: c.id,
      label: `${c.name} (${c.changeRule})`,
      startYear: range[0],
      endYear: range[1],
      group: c.familyId ?? "Other",
      payload: c,
    }];
  });

  // Relational links from explicit relatedChanges (deduped, intra-filter only)
  const relationalLinks: RelationalLink[] = [];
  const seen = new Set<string>();
  for (const c of filtered) {
    for (const otherId of c.relatedChanges ?? []) {
      if (!filteredIds.has(otherId)) continue;
      const [a, b] = c.id < otherId ? [c.id, otherId] : [otherId, c.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationalLinks.push({ source: a, target: b, kind: "related-change" });
    }
  }

  const relational = {
    nodes: filtered.map((c) => ({
      id: c.id,
      label: c.changeRule || c.name,
      group: c.familyId,
      magnitude: c.relatedChanges?.length ?? 0,
      payload: c,
    })),
    links: relationalLinks,
  };

  const categorical = filtered.map((c) => ({
    id: c.id,
    label: c.name,
    facets: {
      family: c.familyId,
      sourceLanguage: c.sourceLanguageId,
      targetLanguage: c.targetLanguageId,
      rule: c.changeRule,
      environment: c.environment,
      dateRange: c.dateRange,
      exampleCount: c.examples?.length ?? 0,
    },
    payload: c,
  }));

  return { temporal, relational, categorical };
}

export const soundChangesAdapter: DatasetAdapter<SoundChange> = {
  id: "sound-changes",
  name: "Sound Changes",
  category: "Linguistics",
  endpoint: "/api/sound-changes",
  unwrap: (resp) => (resp as { changes?: SoundChange[] })?.changes ?? [],
  dimensions: ["temporal", "relational", "categorical"],
  filterableFacets: [
    { key: "familyId", label: "Family" },
    { key: "sourceLanguageId", label: "Source Language" },
  ],
  project,
  detail: (c) => ({
    title: c.name,
    subtitle: `${c.sourceLanguageId} → ${c.targetLanguageId} · ${c.changeRule}`,
    fields: [
      { label: "Family", value: c.familyId },
      { label: "Environment", value: c.environment },
      { label: "Date range", value: c.dateRange },
      {
        label: "Examples",
        value: (c.examples ?? []).map(
          (ex) => `${ex.before} → ${ex.after} ("${ex.meaning}")`
        ),
      },
      { label: "Related changes", value: c.relatedChanges },
    ],
  }),
};
