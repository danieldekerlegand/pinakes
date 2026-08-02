import { describe, it, expect } from 'vitest';
import {
  parseCounterfactualRoutes,
  loadCounterfactualRoutes,
  getCounterfactualRouteById,
  toggleCounterfactualRoute,
  selectAllCounterfactualRoutes,
  clearCounterfactualRoutes,
  activeCounterfactualRoutes,
  routeAppliesAtYear,
  assertSeparateFromReal,
  isCounterfactualRouteId,
  COUNTERFACTUAL_BANNER_TEXT,
  COUNTERFACTUAL_ID_PREFIX,
  type CounterfactualTradeRoute,
} from './counterfactual-trade-routes';

const VALID_RAW = {
  routes: [
    {
      id: 'cf-a',
      name: 'Route A',
      summary: 'A test',
      premise: 'What if A?',
      goods: ['silk', 'gold'],
      timeRange: { start: 700, end: 1400 },
      path: [[0, 0], [1, 1], [2, 2]],
      sources: ['src'],
    },
    {
      id: 'cf-b',
      name: 'Route B',
      premise: 'What if B?',
      goods: [],
      timeRange: {},
      path: [[10, 10], [20, 20]],
    },
  ],
};

describe('parseCounterfactualRoutes', () => {
  it('parses valid routes', () => {
    const r = parseCounterfactualRoutes(VALID_RAW);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe('cf-a');
    expect(r[0].goods).toEqual(['silk', 'gold']);
    expect(r[0].timeRange).toEqual({ start: 700, end: 1400 });
    expect(r[0].path).toHaveLength(3);
  });

  it('accepts a bare array as well as { routes: [...] }', () => {
    expect(parseCounterfactualRoutes(VALID_RAW.routes)).toHaveLength(2);
  });

  it('drops routes missing id or name', () => {
    expect(parseCounterfactualRoutes({ routes: [{ name: 'no id', path: [[0, 0], [1, 1]] }] })).toHaveLength(0);
    expect(parseCounterfactualRoutes({ routes: [{ id: 'cf-x', path: [[0, 0], [1, 1]] }] })).toHaveLength(0);
  });

  it('drops routes whose id is outside the cf- namespace (never a real tr- id)', () => {
    const r = parseCounterfactualRoutes({
      routes: [{ id: 'tr-001', name: 'Real!', path: [[0, 0], [1, 1]] }],
    });
    expect(r).toHaveLength(0);
  });

  it('drops routes with an invalid / too-short path', () => {
    expect(parseCounterfactualRoutes({ routes: [{ id: 'cf-x', name: 'X', path: [[0, 0]] }] })).toHaveLength(0);
    expect(parseCounterfactualRoutes({ routes: [{ id: 'cf-x', name: 'X', path: [[0], [1]] }] })).toHaveLength(0);
    expect(parseCounterfactualRoutes({ routes: [{ id: 'cf-x', name: 'X', path: 'nope' }] })).toHaveLength(0);
  });

  it('deduplicates routes by id (first wins)', () => {
    const dup = { ...VALID_RAW.routes[0], summary: 'second' };
    const r = parseCounterfactualRoutes({ routes: [VALID_RAW.routes[0], dup] });
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe('A test');
  });

  it('normalizes a missing / partial time range to nulls', () => {
    const r = parseCounterfactualRoutes(VALID_RAW);
    expect(r[1].timeRange).toEqual({ start: null, end: null });
  });

  it('returns [] for junk input', () => {
    expect(parseCounterfactualRoutes(null)).toEqual([]);
    expect(parseCounterfactualRoutes(42)).toEqual([]);
    expect(parseCounterfactualRoutes({})).toEqual([]);
  });
});

describe('loadCounterfactualRoutes (bundled data)', () => {
  it('loads the authored routes and they all validate + are namespaced', () => {
    const r = loadCounterfactualRoutes();
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const route of r) {
      expect(route.path.length).toBeGreaterThanOrEqual(2);
      expect(route.name.length).toBeGreaterThan(0);
      expect(isCounterfactualRouteId(route.id)).toBe(true);
    }
  });

  it('includes the "Silk Road to the Americas" example from the spec', () => {
    const r = loadCounterfactualRoutes();
    expect(r.some((x) => /silk road to the americas/i.test(x.name))).toBe(true);
  });
});

