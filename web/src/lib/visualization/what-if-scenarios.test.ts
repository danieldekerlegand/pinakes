import { describe, it, expect } from 'vitest';
import {
  parseScenarios,
  loadScenarios,
  getScenarioById,
  toggleScenario,
  affectedLayersFor,
  scenarioAppliesAtYear,
  SCENARIO_BANNER_TEXT,
  type WhatIfScenario,
} from './what-if-scenarios';

const VALID_RAW = {
  scenarios: [
    {
      id: 'test-scenario',
      title: 'What if X?',
      summary: 'A test',
      category: 'counterfactual',
      affectedLayers: ['civilizations', 'routes'],
      timeRange: { start: -1200, end: -800 },
      overlays: [
        { id: 'poly', kind: 'polygon', label: 'P', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        { id: 'line', kind: 'line', label: 'L', coordinates: [[0, 0], [1, 1]] },
        { id: 'mark', kind: 'marker', label: 'M', coordinates: [10, 20] },
      ],
      sources: ['src'],
    },
  ],
};

describe('parseScenarios', () => {
  it('parses a valid scenario with all overlay kinds', () => {
    const s = parseScenarios(VALID_RAW);
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe('test-scenario');
    expect(s[0].overlays.map((o) => o.kind)).toEqual(['polygon', 'line', 'marker']);
    expect(s[0].affectedLayers).toEqual(['civilizations', 'routes']);
    expect(s[0].timeRange).toEqual({ start: -1200, end: -800 });
  });

  it('accepts a bare array as well as { scenarios: [...] }', () => {
    expect(parseScenarios(VALID_RAW.scenarios)).toHaveLength(1);
  });

  it('drops scenarios missing id or title', () => {
    expect(parseScenarios({ scenarios: [{ title: 'no id', overlays: VALID_RAW.scenarios[0].overlays }] })).toHaveLength(0);
    expect(parseScenarios({ scenarios: [{ id: 'no-title', overlays: VALID_RAW.scenarios[0].overlays }] })).toHaveLength(0);
  });

  it('drops scenarios with no valid overlays', () => {
    expect(parseScenarios({ scenarios: [{ id: 'x', title: 'T', overlays: [] }] })).toHaveLength(0);
  });

  it('drops invalid overlays but keeps valid ones', () => {
    const s = parseScenarios({
      scenarios: [
        {
          id: 'mixed',
          title: 'T',
          overlays: [
            { id: 'bad-marker', kind: 'marker', label: 'M', coordinates: [1] },
            { id: 'bad-line', kind: 'line', label: 'L', coordinates: [[1, 2]] },
            { id: 'bad-poly', kind: 'polygon', label: 'P', coordinates: [[[0, 0], [1, 1]]] },
            { id: 'nonsense-kind', kind: 'wormhole', label: 'W', coordinates: [1, 2] },
            { id: 'good', kind: 'marker', label: 'G', coordinates: [5, 6] },
          ],
        },
      ],
    });
    expect(s).toHaveLength(1);
    expect(s[0].overlays.map((o) => o.id)).toEqual(['good']);
  });

  it('deduplicates scenarios by id (first wins)', () => {
    const dup = { ...VALID_RAW.scenarios[0], summary: 'second' };
    const s = parseScenarios({ scenarios: [VALID_RAW.scenarios[0], dup] });
    expect(s).toHaveLength(1);
    expect(s[0].summary).toBe('A test');
  });

  it('normalizes a missing / partial time range to nulls', () => {
    const s = parseScenarios({
      scenarios: [{ id: 'nr', title: 'T', overlays: [{ id: 'm', kind: 'marker', label: 'M', coordinates: [0, 0] }] }],
    });
    expect(s[0].timeRange).toEqual({ start: null, end: null });
  });

  it('returns [] for junk input', () => {
    expect(parseScenarios(null)).toEqual([]);
    expect(parseScenarios(42)).toEqual([]);
    expect(parseScenarios({})).toEqual([]);
  });
});

describe('loadScenarios (bundled data)', () => {
  it('loads the authored scenarios and they all validate', () => {
    const s = loadScenarios();
    expect(s.length).toBeGreaterThanOrEqual(1);
    for (const sc of s) {
      expect(sc.overlays.length).toBeGreaterThan(0);
      expect(sc.title.length).toBeGreaterThan(0);
    }
  });
});

describe('getScenarioById', () => {
  const scenarios = parseScenarios(VALID_RAW);
  it('finds by id', () => {
    expect(getScenarioById(scenarios, 'test-scenario')?.id).toBe('test-scenario');
  });
  it('returns null for unknown / nullish id', () => {
    expect(getScenarioById(scenarios, 'nope')).toBeNull();
    expect(getScenarioById(scenarios, null)).toBeNull();
    expect(getScenarioById(scenarios, undefined)).toBeNull();
  });
});

describe('toggleScenario', () => {
  it('activates a scenario from nothing', () => {
    expect(toggleScenario(null, 'a')).toBe('a');
  });
  it('switches between scenarios', () => {
    expect(toggleScenario('a', 'b')).toBe('b');
  });
  it('toggles the active scenario off', () => {
    expect(toggleScenario('a', 'a')).toBeNull();
  });
});

describe('affectedLayersFor', () => {
  const scenario = parseScenarios(VALID_RAW)[0];
  it('returns the affected layers of an active scenario', () => {
    expect(affectedLayersFor(scenario)).toEqual(['civilizations', 'routes']);
  });
  it('returns [] when no scenario is active', () => {
    expect(affectedLayersFor(null)).toEqual([]);
  });
  it('returns a copy (does not leak the internal array)', () => {
    const layers = affectedLayersFor(scenario);
    layers.push('mutated');
    expect(scenario.affectedLayers).toEqual(['civilizations', 'routes']);
  });
});

describe('scenarioAppliesAtYear', () => {
  const bounded: WhatIfScenario = { ...parseScenarios(VALID_RAW)[0] };
  it('is true within the range', () => {
    expect(scenarioAppliesAtYear(bounded, -1000)).toBe(true);
  });
  it('is false outside the range', () => {
    expect(scenarioAppliesAtYear(bounded, 0)).toBe(false);
  });
  it('always applies when year is undefined', () => {
    expect(scenarioAppliesAtYear(bounded, undefined)).toBe(true);
  });
  it('handles open-ended ranges', () => {
    const open: WhatIfScenario = { ...bounded, timeRange: { start: -500, end: null } };
    expect(scenarioAppliesAtYear(open, 3000)).toBe(true);
    expect(scenarioAppliesAtYear(open, -600)).toBe(false);
  });
});

describe('banner', () => {
  it('marks the overlay as speculative / educational', () => {
    expect(SCENARIO_BANNER_TEXT.toLowerCase()).toContain('speculative');
  });
});
