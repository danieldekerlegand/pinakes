/**
 * Terrain-aware route utilities for classifying route segments
 * and generating elevation profiles for trade/migration routes.
 */

// ============================================================================
// Types
// ============================================================================

export type TerrainType = 'land' | 'maritime' | 'river' | 'mixed';

export interface RouteSegment {
  coordinates: [number, number][]; // [lng, lat] pairs
  terrainType: TerrainType;
}

export interface ElevationPoint {
  distance: number; // km from start
  elevation: number; // meters
  lat: number;
  lng: number;
}

export interface ElevationProfile {
  points: ElevationPoint[];
  minElevation: number;
  maxElevation: number;
  totalDistance: number;
  totalAscent: number;
  totalDescent: number;
}

// ============================================================================
// Major ocean/sea bounding boxes for classification
// ============================================================================

interface OceanRegion {
  name: string;
  west: number;
  east: number;
  south: number;
  north: number;
}

const OCEAN_REGIONS: OceanRegion[] = [
  // Pacific Ocean (simplified - main body)
  { name: 'Pacific', west: 130, east: -100, south: -60, north: 60 },
  // Atlantic Ocean
  { name: 'Atlantic', west: -80, east: -5, south: -60, north: 65 },
  // Indian Ocean
  { name: 'Indian', west: 30, east: 120, south: -60, north: -5 },
  // Arabian Sea
  { name: 'Arabian Sea', west: 50, east: 78, south: 0, north: 25 },
  // Mediterranean Sea
  { name: 'Mediterranean', west: -6, east: 37, south: 30, north: 46 },
  // South China Sea
  { name: 'South China Sea', west: 100, east: 122, south: -5, north: 23 },
  // Bay of Bengal
  { name: 'Bay of Bengal', west: 78, east: 100, south: 5, north: 22 },
  // North Sea / Baltic
  { name: 'North Sea', west: -5, east: 12, south: 51, north: 62 },
  // Red Sea
  { name: 'Red Sea', west: 32, east: 44, south: 12, north: 30 },
  // Persian Gulf
  { name: 'Persian Gulf', west: 47, east: 56, south: 23, north: 30 },
];

// Major mountain ranges for elevation estimation [lng, lat, radius_deg, peak_m]
const MOUNTAIN_RANGES: [number, number, number, number][] = [
  [86.9, 28.0, 8, 5500],   // Himalayas
  [72, 34, 5, 4500],       // Hindu Kush / Karakorum
  [75, 39, 4, 4000],       // Pamir
  [45, 42, 5, 3500],       // Caucasus
  [44, 38, 3, 3500],       // Zagros
  [10, 46, 4, 3000],       // Alps
  [20, 44, 3, 2000],       // Carpathians
  [36, 38, 3, 3000],       // Taurus (Anatolia)
  [-3, 37, 3, 2500],       // Sierra Nevada (Spain)
  [47, 32, 3, 3000],       // Zagros (central)
  [-106, 40, 5, 3500],     // Rockies
  [-70, -33, 4, 5000],     // Andes
  [100, 30, 5, 4500],      // Tibetan Plateau edge
  [33, -3, 2, 4500],       // East African Rift / Kilimanjaro
  [4, 28, 3, 2000],        // Atlas Mountains
  [68, 40, 3, 2500],       // Tien Shan
];

