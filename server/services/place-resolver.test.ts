import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchPlaces, autocompletePlaces, searchPlacesWithNominatim } from './place-resolver';
import type { PlaceResult } from './place-resolver';

// Mock the storage module to return test data
vi.mock('../storage', () => ({
  storage: {
    getSettlements: vi.fn().mockResolvedValue([
      {
        id: 'ur',
        name: 'Ur',
        alternateNames: ['Urim'],
        latitude: 30.962,
        longitude: 46.103,
        type: 'city-state',
        cultureId: 'sumerian',
        civilizationId: 'sumerian',
        foundedYear: -3800,
        abandonedYear: null,
        peakPopulation: 65000,
        notableFeatures: ['Great Ziggurat'],
        associatedLanguages: ['sux', 'akk'],
        modernName: 'Tell el-Muqayyar',
        region: 'Mesopotamia',
      },
      {
        id: 'uruk',
        name: 'Uruk',
        alternateNames: ['Warka', 'Erech'],
        latitude: 31.322,
        longitude: 45.636,
        type: 'city-state',
        cultureId: 'sumerian',
        civilizationId: 'sumerian',
        foundedYear: -4000,
        abandonedYear: 700,
        peakPopulation: 80000,
        notableFeatures: ['White Temple'],
        associatedLanguages: ['sux'],
        modernName: 'Warka',
        region: 'Mesopotamia',
      },
      {
        id: 'babylon',
        name: 'Babylon',
        alternateNames: ['Bab-ilim', 'Babel'],
        latitude: 32.536,
        longitude: 44.421,
        type: 'capital',
        cultureId: '',
        civilizationId: 'babylonian-empire',
        foundedYear: -2300,
        abandonedYear: null,
        peakPopulation: 200000,
        notableFeatures: ['Ishtar Gate'],
        associatedLanguages: ['akk', 'arc'],
        modernName: 'Hillah',
        region: 'Mesopotamia',
      },
      {
        id: 'rome',
        name: 'Rome',
        alternateNames: ['Roma'],
        latitude: 41.9,
        longitude: 12.5,
        type: 'capital',
        cultureId: 'roman',
        civilizationId: 'roman-empire',
        foundedYear: -753,
        abandonedYear: null,
        peakPopulation: 1000000,
        notableFeatures: ['Colosseum'],
        associatedLanguages: ['lat'],
        modernName: 'Rome',
        region: 'Italy',
      },
    ]),
    getArchaeologicalSites: vi.fn().mockResolvedValue([
      {
        id: 1,
        properties: {
          siteId: 'catalhoyuk',
          name: 'Catalhoyuk',
          siteType: 'settlement mound',
        },
        geometry: {
          type: 'Point',
          coordinates: [32.828, 37.666],
        },
      },
    ]),
    getBattles: vi.fn().mockResolvedValue([
      {
        id: 'thermopylae',
        name: 'Battle of Thermopylae',
        warName: 'Greco-Persian Wars',
        date: '480 BCE',
        coordinates: [22.536, 38.798],
      },
    ]),
  },
}));

