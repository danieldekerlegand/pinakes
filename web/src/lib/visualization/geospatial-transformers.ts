import * as turf from '@turf/turf';
import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
  MaterialCultureFeature,
  MaterialCultureDistribution,
  BoundingBox,
} from './geospatial-types';
import type {
  LanguageRange,
  ArchaeologicalSite,
  Civilization,
  CivilizationBoundary,
  HistoricalRoute,
  MaterialCulture,
  MaterialCultureDistribution as MaterialCultureDistributionDB,
  Language,
  LanguageFamily,
} from '@contracts/types';

// ============================================================================
// Time-Based Filtering
// ============================================================================

/**
 * Filter features by current year based on their time period
 */
export function filterByTime<T extends { timePeriodStart: number; timePeriodEnd: number | null }>(
  features: T[],
  currentYear: number
): T[] {
  return features.filter((feature) => {
    const { timePeriodStart, timePeriodEnd } = feature;

    // Feature starts in the future
    if (timePeriodStart > currentYear) {
      return false;
    }

    // Feature has no end date (continues to present)
    if (timePeriodEnd === null) {
      return true;
    }

    // Feature ends before current year
    if (timePeriodEnd < currentYear) {
      return false;
    }

    return true;
  });
}

/**
 * Filter GeoJSON features by time period
 */
export function filterGeoJSONByTime<T extends { properties: { timePeriod: { start: number; end: number | null } } }>(
  features: T[],
  currentYear: number
): T[] {
  return features.filter((feature) => {
    const { start, end } = feature.properties.timePeriod;

    if (start > currentYear) return false;
    if (end === null) return true;
    if (end < currentYear) return false;

    return true;
  });
}

// ============================================================================
// Database to GeoJSON Conversion
// ============================================================================

/**
 * Convert LanguageRange DB record to GeoJSON feature
 */
export function dbToLanguageRangeFeature(
  range: LanguageRange,
  language: Language,
  family: LanguageFamily
): LanguageRangeFeature {
  return {
    type: 'Feature',
    id: range.id,
    geometry: range.geometry as any, // JSONB stored as GeoJSON geometry
    properties: {
      languageId: language.id,
      languageName: language.name,
      nativeName: language.nativeName || undefined,
      familyId: family.id,
      familyName: family.name,
      rangeType: range.rangeType as any,
      timePeriod: {
        start: range.timePeriodStart || 0,
        end: range.timePeriodEnd,
        label: range.timePeriodLabel || '',
      },
      confidence: range.confidence || 50,
      sources: range.sources || [],
      totalSpeakers: language.totalSpeakers || undefined,
      region: language.region || undefined,
      status: language.status,
      iso639_1: language.iso639_1 || undefined,
      iso639_2: language.iso639_2 || undefined,
    },
  };
}

/**
 * Convert ArchaeologicalSite DB record to GeoJSON feature
 */
export function dbToArchaeologicalSiteFeature(site: ArchaeologicalSite): ArchaeologicalSiteFeature {
  const coords = site.coordinates as { lat: number; lng: number };

  return {
    type: 'Feature',
    id: site.id,
    geometry: {
      type: 'Point',
      coordinates: [coords.lng, coords.lat], // GeoJSON is [lng, lat]
    },
    properties: {
      siteId: site.id,
      name: site.name,
      siteType: site.siteType as any,
      timePeriod: {
        start: site.timePeriodStart,
        end: site.timePeriodEnd || null,
        label: site.timePeriodLabel || '',
      },
      associatedLanguageIds: site.associatedLanguageIds || [],
      associatedCultureIds: site.associatedCultureIds || [],
      excavationStatus: site.excavationStatus as any,
      findings: site.findings || [],
      importance: site.importance || 50,
      confidence: site.confidence || 50,
      sources: site.sources || [],
    },
  };
}

/**
 * Convert Civilization + CivilizationBoundary to GeoJSON feature
 */
export function dbToCivilizationFeature(
  civilization: Civilization,
  boundary: CivilizationBoundary
): CivilizationFeature {
  return {
    type: 'Feature',
    id: boundary.id,
    geometry: boundary.geometry as any, // JSONB stored as GeoJSON geometry
    properties: {
      civilizationId: civilization.id,
      name: civilization.name,
      nativeName: civilization.nativeName || undefined,
      timePeriod: {
        start: boundary.timePeriodStart,
        end: boundary.timePeriodEnd || null,
        label: boundary.timePeriodLabel || '',
      },
      associatedLanguageIds: civilization.associatedLanguageIds || [],
      writingSystems: civilization.writingSystems || [],
      politicalStructure: civilization.politicalStructure || undefined,
      capital: civilization.capital || undefined,
      population: civilization.population || undefined,
      sources: civilization.sources || [],
    },
  };
}

