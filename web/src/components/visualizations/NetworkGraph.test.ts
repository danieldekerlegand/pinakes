import { describe, it, expect } from 'vitest';
import { defaultNodeColor, defaultNodeRadius, defaultLabelText } from '../../lib/visualization/network-graph-types';
import type { GraphNode, GraphLink, GraphData, SimulationConfig } from '../../lib/visualization/network-graph-types';

// ============================================================================
// Type Tests — ensure the generic interfaces are correct
// ============================================================================

describe('GraphNode interface', () => {
  it('accepts minimal node with just id and label', () => {
    const node: GraphNode = { id: '1', label: 'Test' };
    expect(node.id).toBe('1');
    expect(node.label).toBe('Test');
    expect(node.size).toBeUndefined();
    expect(node.group).toBeUndefined();
  });

  it('accepts node with all optional fields', () => {
    const node: GraphNode = {
      id: '1',
      label: 'Test',
      size: 10,
      group: 'A',
      x: 100,
      y: 200,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
    expect(node.size).toBe(10);
    expect(node.group).toBe('A');
    expect(node.fx).toBeNull();
  });

  it('allows arbitrary extra properties via index signature', () => {
    const node: GraphNode = {
      id: '1',
      label: 'Test',
      region: 'Europe',
      status: 'active',
      customField: 42,
    };
    expect(node.region).toBe('Europe');
    expect(node.customField).toBe(42);
  });
});

describe('GraphLink interface', () => {
  it('accepts link with string source/target', () => {
    const link: GraphLink = { source: '1', target: '2' };
    expect(link.source).toBe('1');
    expect(link.target).toBe('2');
    expect(link.strength).toBeUndefined();
  });

  it('accepts link with node object source/target', () => {
    const nodeA: GraphNode = { id: '1', label: 'A' };
    const nodeB: GraphNode = { id: '2', label: 'B' };
    const link: GraphLink = { source: nodeA, target: nodeB, strength: 0.5 };
    expect((link.source as GraphNode).id).toBe('1');
    expect(link.strength).toBe(0.5);
  });

  it('allows arbitrary extra properties', () => {
    const link: GraphLink = { source: '1', target: '2', type: 'parent-child', weight: 3 };
    expect(link.type).toBe('parent-child');
    expect(link.weight).toBe(3);
  });
});

describe('GraphData interface', () => {
  it('holds nodes and links', () => {
    const data: GraphData = {
      nodes: [
        { id: '1', label: 'A' },
        { id: '2', label: 'B' },
      ],
      links: [{ source: '1', target: '2' }],
    };
    expect(data.nodes).toHaveLength(2);
    expect(data.links).toHaveLength(1);
  });

  it('supports generic node/link subtypes', () => {
    interface MyNode extends GraphNode {
      category: string;
    }
    interface MyLink extends GraphLink {
      weight: number;
    }

    const data: GraphData<MyNode, MyLink> = {
      nodes: [
        { id: '1', label: 'A', category: 'food' },
        { id: '2', label: 'B', category: 'drink' },
      ],
      links: [{ source: '1', target: '2', weight: 5 }],
    };
    expect(data.nodes[0].category).toBe('food');
    expect(data.links[0].weight).toBe(5);
  });
});

describe('SimulationConfig interface', () => {
  it('accepts empty config', () => {
    const config: SimulationConfig = {};
    expect(config.linkDistance).toBeUndefined();
  });

  it('accepts partial config', () => {
    const config: SimulationConfig = { linkDistance: 50, chargeStrength: -200 };
    expect(config.linkDistance).toBe(50);
    expect(config.chargeStrength).toBe(-200);
  });
});

// ============================================================================
// defaultNodeColor
// ============================================================================

describe('defaultNodeColor', () => {
  it('returns a color string for a node with a group', () => {
    const node: GraphNode = { id: '1', label: 'A', group: 'family-1' };
    const color = defaultNodeColor(node);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns default color for a node without group', () => {
    const node: GraphNode = { id: '1', label: 'A' };
    const color = defaultNodeColor(node);
    expect(color).toBe('#3b82f6');
  });

  it('returns consistent color for same group', () => {
    const nodeA: GraphNode = { id: '1', label: 'A', group: 'test-group' };
    const nodeB: GraphNode = { id: '2', label: 'B', group: 'test-group' };
    expect(defaultNodeColor(nodeA)).toBe(defaultNodeColor(nodeB));
  });

  it('can produce different colors for different groups', () => {
    const groups = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const colors = groups.map((g) => defaultNodeColor({ id: '1', label: 'X', group: g }));
    const unique = new Set(colors);
    // With 5 different group strings and 10 colors, we expect some variety
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// defaultNodeRadius
// ============================================================================

describe('defaultNodeRadius', () => {
  it('returns node.size when present', () => {
    expect(defaultNodeRadius({ id: '1', label: 'A', size: 15 })).toBe(15);
  });

  it('returns 6 when size is undefined', () => {
    expect(defaultNodeRadius({ id: '1', label: 'A' })).toBe(6);
  });
});

// ============================================================================
// defaultLabelText
// ============================================================================

describe('defaultLabelText', () => {
  it('returns full label when short', () => {
    expect(defaultLabelText({ id: '1', label: 'Hello' })).toBe('Hello');
  });

  it('returns full label when exactly 20 chars', () => {
    const label = '12345678901234567890';
    expect(defaultLabelText({ id: '1', label })).toBe(label);
  });

  it('truncates label when over 20 chars', () => {
    const label = '123456789012345678901'; // 21 chars
    const result = defaultLabelText({ id: '1', label });
    expect(result).toBe('12345678901234567...');
    expect(result.length).toBe(20);
  });
});

// ============================================================================
// Generic type composability
// ============================================================================

describe('Generic type composability', () => {
  it('supports custom node subtypes in GraphData', () => {
    interface TradeNode extends GraphNode {
      goodType: string;
      value: number;
    }
    interface TradeLink extends GraphLink {
      volume: number;
    }

    const data: GraphData<TradeNode, TradeLink> = {
      nodes: [{ id: '1', label: 'Silk', goodType: 'textile', value: 100 }],
      links: [{ source: '1', target: '2', volume: 50 }],
    };
    expect(data.nodes[0].goodType).toBe('textile');
    expect(data.links[0].volume).toBe(50);
  });

  it('nodeColor works with custom subtypes', () => {
    interface CultureNode extends GraphNode {
      tradition: string;
    }
    const node: CultureNode = { id: '1', label: 'Dance', group: 'folk', tradition: 'maypole' };
    const color = defaultNodeColor(node);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
