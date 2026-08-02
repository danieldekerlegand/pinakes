import { describe, it, expect } from 'vitest';
import {
  orderFeatures,
  sequentialTarget,
  spatialTarget,
  applyTraversal,
  decodeTraversalKey,
  announceFeatureFocus,
  type NavigableFeature,
} from './map-feature-traversal';

// A small deterministic grid of features:
//   A(0,2)  B(2,2)  C(4,2)     (lat 2 = north row)
//   D(0,0)  E(2,0)  F(4,0)     (lat 0 = south row)
// lng increases east (0 -> 4), lat increases north (0 -> 2).
const GRID: NavigableFeature[] = [
  { id: 'A', name: 'Alpha', type: 'settlement', lng: 0, lat: 2 },
  { id: 'B', name: 'Bravo', type: 'settlement', lng: 2, lat: 2 },
  { id: 'C', name: 'Charlie', type: 'settlement', lng: 4, lat: 2 },
  { id: 'D', name: 'Delta', type: 'settlement', lng: 0, lat: 0 },
  { id: 'E', name: 'Echo', type: 'settlement', lng: 2, lat: 0 },
  { id: 'F', name: 'Foxtrot', type: 'settlement', lng: 4, lat: 0 },
];

const idOf = (f: NavigableFeature | null) => f?.id ?? null;