/**
 * Convert HistoricalRoute DB record to GeoJSON feature
 */
export function dbToHistoricalRouteFeature(route: HistoricalRoute): HistoricalRouteFeature {
  return {
    type: 'Feature',
    id: route.id,
    geometry: route.geometry as any, // JSONB stored as GeoJSON LineString
    properties: {
      routeId: route.id,
      name: route.name,
      routeType: route.routeType as any,
      timePeriod: {
        start: route.timePeriodStart,
        end: route.timePeriodEnd || null,
        label: route.timePeriodLabel || '',
      },
      associatedLanguageIds: route.associatedLanguageIds || [],
      linguisticImpact: route.linguisticImpact || undefined,
      tradedGoods: route.tradedGoods || [],
      direction: route.direction as any,
      sources: route.sources || [],
    },
  };
}

/**
 * Convert MaterialCulture + Distribution to GeoJSON feature
 */
export function dbToMaterialCultureFeature(
  culture: MaterialCulture,
  distribution: MaterialCultureDistributionDB
): MaterialCultureFeature {
  return {
    type: 'Feature',
    id: distribution.id,
    geometry: distribution.geometry as any, // JSONB stored as GeoJSON geometry
    properties: {
      cultureId: culture.id,
      name: culture.name,
      cultureType: culture.cultureType as any,
      timePeriod: {
        start: distribution.timePeriodStart,
        end: distribution.timePeriodEnd || null,
        label: distribution.timePeriodLabel || '',
      },
      associatedLanguageIds: culture.associatedLanguageIds || [],
      description: culture.description || undefined,
      sources: culture.sources || [],
    },
  };
}

// ============================================================================
// Geometry Simplification
// ============================================================================

/**
 * Simplify polygon geometry based on zoom level
 * Higher zoom = less simplification (more detail)
 * Lower zoom = more simplification (less detail)
 */
export function simplifyGeometry<T extends LanguageRangeFeature | CivilizationFeature | MaterialCultureFeature>(
  feature: T,
  zoom: number,
  highQuality: boolean = false
): T {
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
    return feature;
  }

  // Calculate tolerance based on zoom
  // At zoom 1: tolerance ~0.05 (very simplified)
  // At zoom 10: tolerance ~0.0001 (detailed)
  const tolerance = 0.1 / Math.pow(2, zoom - 1);

  try {
    const simplified = turf.simplify(feature as any, {
      tolerance,
      highQuality,
      mutate: false,
    });

    return simplified as T;
  } catch (error) {
    console.error('Error simplifying geometry:', error);
    return feature;
  }
}

/**
 * Simplify an array of features
 */
export function simplifyFeatures<T extends LanguageRangeFeature | CivilizationFeature | MaterialCultureFeature>(
  features: T[],
  zoom: number,
  highQuality: boolean = false
): T[] {
  return features.map((feature) => simplifyGeometry(feature, zoom, highQuality));
}

// ============================================================================
// Heatmap Data Aggregation
// ============================================================================

/**
 * Convert material culture distributions to heatmap data
 */
export function aggregateToHeatmap(
  distributions: MaterialCultureDistributionDB[]
): MaterialCultureDistribution[] {
  return distributions.flatMap((dist) => {
    const geometry = dist.geometry as any;
    const intensity = parseFloat(String(dist.intensity || 1.0));

    // Handle Point geometry
    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates;
      return [{
        lat,
        lng,
        intensity,
        cultureId: dist.cultureId,
        timePeriod: {
          start: dist.timePeriodStart,
          end: dist.timePeriodEnd || null,
          label: dist.timePeriodLabel || '',
        },
      }];
    }

    // Handle Polygon/MultiPolygon by getting centroid
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      try {
        const centroid = turf.centroid(geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [{
          lat,
          lng,
          intensity,
          cultureId: dist.cultureId,
          timePeriod: {
            start: dist.timePeriodStart,
            end: dist.timePeriodEnd || null,
            label: dist.timePeriodLabel || '',
          },
        }];
      } catch (error) {
        console.error('Error calculating centroid:', error);
        return [];
      }
    }

    return [];
  });
}

/**
 * Convert archaeological sites to heatmap data based on importance
 */
