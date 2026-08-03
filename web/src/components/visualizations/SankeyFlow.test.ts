import { describe, it, expect } from 'vitest';
import type { SankeyFlowNode, SankeyFlowLink, SankeyFlowData } from '@contracts/types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeNode(id: string, label: string, group: string): SankeyFlowNode {
  return { id, label, group };
}

function makeLink(
  source: string,
  target: string,
  value: number,
  category?: string,
  metadata?: Record<string, string>,
): SankeyFlowLink {
  return { source, target, value, category, metadata };
}

function makeSampleData(): SankeyFlowData {
  return {
    nodes: [
      makeNode('a', 'Node A', 'group-1'),
      makeNode('b', 'Node B', 'group-1'),
      makeNode('c', 'Node C', 'group-2'),
      makeNode('d', 'Node D', 'group-2'),
    ],
    links: [
      makeLink('a', 'c', 5, 'trade', { period: '1900-2000' }),
      makeLink('a', 'd', 2, 'migration'),
      makeLink('b', 'c', 3, 'trade'),
      makeLink('b', 'd', 1),
    ],
  };
}

// ============================================================================
// Type Contract Tests
// ============================================================================

describe('SankeyFlowNode', () => {
  it('has required id, label, and group fields', () => {
    const node = makeNode('n1', 'Test Node', 'test-group');
    expect(node.id).toBe('n1');
    expect(node.label).toBe('Test Node');
    expect(node.group).toBe('test-group');
  });
});

describe('SankeyFlowLink', () => {
  it('has required source, target, and value fields', () => {
    const link = makeLink('a', 'b', 10);
    expect(link.source).toBe('a');
    expect(link.target).toBe('b');
    expect(link.value).toBe(10);
  });

  it('supports optional category', () => {
    const link = makeLink('a', 'b', 5, 'influence');
    expect(link.category).toBe('influence');
  });

  it('supports optional metadata', () => {
    const link = makeLink('a', 'b', 5, 'trade', { region: 'Europe', era: 'Medieval' });
    expect(link.metadata).toEqual({ region: 'Europe', era: 'Medieval' });
  });

  it('omits category and metadata when not provided', () => {
    const link = makeLink('a', 'b', 3);
    expect(link.category).toBeUndefined();
    expect(link.metadata).toBeUndefined();
  });
});

describe('SankeyFlowData', () => {
  it('contains arrays of nodes and links', () => {
    const data = makeSampleData();
    expect(data.nodes).toHaveLength(4);
    expect(data.links).toHaveLength(4);
  });

  it('all links reference valid node ids', () => {
    const data = makeSampleData();
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    for (const link of data.links) {
      expect(nodeIds.has(link.source)).toBe(true);
      expect(nodeIds.has(link.target)).toBe(true);
    }
  });

  it('all link values are positive', () => {
    const data = makeSampleData();
    for (const link of data.links) {
      expect(link.value).toBeGreaterThan(0);
    }
  });

  it('has no self-loop links', () => {
    const data = makeSampleData();
    for (const link of data.links) {
      expect(link.source).not.toBe(link.target);
    }
  });
});

// ============================================================================
// Data Transformation Tests
// ============================================================================

describe('SankeyFlow data transformations', () => {
  it('can filter links by category', () => {
    const data = makeSampleData();
    const tradeLinks = data.links.filter((l) => l.category === 'trade');
    expect(tradeLinks).toHaveLength(2);
    expect(tradeLinks.every((l) => l.category === 'trade')).toBe(true);
  });

  it('can compute total flow per node', () => {
    const data = makeSampleData();
    const outflow = new Map<string, number>();
    const inflow = new Map<string, number>();

    for (const link of data.links) {
      outflow.set(link.source, (outflow.get(link.source) || 0) + link.value);
      inflow.set(link.target, (inflow.get(link.target) || 0) + link.value);
    }

    // Node A has outflow of 5 + 2 = 7
    expect(outflow.get('a')).toBe(7);
    // Node C has inflow of 5 + 3 = 8
    expect(inflow.get('c')).toBe(8);
  });

  it('can extract unique categories from links', () => {
    const data = makeSampleData();
    const categories = [...new Set(data.links.map((l) => l.category).filter(Boolean))];
    expect(categories).toContain('trade');
    expect(categories).toContain('migration');
    expect(categories).toHaveLength(2);
  });

  it('can extract unique groups from nodes', () => {
    const data = makeSampleData();
    const groups = [...new Set(data.nodes.map((n) => n.group))];
    expect(groups).toContain('group-1');
    expect(groups).toContain('group-2');
    expect(groups).toHaveLength(2);
  });

  it('can build node index map for d3-sankey', () => {
    const data = makeSampleData();
    const nodeIndex = new Map(data.nodes.map((n, i) => [n.id, i]));

    expect(nodeIndex.size).toBe(4);
    expect(nodeIndex.get('a')).toBe(0);
    expect(nodeIndex.get('d')).toBe(3);

    // All links should resolve to valid indices
    for (const link of data.links) {
      expect(nodeIndex.has(link.source)).toBe(true);
      expect(nodeIndex.has(link.target)).toBe(true);
    }
  });

  it('handles empty data gracefully', () => {
    const emptyData: SankeyFlowData = { nodes: [], links: [] };
    expect(emptyData.nodes).toHaveLength(0);
    expect(emptyData.links).toHaveLength(0);
  });

  it('can convert language contact SankeyData to generic SankeyFlowData', () => {
    // Simulate converting from the existing domain-specific format
    const languageContactNodes = [
      { id: 'lang-en', name: 'English', group: 'germanic' },
      { id: 'lang-fr', name: 'French', group: 'romance' },
    ];
    const languageContactLinks = [
      { source: 'lang-fr', target: 'lang-en', value: 3, contactType: 'superstrate', timePeriod: '1066-1400' },
    ];

    // Convert to generic format
    const flowData: SankeyFlowData = {
      nodes: languageContactNodes.map((n) => ({
        id: n.id,
        label: n.name,
        group: n.group,
      })),
      links: languageContactLinks.map((l) => ({
        source: l.source,
        target: l.target,
        value: l.value,
        category: l.contactType,
        metadata: { timePeriod: l.timePeriod },
      })),
    };

    expect(flowData.nodes[0].label).toBe('English');
    expect(flowData.links[0].category).toBe('superstrate');
    expect(flowData.links[0].metadata?.timePeriod).toBe('1066-1400');
  });
});

// ============================================================================
// Color Scheme Tests
// ============================================================================

describe('SankeyFlow color scheme', () => {
  it('maps categories to colors', () => {
    const colorScheme: Record<string, string> = {
      trade: '#ef4444',
      migration: '#3b82f6',
      cultural: '#10b981',
    };

    const data = makeSampleData();
    for (const link of data.links) {
      if (link.category && colorScheme[link.category]) {
        expect(typeof colorScheme[link.category]).toBe('string');
        expect(colorScheme[link.category]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('handles missing categories in color scheme gracefully', () => {
    const colorScheme: Record<string, string> = {
      trade: '#ef4444',
    };

    // migration is not in the scheme — should fall back gracefully
    const link = makeLink('a', 'b', 1, 'migration');
    const color = colorScheme[link.category || ''] || '#94a3b8';
    expect(color).toBe('#94a3b8');
  });
});
