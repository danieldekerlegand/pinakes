import { useState, useCallback, useEffect } from 'react';
import type { MapFeatureData } from '../map-layers/MapFeatureInfoPanel';
import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  ArchaeologicalCultureFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
} from '../../../lib/visualization/geospatial-types';

/**
 * Encodes a selected feature into a URL search param string: `?feature=<type>:<id>`
 */
export function encodeFeatureParam(featureType: string, featureId: string): string {
  return `${featureType}:${encodeURIComponent(featureId)}`;
}

/**
 * Decodes a `feature` search param into { featureType, featureId } or null.
 */
export function decodeFeatureParam(param: string | null): { featureType: string; featureId: string } | null {
  if (!param) return null;
  const idx = param.indexOf(':');
  if (idx < 1) return null;
  return {
    featureType: param.slice(0, idx),
    featureId: decodeURIComponent(param.slice(idx + 1)),
  };
}

/**
 * Reads the initial `feature` param from the current URL's search string.
 */
function getInitialFeatureFromURL(): { featureType: string; featureId: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return decodeFeatureParam(params.get('feature'));
}

/**
 * Updates the URL search params with the selected feature without triggering navigation.
 */
function updateURLFeature(featureType: string | null, featureId: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (featureType && featureId) {
    url.searchParams.set('feature', encodeFeatureParam(featureType, featureId));
  } else {
    url.searchParams.delete('feature');
  }
  window.history.replaceState({}, '', url.toString());
}

export interface FeatureLookupCollections {
  languageRanges?: LanguageRangeFeature[];
  archaeologicalSites?: ArchaeologicalSiteFeature[];
  archaeologicalCultures?: ArchaeologicalCultureFeature[];
  civilizations?: CivilizationFeature[];
  routes?: HistoricalRouteFeature[];
  cuisines?: any[];
  music?: any[];
  dance?: any[];
  religions?: any[];
  battles?: any[];
  deities?: any[];
  haplogroups?: any[];
  foodwayEvents?: any[];
  kinshipSystems?: any[];
  architecturalStyles?: any[];
  ingredientOrigins?: any[];
  cookingTechniques?: any[];
  urheimatHypotheses?: any[];
}

/**
 * Attempts to find a feature across all collections by id and returns
 * the appropriate MapFeatureData.
 */
export function findFeatureById(
  featureId: string,
  collections: FeatureLookupCollections,
): MapFeatureData | null {
  // Search each collection in order, checking common id patterns
  const idMatchers = [
    {
      items: collections.languageRanges,
      type: 'language-range' as const,
      getId: (f: any) => f.properties?.languageId || f.id,
    },
    {
      items: collections.archaeologicalSites,
      type: 'archaeological-site' as const,
      getId: (f: any) => f.properties?.siteId || f.id,
    },
    {
      items: collections.archaeologicalCultures,
      type: 'archaeological-culture' as const,
      getId: (f: any) => f.properties?.cultureId || f.id,
    },
    {
      items: collections.civilizations,
      type: 'civilization' as const,
      getId: (f: any) => f.properties?.civilizationId || f.id,
    },
    {
      items: collections.routes,
      type: 'route' as const,
      getId: (f: any) => f.properties?.routeId || f.id,
    },
    {
      items: collections.cuisines,
      type: 'cuisine' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.music,
      type: 'music' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.dance,
      type: 'dance' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.religions,
      type: 'religion' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.battles,
      type: 'battle' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.deities,
      type: 'deity' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.haplogroups,
      type: 'haplogroup' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.foodwayEvents,
      type: 'foodway-event' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.kinshipSystems,
      type: 'kinship-system' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.architecturalStyles,
      type: 'architectural-style' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.ingredientOrigins,
      type: 'ingredient-origin' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.cookingTechniques,
      type: 'cooking-technique' as const,
      getId: (f: any) => f.id,
    },
    {
      items: collections.urheimatHypotheses,
      type: 'urheimat-hypothesis' as const,
      getId: (f: any) => f.id,
    },
  ];

  for (const { items, type, getId } of idMatchers) {
    if (!items) continue;
    const found = items.find((f) => getId(f) === featureId);
    if (found) {
      return { featureType: type, feature: found } as MapFeatureData;
    }
  }
  return null;
}

/**
 * Finds a feature using both featureType hint and featureId for faster lookup.
 */
