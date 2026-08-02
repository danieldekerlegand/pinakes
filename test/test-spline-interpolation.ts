/**
 * Test script for spline interpolation and organic boundary rendering
 * Run with: npx tsx test/test-spline-interpolation.ts
 */

import {
  smoothRing,
  smoothPolygon,
  smoothFeature,
  smoothFeatures,
  generateGradientEdgeRings,
} from '../web/src/lib/visualization/spline-interpolation';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  const diff = Math.abs(actual - expected);
  assert(diff < tolerance, `${message} (got ${actual}, expected ~${expected}, diff ${diff.toFixed(6)})`);
}

// ============================================================================
// Test Data
// ============================================================================

// Simple triangle (closed ring)
const triangle: [number, number][] = [
  [0, 0], [10, 0], [5, 8], [0, 0],
];

// Square
const square: [number, number][] = [
  [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
];

// Pentagon
const pentagon: [number, number][] = [
  [5, 0], [10, 4], [8, 10], [2, 10], [0, 4], [5, 0],
];

// ============================================================================
// Tests
// ============================================================================

console.log('=== Spline Interpolation Tests ===\n');

// --- smoothRing ---
console.log('Test 1: smoothRing produces more points than input');
{
  const result = smoothRing(triangle, 6);
  assert(result.length > triangle.length, `smoothed triangle has ${result.length} points (original: ${triangle.length})`);
}

console.log('\nTest 2: smoothRing output is a closed ring');
{
  const result = smoothRing(square, 6);
  const first = result[0];
  const last = result[result.length - 1];
  assert(first[0] === last[0] && first[1] === last[1], 'first and last points are identical');
}

console.log('\nTest 3: smoothRing with pointsPerSegment controls density');
{
  const sparse = smoothRing(square, 3);
  const dense = smoothRing(square, 10);
  assert(dense.length > sparse.length, `dense (${dense.length}) > sparse (${sparse.length})`);
}

console.log('\nTest 4: smoothRing handles minimum points (3 points)');
{
  const triOpen: [number, number][] = [[0, 0], [5, 5], [10, 0], [0, 0]];
  const result = smoothRing(triOpen, 4);
  assert(result.length > 4, `result has ${result.length} points`);
  const first = result[0];
  const last = result[result.length - 1];
  assert(first[0] === last[0] && first[1] === last[1], 'closed ring');
}

console.log('\nTest 5: smoothRing returns input for < 3 unique points');
{
  const twoPoints: [number, number][] = [[0, 0], [5, 5], [0, 0]];
  const result = smoothRing(twoPoints, 6);
  // Only 2 unique points, should return as-is
  assert(result.length === twoPoints.length, `returns original (${result.length} pts)`);
}

console.log('\nTest 6: smoothRing interpolated points stay near original shape');
{
  const result = smoothRing(square, 6);
  // All points should be within a reasonable distance of the original square bounds
  let allInBounds = true;
  for (const pt of result) {
    if (pt[0] < -2 || pt[0] > 12 || pt[1] < -2 || pt[1] > 12) {
      allInBounds = false;
      break;
    }
  }
  assert(allInBounds, 'all smoothed points stay within reasonable bounds of original');
}

console.log('\nTest 7: smoothRing with different tension values');
{
  const uniform = smoothRing(pentagon, 6, 0.0);   // uniform
  const centripetal = smoothRing(pentagon, 6, 0.5); // centripetal
  const chordal = smoothRing(pentagon, 6, 1.0);   // chordal
  assert(uniform.length === centripetal.length, 'same point count regardless of tension');
  assert(centripetal.length === chordal.length, 'same point count regardless of tension');
  // Different tensions should produce different coordinates
  let allSame = true;
  for (let i = 0; i < Math.min(uniform.length, centripetal.length); i++) {
    if (Math.abs(uniform[i][0] - centripetal[i][0]) > 1e-10 ||
        Math.abs(uniform[i][1] - centripetal[i][1]) > 1e-10) {
      allSame = false;
      break;
    }
  }
  assert(!allSame, 'different tension values produce different curves');
}

// --- smoothPolygon ---
console.log('\nTest 8: smoothPolygon smooths all rings');
{
  const coords: [number, number][][] = [square];
  const result = smoothPolygon(coords, 6);
  assert(result.length === 1, 'preserves ring count');
  assert(result[0].length > square.length, 'ring has more points');
}

console.log('\nTest 9: smoothPolygon handles polygon with hole');
{
  const outer: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
  const hole: [number, number][] = [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]];
  const result = smoothPolygon([outer, hole], 4);
  assert(result.length === 2, 'preserves both rings');
  assert(result[0].length > outer.length, 'outer ring smoothed');
  assert(result[1].length > hole.length, 'hole ring smoothed');
}

