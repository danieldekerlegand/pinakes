import { describe, it, expect } from 'vitest';
import {
  CURATED_TOURS,
  formatTourYear,
  getTourTimeSpanLabel,
  getTourStepCount,
  getTourById,
} from './story-mode-data';
import type { HistoricalTour, TourStep } from './story-mode-data';

// ── formatTourYear ───────────────────────────────────────────────────

describe('formatTourYear', () => {
  it('formats BCE years with positive display', () => {
    expect(formatTourYear(-3500)).toBe('3500 BCE');
    expect(formatTourYear(-1)).toBe('1 BCE');
  });

  it('formats CE years', () => {
    expect(formatTourYear(0)).toBe('0 CE');
    expect(formatTourYear(1200)).toBe('1200 CE');
    expect(formatTourYear(2000)).toBe('2000 CE');
  });
});

// ── getTourTimeSpanLabel ─────────────────────────────────────────────

describe('getTourTimeSpanLabel', () => {
  it('returns formatted time span', () => {
    const tour = CURATED_TOURS.find((t) => t.id === 'mesopotamia-rise')!;
    expect(getTourTimeSpanLabel(tour)).toBe('5000 BCE \u2013 539 BCE');
  });

  it('handles mixed BCE/CE spans', () => {
    const tour = CURATED_TOURS.find((t) => t.id === 'silk-road')!;
    expect(getTourTimeSpanLabel(tour)).toBe('200 BCE \u2013 1400 CE');
  });
});

// ── getTourStepCount ─────────────────────────────────────────────────

describe('getTourStepCount', () => {
  it('returns step count for each tour', () => {
    for (const tour of CURATED_TOURS) {
      expect(getTourStepCount(tour)).toBe(tour.steps.length);
      expect(getTourStepCount(tour)).toBeGreaterThanOrEqual(5);
    }
  });
});

// ── getTourById ──────────────────────────────────────────────────────

describe('getTourById', () => {
  it('finds existing tours', () => {
    expect(getTourById('mesopotamia-rise')?.title).toBe('Rise of Civilization in Mesopotamia');
    expect(getTourById('silk-road')?.title).toBe('The Silk Road');
    expect(getTourById('austronesian-migration')?.title).toBe('Austronesian Migration');
  });

  it('returns undefined for non-existent tour', () => {
    expect(getTourById('nonexistent')).toBeUndefined();
  });
});

// ── CURATED_TOURS catalog validation ─────────────────────────────────

describe('CURATED_TOURS', () => {
  it('contains exactly 5 tours', () => {
    expect(CURATED_TOURS).toHaveLength(5);
  });

  it('each tour has a unique id', () => {
    const ids = CURATED_TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each tour has required metadata', () => {
    for (const tour of CURATED_TOURS) {
      expect(tour.id).toBeTruthy();
      expect(tour.title).toBeTruthy();
      expect(tour.description.length).toBeGreaterThan(20);
      expect(tour.coverRegion).toBeTruthy();
      expect(tour.timeSpan).toHaveLength(2);
      expect(tour.timeSpan[0]).toBeLessThan(tour.timeSpan[1]);
    }
  });

  it('each tour has at least 5 steps', () => {
    for (const tour of CURATED_TOURS) {
      expect(tour.steps.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('steps have valid coordinates', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        const [lat, lng] = step.center;
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
      }
    }
  });

  it('steps have valid zoom levels', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        expect(step.zoom).toBeGreaterThanOrEqual(1);
        expect(step.zoom).toBeLessThanOrEqual(18);
      }
    }
  });

  it('steps have non-empty narration', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        expect(step.narration.length).toBeGreaterThan(50);
      }
    }
  });

  it('steps have at least one layer', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        expect(step.layers.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('step time years are within tour time span', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        expect(step.timeYear).toBeGreaterThanOrEqual(tour.timeSpan[0]);
        expect(step.timeYear).toBeLessThanOrEqual(tour.timeSpan[1]);
      }
    }
  });

  it('steps are in roughly chronological order', () => {
    for (const tour of CURATED_TOURS) {
      for (let i = 1; i < tour.steps.length; i++) {
        // Allow equal years but not going backwards significantly
        expect(tour.steps[i].timeYear).toBeGreaterThanOrEqual(tour.steps[i - 1].timeYear - 200);
      }
    }
  });

  it('includes the 5 required tours', () => {
    const ids = CURATED_TOURS.map((t) => t.id);
    expect(ids).toContain('mesopotamia-rise');
    expect(ids).toContain('indo-european-expansion');
    expect(ids).toContain('silk-road');
    expect(ids).toContain('austronesian-migration');
    expect(ids).toContain('mediterranean-world');
  });
});

// ── Tour step layer references ───────────────────────────────────────

describe('Tour step layers', () => {
  const VALID_LAYER_IDS = new Set([
    'language-ranges', 'language-range-polygons', 'archaeological-sites',
    'archaeological-cultures', 'civilizations', 'routes', 'battles',
    'settlements', 'cuisines', 'music', 'dance', 'religions', 'mythology',
    'material-culture', 'material-culture-heatmap', 'foodway-events',
    'kinship-systems', 'architectural-styles', 'ingredient-origins',
    'cooking-techniques', 'haplogroups', 'language-contacts',
    'genetic-linguistic-correlation', 'urheimat-hypotheses',
  ]);

  it('all referenced layers are valid layer IDs', () => {
    for (const tour of CURATED_TOURS) {
      for (const step of tour.steps) {
        for (const layerId of step.layers) {
          expect(VALID_LAYER_IDS.has(layerId)).toBe(true);
        }
      }
    }
  });
});