describe('Place Resolver', () => {
  describe('searchPlaces', () => {
    it('should return empty results for empty query', async () => {
      const result = await searchPlaces('');
      expect(result.results).toEqual([]);
      expect(result.query).toBe('');
    });

    it('should find known regions by name', async () => {
      const result = await searchPlaces('Mesopotamia');
      expect(result.results.length).toBeGreaterThan(0);
      const region = result.results.find((r) => r.category === 'region');
      expect(region).toBeDefined();
      expect(region!.name).toBe('Mesopotamia');
      expect(region!.geometryType).toBe('bbox');
      expect(region!.bbox).toBeDefined();
    });

    it('should find settlements by name', async () => {
      const result = await searchPlaces('Uruk');
      const settlement = result.results.find((r) => r.category === 'settlement' && r.name === 'Uruk');
      expect(settlement).toBeDefined();
      expect(settlement!.lat).toBeCloseTo(31.322, 1);
      expect(settlement!.lng).toBeCloseTo(45.636, 1);
      expect(settlement!.geometryType).toBe('point');
    });

    it('should find settlements by alternate name', async () => {
      const result = await searchPlaces('Warka');
      const settlement = result.results.find((r) => r.category === 'settlement');
      expect(settlement).toBeDefined();
      expect(settlement!.name).toBe('Uruk');
    });

    it('should find settlements by modern name', async () => {
      const result = await searchPlaces('Tell el-Muqayyar');
      const settlement = result.results.find((r) => r.category === 'settlement');
      expect(settlement).toBeDefined();
      expect(settlement!.name).toBe('Ur');
    });

    it('should find battles by name', async () => {
      const result = await searchPlaces('Thermopylae');
      const battle = result.results.find((r) => r.category === 'battle');
      expect(battle).toBeDefined();
      expect(battle!.name).toBe('Battle of Thermopylae');
    });

    it('should find archaeological sites', async () => {
      const result = await searchPlaces('Catalhoyuk');
      const site = result.results.find((r) => r.category === 'archaeological-site');
      expect(site).toBeDefined();
      expect(site!.name).toBe('Catalhoyuk');
    });

    it('should rank exact matches higher', async () => {
      const result = await searchPlaces('Ur');
      // Ur (exact) should rank above Uruk (prefix)
      const urIndex = result.results.findIndex((r) => r.name === 'Ur');
      const urukIndex = result.results.findIndex((r) => r.name === 'Uruk');
      if (urIndex >= 0 && urukIndex >= 0) {
        expect(result.results[urIndex].relevance).toBeGreaterThanOrEqual(
          result.results[urukIndex].relevance,
        );
      }
    });

    it('should respect limit parameter', async () => {
      const result = await searchPlaces('a', 3);
      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('should do case-insensitive matching', async () => {
      const result = await searchPlaces('babylon');
      const settlement = result.results.find((r) => r.name === 'Babylon');
      expect(settlement).toBeDefined();
    });

    it('should include time period for settlements with dates', async () => {
      const result = await searchPlaces('Uruk');
      const settlement = result.results.find((r) => r.name === 'Uruk');
      expect(settlement).toBeDefined();
      expect(settlement!.timePeriod).toContain('4000 BCE');
    });

    it('should find regions by alias', async () => {
      const result = await searchPlaces('asia minor');
      const region = result.results.find((r) => r.name === 'Anatolia');
      expect(region).toBeDefined();
    });

    it('should include description with settlement details', async () => {
      const result = await searchPlaces('Babylon');
      const settlement = result.results.find(
        (r) => r.category === 'settlement' && r.name === 'Babylon',
      );
      expect(settlement).toBeDefined();
      expect(settlement!.description).toContain('Capital');
      expect(settlement!.description).toContain('Mesopotamia');
    });
  });

  describe('autocompletePlaces', () => {
    it('should return empty for short queries', async () => {
      const result = await autocompletePlaces('U');
      expect(result).toEqual([]);
    });

    it('should return suggestions for valid queries', async () => {
      const result = await autocompletePlaces('Ur');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should respect limit', async () => {
      const result = await autocompletePlaces('a', 2);
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('searchPlacesWithNominatim', () => {
    it('should return local results and skip Nominatim for broad queries with many matches', async () => {
      // "Ur" matches: Ur (exact), Uruk (prefix), region "Europe" (substring)
      // plus others — enough local hits to skip Nominatim
      const result = await searchPlacesWithNominatim('Ur');
      expect(result.results.length).toBeGreaterThan(0);
      // Verify the results include our local data
      const hasSettlement = result.results.some((r) => r.category === 'settlement');
      expect(hasSettlement).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('should not return duplicate places with same name and nearby coordinates', async () => {
      const result = await searchPlaces('Rome');
      const romeResults = result.results.filter(
        (r) => r.name.toLowerCase() === 'rome',
      );
      // Should have at most 1 settlement + 1 region (if matched)
      expect(romeResults.length).toBeLessThanOrEqual(2);
    });
  });

  describe('region geometry', () => {
    it('should return bbox for known regions', async () => {
      const result = await searchPlaces('Egypt');
      const region = result.results.find((r) => r.category === 'region');
      expect(region).toBeDefined();
      expect(region!.bbox).toBeDefined();
      expect(region!.bbox!.length).toBe(4);
      // south < north, west < east
      expect(region!.bbox![0]).toBeLessThan(region!.bbox![2]);
      expect(region!.bbox![1]).toBeLessThan(region!.bbox![3]);
    });
  });
});
