import type { LanguageFamilyWithChildren, LanguageWithVariants } from "../../../../../shared/types";
import type {
  DatasetAdapter,
  DimensionProjections,
  HierarchicalNode,
  ProjectionOptions,
  RelationalLink,
  RelationalNode,
  SpatialItem,
  TemporalItem,
} from "./types";
import { parseYear } from "./project-helpers";

function flattenLanguages(family: LanguageFamilyWithChildren): LanguageWithVariants[] {
  const out: LanguageWithVariants[] = [...family.languages];
  for (const child of family.children) {
    out.push(...flattenLanguages(child));
  }
  return out;
}

function applyQuery(
  families: LanguageFamilyWithChildren[],
  q: string
): LanguageFamilyWithChildren[] {
  if (!q) return families;
  const ql = q.toLowerCase();
  const recurse = (
    family: LanguageFamilyWithChildren
  ): LanguageFamilyWithChildren | null => {
    const matchingLangs = family.languages.filter(
      (lang) =>
        lang.name.toLowerCase().includes(ql) ||
        lang.nativeName?.toLowerCase().includes(ql) ||
        lang.iso639_1?.toLowerCase().includes(ql) ||
        lang.iso639_2?.toLowerCase().includes(ql)
    );
    const filteredChildren = family.children
      .map(recurse)
      .filter((c): c is LanguageFamilyWithChildren => c !== null);
    if (matchingLangs.length === 0 && filteredChildren.length === 0) return null;
    return { ...family, languages: matchingLangs, children: filteredChildren };
  };
  return families.map(recurse).filter((f): f is LanguageFamilyWithChildren => f !== null);
}

function project(
  rows: LanguageFamilyWithChildren[],
  opts: ProjectionOptions
): DimensionProjections {
  const families = applyQuery(rows, opts.searchQuery ?? "");

  const hierarchical: HierarchicalNode[] = [];
  const relationalNodes: RelationalNode[] = [];
  const relationalLinks: RelationalLink[] = [];
  const temporal: TemporalItem[] = [];
  const spatial: SpatialItem[] = [];
  const categorical: { id: string; label: string; facets: Record<string, string | number | string[] | null>; payload: unknown }[] = [];

  const visit = (family: LanguageFamilyWithChildren, depth: number, parentId: string | null) => {
    hierarchical.push({
      id: family.id,
      label: family.name,
      parentId,
      depth,
      payload: family,
    });
    relationalNodes.push({
      id: family.id,
      label: family.name,
      group: family.parentId ?? family.id,
      magnitude: family.totalSpeakers ?? undefined,
      payload: family,
    });
    if (parentId) {
      relationalLinks.push({ source: parentId, target: family.id, kind: "family-child" });
    }

    for (const child of family.children) {
      visit(child, depth + 1, family.id);
    }

    for (const lang of family.languages) {
      hierarchical.push({
        id: lang.id,
        label: lang.name,
        parentId: family.id,
        depth: depth + 1,
        payload: lang,
      });
      relationalNodes.push({
        id: lang.id,
        label: lang.name,
        group: family.id,
        magnitude: lang.totalSpeakers ?? undefined,
        payload: lang,
      });
      relationalLinks.push({ source: family.id, target: lang.id, kind: "language-family" });

      const startYear = parseYear(lang.timeOrigin ?? null);
      if (startYear !== null) {
        temporal.push({
          id: lang.id,
          label: lang.name,
          startYear,
          endYear: parseYear(lang.timeEnd ?? null),
          group: family.name,
          payload: lang,
        });
      }

      if (lang.coordinates && lang.coordinates.lat && lang.coordinates.lng) {
        spatial.push({
          id: lang.id,
          label: lang.name,
          lat: lang.coordinates.lat,
          lng: lang.coordinates.lng,
          region: lang.region ?? undefined,
          countries: lang.countries,
          magnitude: lang.totalSpeakers ?? undefined,
          startYear: startYear ?? undefined,
          payload: lang,
        });
      }

      categorical.push({
        id: lang.id,
        label: lang.name,
        facets: {
          family: family.name,
          status: lang.status,
          region: lang.region ?? null,
          countries: lang.countries ?? [],
          totalSpeakers: lang.totalSpeakers ?? null,
          writingSystem: lang.writingSystem ?? null,
          iso639_1: lang.iso639_1 ?? null,
        },
        payload: lang,
      });
    }
  };

  for (const family of families) visit(family, 0, null);

  return {
    hierarchical,
    relational: { nodes: relationalNodes, links: relationalLinks },
    temporal,
    spatial,
    categorical,
  };
}

export const languageFamiliesAdapter: DatasetAdapter<LanguageFamilyWithChildren> = {
  id: "language-families",
  name: "Language Families",
  category: "Linguistics",
  endpoint: "/api/language-families/tree",
  unwrap: (resp) => (Array.isArray(resp) ? (resp as LanguageFamilyWithChildren[]) : []),
  dimensions: ["hierarchical", "relational", "temporal", "spatial", "categorical"],
  project,
  detail: (lang) => {
    const isLang = "status" in lang;
    if (isLang) {
      const l = lang as unknown as LanguageWithVariants;
      return {
        title: l.name,
        subtitle: l.nativeName ?? l.iso639_1 ?? undefined,
        fields: [
          { label: "Status", value: l.status },
          { label: "Region", value: l.region ?? null },
          { label: "Speakers", value: l.totalSpeakers ?? null },
          { label: "Writing system", value: l.writingSystem ?? null },
        ],
      };
    }
    const f = lang as unknown as LanguageFamilyWithChildren;
    return {
      title: f.name,
      subtitle: f.taxonomicLevel,
      fields: [
        { label: "Languages", value: flattenLanguages(f).length },
        { label: "Region", value: f.region ?? null },
      ],
    };
  },
};
