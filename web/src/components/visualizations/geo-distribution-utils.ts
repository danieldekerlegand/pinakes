// Utility types and functions for GeoDistributionMap
// Extracted to a .ts file so they can be tested without JSX parsing

export interface GeoDataPoint {
  lat: number;
  lng: number;
}

export interface MarkerStyle {
  fillColor: string;
  fillOpacity: number;
  color: string;
  weight: number;
  radius: number;
}

export interface LegendItem {
  label: string;
  color: string;
}

export function computeCenter(points: GeoDataPoint[]): [number, number] {
  if (points.length === 0) return [20, 0];
  const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const avgLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return [avgLat, avgLng];
}

export function computeBounds(points: GeoDataPoint[]): [number, number][] {
  return points.map((p) => [p.lat, p.lng]);
}
