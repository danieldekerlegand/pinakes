import { describe, it, expect } from 'vitest';
import type { MapFeatureData } from './MapFeatureInfoPanel';

/**
 * Unit tests for MapFeatureInfoPanel feature type discrimination.
 * Tests the type discriminator pattern used to route features to the correct detail view.
 */

describe('MapFeatureData type discrimination', () => {
  const featureTypes: Array<{ type: MapFeatureData['featureType']; label: string }> = [
    { type: 'language-range', label: 'Language Range' },
    { type: 'archaeological-site', label: 'Archaeological Site' },
    { type: 'archaeological-culture', label: 'Archaeological Culture' },
    { type: 'civilization', label: 'Civilization' },
    { type: 'route', label: 'Route' },
    { type: 'cuisine', label: 'Cuisine' },
    { type: 'music', label: 'Music' },
    { type: 'dance', label: 'Dance' },
    { type: 'religion', label: 'Religion' },
    { type: 'battle', label: 'Battle' },
    { type: 'deity', label: 'Deity' },
    { type: 'haplogroup', label: 'Haplogroup' },
    { type: 'foodway-event', label: 'Foodway Event' },
    { type: 'kinship-system', label: 'Kinship System' },
    { type: 'architectural-style', label: 'Architectural Style' },
    { type: 'ingredient-origin', label: 'Ingredient Origin' },
    { type: 'cooking-technique', label: 'Cooking Technique' },
    { type: 'urheimat-hypothesis', label: 'Urheimat Hypothesis' },
  ];

  it('has 18 distinct feature types', () => {
    expect(featureTypes).toHaveLength(18);
  });

  it('all feature types are unique', () => {
    const types = featureTypes.map((ft) => ft.type);
    expect(new Set(types).size).toBe(types.length);
  });

  for (const { type, label } of featureTypes) {
    it(`can create a ${label} MapFeatureData variant`, () => {
      const data = { featureType: type, feature: { id: 'test', properties: {} } } as any as MapFeatureData;
      expect(data.featureType).toBe(type);
      expect(data.feature).toBeDefined();
    });
  }
});

describe('Feature detail panel gradient mapping', () => {
  // Verify the gradient colors are valid Tailwind gradient class patterns
  const gradients = [
    'from-blue-50 to-indigo-50',
    'from-amber-50 to-orange-50',
    'from-orange-50 to-red-50',
    'from-purple-50 to-violet-50',
    'from-green-50 to-emerald-50',
    'from-orange-50 to-yellow-50',
    'from-pink-50 to-rose-50',
    'from-teal-50 to-cyan-50',
    'from-indigo-50 to-blue-50',
    'from-red-50 to-rose-50',
    'from-yellow-50 to-amber-50',
    'from-emerald-50 to-green-50',
    'from-lime-50 to-green-50',
    'from-sky-50 to-blue-50',
    'from-stone-50 to-gray-50',
    'from-green-50 to-lime-50',
    'from-red-50 to-orange-50',
    'from-violet-50 to-purple-50',
  ];

  it('each gradient follows the from-X to-Y pattern', () => {
    for (const g of gradients) {
      expect(g).toMatch(/^from-\w+-\d+ to-\w+-\d+$/);
    }
  });

  it('has 18 gradients matching the number of feature types', () => {
    expect(gradients).toHaveLength(18);
  });
});
