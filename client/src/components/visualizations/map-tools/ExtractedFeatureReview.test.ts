import { describe, it, expect } from 'vitest';
import {
  resultToReviewableFeatures,
  createInitialExtractionState,
} from './extracted-feature-utils';
import type { MapFeatureExtractionResult } from '../../../../../server/services/map-image-analyzer';

describe('createInitialExtractionState', () => {
  it('returns a clean initial state', () => {
    const state = createInitialExtractionState();
    expect(state.isExtracting).toBe(false);
    expect(state.extractionResult).toBeNull();
    expect(state.reviewableFeatures).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.mapDescription).toBe('');
    expect(state.estimatedTimePeriod).toBe('');
    expect(state.estimatedRegion).toBe('');
  });
});

describe('resultToReviewableFeatures', () => {
  it('converts settlements to reviewable features', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [
        { name: 'Rome', lat: 41.9, lng: 12.5, type: 'city', confidence: 0.95 },
        { name: 'Pompeii', lat: 40.75, lng: 14.49, type: 'town', confidence: 0.4 },
      ],
      boundaries: [],
      routes: [],
      labels: [],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features).toHaveLength(2);

    // High confidence: auto-accepted
    expect(features[0].type).toBe('settlement');
    expect(features[0].name).toBe('Rome');
    expect(features[0].accepted).toBe(true);
    expect(features[0].visible).toBe(true);
    expect(features[0].data.lat).toBe(41.9);
    expect(features[0].data.lng).toBe(12.5);
    expect(features[0].data.settlementType).toBe('city');

    // Low confidence: not auto-accepted
    expect(features[1].name).toBe('Pompeii');
    expect(features[1].accepted).toBe(false);
  });

  it('converts boundaries to reviewable features', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [],
      boundaries: [
        {
          name: 'Roman Empire',
          coordinates: [
            [40, 10],
            [50, 10],
            [50, 30],
            [40, 30],
          ],
          type: 'empire',
          confidence: 0.85,
        },
      ],
      routes: [],
      labels: [],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features).toHaveLength(1);
    expect(features[0].type).toBe('boundary');
    expect(features[0].name).toBe('Roman Empire');
    expect(features[0].accepted).toBe(true);
    expect(features[0].data.boundaryType).toBe('empire');
    expect((features[0].data.coordinates as number[][]).length).toBe(4);
  });

  it('converts routes to reviewable features', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [],
      boundaries: [],
      routes: [
        {
          name: 'Silk Road',
          waypoints: [
            [35, 30],
            [38, 55],
            [40, 80],
          ],
          type: 'trade',
          confidence: 0.75,
        },
      ],
      labels: [],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features).toHaveLength(1);
    expect(features[0].type).toBe('route');
    expect(features[0].name).toBe('Silk Road');
    expect(features[0].accepted).toBe(true);
    expect(features[0].data.routeType).toBe('trade');
  });

  it('converts labels to reviewable features', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [],
      boundaries: [],
      routes: [],
      labels: [
        { text: 'Mediterranean Sea', lat: 35, lng: 18, category: 'water', confidence: 0.9 },
        { text: 'Unclear Text', lat: 42, lng: 25, category: 'unknown', confidence: 0.3 },
      ],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features).toHaveLength(2);
    expect(features[0].type).toBe('label');
    expect(features[0].name).toBe('Mediterranean Sea');
    expect(features[0].accepted).toBe(true);
    expect(features[1].name).toBe('Unclear Text');
    expect(features[1].accepted).toBe(false);
  });

  it('assigns unique IDs to all features', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [
        { name: 'A', lat: 40, lng: 30, type: 'city', confidence: 0.9 },
      ],
      boundaries: [
        {
          name: 'B',
          coordinates: [
            [40, 30],
            [41, 30],
            [41, 31],
          ],
          type: 'region',
          confidence: 0.8,
        },
      ],
      routes: [
        {
          name: 'C',
          waypoints: [
            [40, 30],
            [42, 32],
          ],
          type: 'trade',
          confidence: 0.7,
        },
      ],
      labels: [
        { text: 'D', lat: 40, lng: 30, category: 'place', confidence: 0.6 },
      ],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    const ids = features.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('handles empty result', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [],
      boundaries: [],
      routes: [],
      labels: [],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features).toEqual([]);
  });

  it('auto-accepts features with confidence >= 0.7', () => {
    const result: MapFeatureExtractionResult = {
      settlements: [
        { name: 'High', lat: 40, lng: 30, type: 'city', confidence: 0.7 },
        { name: 'Low', lat: 41, lng: 31, type: 'town', confidence: 0.69 },
      ],
      boundaries: [],
      routes: [],
      labels: [],
      mapDescription: '',
      estimatedTimePeriod: '',
      estimatedRegion: '',
    };

    const features = resultToReviewableFeatures(result);
    expect(features[0].accepted).toBe(true);
    expect(features[1].accepted).toBe(false);
  });
});
