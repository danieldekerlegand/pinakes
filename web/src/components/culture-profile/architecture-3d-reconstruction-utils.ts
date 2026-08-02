import type { Site3DReconstruction } from "@/components/visualizations/SiteReconstruction3DViewer";
import type { SiteType } from "@/components/visualizations/site-reconstruction-utils";

export interface RawSiteProperties {
  siteId: string;
  name: string;
  siteType: SiteType;
  timePeriod: { start: number; end: number | null; label: string };
  associatedLanguageIds: string[];
  associatedCultureIds: string[];
  excavationStatus: string;
  findings: string[];
  importance: number;
  confidence: number;
  description?: string;
}

export interface RawSiteFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: RawSiteProperties;
}

export interface CultureSiteFilterOpts {
  languageIds?: string[];
  notableSettlements?: string[];
  timePeriodStart?: number;
  timePeriodEnd?: number;
}

/**
 * Match archaeological sites to a culture profile by:
 *   1. Direct name match against notableSettlements
 *   2. Overlap of associatedLanguageIds with the profile's languages
 *   3. Optional time-period overlap
 */
export function filterSitesForCulture(
  sites: RawSiteFeature[],
  opts: CultureSiteFilterOpts,
): RawSiteFeature[] {
  const langSet = new Set((opts.languageIds ?? []).map((l) => l.toLowerCase()));
  const settlementSet = new Set(
    (opts.notableSettlements ?? []).map((n) => n.trim().toLowerCase()),
  );
  const hasAnyMatcher = langSet.size > 0 || settlementSet.size > 0;

  return sites.filter((site) => {
    const props = site.properties;
    let matches = !hasAnyMatcher;
    if (settlementSet.has(props.name.trim().toLowerCase())) {
      matches = true;
    }
    if (!matches) {
      for (const lang of props.associatedLanguageIds) {
        if (langSet.has(lang.toLowerCase())) {
          matches = true;
          break;
        }
      }
    }
    if (!matches) return false;

    if (
      opts.timePeriodStart !== undefined &&
      opts.timePeriodEnd !== undefined
    ) {
      const sStart = props.timePeriod.start;
      const sEnd = props.timePeriod.end ?? new Date().getFullYear();
      if (sEnd < opts.timePeriodStart || sStart > opts.timePeriodEnd) {
        return false;
      }
    }
    return true;
  });
}

/** Rank sites so the most representative appear first. */
export function rankSites(sites: RawSiteFeature[]): RawSiteFeature[] {
  return [...sites].sort((a, b) => {
    const ai = a.properties.importance ?? 0;
    const bi = b.properties.importance ?? 0;
    if (ai !== bi) return bi - ai;
    return a.properties.name.localeCompare(b.properties.name);
  });
}

export function toReconstruction(site: RawSiteFeature): Site3DReconstruction {
  const p = site.properties;
  return {
    id: p.siteId,
    name: p.name,
    siteType: p.siteType,
    timePeriodStart: p.timePeriod.start,
    timePeriodEnd: p.timePeriod.end,
    timePeriodLabel: p.timePeriod.label,
    findings: p.findings,
    importance: p.importance,
    confidence: p.confidence,
    description: p.description ?? "",
    excavationStatus: p.excavationStatus,
  };
}
