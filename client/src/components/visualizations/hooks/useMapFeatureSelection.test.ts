import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeFeatureParam,
  decodeFeatureParam,
  findFeatureById,
  findFeatureByTypeAndId,
} from './useMapFeatureSelection';
import type { FeatureLookupCollections } from './useMapFeatureSelection';

// ---------------------------------------------------------------------------
// URL param encoding / decoding
// ---------------------------------------------------------------------------

describe('encodeFeatureParam', () => {
  it('encodes type and id separated by colon', () => {
    expect(encodeFeatureParam('civilization', 'civ-001')).toBe('civilization:civ-001');
  });

  it('encodes special characters in id', () => {
    const result = encodeFeatureParam('route', 'silk road & spice');
    expect(result).toBe('route:silk%20road%20%26%20spice');
  });
});

describe('decodeFeatureParam', () => {
  it('returns null for null input', () => {
    expect(decodeFeatureParam(null)).toBeNull();
  });

  it('returns null for string without colon', () => {
    expect(decodeFeatureParam('nocolon')).toBeNull();
  });

  it('returns null for string with colon at position 0', () => {
    expect(decodeFeatureParam(':id')).toBeNull();
  });

  it('decodes a valid param', () => {
    const result = decodeFeatureParam('civilization:civ-001');
    expect(result).toEqual({ featureType: 'civilization', featureId: 'civ-001' });
  });

  it('decodes encoded characters in id', () => {
    const result = decodeFeatureParam('route:silk%20road%20%26%20spice');
    expect(result).toEqual({ featureType: 'route', featureId: 'silk road & spice' });
  });

  it('handles colons in the id portion', () => {
    const result = decodeFeatureParam('type:id:with:colons');
    expect(result).toEqual({ featureType: 'type', featureId: 'id:with:colons' });
  });
});

// ---------------------------------------------------------------------------
// Feature lookup
// ---------------------------------------------------------------------------

function makeCollections(): FeatureLookupCollections {
  return {
    languageRanges: [
      { id: 'lr-1', properties: { languageId: 'lang-001', languageName: 'Test Language' } } as any,
    ],
    civilizations: [
      { id: 'civ-1', properties: { civilizationId: 'civ-001', name: 'Test Civilization' } } as any,
    ],
    routes: [
      { id: 'rt-1', properties: { routeId: 'route-001', name: 'Silk Road' } } as any,
    ],
    cuisines: [
      { id: 'cuisine-001', name: 'Thai' } as any,
    ],
    battles: [
      { id: 'battle-001', name: 'Battle of Kadesh' } as any,
    ],
  };
}

describe('findFeatureById', () => {
  const collections = makeCollections();

  it('finds a language range by its languageId property', () => {
    const result = findFeatureById('lang-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('language-range');
  });

  it('finds a civilization by its civilizationId property', () => {
    const result = findFeatureById('civ-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('civilization');
  });

  it('finds a route by its routeId property', () => {
    const result = findFeatureById('route-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('route');
  });

  it('finds a cuisine by its id', () => {
    const result = findFeatureById('cuisine-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('cuisine');
  });

  it('finds a battle by its id', () => {
    const result = findFeatureById('battle-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('battle');
  });

  it('returns null for unknown id', () => {
    const result = findFeatureById('nonexistent', collections);
    expect(result).toBeNull();
  });

  it('returns null when all collections are empty', () => {
    const result = findFeatureById('any-id', {});
    expect(result).toBeNull();
  });
});

describe('findFeatureByTypeAndId', () => {
  const collections = makeCollections();

  it('finds a feature by type hint and id', () => {
    const result = findFeatureByTypeAndId('civilization', 'civ-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('civilization');
  });

  it('falls back to global search when type hint has no collection', () => {
    const result = findFeatureByTypeAndId('unknown-type', 'cuisine-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('cuisine');
  });

  it('falls back to global search when id not found in hinted collection', () => {
    // cuisine-001 won't be found in the civilization collection
    const result = findFeatureByTypeAndId('civilization', 'cuisine-001', collections);
    expect(result).not.toBeNull();
    expect(result!.featureType).toBe('cuisine');
  });

  it('returns null when feature does not exist anywhere', () => {
    const result = findFeatureByTypeAndId('civilization', 'nonexistent', collections);
    expect(result).toBeNull();
  });
});