// Major river corridors for river route detection [lng, lat, radius_deg]
const RIVER_CORRIDORS: [number, number, number][] = [
  [31, 26, 1.5],   // Nile (Egypt)
  [31, 30, 1],     // Nile Delta
  [44, 33, 1.5],   // Tigris-Euphrates
  [47, 31, 1.5],   // Shatt al-Arab
  [80, 25, 2],     // Ganges
  [90, 23, 1.5],   // Ganges Delta
  [105, 30, 2],    // Yangtze
  [114, 23, 1.5],  // Pearl River
  [110, 35, 2],    // Yellow River
  [70, 26, 1.5],   // Indus
  [30, 48, 2],     // Danube
  [37, 55, 1.5],   // Volga (upper)
  [49, 47, 1.5],   // Volga (lower)
  [0, 12, 2],      // Niger
  [28, -5, 2],     // Congo
  [-50, -15, 2],   // Amazon
  [-90, 35, 2],    // Mississippi
  [69, 42, 1.5],   // Amu Darya / Syr Darya
  [105, 15, 1.5],  // Mekong
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Haversine distance between two points in km
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a coordinate [lng, lat] is likely over ocean/sea.
 * Uses a simplified heuristic based on known ocean bounding boxes
 * and distance from major landmasses.
 */
export function isOverWater(lng: number, lat: number): boolean {
  // Simple land exclusions - major continental interiors
  // Central Asia / Siberia
  if (lat > 40 && lat < 65 && lng > 40 && lng < 130) return false;
  // Africa interior
  if (lat > -35 && lat < 35 && lng > -15 && lng < 50) return false;
  // Europe interior
  if (lat > 42 && lat < 60 && lng > -10 && lng < 40) return false;
  // South America interior
  if (lat > -50 && lat < 10 && lng > -75 && lng < -35) return false;
  // North America interior
  if (lat > 25 && lat < 60 && lng > -120 && lng < -60) return false;
  // India
  if (lat > 8 && lat < 35 && lng > 68 && lng < 88) return false;
  // China interior
  if (lat > 20 && lat < 50 && lng > 90 && lng < 125) return false;
  // Southeast Asia peninsula
  if (lat > 5 && lat < 25 && lng > 95 && lng < 110) return false;
  // Australia interior
  if (lat > -40 && lat < -12 && lng > 115 && lng < 150) return false;

  // Check if within known ocean regions
  for (const region of OCEAN_REGIONS) {
    if (region.west < region.east) {
      if (lng >= region.west && lng <= region.east &&
          lat >= region.south && lat <= region.north) {
        return true;
      }
    } else {
      // Wraps around antimeridian (Pacific)
      if ((lng >= region.west || lng <= region.east) &&
          lat >= region.south && lat <= region.north) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a coordinate is near a major river corridor.
 */
export function isNearRiver(lng: number, lat: number): boolean {
  for (const [rlng, rlat, radius] of RIVER_CORRIDORS) {
    const dist = Math.sqrt((lng - rlng) ** 2 + (lat - rlat) ** 2);
    if (dist < radius) return true;
  }
  return false;
}

/**
 * Classify terrain type for a single coordinate.
 */
export function classifyPointTerrain(lng: number, lat: number): 'land' | 'maritime' | 'river' {
  if (isOverWater(lng, lat)) return 'maritime';
  if (isNearRiver(lng, lat)) return 'river';
  return 'land';
}

/**
 * Classify the overall terrain type of a route based on its coordinates.
 * Returns 'mixed' if the route crosses multiple terrain types.
 */
export function classifyRouteTerrain(coordinates: number[][]): TerrainType {
  if (coordinates.length === 0) return 'land';

  const types = new Set<string>();
  for (const [lng, lat] of coordinates) {
    types.add(classifyPointTerrain(lng, lat));
  }

  if (types.size === 1) return types.values().next().value as TerrainType;
  return 'mixed';
}

/**
 * Classify terrain from the trade route's explicit route_type field.
 * Trade routes have 'land', 'maritime', 'river' in the TSV.
 */
export function terrainFromRouteType(routeType: string): TerrainType {
  switch (routeType) {
    case 'land': return 'land';
    case 'maritime': return 'maritime';
    case 'river': return 'river';
    default: return 'land';
  }
}

/**
 * Split a route's coordinates into segments by terrain type.
 * Each segment contains a continuous run of same-terrain coordinates.
 */
export function splitRouteByTerrain(coordinates: number[][]): RouteSegment[] {
  if (coordinates.length === 0) return [];
  if (coordinates.length === 1) {
    const [lng, lat] = coordinates[0];
    return [{
      coordinates: [[lng, lat] as [number, number]],
      terrainType: classifyPointTerrain(lng, lat),
    }];
  }

  const segments: RouteSegment[] = [];
  let currentType = classifyPointTerrain(coordinates[0][0], coordinates[0][1]);
  let currentCoords: [number, number][] = [[coordinates[0][0], coordinates[0][1]]];

  for (let i = 1; i < coordinates.length; i++) {
    const [lng, lat] = coordinates[i];
    const pointType = classifyPointTerrain(lng, lat);

    if (pointType !== currentType) {
      // Add overlap point for continuity
      currentCoords.push([lng, lat]);
      segments.push({ coordinates: currentCoords, terrainType: currentType });
      currentCoords = [[lng, lat]];
      currentType = pointType;
    } else {
      currentCoords.push([lng, lat]);
    }
  }

  if (currentCoords.length > 0) {
    segments.push({ coordinates: currentCoords, terrainType: currentType });
  }

  return segments;
}

/**
 * Estimate elevation at a point based on proximity to known mountain ranges.
 * Returns elevation in meters. This is a rough heuristic, not real DEM data.
 */
export function estimateElevation(lng: number, lat: number): number {
  if (isOverWater(lng, lat)) return 0;

  let maxInfluence = 0;

  for (const [mlng, mlat, radius, peak] of MOUNTAIN_RANGES) {
    const dist = Math.sqrt((lng - mlng) ** 2 + (lat - mlat) ** 2);
    if (dist < radius) {
      // Gaussian-like falloff from peak
      const influence = peak * Math.exp(-2 * (dist / radius) ** 2);
      maxInfluence = Math.max(maxInfluence, influence);
    }
  }

  // Base elevation: simple latitude/terrain heuristic
  const baseElevation = Math.max(50, 200 + Math.abs(lat) * 3);

  return Math.round(baseElevation + maxInfluence);
}

/**
 * Generate an elevation profile for a route.
 */
export function generateElevationProfile(coordinates: number[][]): ElevationProfile {
  if (coordinates.length === 0) {
    return { points: [], minElevation: 0, maxElevation: 0, totalDistance: 0, totalAscent: 0, totalDescent: 0 };
  }

  const points: ElevationPoint[] = [];
  let cumulativeDistance = 0;
  let totalAscent = 0;
  let totalDescent = 0;
  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let i = 0; i < coordinates.length; i++) {
    const [lng, lat] = coordinates[i];
    const elevation = estimateElevation(lng, lat);

    if (i > 0) {
      const [prevLng, prevLat] = coordinates[i - 1];
      cumulativeDistance += haversineDistance(prevLat, prevLng, lat, lng);
      const prevElev = points[i - 1].elevation;
      const diff = elevation - prevElev;
      if (diff > 0) totalAscent += diff;
      else totalDescent += Math.abs(diff);
    }

    minElevation = Math.min(minElevation, elevation);
    maxElevation = Math.max(maxElevation, elevation);

    points.push({ distance: cumulativeDistance, elevation, lat, lng });
  }

  return {
    points,
    minElevation: minElevation === Infinity ? 0 : minElevation,
    maxElevation: maxElevation === -Infinity ? 0 : maxElevation,
    totalDistance: cumulativeDistance,
    totalAscent,
    totalDescent,
  };
}

// ============================================================================
// Styling Utilities
// ============================================================================

export interface TerrainRouteStyle {
  dashArray?: string;
  weight: number;
  opacity: number;
  lineCap: 'butt' | 'round' | 'square';
  className?: string;
}

/**
 * Get terrain-specific line styling for a route segment.
 */
export function getTerrainStyle(terrainType: TerrainType): TerrainRouteStyle {
  switch (terrainType) {
    case 'maritime':
      return {
        dashArray: '8, 6',
        weight: 3,
        opacity: 0.8,
        lineCap: 'round',
      };
    case 'river':
      return {
        dashArray: '4, 4',
        weight: 2.5,
        opacity: 0.9,
        lineCap: 'round',
        className: 'route-river',
      };
    case 'land':
      return {
        weight: 3,
        opacity: 0.85,
        lineCap: 'round',
      };
    case 'mixed':
    default:
      return {
        weight: 3,
        opacity: 0.8,
        lineCap: 'round',
      };
  }
}

/**
 * Get an icon character for a terrain type (used in markers/legends).
 */
export function getTerrainIcon(terrainType: TerrainType): string {
  switch (terrainType) {
    case 'maritime': return '\u2693'; // anchor
    case 'river': return '\u{1F6F6}'; // canoe
    case 'land': return '\u{1F42A}'; // camel
    default: return '\u{1F5FA}'; // world map
  }
}

/**
 * Get a human-readable label for terrain type.
 */
export function getTerrainLabel(terrainType: TerrainType): string {
  switch (terrainType) {
    case 'maritime': return 'Sea Route';
    case 'river': return 'River Route';
    case 'land': return 'Land Route';
    case 'mixed': return 'Mixed Route';
  }
}