// --- smoothFeature ---
console.log('\nTest 10: smoothFeature processes Polygon feature');
{
  const feature: Feature<Polygon> = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [square] },
    properties: { name: 'test' },
  };
  const result = smoothFeature(feature, 6);
  assert(result.geometry.type === 'Polygon', 'preserves geometry type');
  assert(result.geometry.coordinates[0].length > square.length, 'smoothed coordinates');
  assert(result.properties!.name === 'test', 'preserves properties');
}

console.log('\nTest 11: smoothFeature processes MultiPolygon feature');
{
  const feature: Feature<MultiPolygon> = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[square], [triangle]],
    },
    properties: { name: 'multi' },
  };
  const result = smoothFeature(feature, 6);
  assert(result.geometry.type === 'MultiPolygon', 'preserves geometry type');
  assert((result.geometry as MultiPolygon).coordinates.length === 2, 'preserves polygon count');
  assert(result.properties!.name === 'multi', 'preserves properties');
}

console.log('\nTest 12: smoothFeature preserves feature id');
{
  const feature: Feature<Polygon> = {
    type: 'Feature',
    id: 'civ-123',
    geometry: { type: 'Polygon', coordinates: [pentagon] },
    properties: { civilizationId: 'roman-empire' },
  };
  const result = smoothFeature(feature);
  assert(result.id === 'civ-123', 'feature id preserved');
}

// --- smoothFeatures ---
console.log('\nTest 13: smoothFeatures processes array of features');
{
  const features: Feature<Polygon>[] = [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square] }, properties: { id: 'a' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [triangle] }, properties: { id: 'b' } },
  ];
  const result = smoothFeatures(features, 6);
  assert(result.length === 2, 'preserves feature count');
  assert(result[0].geometry.coordinates[0].length > square.length, 'first feature smoothed');
  assert(result[1].geometry.coordinates[0].length > triangle.length, 'second feature smoothed');
}

console.log('\nTest 14: smoothFeatures handles empty array');
{
  const result = smoothFeatures([], 6);
  assert(result.length === 0, 'returns empty array');
}

// --- generateGradientEdgeRings ---
console.log('\nTest 15: generateGradientEdgeRings produces correct layer count');
{
  const result = generateGradientEdgeRings(square, 3, 0.5);
  assert(result.length === 3, `produced ${result.length} gradient layers`);
}

console.log('\nTest 16: generateGradientEdgeRings opacity decreases outward');
{
  const result = generateGradientEdgeRings(square, 4, 0.5);
  let decreasing = true;
  for (let i = 1; i < result.length; i++) {
    if (result[i].opacityMultiplier >= result[i - 1].opacityMultiplier) {
      decreasing = false;
      break;
    }
  }
  assert(decreasing, 'opacity multiplier decreases for outer rings');
}

console.log('\nTest 17: generateGradientEdgeRings produces closed rings');
{
  const result = generateGradientEdgeRings(pentagon, 3, 0.3);
  for (let i = 0; i < result.length; i++) {
    const ring = result[i].ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    assert(first[0] === last[0] && first[1] === last[1], `gradient ring ${i} is closed`);
  }
}

console.log('\nTest 18: generateGradientEdgeRings successive rings differ progressively');
{
  const result = generateGradientEdgeRings(square, 3, 1.0);
  // Successive rings should be progressively more offset from the original
  // Measure average displacement from the original ring centroid
  const centroidX = square.slice(0, -1).reduce((s, p) => s + p[0], 0) / (square.length - 1);
  const centroidY = square.slice(0, -1).reduce((s, p) => s + p[1], 0) / (square.length - 1);
  const avgDist = (ring: number[][]) => {
    const pts = ring.slice(0, -1);
    return pts.reduce((s, p) => s + Math.hypot(p[0] - centroidX, p[1] - centroidY), 0) / pts.length;
  };
  const d0 = avgDist(result[0].ring);
  const d1 = avgDist(result[1].ring);
  const d2 = avgDist(result[2].ring);
  // Each successive ring should have a different average distance (offset applied)
  assert(Math.abs(d2 - d0) > 0.1, `outer rings are offset from inner (d0=${d0.toFixed(2)}, d2=${d2.toFixed(2)})`);
}

// --- Edge cases ---
console.log('\nTest 19: smoothRing handles pentagon correctly');
{
  const result = smoothRing(pentagon, 8);
  // Pentagon has 5 unique points, 8 points per segment = 40 + 1 (closing) = 41
  assert(result.length === 41, `pentagon smoothed to ${result.length} points (expected 41)`);
}

console.log('\nTest 20: smoothRing produces continuous curve (no NaN)');
{
  const result = smoothRing(square, 6);
  let hasNaN = false;
  for (const pt of result) {
    if (isNaN(pt[0]) || isNaN(pt[1])) {
      hasNaN = true;
      break;
    }
  }
  assert(!hasNaN, 'no NaN values in smoothed output');
}

// ============================================================================
// Summary
// ============================================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