describe('orderFeatures', () => {
  it('orders north-to-south then west-to-east, stable by id, without mutating input', () => {
    const input = [...GRID].reverse();
    const snapshot = JSON.stringify(input);
    const ordered = orderFeatures(input);
    expect(ordered.map((f) => f.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
  });

  it('breaks ties on identical coordinates by id', () => {
    const dupes: NavigableFeature[] = [
      { id: 'z', name: 'Z', type: 'settlement', lng: 1, lat: 1 },
      { id: 'a', name: 'A', type: 'settlement', lng: 1, lat: 1 },
    ];
    expect(orderFeatures(dupes).map((f) => f.id)).toEqual(['a', 'z']);
  });
});

describe('sequentialTarget', () => {
  it('first / last return the endpoints', () => {
    expect(idOf(sequentialTarget(GRID, null, 'first'))).toBe('A');
    expect(idOf(sequentialTarget(GRID, null, 'last'))).toBe('F');
  });

  it('next / prev step through ordered features', () => {
    expect(idOf(sequentialTarget(GRID, 'A', 'next'))).toBe('B');
    expect(idOf(sequentialTarget(GRID, 'B', 'prev'))).toBe('A');
  });

  it('wraps at both ends', () => {
    expect(idOf(sequentialTarget(GRID, 'F', 'next'))).toBe('A');
    expect(idOf(sequentialTarget(GRID, 'A', 'prev'))).toBe('F');
  });

  it('seeds from an end when nothing is focused', () => {
    expect(idOf(sequentialTarget(GRID, null, 'next'))).toBe('A');
    expect(idOf(sequentialTarget(GRID, null, 'prev'))).toBe('F');
  });

  it('handles an unknown current id by seeding', () => {
    expect(idOf(sequentialTarget(GRID, 'nope', 'next'))).toBe('A');
  });

  it('returns null for an empty list', () => {
    expect(sequentialTarget([], null, 'first')).toBeNull();
  });
});

describe('spatialTarget', () => {
  it('moves to the adjacent feature in each direction', () => {
    expect(idOf(spatialTarget(GRID, 'E', 'right'))).toBe('F'); // east
    expect(idOf(spatialTarget(GRID, 'E', 'left'))).toBe('D'); // west
    expect(idOf(spatialTarget(GRID, 'E', 'up'))).toBe('B'); // north
    expect(idOf(spatialTarget(GRID, 'A', 'down'))).toBe('D'); // south
  });

  it('prefers the closest feature along the pressed axis', () => {
    // From A(0,2) going right, B(2,2) is closer than C(4,2).
    expect(idOf(spatialTarget(GRID, 'A', 'right'))).toBe('B');
  });

  it('penalizes cross-axis drift (straight line preferred)', () => {
    // From D(0,0) going right, E(2,0) is straight; F(4,0) further; the
    // north row (B/C) sits off-axis and must lose to E.
    expect(idOf(spatialTarget(GRID, 'D', 'right'))).toBe('E');
  });

  it('returns null at the edge with nothing in that direction', () => {
    expect(spatialTarget(GRID, 'C', 'right')).toBeNull(); // C is easternmost
    expect(spatialTarget(GRID, 'A', 'up')).toBeNull(); // A is northernmost
    expect(spatialTarget(GRID, 'D', 'down')).toBeNull(); // D is southernmost
  });

  it('seeds on the first feature when nothing is focused', () => {
    expect(idOf(spatialTarget(GRID, null, 'right'))).toBe('A');
  });

  it('returns null for an empty list', () => {
    expect(spatialTarget([], null, 'right')).toBeNull();
  });

  it('is deterministic on tied scores (lowest id wins)', () => {
    const tied: NavigableFeature[] = [
      { id: 'center', name: 'C', type: 'settlement', lng: 0, lat: 0 },
      { id: 'y', name: 'Y', type: 'settlement', lng: 1, lat: 1 },
      { id: 'x', name: 'X', type: 'settlement', lng: 1, lat: -1 },
    ];
    // x and y are symmetric to the right of center -> equal score -> id tiebreak.
    expect(idOf(spatialTarget(tied, 'center', 'right'))).toBe('x');
  });
});

describe('decodeTraversalKey', () => {
  it('maps arrow keys to spatial directions', () => {
    expect(decodeTraversalKey('ArrowRight')).toEqual({ kind: 'spatial', direction: 'right' });
    expect(decodeTraversalKey('ArrowLeft')).toEqual({ kind: 'spatial', direction: 'left' });
    expect(decodeTraversalKey('ArrowUp')).toEqual({ kind: 'spatial', direction: 'up' });
    expect(decodeTraversalKey('ArrowDown')).toEqual({ kind: 'spatial', direction: 'down' });
  });

  it('maps Home/End and bracket keys to sequential steps', () => {
    expect(decodeTraversalKey('Home')).toEqual({ kind: 'sequential', step: 'first' });
    expect(decodeTraversalKey('End')).toEqual({ kind: 'sequential', step: 'last' });
    expect(decodeTraversalKey(']')).toEqual({ kind: 'sequential', step: 'next' });
    expect(decodeTraversalKey('[')).toEqual({ kind: 'sequential', step: 'prev' });
  });

  it('respects shift for Tab direction', () => {
    expect(decodeTraversalKey('Tab')).toEqual({ kind: 'sequential', step: 'next' });
    expect(decodeTraversalKey('Tab', { shiftKey: true })).toEqual({ kind: 'sequential', step: 'prev' });
  });

  it('maps Enter/Space to select and Escape to exit', () => {
    expect(decodeTraversalKey('Enter')).toEqual({ kind: 'select' });
    expect(decodeTraversalKey(' ')).toEqual({ kind: 'select' });
    expect(decodeTraversalKey('Escape')).toEqual({ kind: 'exit' });
  });

  it('returns null for unrelated keys', () => {
    expect(decodeTraversalKey('a')).toBeNull();
    expect(decodeTraversalKey('Shift')).toBeNull();
  });
});

describe('applyTraversal', () => {
  it('routes spatial and sequential intents to the right resolver', () => {
    expect(idOf(applyTraversal(GRID, 'E', { kind: 'spatial', direction: 'up' }))).toBe('B');
    expect(idOf(applyTraversal(GRID, 'A', { kind: 'sequential', step: 'next' }))).toBe('B');
  });

  it('never moves focus for select / exit', () => {
    expect(applyTraversal(GRID, 'A', { kind: 'select' })).toBeNull();
    expect(applyTraversal(GRID, 'A', { kind: 'exit' })).toBeNull();
  });

  it('end-to-end: decode then apply an arrow key', () => {
    const intent = decodeTraversalKey('ArrowRight');
    expect(intent).not.toBeNull();
    expect(idOf(applyTraversal(GRID, 'E', intent!))).toBe('F');
  });
});

describe('announceFeatureFocus', () => {
  it('includes the feature description and a position cue', () => {
    const msg = announceFeatureFocus(GRID[1], GRID); // B, 2nd in order
    expect(msg).toContain('Bravo');
    expect(msg).toContain('2 of 6');
  });

  it('includes time range when present', () => {
    const timed: NavigableFeature = {
      id: 'x',
      name: 'Uruk',
      type: 'settlement',
      lng: 1,
      lat: 1,
      timeStart: -4000,
      timeEnd: -3100,
    };
    const msg = announceFeatureFocus(timed, [timed]);
    expect(msg).toContain('4000 BCE');
    expect(msg).toContain('3100 BCE');
    expect(msg).toContain('1 of 1');
  });
});
