import type { LanguageFamilyWithChildren, LanguageWithVariants } from "../../../../contracts/types";
import type {
  VisualizationFilters,
  TreeNode,
  NetworkData,
  NetworkNode,
  NetworkLink,
  TimelineEvent,
  MapPoint,
} from "./types";

/**
 * Apply filters to language families and their languages
 */
export function applyFilters(
  families: LanguageFamilyWithChildren[],
  filters: VisualizationFilters
): LanguageFamilyWithChildren[] {
  if (!families) return [];

  const {
    searchQuery,
    status,
    region,
    dataSource,
    timeRange,
    speakerRange,
  } = filters;

  // Helper to check if a language matches filters
  const languageMatchesFilters = (lang: LanguageWithVariants): boolean => {
    // Search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = lang.name.toLowerCase().includes(query);
      const matchesNative = lang.nativeName?.toLowerCase().includes(query);
      const matchesIso1 = lang.iso639_1?.toLowerCase().includes(query);
      const matchesIso2 = lang.iso639_2?.toLowerCase().includes(query);
      if (!matchesName && !matchesNative && !matchesIso1 && !matchesIso2) {
        return false;
      }
    }

    // Status filter
    if (status.length > 0 && !status.includes(lang.status)) {
      return false;
    }

    // Region filter
    if (region && lang.region !== region) {
      return false;
    }

    // Data source filter
    if (dataSource.length > 0 && lang.source && !dataSource.includes(lang.source)) {
      return false;
    }

    // Speaker range filter
    if (speakerRange[0] !== null || speakerRange[1] !== null) {
      const speakers = lang.totalSpeakers || 0;
      if (speakerRange[0] !== null && speakers < speakerRange[0]) return false;
      if (speakerRange[1] !== null && speakers > speakerRange[1]) return false;
    }

    // Time range filter (for historical variants)
    if (timeRange[0] !== null || timeRange[1] !== null) {
      // Parse time origin if exists
      if (lang.timeOrigin) {
        const year = parseTimeString(lang.timeOrigin);
        if (year !== null) {
          if (timeRange[0] !== null && year < timeRange[0]) return false;
          if (timeRange[1] !== null && year > timeRange[1]) return false;
        }
      }
    }

    return true;
  };

  // Recursively filter families
  const filterFamily = (
    family: LanguageFamilyWithChildren
  ): LanguageFamilyWithChildren | null => {
    // Filter languages
    const filteredLanguages = family.languages.filter(languageMatchesFilters);

    // Recursively filter children
    const filteredChildren = family.children
      .map(filterFamily)
      .filter((child): child is LanguageFamilyWithChildren => child !== null);

    // Keep family if it has languages or children
    if (filteredLanguages.length > 0 || filteredChildren.length > 0) {
      return {
        ...family,
        languages: filteredLanguages,
        children: filteredChildren,
      };
    }

    return null;
  };

  return families
    .map(filterFamily)
    .filter((family): family is LanguageFamilyWithChildren => family !== null);
}

/**
 * Transform tree data for D3 hierarchical tree visualization
 */
export function transformToTreeData(
  families: LanguageFamilyWithChildren[],
  filters: VisualizationFilters
): TreeNode[] {
  const filteredFamilies = applyFilters(families, filters);

  const transformFamily = (
    family: LanguageFamilyWithChildren,
    level: number
  ): TreeNode => {
    const familyNode: TreeNode = {
      id: family.id,
      name: family.name,
      type: 'family',
      level,
      data: family,
      children: [],
    };

    // Add child families
    const childFamilyNodes = family.children.map((child) =>
      transformFamily(child, level + 1)
    );

    // Add languages as leaf nodes
    const languageNodes: TreeNode[] = family.languages.map((lang) => ({
      id: lang.id,
      name: lang.name,
      type: 'language',
      level: level + 1,
      familyId: family.id,
      data: lang,
    }));

    familyNode.children = [...childFamilyNodes, ...languageNodes];

    return familyNode;
  };

  return filteredFamilies.map((family) => transformFamily(family, 0));
}

