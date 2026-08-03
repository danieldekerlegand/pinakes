import { describe, it, expect } from 'vitest';
import {
  polygonCentroid,
  generateInwardGradientRings,
  patternId,
  createHatchedPatternSVG,
  createStripedPatternSVG,
  territorialClassName,
  buildPatternCSS,
} from './territorial-shading';

// A simple square polygon ring: [0,0] -> [10,0] -> [10,10] -> [0,10] -> [0,0]
const squareRing: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

// Triangle
const triangleRing: [number, number][] = [
  [0, 0],
  [10, 0],
  [5, 10],
  [0, 0],
];

describe('polygonCentroid', () => {
  it('computes the centroid of a square', () => {
    const [cx, cy] = polygonCentroid(squareRing);
    expect(cx).toBeCloseTo(5, 5);
    expect(cy).toBeCloseTo(5, 5);
  });

  it('computes the centroid of a triangle', () => {
    const [cx, cy] = polygonCentroid(triangleRing);
    expect(cx).toBeCloseTo(5, 5);
    expect(cy).toBeCloseTo(10 / 3, 4);
  });

  it('handles unclosed rings', () => {
    const unclosed: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const [cx, cy] = polygonCentroid(unclosed);
    expect(cx).toBeCloseTo(5, 5);
    expect(cy).toBeCloseTo(5, 5);
  });

  it('handles a single point', () => {
    const [cx, cy] = polygonCentroid([[3, 7]]);
    expect(cx).toBe(3);
    expect(cy).toBe(7);
  });

  it('handles two points', () => {
    const [cx, cy] = polygonCentroid([
      [2, 4],
      [8, 6],
    ]);
    expect(cx).toBe(5);
    expect(cy).toBe(5);
  });

  it('handles empty ring', () => {
    const [cx, cy] = polygonCentroid([]);
    expect(cx).toBe(0);
    expect(cy).toBe(0);
  });
});

describe('generateInwardGradientRings', () => {
  it('generates the requested number of rings', () => {
    const rings = generateInwardGradientRings(squareRing, 3);
    expect(rings).toHaveLength(3);
  });

  it('each ring has increasing opacity toward center', () => {
    const rings = generateInwardGradientRings(squareRing, 4);
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].opacityMultiplier).toBeGreaterThan(rings[i - 1].opacityMultiplier);
    }
  });

  it('inner rings are closer to the centroid than outer rings', () => {
    const rings = generateInwardGradientRings(squareRing, 3);
    const centroid = polygonCentroid(squareRing);

    // For each successive ring, the first point should be closer to centroid
    const distances = rings.map((r) => {
      const p = r.ring[0];
      return Math.hypot(p[0] - centroid[0], p[1] - centroid[1]);
    });

    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThan(distances[i - 1]);
    }
  });

  it('rings are closed (first === last)', () => {
    const rings = generateInwardGradientRings(squareRing, 2);
    for (const { ring } of rings) {
      expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
      expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    }
  });

  it('opacity multiplier stays in [0.3, 1.0]', () => {
    const rings = generateInwardGradientRings(squareRing, 5);
    for (const { opacityMultiplier } of rings) {
      expect(opacityMultiplier).toBeGreaterThanOrEqual(0.3);
      expect(opacityMultiplier).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('patternId', () => {
  it('returns a unique id for hatched fill', () => {
    const id = patternId('hatched', '#3b82f6');
    expect(id).toBe('territorial-hatched-3b82f6');
  });

  it('returns a unique id for striped fill', () => {
    const id = patternId('striped', '#ef4444');
    expect(id).toBe('territorial-striped-ef4444');
  });
});

describe('createHatchedPatternSVG', () => {
  it('returns valid SVG pattern markup', () => {
    const svg = createHatchedPatternSVG('#3b82f6', 'test-hatched');
    expect(svg).toContain('<pattern');
    expect(svg).toContain('id="test-hatched"');
    expect(svg).toContain('rotate(45)');
    expect(svg).toContain('#3b82f6');
    expect(svg).toContain('</pattern>');
  });
});

describe('createStripedPatternSVG', () => {
  it('returns valid SVG pattern markup', () => {
    const svg = createStripedPatternSVG('#ef4444', 'test-striped');
    expect(svg).toContain('<pattern');
    expect(svg).toContain('id="test-striped"');
    expect(svg).toContain('#ef4444');
    expect(svg).toContain('</pattern>');
  });
});

describe('territorialClassName', () => {
  it('returns empty string for solid fill', () => {
    expect(territorialClassName('solid', '#3b82f6')).toBe('');
  });

  it('returns empty string for gradient fill', () => {
    expect(territorialClassName('gradient', '#3b82f6')).toBe('');
  });

  it('returns a className for hatched fill', () => {
    const cls = territorialClassName('hatched', '#3b82f6');
    expect(cls).toContain('territorial-fill-');
    expect(cls).toContain('hatched');
  });

  it('returns a className for striped fill', () => {
    const cls = territorialClassName('striped', '#ef4444');
    expect(cls).toContain('territorial-fill-');
    expect(cls).toContain('striped');
  });
});

describe('buildPatternCSS', () => {
  it('returns empty string for solid fill', () => {
    expect(buildPatternCSS('solid', '#3b82f6')).toBe('');
  });

  it('returns empty string for gradient fill', () => {
    expect(buildPatternCSS('gradient', '#3b82f6')).toBe('');
  });

  it('returns CSS rule for hatched fill', () => {
    const css = buildPatternCSS('hatched', '#3b82f6');
    expect(css).toContain('url(#territorial-hatched-3b82f6)');
    expect(css).toContain('!important');
  });

  it('returns CSS rule for striped fill', () => {
    const css = buildPatternCSS('striped', '#ef4444');
    expect(css).toContain('url(#territorial-striped-ef4444)');
    expect(css).toContain('!important');
  });
});
