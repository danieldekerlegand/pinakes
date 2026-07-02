import { describe, it, expect } from 'vitest';
import {
  computePriority,
  isVisibleAtZoom,
  minZoomForLabel,
  fontSizeAtZoom,
  resolveCollisions,
  placeLabels,
  curvedPathForRegion,
  polygonCentroid,
  LABEL_PRIORITY,
  SETTLEMENT_RANK_BOOST,
  ZOOM_THRESHOLDS,
  SETTLEMENT_ZOOM,
  type MapLabel,
  type VisibleLabel,
} from '@/lib/visualization/map-label-engine';

// ---------------------------------------------------------------------------
// Priority computation
// ---------------------------------------------------------------------------

describe('computePriority', () => {
  it('returns base priority for type without extras', () => {
    expect(computePriority('region')).toBe(LABEL_PRIORITY.region);
    expect(computePriority('settlement')).toBe(LABEL_PRIORITY.settlement);
    expect(computePriority('route')).toBe(LABEL_PRIORITY.route);
  });

  it('adds settlement rank boost', () => {
    const base = LABEL_PRIORITY.settlement;
    expect(computePriority('settlement', 'capital')).toBe(base + SETTLEMENT_RANK_BOOST.capital);
    expect(computePriority('settlement', 'major')).toBe(base + SETTLEMENT_RANK_BOOST.major);
    expect(computePriority('settlement', 'minor')).toBe(base + SETTLEMENT_RANK_BOOST.minor);
  });

  it('adds scaled importance', () => {
    const p = computePriority('settlement', undefined, 100);
    expect(p).toBe(LABEL_PRIORITY.settlement + 100 * 0.2);
  });

  it('capital > major > minor in priority', () => {
    const capital = computePriority('settlement', 'capital');
    const major = computePriority('settlement', 'major');
    const minor = computePriority('settlement', 'minor');
    expect(capital).toBeGreaterThan(major);
    expect(major).toBeGreaterThan(minor);
  });
});

// ---------------------------------------------------------------------------
// Zoom visibility
// ---------------------------------------------------------------------------

describe('isVisibleAtZoom', () => {
  const label: MapLabel = {
    id: 'test',
    text: 'Test',
    type: 'region',
    lat: 0,
    lng: 0,
    priority: 50,
    minZoom: 3,
    layerId: 'region-labels',
  };

  it('returns false below minZoom', () => {
    expect(isVisibleAtZoom(label, 2)).toBe(false);
  });

  it('returns true at minZoom', () => {
    expect(isVisibleAtZoom(label, 3)).toBe(true);
  });

  it('returns true above minZoom', () => {
    expect(isVisibleAtZoom(label, 10)).toBe(true);
  });

  it('respects maxZoom', () => {
    const bounded = { ...label, maxZoom: 8 };
    expect(isVisibleAtZoom(bounded, 8)).toBe(true);
    expect(isVisibleAtZoom(bounded, 9)).toBe(false);
  });
});

describe('minZoomForLabel', () => {
  it('returns type-based threshold for non-settlements', () => {
    expect(minZoomForLabel('region')).toBe(ZOOM_THRESHOLDS.region);
    expect(minZoomForLabel('route')).toBe(ZOOM_THRESHOLDS.route);
  });

  it('returns rank-based threshold for settlements', () => {
    expect(minZoomForLabel('settlement', 'capital')).toBe(SETTLEMENT_ZOOM.capital);
    expect(minZoomForLabel('settlement', 'major')).toBe(SETTLEMENT_ZOOM.major);
    expect(minZoomForLabel('settlement', 'minor')).toBe(SETTLEMENT_ZOOM.minor);
  });

  it('capital labels appear at lower zoom than minor', () => {
    expect(minZoomForLabel('settlement', 'capital')).toBeLessThan(
      minZoomForLabel('settlement', 'minor'),
    );
  });
});

// ---------------------------------------------------------------------------
// Font scaling
// ---------------------------------------------------------------------------

