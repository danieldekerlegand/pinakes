import type {
  DatasetAdapter,
  DimensionProjections,
  ProjectionOptions,
  RelationalLink,
  RelationalNode,
  TemporalItem,
} from "./types";
import { parseYearRange } from "./project-helpers";

interface LanguageContact {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  region: string;
  featuresTransferred: {
    phonological?: string[];
    lexical?: string[];
    grammatical?: string[];
  };
  exampleFeatures: string;
  intensity: string;
}

const INTENSITY_WEIGHTS: Record<string, number> = {
  heavy: 3,
  medium: 2,
  moderate: 2,
  light: 1,
  weak: 1,
};

function matchesQuery(c: LanguageContact, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    c.sourceLanguageId?.toLowerCase().includes(ql) ||
    c.targetLanguageId?.toLowerCase().includes(ql) ||
    c.contactType?.toLowerCase().includes(ql) ||
    c.region?.toLowerCase().includes(ql) ||
    c.exampleFeatures?.toLowerCase().includes(ql)
  );
}

function project(
  rows: LanguageContact[],
  opts: ProjectionOptions
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((c) => {
    if (facets.contactType && c.contactType !== facets.contactType) return false;
    if (facets.region && c.region !== facets.region) return false;
    if (facets.intensity && c.intensity !== facets.intensity) return false;
    if (!matchesQuery(c, opts.searchQuery ?? "")) return false;
    return true;
  });

  // Relational: nodes are unique language IDs, edges are contact rows
  const languageNodes = new Map<string, RelationalNode>();
  const ensureNode = (id: string) => {
    if (!languageNodes.has(id)) {
      languageNodes.set(id, {
        id,
        label: id,
        group: id,
        magnitude: 0,
        payload: { languageId: id },
      });
    }
    const node = languageNodes.get(id)!;
    node.magnitude = (node.magnitude ?? 0) + 1;
  };

  const relationalLinks: RelationalLink[] = [];
  for (const c of filtered) {
    if (!c.sourceLanguageId || !c.targetLanguageId) continue;
    ensureNode(c.sourceLanguageId);
    ensureNode(c.targetLanguageId);
    relationalLinks.push({
      source: c.sourceLanguageId,
      target: c.targetLanguageId,
      kind: c.contactType,
      weight: INTENSITY_WEIGHTS[c.intensity?.toLowerCase()] ?? 1,
      payload: c,
    });
  }

  const relational = {
    nodes: Array.from(languageNodes.values()),
    links: relationalLinks,
  };

  // Temporal: each contact is a time-bounded event
  const temporal: TemporalItem[] = filtered.flatMap((c) => {
    const range = parseYearRange(c.timePeriod);
    if (!range) return [];
    return [{
      id: c.id,
      label: `${c.sourceLanguageId} → ${c.targetLanguageId}`,
      startYear: range[0],
      endYear: range[1],
      group: c.contactType ?? "Other",
      payload: c,
    }];
  });

  const featureCount = (c: LanguageContact) =>
    (c.featuresTransferred?.phonological?.length ?? 0) +
    (c.featuresTransferred?.lexical?.length ?? 0) +
    (c.featuresTransferred?.grammatical?.length ?? 0);

  const categorical = filtered.map((c) => ({
    id: c.id,
    label: `${c.sourceLanguageId} → ${c.targetLanguageId}`,
    facets: {
      contactType: c.contactType,
      region: c.region,
      intensity: c.intensity,
      timePeriod: c.timePeriod,
      sourceLanguage: c.sourceLanguageId,
      targetLanguage: c.targetLanguageId,
      featuresTransferred: featureCount(c),
    },
    payload: c,
  }));

  return { temporal, relational, categorical };
}

export const languageContactsAdapter: DatasetAdapter<LanguageContact> = {
  id: "language-contacts",
  name: "Language Contacts",
  category: "Linguistics",
  endpoint: "/api/language-contacts",
  unwrap: (resp) => (resp as { contacts?: LanguageContact[] })?.contacts ?? [],
  dimensions: ["temporal", "relational", "categorical"],
  filterableFacets: [
    { key: "contactType", label: "Contact Type" },
    { key: "intensity", label: "Intensity" },
    { key: "region", label: "Region" },
  ],
  project,
  detail: (c) => ({
    title: `${c.sourceLanguageId} → ${c.targetLanguageId}`,
    subtitle: `${c.contactType} · ${c.region}`,
    fields: [
      { label: "Time period", value: c.timePeriod },
      { label: "Intensity", value: c.intensity },
      { label: "Phonological transfers", value: c.featuresTransferred?.phonological ?? [] },
      { label: "Lexical transfers", value: c.featuresTransferred?.lexical ?? [] },
      { label: "Grammatical transfers", value: c.featuresTransferred?.grammatical ?? [] },
      { label: "Examples", value: c.exampleFeatures },
    ],
  }),
};
