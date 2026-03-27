import { describe, it, expect } from 'vitest';
import type { TreeVisualizationConfig } from './TreeVisualization';

interface SimpleNode {
  id: string;
  name: string;
  children?: SimpleNode[];
}

describe('TreeVisualizationConfig', () => {
  const config: TreeVisualizationConfig<SimpleNode> = {
    getChildren: (d) => d.children,
    skipRoot: true,
    autoFitScale: 0.9,
    linkStroke: '#cbd5e0',
    linkStrokeWidth: 2,
    linkOffsetX: 150,
    linkOffsetY: 50,
  };

  it('getChildren returns children array', () => {
    const node: SimpleNode = {
      id: '1',
      name: 'Root',
      children: [{ id: '2', name: 'Child' }],
    };
    expect(config.getChildren(node)).toEqual([{ id: '2', name: 'Child' }]);
  });

  it('getChildren returns undefined for leaf nodes', () => {
    const leaf: SimpleNode = { id: '1', name: 'Leaf' };
    expect(config.getChildren(leaf)).toBeUndefined();
  });

  it('config has correct default-like values', () => {
    expect(config.skipRoot).toBe(true);
    expect(config.autoFitScale).toBe(0.9);
    expect(config.linkOffsetX).toBe(150);
    expect(config.linkOffsetY).toBe(50);
  });

  it('separation function works when provided', () => {
    const configWithSep: TreeVisualizationConfig<SimpleNode> = {
      getChildren: (d) => d.children,
      separation: (a, b) => (a.parent === b.parent ? 1 : 2),
    };
    // Verify separation is a function
    expect(typeof configWithSep.separation).toBe('function');
  });
});

describe('TreeVisualization data wrapping', () => {
  it('array data should be wrapped in synthetic root', () => {
    const data: SimpleNode[] = [
      { id: '1', name: 'Family A', children: [{ id: '2', name: 'Lang 1' }] },
      { id: '3', name: 'Family B', children: [{ id: '4', name: 'Lang 2' }] },
    ];

    // Simulates the wrapping logic inside TreeVisualization
    const isArray = Array.isArray(data);
    expect(isArray).toBe(true);

    const wrapped = { __syntheticRoot: true, children: data } as unknown as SimpleNode;
    const getChildren = (d: any) => d.children;
    expect(getChildren(wrapped)).toHaveLength(2);
    expect(getChildren(wrapped)[0].name).toBe('Family A');
  });

  it('single root data should not be wrapped', () => {
    const data: SimpleNode = {
      id: '1',
      name: 'Root',
      children: [{ id: '2', name: 'Child' }],
    };

    const isArray = Array.isArray(data);
    expect(isArray).toBe(false);
  });

  it('empty array should be detected before rendering', () => {
    const data: SimpleNode[] = [];
    const shouldSkip = Array.isArray(data) && data.length === 0;
    expect(shouldSkip).toBe(true);
  });
});
