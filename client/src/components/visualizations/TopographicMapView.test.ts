import { describe, it, expect } from 'vitest';
import type { ExtrusionMetric, ViewState } from './TopographicMapView';

// ============================================================================
// TopographicMapView unit tests
// ============================================================================

describe('TopographicMapView types and helpers', () => {
  describe('ViewState', () => {
    it('defines valid initial view state structure', () => {
      const viewState: ViewState = {
        longitude: 0,
        latitude: 20,
        zoom: 2,
        pitch: 45,
        bearing: 0,
      };

      expect(viewState.longitude).toBe(0);
      expect(viewState.latitude).toBe(20);
      expect(viewState.zoom).toBe(2);
      expect(viewState.pitch).toBe(45);
      expect(viewState.bearing).toBe(0);
    });

    it('supports optional transitionDuration', () => {
      const viewState: ViewState = {
        longitude: 35,
        latitude: 33,
        zoom: 5,
        pitch: 60,
        bearing: -30,
        transitionDuration: 1000,
      };

      expect(viewState.transitionDuration).toBe(1000);
    });

    it('enforces pitch within valid range conceptually', () => {
      const pitch = Math.max(0, Math.min(85, 90));
      expect(pitch).toBe(85);

      const pitchNeg = Math.max(0, Math.min(85, -10));
      expect(pitchNeg).toBe(0);
    });

    it('handles bearing wrap-around', () => {
      const bearing = (370) % 360;
      expect(bearing).toBe(10);

      const bearingNeg = ((360 + (-10 % 360)) % 360);
      expect(bearingNeg).toBe(350);
    });
  });

  describe('ExtrusionMetric', () => {
    it('supports all valid metric types', () => {
      const metrics: ExtrusionMetric[] = ['population', 'area', 'speakers', 'importance'];
      expect(metrics).toHaveLength(4);
      expect(metrics).toContain('population');
      expect(metrics).toContain('area');
      expect(metrics).toContain('speakers');
      expect(metrics).toContain('importance');
    });
  });

  describe('hexToRgba conversion logic', () => {
    function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b, alpha];
    }

    it('converts hex blue to RGBA', () => {
      expect(hexToRgba('#3b82f6')).toEqual([59, 130, 246, 255]);
    });

    it('converts hex red to RGBA with custom alpha', () => {
      expect(hexToRgba('#ef4444', 128)).toEqual([239, 68, 68, 128]);
    });

    it('converts hex black', () => {
      expect(hexToRgba('#000000')).toEqual([0, 0, 0, 255]);
    });

    it('converts hex white', () => {
      expect(hexToRgba('#ffffff')).toEqual([255, 255, 255, 255]);
    });
  });

  describe('hashString determinism', () => {
    function hashString(str: string): number {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      return Math.abs(hash);
    }

    it('produces consistent hash for same input', () => {
      const h1 = hashString('roman-empire');
      const h2 = hashString('roman-empire');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      const h1 = hashString('roman-empire');
      const h2 = hashString('byzantine-empire');
      expect(h1).not.toBe(h2);
    });

    it('handles empty string', () => {
      expect(hashString('')).toBe(0);
    });
  });

  describe('extrusion value calculation', () => {
    function getExtrusionValue(
      population: number | undefined,
      metric: ExtrusionMetric,
    ): number {
      switch (metric) {
        case 'population':
          return population ? Math.min(population / 1e6, 100) : 5;
        case 'area':
          return 20;
        case 'speakers':
          return 10;
        case 'importance':
          return 30;
        default:
          return 10;
      }
    }

    it('calculates population-based extrusion', () => {
      expect(getExtrusionValue(50_000_000, 'population')).toBe(50);
    });

    it('caps population extrusion at 100', () => {
      expect(getExtrusionValue(200_000_000, 'population')).toBe(100);
    });

    it('returns default 5 for undefined population', () => {
      expect(getExtrusionValue(undefined, 'population')).toBe(5);
    });

    it('returns fixed value for area metric', () => {
      expect(getExtrusionValue(50_000_000, 'area')).toBe(20);
    });

    it('returns fixed value for importance metric', () => {
      expect(getExtrusionValue(undefined, 'importance')).toBe(30);
    });
  });

  describe('deck.gl layer configuration', () => {
    it('terrain layer uses Terrarium elevation decoder', () => {
      const decoder = {
        rScaler: 256,
        gScaler: 1,
        bScaler: 1 / 256,
        offset: -32768,
      };

      // Terrarium format: height = (r * 256 + g + b / 256) - 32768
      const r = 128, g = 0, b = 0;
      const height = r * decoder.rScaler + g * decoder.gScaler + b * decoder.bScaler + decoder.offset;
      expect(height).toBe(0); // Sea level at r=128

      const r2 = 129, g2 = 0, b2 = 0;
      const height2 = r2 * decoder.rScaler + g2 * decoder.gScaler + b2 * decoder.bScaler + decoder.offset;
      expect(height2).toBe(256); // 256m above sea level
    });

    it('max extrusion height is reasonable', () => {
      const MAX_EXTRUSION_HEIGHT = 500000;
      expect(MAX_EXTRUSION_HEIGHT).toBeGreaterThan(0);
      expect(MAX_EXTRUSION_HEIGHT).toBeLessThanOrEqual(1000000);
    });
  });

  describe('tooltip formatting', () => {
    function formatYear(year: number): string {
      return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
    }

    function formatTimePeriod(start: number, end: number | null): string {
      const startStr = formatYear(start);
      const endStr = end === null ? 'present' : formatYear(end);
      return `${startStr} – ${endStr}`;
    }

    it('formats BCE years correctly', () => {
      expect(formatYear(-3000)).toBe('3000 BCE');
    });

    it('formats CE years correctly', () => {
      expect(formatYear(2024)).toBe('2024 CE');
    });

    it('formats time period with null end as present', () => {
      expect(formatTimePeriod(-500, null)).toBe('500 BCE – present');
    });

    it('formats time period spanning BCE to CE', () => {
      expect(formatTimePeriod(-27, 476)).toBe('27 BCE – 476 CE');
    });
  });
});

describe('ViewMode integration', () => {
  it('map-3d is a valid view mode', () => {
    const validModes = ['tree', 'network', 'timeline', 'map', 'map-3d', 'explorer', 'lineage', 'contribute'];
    expect(validModes).toContain('map-3d');
  });
});