export function sitesToHeatmap(sites: ArchaeologicalSite[]): MaterialCultureDistribution[] {
  return sites.map((site) => {
    const coords = site.coordinates as { lat: number; lng: number };
    const importance = site.importance || 50;

    return {
      lat: coords.lat,
      lng: coords.lng,
      intensity: importance / 100, // Normalize to 0-1
      cultureId: site.id,
      timePeriod: {
        start: site.timePeriodStart,
        end: site.timePeriodEnd || null,
        label: site.timePeriodLabel || '',
      },
    };
  });
}

// ============================================================================
// Bounding Box Calculations
// ============================================================================

/**
 * Calculate bounding box for an array of features
 */
export function calculateBounds(
  features: Array<LanguageRangeFeature | ArchaeologicalSiteFeature | CivilizationFeature | HistoricalRouteFeature | MaterialCultureFeature>
): BoundingBox | null {
  if (features.length === 0) return null;

  try {
    const featureCollection = turf.featureCollection(features as any[]);
    const bbox = turf.bbox(featureCollection);

    return {
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
    };
  } catch (error) {
    console.error('Error calculating bounds:', error);
    return null;
  }
}

/**
 * Calculate bounding box for point features (sites)
 */
export function calculatePointBounds(
  points: Array<{ lat: number; lng: number }>
): BoundingBox | null {
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

/**
 * Check if a feature is within bounding box
 */
export function isWithinBounds(
  feature: LanguageRangeFeature | ArchaeologicalSiteFeature | CivilizationFeature | HistoricalRouteFeature | MaterialCultureFeature,
  bounds: BoundingBox
): boolean {
  try {
    const bbox = turf.bbox(feature as any);
    const [west, south, east, north] = bbox;

    // Check if feature bounding box intersects with query bounds
    return !(
      east < bounds.west ||
      west > bounds.east ||
      north < bounds.south ||
      south > bounds.north
    );
  } catch (error) {
    console.error('Error checking bounds:', error);
    return true; // Include by default if error
  }
}

/**
 * Filter features by bounding box
 */
export function filterByBounds<T extends LanguageRangeFeature | ArchaeologicalSiteFeature | CivilizationFeature | HistoricalRouteFeature | MaterialCultureFeature>(
  features: T[],
  bounds: BoundingBox
): T[] {
  return features.filter((feature) => isWithinBounds(feature, bounds));
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse bounding box string "west,south,east,north" to BoundingBox
 */
export function parseBboxString(bbox: string): BoundingBox | null {
  try {
    const parts = bbox.split(',').map((s) => parseFloat(s.trim()));

    if (parts.length !== 4 || parts.some(isNaN)) {
      return null;
    }

    return {
      west: parts[0],
      south: parts[1],
      east: parts[2],
      north: parts[3],
    };
  } catch (error) {
    console.error('Error parsing bbox string:', error);
    return null;
  }
}

/**
 * Format time period for display
 */
export function formatTimePeriod(start: number, end: number | null): string {
  const formatYear = (year: number) => {
    if (year < 0) {
      return `${Math.abs(year)} BCE`;
    }
    return `${year} CE`;
  };

  const startStr = formatYear(start);
  const endStr = end === null ? 'Present' : formatYear(end);

  if (start === end) return startStr;
  return `${startStr} - ${endStr}`;
}

/**
 * Get feature centroid coordinates
 */
export function getFeatureCentroid(
  feature: LanguageRangeFeature | CivilizationFeature | MaterialCultureFeature | HistoricalRouteFeature
): { lat: number; lng: number } | null {
  try {
    const centroid = turf.centroid(feature as any);
    const [lng, lat] = centroid.geometry.coordinates;
    return { lat, lng };
  } catch (error) {
    console.error('Error getting centroid:', error);
    return null;
  }
}

/**
 * Calculate area of polygon feature in square kilometers
 */
export function calculateArea(
  feature: LanguageRangeFeature | CivilizationFeature | MaterialCultureFeature
): number | null {
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
    return null;
  }

  try {
    const area = turf.area(feature as any);
    return area / 1_000_000; // Convert m² to km²
  } catch (error) {
    console.error('Error calculating area:', error);
    return null;
  }
}

/**
 * Calculate length of route in kilometers
 */
export function calculateRouteLength(route: HistoricalRouteFeature): number | null {
  if (route.geometry.type !== 'LineString') {
    return null;
  }

  try {
    const length = turf.length(route as any, { units: 'kilometers' });
    return length;
  } catch (error) {
    console.error('Error calculating route length:', error);
    return null;
  }
}