/**
 * Transform tree data for D3 force-directed network visualization
 */
export function transformToNetworkData(
  families: LanguageFamilyWithChildren[],
  filters: VisualizationFilters
): NetworkData {
  const filteredFamilies = applyFilters(families, filters);

  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];

  const processFamily = (
    family: LanguageFamilyWithChildren,
    level: number,
    parentId?: string
  ) => {
    // Add family node
    const familyNode: NetworkNode = {
      id: family.id,
      name: family.name,
      type: 'family',
      group: family.parentId || family.id, // Root families group by themselves
      level,
      size: Math.max(30, Math.log10((family.totalSpeakers || 1000) + 1) * 10),
      totalSpeakers: family.totalSpeakers || undefined,
      region: family.region || undefined,
    };
    nodes.push(familyNode);

    // Add link to parent if exists
    if (parentId) {
      links.push({
        source: parentId,
        target: family.id,
        type: 'family-child',
        strength: 1,
      });
    }

    // Process child families
    family.children.forEach((child) => {
      processFamily(child, level + 1, family.id);
    });

    // Process languages
    family.languages.forEach((lang) => {
      const langNode: NetworkNode = {
        id: lang.id,
        name: lang.name,
        type: 'language',
        group: family.id,
        level: level + 1,
        size: Math.max(8, Math.log10((lang.totalSpeakers || 1000) + 1) * 5),
        totalSpeakers: lang.totalSpeakers || undefined,
        region: lang.region || undefined,
        status: lang.status,
      };
      nodes.push(langNode);

      // Link language to its family
      links.push({
        source: family.id,
        target: lang.id,
        type: 'language-family',
        strength: 0.5,
      });
    });
  };

  filteredFamilies.forEach((family) => processFamily(family, 0));

  return { nodes, links };
}

/**
 * Transform tree data for timeline visualization
 */
export function transformToTimelineData(
  families: LanguageFamilyWithChildren[],
  filters: VisualizationFilters,
  groupBy: 'family' | 'region' = 'family'
): TimelineEvent[] {
  const filteredFamilies = applyFilters(families, filters);

  const events: TimelineEvent[] = [];

  const processFamily = (family: LanguageFamilyWithChildren) => {
    // Process languages with time data
    family.languages.forEach((lang) => {
      if (lang.timeOrigin) {
        const startYear = parseTimeString(lang.timeOrigin);
        const endYear = lang.timeEnd ? parseTimeString(lang.timeEnd) : null;

        if (startYear !== null) {
          events.push({
            id: lang.id,
            name: lang.name,
            nativeName: lang.nativeName || undefined,
            type: 'language',
            familyId: family.id,
            familyName: family.name,
            groupName: groupBy === 'family' ? family.name : (lang.region || 'Unknown'),
            startYear,
            endYear,
            region: lang.region || undefined,
            status: lang.status,
            totalSpeakers: lang.totalSpeakers || undefined,
            historicalContext: lang.historicalContext || undefined,
            isEstimate: false,
          });
        }
      }

      // Include historical variants
      lang.historicalVariants.forEach((variant) => {
        if (variant.timeOrigin) {
          const startYear = parseTimeString(variant.timeOrigin);
          const endYear = variant.timeEnd ? parseTimeString(variant.timeEnd) : null;

          if (startYear !== null) {
            events.push({
              id: variant.id,
              name: variant.name,
              nativeName: variant.nativeName || undefined,
              type: 'language',
              familyId: family.id,
              familyName: family.name,
              groupName: groupBy === 'family' ? family.name : (variant.region || 'Unknown'),
              startYear,
              endYear,
              region: variant.region || undefined,
              status: variant.status,
              totalSpeakers: variant.totalSpeakers || undefined,
              historicalContext: variant.historicalContext || undefined,
              isEstimate: false,
            });
          }
        }
      });
    });

    // Recursively process children
    family.children.forEach((child) => processFamily(child));
  };

  filteredFamilies.forEach((family) => processFamily(family));

  // Sort by start year
  return events.sort((a, b) => a.startYear - b.startYear);
}