describe('separation from real trade-route data', () => {
  it('every bundled counterfactual id is in the cf- namespace', () => {
    for (const route of loadCounterfactualRoutes()) {
      expect(route.id.startsWith(COUNTERFACTUAL_ID_PREFIX)).toBe(true);
    }
  });

  it('assertSeparateFromReal reports no collisions with real tr- ids', () => {
    const realIds = ['tr-001', 'tr-002', 'tr-003', 'tr-004', 'tr-005'];
    expect(assertSeparateFromReal(loadCounterfactualRoutes(), realIds)).toEqual([]);
  });

  it('assertSeparateFromReal flags a fabricated collision', () => {
    const routes = parseCounterfactualRoutes(VALID_RAW);
    expect(assertSeparateFromReal(routes, ['cf-a'])).toEqual(['cf-a']);
  });
});

describe('getCounterfactualRouteById', () => {
  const routes = parseCounterfactualRoutes(VALID_RAW);
  it('finds by id', () => {
    expect(getCounterfactualRouteById(routes, 'cf-a')?.id).toBe('cf-a');
  });
  it('returns null for unknown / nullish id', () => {
    expect(getCounterfactualRouteById(routes, 'nope')).toBeNull();
    expect(getCounterfactualRouteById(routes, null)).toBeNull();
    expect(getCounterfactualRouteById(routes, undefined)).toBeNull();
  });
});

describe('toggle / select / clear', () => {
  it('toggles a route on then off', () => {
    let active = new Set<string>();
    active = toggleCounterfactualRoute(active, 'cf-a');
    expect([...active]).toEqual(['cf-a']);
    active = toggleCounterfactualRoute(active, 'cf-a');
    expect([...active]).toEqual([]);
  });

  it('supports several routes on at once (independent toggles)', () => {
    let active = new Set<string>();
    active = toggleCounterfactualRoute(active, 'cf-a');
    active = toggleCounterfactualRoute(active, 'cf-b');
    expect(active.has('cf-a')).toBe(true);
    expect(active.has('cf-b')).toBe(true);
  });

  it('does not mutate the input set', () => {
    const original = new Set<string>(['cf-a']);
    const next = toggleCounterfactualRoute(original, 'cf-b');
    expect([...original]).toEqual(['cf-a']);
    expect(next.has('cf-b')).toBe(true);
  });

  it('selectAll turns every route on; clear turns them off', () => {
    const routes = parseCounterfactualRoutes(VALID_RAW);
    expect([...selectAllCounterfactualRoutes(routes)].sort()).toEqual(['cf-a', 'cf-b']);
    expect([...clearCounterfactualRoutes()]).toEqual([]);
  });
});

describe('activeCounterfactualRoutes', () => {
  const routes = parseCounterfactualRoutes(VALID_RAW);
  it('returns active routes in authored order', () => {
    const r = activeCounterfactualRoutes(routes, new Set(['cf-b', 'cf-a']));
    expect(r.map((x) => x.id)).toEqual(['cf-a', 'cf-b']);
  });
  it('returns [] when nothing active', () => {
    expect(activeCounterfactualRoutes(routes, new Set())).toEqual([]);
  });
});

describe('routeAppliesAtYear', () => {
  const bounded: CounterfactualTradeRoute = parseCounterfactualRoutes(VALID_RAW)[0];
  it('is true within the range', () => {
    expect(routeAppliesAtYear(bounded, 1000)).toBe(true);
  });
  it('is false outside the range', () => {
    expect(routeAppliesAtYear(bounded, 1600)).toBe(false);
  });
  it('always applies when year is undefined', () => {
    expect(routeAppliesAtYear(bounded, undefined)).toBe(true);
  });
  it('handles open-ended ranges', () => {
    const open: CounterfactualTradeRoute = { ...bounded, timeRange: { start: 500, end: null } };
    expect(routeAppliesAtYear(open, 3000)).toBe(true);
    expect(routeAppliesAtYear(open, 400)).toBe(false);
  });
  it('always applies with no time range at all', () => {
    const none: CounterfactualTradeRoute = { ...bounded, timeRange: { start: null, end: null } };
    expect(routeAppliesAtYear(none, -5000)).toBe(true);
  });
});

describe('banner', () => {
  it('marks the overlay as speculative', () => {
    expect(COUNTERFACTUAL_BANNER_TEXT.toLowerCase()).toContain('speculative');
  });
});