export function findFeatureByTypeAndId(
  featureType: string,
  featureId: string,
  collections: FeatureLookupCollections,
): MapFeatureData | null {
  const typeToCollection: Record<string, { items: any[] | undefined; getId: (f: any) => string }> = {
    'language-range': { items: collections.languageRanges, getId: (f) => f.properties?.languageId || f.id },
    'archaeological-site': { items: collections.archaeologicalSites, getId: (f) => f.properties?.siteId || f.id },
    'archaeological-culture': { items: collections.archaeologicalCultures, getId: (f) => f.properties?.cultureId || f.id },
    'civilization': { items: collections.civilizations, getId: (f) => f.properties?.civilizationId || f.id },
    'route': { items: collections.routes, getId: (f) => f.properties?.routeId || f.id },
    'cuisine': { items: collections.cuisines, getId: (f) => f.id },
    'music': { items: collections.music, getId: (f) => f.id },
    'dance': { items: collections.dance, getId: (f) => f.id },
    'religion': { items: collections.religions, getId: (f) => f.id },
    'battle': { items: collections.battles, getId: (f) => f.id },
    'deity': { items: collections.deities, getId: (f) => f.id },
    'haplogroup': { items: collections.haplogroups, getId: (f) => f.id },
    'foodway-event': { items: collections.foodwayEvents, getId: (f) => f.id },
    'kinship-system': { items: collections.kinshipSystems, getId: (f) => f.id },
    'architectural-style': { items: collections.architecturalStyles, getId: (f) => f.id },
    'ingredient-origin': { items: collections.ingredientOrigins, getId: (f) => f.id },
    'cooking-technique': { items: collections.cookingTechniques, getId: (f) => f.id },
    'urheimat-hypothesis': { items: collections.urheimatHypotheses, getId: (f) => f.id },
  };

  const entry = typeToCollection[featureType];
  if (!entry?.items) {
    // Fallback to global search
    return findFeatureById(featureId, collections);
  }

  const found = entry.items.find((f: any) => entry.getId(f) === featureId);
  if (found) {
    return { featureType, feature: found } as MapFeatureData;
  }

  // Fallback to global search if not found in expected collection
  return findFeatureById(featureId, collections);
}

export interface UseMapFeatureSelectionReturn {
  selectedFeatureData: MapFeatureData | null;
  selectedFeatureId: string | null;
  selectFeature: (id: string) => void;
  clearSelection: () => void;
}

/**
 * Hook that manages map feature selection state and URL deep-linking.
 *
 * When a feature is clicked, it:
 * 1. Looks up the feature data across all collections
 * 2. Updates state to show the info panel
 * 3. Updates the URL with a sharable `?feature=type:id` param
 *
 * On mount, it reads the URL for an initial selection (deep-link support).
 */
export function useMapFeatureSelection(
  collections: FeatureLookupCollections,
): UseMapFeatureSelectionReturn {
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(() => {
    const initial = getInitialFeatureFromURL();
    return initial?.featureId ?? null;
  });

  const [selectedFeatureData, setSelectedFeatureData] = useState<MapFeatureData | null>(null);

  // Resolve deep-linked feature once data is available
  useEffect(() => {
    if (!selectedFeatureId) {
      setSelectedFeatureData(null);
      return;
    }

    const urlInfo = getInitialFeatureFromURL();
    let data: MapFeatureData | null;
    if (urlInfo && urlInfo.featureId === selectedFeatureId) {
      data = findFeatureByTypeAndId(urlInfo.featureType, selectedFeatureId, collections);
    } else {
      data = findFeatureById(selectedFeatureId, collections);
    }

    setSelectedFeatureData(data);
  }, [selectedFeatureId, collections]);

  const selectFeature = useCallback(
    (id: string) => {
      setSelectedFeatureId(id);
      const data = findFeatureById(id, collections);
      setSelectedFeatureData(data);
      if (data) {
        updateURLFeature(data.featureType, id);
      }
    },
    [collections],
  );

  const clearSelection = useCallback(() => {
    setSelectedFeatureId(null);
    setSelectedFeatureData(null);
    updateURLFeature(null, null);
  }, []);

  return {
    selectedFeatureData,
    selectedFeatureId,
    selectFeature,
    clearSelection,
  };
}