/**
 * Transform tree data for map visualization
 */
export function transformToMapData(
  families: LanguageFamilyWithChildren[],
  filters: VisualizationFilters
): MapPoint[] {
  const filteredFamilies = applyFilters(families, filters);

  const points: MapPoint[] = [];

  const processFamily = (family: LanguageFamilyWithChildren) => {
    // Process languages with coordinates
    family.languages.forEach((lang) => {
      if (lang.coordinates && lang.coordinates.lat && lang.coordinates.lng) {
        points.push({
          id: lang.id,
          name: lang.name,
          nativeName: lang.nativeName || undefined,
          type: 'language',
          familyId: family.id,
          familyName: family.name,
          lat: lang.coordinates.lat,
          lng: lang.coordinates.lng,
          region: lang.region || undefined,
          countries: lang.countries,
          status: lang.status,
          totalSpeakers: lang.totalSpeakers || undefined,
          nativeSpeakers: lang.nativeSpeakers || undefined,
          writingSystem: lang.writingSystem || undefined,
          iso639_1: lang.iso639_1 || undefined,
          iso639_2: lang.iso639_2 || undefined,
        });
      }
    });

    // Recursively process children
    family.children.forEach((child) => processFamily(child));
  };

  filteredFamilies.forEach((family) => processFamily(family));

  return points;
}

/**
 * Parse time strings to numeric years
 * Handles formats like "500 BCE", "1100 CE", "Modern Era", etc.
 */
export function parseTimeString(timeStr: string): number | null {
  if (!timeStr) return null;

  const str = timeStr.trim();

  // Try to extract year from various formats
  // "500 BCE" -> -500
  const bceMatch = str.match(/(\d+)\s*BCE/i);
  if (bceMatch) {
    return -parseInt(bceMatch[1], 10);
  }

  // "1100 CE" or "1100 AD" -> 1100
  const ceMatch = str.match(/(\d+)\s*(CE|AD)/i);
  if (ceMatch) {
    return parseInt(ceMatch[1], 10);
  }

  // Just a number "1500" -> 1500
  const numberMatch = str.match(/^(\d+)$/);
  if (numberMatch) {
    return parseInt(numberMatch[1], 10);
  }

  // Range "500-1100 CE" -> use start year
  const rangeMatch = str.match(/(\d+)-\d+\s*(CE|AD|BCE)?/i);
  if (rangeMatch) {
    const year = parseInt(rangeMatch[1], 10);
    return rangeMatch[2]?.toUpperCase() === 'BCE' ? -year : year;
  }

  // Modern era estimates
  if (str.toLowerCase().includes('modern')) {
    return 1800;
  }
  if (str.toLowerCase().includes('medieval')) {
    return 1000;
  }
  if (str.toLowerCase().includes('ancient')) {
    return -500;
  }

  return null;
}

/**
 * Get all unique regions from the tree data
 */
export function getUniqueRegions(families: LanguageFamilyWithChildren[]): string[] {
  const regions = new Set<string>();

  const processFamily = (family: LanguageFamilyWithChildren) => {
    if (family.region) regions.add(family.region);

    family.languages.forEach((lang) => {
      if (lang.region) regions.add(lang.region);
    });

    family.children.forEach((child) => processFamily(child));
  };

  families.forEach((family) => processFamily(family));

  return Array.from(regions).sort();
}

/**
 * Get all unique statuses from the tree data
 */
export function getUniqueStatuses(families: LanguageFamilyWithChildren[]): string[] {
  const statuses = new Set<string>();

  const processFamily = (family: LanguageFamilyWithChildren) => {
    family.languages.forEach((lang) => {
      statuses.add(lang.status);
    });

    family.children.forEach((child) => processFamily(child));
  };

  families.forEach((family) => processFamily(family));

  return Array.from(statuses).sort();
}
