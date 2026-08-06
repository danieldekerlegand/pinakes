import type { MapFeatureExtractionResult } from '@/lib/map/feature-extraction-types';

// ============================================================================
// Types
// ============================================================================

export interface ReviewableFeature {
  id: string;
  type: 'settlement' | 'boundary' | 'route' | 'label';
  name: string;
  accepted: boolean;
  visible: boolean;
  confidence: number;
  data: Record<string, unknown>;
}

export interface FeatureExtractionState {
  isExtracting: boolean;
  extractionResult: MapFeatureExtractionResult | null;
  reviewableFeatures: ReviewableFeature[];
  error: string | null;
  mapDescription: string;
  estimatedTimePeriod: string;
  estimatedRegion: string;
}

// ============================================================================
// Pure utility functions
// ============================================================================

export function createInitialExtractionState(): FeatureExtractionState {
  return {
    isExtracting: false,
    extractionResult: null,
    reviewableFeatures: [],
    error: null,
    mapDescription: '',
    estimatedTimePeriod: '',
    estimatedRegion: '',
  };
}

export function resultToReviewableFeatures(result: MapFeatureExtractionResult): ReviewableFeature[] {
  const features: ReviewableFeature[] = [];
  let id = 0;

  for (const s of result.settlements) {
    features.push({
      id: `ext-${++id}`,
      type: 'settlement',
      name: s.name,
      accepted: s.confidence >= 0.7,
      visible: true,
      confidence: s.confidence,
      data: { lat: s.lat, lng: s.lng, settlementType: s.type },
    });
  }

  for (const b of result.boundaries) {
    features.push({
      id: `ext-${++id}`,
      type: 'boundary',
      name: b.name,
      accepted: b.confidence >= 0.7,
      visible: true,
      confidence: b.confidence,
      data: { coordinates: b.coordinates, boundaryType: b.type },
    });
  }

  for (const r of result.routes) {
    features.push({
      id: `ext-${++id}`,
      type: 'route',
      name: r.name,
      accepted: r.confidence >= 0.7,
      visible: true,
      confidence: r.confidence,
      data: { waypoints: r.waypoints, routeType: r.type },
    });
  }

  for (const l of result.labels) {
    features.push({
      id: `ext-${++id}`,
      type: 'label',
      name: l.text,
      accepted: l.confidence >= 0.7,
      visible: true,
      confidence: l.confidence,
      data: { lat: l.lat, lng: l.lng, category: l.category },
    });
  }

  return features;
}