describe('fontSizeAtZoom', () => {
  it('returns a number within min/max bounds', () => {
    for (let z = 1; z <= 18; z++) {
      const size = fontSizeAtZoom('region', z);
      expect(size).toBeGreaterThanOrEqual(8);
      expect(size).toBeLessThanOrEqual(24);
    }
  });

  it('font size increases with zoom', () => {
    const low = fontSizeAtZoom('settlement', 3);
    const high = fontSizeAtZoom('settlement', 12);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('region labels are larger than route labels at same zoom', () => {
    const regionSize = fontSizeAtZoom('region', 5);
    const routeSize = fontSizeAtZoom('route', 5);
    expect(regionSize).toBeGreaterThan(routeSize);
  });
});

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

describe('resolveCollisions', () => {
  function makeLabel(id: string, x: number, y: number, priority: number, text = 'Label'): VisibleLabel {
    return {
      id,
      text,
      type: 'settlement',
      lat: 0,
      lng: 0,
      priority,
      minZoom: 3,
      layerId: 'test',
      screenX: x,
      screenY: y,
      fontSize: 12,
    };
  }

  it('returns all labels when none overlap', () => {
    const labels = [
      makeLabel('a', 0, 0, 100),
      makeLabel('b', 200, 0, 90),
      makeLabel('c', 400, 0, 80),
    ];
    const result = resolveCollisions(labels);
    expect(result).toHaveLength(3);
  });

  it('removes lower-priority label when overlapping', () => {
    // Two labels at exact same position - higher priority wins
    const labels = [
      makeLabel('high', 100, 100, 100),
      makeLabel('low', 100, 100, 50),
    ];
    const result = resolveCollisions(labels);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('high');
  });

  it('keeps both labels when one is removed, freeing space for a third', () => {
    // A at (0,0), B slightly overlapping A at (20,0), C far away
    const labels = [
      makeLabel('a', 0, 0, 100),
      makeLabel('b', 10, 0, 90), // overlaps with a
      makeLabel('c', 500, 0, 80), // far away
    ];
    const result = resolveCollisions(labels);
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.id)).toContain('a');
    expect(result.map((l) => l.id)).toContain('c');
  });

  it('handles empty input', () => {
    expect(resolveCollisions([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Curved path for region labels
// ---------------------------------------------------------------------------

describe('curvedPathForRegion', () => {
  it('returns empty string for degenerate input', () => {
    expect(curvedPathForRegion([])).toBe('');
    expect(curvedPathForRegion([[0, 0]])).toBe('');
    expect(curvedPathForRegion([[0, 0], [1, 1]])).toBe('');
  });

  it('returns a valid SVG path string', () => {
    const ring: [number, number][] = [
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ];
    const path = curvedPathForRegion(ring);
    expect(path).toMatch(/^M\s/);
    expect(path).toContain('Q');
  });

  it('ensures left-to-right text direction', () => {
    const ring: [number, number][] = [
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ];
    const path = curvedPathForRegion(ring);
    // Extract M x1 and the final x2 - x1 should be < x2
    const parts = path.split(/\s+/);
    const mx = parseFloat(parts[1]);
    const finalX = parseFloat(parts[parts.length - 2]);
    expect(mx).toBeLessThanOrEqual(finalX);
  });
});

describe('polygonCentroid', () => {
  it('computes centroid of a square', () => {
    const ring: [number, number][] = [
      [0, 0], [10, 0], [10, 10], [0, 10],
    ];
    const [cx, cy] = polygonCentroid(ring);
    expect(cx).toBe(5);
    expect(cy).toBe(5);
  });

  it('returns [0,0] for empty ring', () => {
    expect(polygonCentroid([])).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline (placeLabels)
// ---------------------------------------------------------------------------

describe('placeLabels', () => {
  const labels: MapLabel[] = [
    {
      id: 'capital-1',
      text: 'Rome',
      type: 'settlement',
      lat: 41.9,
      lng: 12.5,
      priority: computePriority('settlement', 'capital', 95),
      minZoom: minZoomForLabel('settlement', 'capital'),
      settlementRank: 'capital',
      layerId: 'settlement-labels',
    },
    {
      id: 'minor-1',
      text: 'Small Town',
      type: 'settlement',
      lat: 42.0,
      lng: 12.6,
      priority: computePriority('settlement', 'minor', 20),
      minZoom: minZoomForLabel('settlement', 'minor'),
      settlementRank: 'minor',
      layerId: 'settlement-labels',
    },
    {
      id: 'region-1',
      text: 'Latin',
      type: 'region',
      lat: 42.0,
      lng: 12.0,
      priority: computePriority('region'),
      minZoom: minZoomForLabel('region'),
      layerId: 'region-labels',
    },
    {
      id: 'route-1',
      text: 'Via Appia',
      type: 'route',
      lat: 41.5,
      lng: 13.0,
      priority: computePriority('route'),
      minZoom: minZoomForLabel('route'),
      layerId: 'route-labels',
    },
  ];

  const simpleProject = (lat: number, lng: number) => ({
    x: lng * 100,
    y: lat * 100,
  });

  it('filters by zoom level', () => {
    const enabled = new Set(['settlement-labels', 'region-labels', 'route-labels']);
    // At zoom 2, nothing should show (all minZooms > 2)
    const result = placeLabels(labels, 2, enabled, simpleProject);
    expect(result).toHaveLength(0);
  });

  it('shows region and capital labels at zoom 4', () => {
    const enabled = new Set(['settlement-labels', 'region-labels', 'route-labels']);
    const result = placeLabels(labels, 4, enabled, simpleProject);
    const ids = result.map((l) => l.id);
    expect(ids).toContain('capital-1');
    expect(ids).toContain('region-1');
    expect(ids).toContain('route-1');
    // Minor settlement has minZoom=8, should not appear
    expect(ids).not.toContain('minor-1');
  });

  it('filters by enabled label layers', () => {
    const enabled = new Set(['settlement-labels']); // only settlements
    const result = placeLabels(labels, 10, enabled, simpleProject);
    for (const l of result) {
      expect(l.layerId).toBe('settlement-labels');
    }
  });

  it('returns labels sorted by priority (highest first placed)', () => {
    const enabled = new Set(['settlement-labels', 'region-labels', 'route-labels']);
    const result = placeLabels(labels, 10, enabled, simpleProject);
    // The capital should be first (highest priority)
    expect(result[0].id).toBe('capital-1');
  });

  it('excludes labels whose projection returns null', () => {
    const nullProject = () => null;
    const enabled = new Set(['settlement-labels', 'region-labels', 'route-labels']);
    const result = placeLabels(labels, 10, enabled, nullProject);
    expect(result).toHaveLength(0);
  });
});
