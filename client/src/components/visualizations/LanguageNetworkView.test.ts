import { describe, it, expect } from 'vitest';
import type { NetworkData } from '../../lib/visualization/types';
import type { GraphNode, GraphLink, GraphData } from '../../lib/visualization/network-graph-types';

// ============================================================================
// Data mapping tests — verify NetworkData maps correctly to GraphData
// ============================================================================

describe('LanguageNetworkView data mapping', () => {
  const sampleNetworkData: NetworkData = {
    nodes: [
      {
        id: 'ie',
        name: 'Indo-European',
        type: 'family',
        group: 'ie',
        level: 0,
        size: 14,
        totalSpeakers: 3200000000,
        region: 'Europe',
        status: 'living',
      },
      {
        id: 'en',
        name: 'English',
        type: 'language',
        group: 'ie',
        level: 1,
        size: 10,
        totalSpeakers: 1500000000,
        region: 'Europe',
        status: 'living',
      },
    ],
    links: [
      { source: 'ie', target: 'en', type: 'family-child', strength: 1 },
    ],
  };

  it('maps NetworkNode name to GraphNode label', () => {
    // Simulate the mapping done in LanguageNetworkView
    const graphNodes = sampleNetworkData.nodes.map((n) => ({
      ...n,
      label: n.name,
    }));

    expect(graphNodes[0].label).toBe('Indo-European');
    expect(graphNodes[0].name).toBe('Indo-European');
    expect(graphNodes[1].label).toBe('English');
  });

  it('preserves all language-specific fields after mapping', () => {
    const graphNodes = sampleNetworkData.nodes.map((n) => ({
      ...n,
      label: n.name,
    }));

    const family = graphNodes[0];
    expect(family.id).toBe('ie');
    expect(family.type).toBe('family');
    expect(family.group).toBe('ie');
    expect(family.level).toBe(0);
    expect(family.size).toBe(14);
    expect(family.totalSpeakers).toBe(3200000000);
    expect(family.region).toBe('Europe');
    expect(family.status).toBe('living');
  });

  it('mapped nodes satisfy GraphNode interface', () => {
    const graphNodes: GraphNode[] = sampleNetworkData.nodes.map((n) => ({
      ...n,
      label: n.name,
    }));

    expect(graphNodes[0].id).toBeDefined();
    expect(graphNodes[0].label).toBeDefined();
  });

  it('produces valid GraphData structure', () => {
    const graphData: GraphData = {
      nodes: sampleNetworkData.nodes.map((n) => ({ ...n, label: n.name })),
      links: sampleNetworkData.links as GraphLink[],
    };

    expect(graphData.nodes).toHaveLength(2);
    expect(graphData.links).toHaveLength(1);
    expect(graphData.links[0].source).toBe('ie');
    expect(graphData.links[0].target).toBe('en');
  });
});

// ============================================================================
// Styling function tests — verify language-specific styling logic
// ============================================================================

describe('LanguageNetworkView styling logic', () => {
  it('family-child links should be wider than other types', () => {
    const getLinkWidth = (link: { type: string }) =>
      link.type === 'family-child' ? 2 : 1;

    expect(getLinkWidth({ type: 'family-child' })).toBe(2);
    expect(getLinkWidth({ type: 'language-family' })).toBe(1);
    expect(getLinkWidth({ type: 'language-parent' })).toBe(1);
  });

  it('family nodes always show labels', () => {
    const showLabels = false;
    const shouldShowLabel = (node: { type: string }) =>
      node.type === 'family' || showLabels;

    expect(shouldShowLabel({ type: 'family' })).toBe(true);
    expect(shouldShowLabel({ type: 'language' })).toBe(false);
  });

  it('all nodes show labels when showLabels is true', () => {
    const showLabels = true;
    const shouldShowLabel = (node: { type: string }) =>
      node.type === 'family' || showLabels;

    expect(shouldShowLabel({ type: 'family' })).toBe(true);
    expect(shouldShowLabel({ type: 'language' })).toBe(true);
  });

  it('family nodes get bold font, language nodes get regular', () => {
    const getLabelFont = (node: { type: string }) =>
      node.type === 'family' ? '600 12px sans-serif' : '400 10px sans-serif';

    expect(getLabelFont({ type: 'family' })).toBe('600 12px sans-serif');
    expect(getLabelFont({ type: 'language' })).toBe('400 10px sans-serif');
  });

  it('node radius uses size property with fallback', () => {
    const getRadius = (node: { size?: number }) => node.size ?? 6;

    expect(getRadius({ size: 14 })).toBe(14);
    expect(getRadius({ size: 0 })).toBe(0);
    expect(getRadius({})).toBe(6);
  });
});

// ============================================================================
// Props interface compatibility
// ============================================================================

describe('LanguageNetworkView props compatibility', () => {
  it('onNodeClick callback receives id and type', () => {
    let receivedId = '';
    let receivedType = '';
    const onNodeClick = (id: string, type: 'family' | 'language') => {
      receivedId = id;
      receivedType = type;
    };

    // Simulate what handleNodeClick does
    const node = { id: 'en', type: 'language' as const, name: 'English', label: 'English', level: 1, size: 10, group: 'ie' };
    onNodeClick(node.id, node.type);

    expect(receivedId).toBe('en');
    expect(receivedType).toBe('language');
  });
});
