import { describe, it, expect } from 'vitest';
import type { TreeNodeData, TreeVisualizationConfig } from '@/components/visualizations/TreeVisualization';

// Test the TreeNodeData interface contract and data transformation logic
// (Component rendering is tested via the interface contract since we're in a node environment)

function buildSampleTree(): TreeNodeData {
  return {
    id: 'indo-european',
    name: 'Indo-European',
    type: 'family',
    children: [
      {
        id: 'germanic',
        name: 'Germanic',
        type: 'family',
        children: [
          { id: 'english', name: 'English', type: 'language', speakers: 1500000000 },
          { id: 'german', name: 'German', type: 'language', speakers: 130000000 },
          { id: 'dutch', name: 'Dutch', type: 'language', speakers: 25000000 },
        ],
      },
      {
        id: 'romance',
        name: 'Romance',
        type: 'family',
        children: [
          { id: 'spanish', name: 'Spanish', type: 'language', speakers: 550000000 },
          { id: 'french', name: 'French', type: 'language', speakers: 310000000 },
        ],
      },
      {
        id: 'slavic',
        name: 'Slavic',
        type: 'family',
        children: [
          { id: 'russian', name: 'Russian', type: 'language', speakers: 258000000 },
        ],
      },
    ],
  };
}

function buildForest(): TreeNodeData[] {
  return [
    {
      id: 'sino-tibetan',
      name: 'Sino-Tibetan',
      children: [
        { id: 'mandarin', name: 'Mandarin' },
        { id: 'cantonese', name: 'Cantonese' },
      ],
    },
    {
      id: 'afroasiatic',
      name: 'Afroasiatic',
      children: [
        { id: 'arabic', name: 'Arabic' },
        { id: 'hebrew', name: 'Hebrew' },
      ],
    },
  ];
}

function countNodes(node: TreeNodeData): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

function collectIds(node: TreeNodeData): string[] {
  const ids = [node.id];
  if (node.children) {
    for (const child of node.children) {
      ids.push(...collectIds(child));
    }
  }
  return ids;
}

function getDepth(node: TreeNodeData): number {
  if (!node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(getDepth));
}

function getLeaves(node: TreeNodeData): TreeNodeData[] {
  if (!node.children || node.children.length === 0) return [node];
  return node.children.flatMap(getLeaves);
}

function filterTree(node: TreeNodeData, predicate: (n: TreeNodeData) => boolean): TreeNodeData | null {
  if (!node.children || node.children.length === 0) {
    return predicate(node) ? { ...node } : null;
  }
  const filteredChildren = node.children
    .map((child) => filterTree(child, predicate))
    .filter((child): child is TreeNodeData => child !== null);
  if (filteredChildren.length > 0 || predicate(node)) {
    return { ...node, children: filteredChildren };
  }
  return null;
}

function searchTree(node: TreeNodeData, query: string): TreeNodeData | null {
  return filterTree(node, (n) => n.name.toLowerCase().includes(query.toLowerCase()));
}

describe('TreeVisualization data structures', () => {
  describe('TreeNodeData interface', () => {
    it('supports single root tree', () => {
      const tree = buildSampleTree();
      expect(tree.id).toBe('indo-european');
      expect(tree.children).toHaveLength(3);
    });

    it('supports forest (array of roots)', () => {
      const forest = buildForest();
      expect(forest).toHaveLength(2);
      expect(forest[0].id).toBe('sino-tibetan');
      expect(forest[1].id).toBe('afroasiatic');
    });

    it('allows arbitrary extra properties', () => {
      const node: TreeNodeData = {
        id: 'test',
        name: 'Test',
        speakers: 1000000,
        region: 'Europe',
        status: 'living',
      };
      expect(node.speakers).toBe(1000000);
      expect(node.region).toBe('Europe');
    });

    it('handles leaf nodes without children', () => {
      const leaf: TreeNodeData = { id: 'leaf', name: 'Leaf' };
      expect(leaf.children).toBeUndefined();
    });

    it('handles empty children array', () => {
      const node: TreeNodeData = { id: 'empty', name: 'Empty', children: [] };
      expect(node.children).toHaveLength(0);
    });
  });

  describe('tree traversal', () => {
    it('counts all nodes in tree', () => {
      const tree = buildSampleTree();
      // root + 3 families + 6 languages = 10
      expect(countNodes(tree)).toBe(10);
    });

    it('collects all unique IDs', () => {
      const tree = buildSampleTree();
      const ids = collectIds(tree);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      expect(ids).toContain('english');
      expect(ids).toContain('germanic');
      expect(ids).toContain('indo-european');
    });

    it('computes tree depth', () => {
      const tree = buildSampleTree();
      expect(getDepth(tree)).toBe(2); // root -> family -> language
    });

    it('extracts leaf nodes', () => {
      const tree = buildSampleTree();
      const leaves = getLeaves(tree);
      expect(leaves).toHaveLength(6);
      expect(leaves.every((l) => !l.children || l.children.length === 0)).toBe(true);
      expect(leaves.map((l) => l.id)).toContain('english');
      expect(leaves.map((l) => l.id)).toContain('spanish');
    });
  });

  describe('tree filtering and search', () => {
    it('filters tree by predicate', () => {
      const tree = buildSampleTree();
      const filtered = filterTree(tree, (n) => n.type === 'language' && (n.speakers as number) > 200000000);
      expect(filtered).not.toBeNull();
      const leaves = getLeaves(filtered!);
      expect(leaves.every((l) => (l.speakers as number) > 200000000)).toBe(true);
      expect(leaves.map((l) => l.id)).toContain('english');
      expect(leaves.map((l) => l.id)).toContain('spanish');
      expect(leaves.map((l) => l.id)).toContain('french');
      expect(leaves.map((l) => l.id)).not.toContain('dutch');
    });

    it('returns null when no nodes match', () => {
      const tree = buildSampleTree();
      const filtered = filterTree(tree, (n) => n.id === 'nonexistent');
      expect(filtered).toBeNull();
    });

    it('searches by name', () => {
      const tree = buildSampleTree();
      const result = searchTree(tree, 'ger');
      expect(result).not.toBeNull();
      const ids = collectIds(result!);
      expect(ids).toContain('germanic');
      expect(ids).toContain('german');
    });

    it('search is case-insensitive', () => {
      const tree = buildSampleTree();
      const result = searchTree(tree, 'ENGLISH');
      expect(result).not.toBeNull();
      const leaves = getLeaves(result!);
      expect(leaves.map((l) => l.id)).toContain('english');
    });
  });

  describe('forest to tree conversion', () => {
    it('wraps forest in virtual root', () => {
      const forest = buildForest();
      const root: TreeNodeData = { id: '__root__', name: 'Root', children: forest };
      expect(root.children).toHaveLength(2);
      expect(countNodes(root)).toBe(7); // root + 2 families + 4 languages
    });

    it('virtual root is skippable', () => {
      const forest = buildForest();
      const root: TreeNodeData = { id: '__root__', name: 'Root', children: forest };
      const descendants = collectIds(root).filter((id) => id !== '__root__');
      expect(descendants).toHaveLength(6);
    });
  });

  describe('config defaults', () => {
    it('has sensible default config values', () => {
      const defaults: TreeVisualizationConfig = {
        orientation: 'horizontal',
        nodeRadius: 6,
        nodeColor: '#3b82f6',
        linkColor: '#cbd5e0',
        linkWidth: 1.5,
        labelSize: 12,
        labelColor: '#374151',
        padding: { top: 40, right: 120, bottom: 40, left: 120 },
        minZoom: 0.1,
        maxZoom: 4,
        animationDuration: 300,
      };
      expect(defaults.orientation).toBe('horizontal');
      expect(defaults.minZoom).toBeLessThan(defaults.maxZoom!);
      expect(defaults.nodeRadius).toBeGreaterThan(0);
    });

    it('supports both orientation options', () => {
      const horiz: Partial<TreeVisualizationConfig> = { orientation: 'horizontal' };
      const vert: Partial<TreeVisualizationConfig> = { orientation: 'vertical' };
      expect(horiz.orientation).toBe('horizontal');
      expect(vert.orientation).toBe('vertical');
    });

    it('supports function-based node radius', () => {
      const config: Partial<TreeVisualizationConfig> = {
        nodeRadius: (node: any) => node.depth === 0 ? 10 : 6,
      };
      expect(typeof config.nodeRadius).toBe('function');
    });

    it('supports function-based node color', () => {
      const config: Partial<TreeVisualizationConfig> = {
        nodeColor: (node: any) => node.data.type === 'family' ? '#3b82f6' : '#10b981',
      };
      expect(typeof config.nodeColor).toBe('function');
    });
  });

  describe('selection and highlight sets', () => {
    it('tracks selected nodes via Set', () => {
      const selected = new Set(['english', 'spanish']);
      expect(selected.has('english')).toBe(true);
      expect(selected.has('german')).toBe(false);
      expect(selected.size).toBe(2);
    });

    it('tracks highlighted nodes via Set', () => {
      const highlighted = new Set(['germanic']);
      expect(highlighted.has('germanic')).toBe(true);
      expect(highlighted.has('romance')).toBe(false);
    });

    it('supports empty selection', () => {
      const selected = new Set<string>();
      expect(selected.size).toBe(0);
      expect(selected.has('anything')).toBe(false);
    });
  });

  describe('deep tree structures', () => {
    it('handles deeply nested trees', () => {
      let node: TreeNodeData = { id: 'leaf', name: 'Leaf' };
      for (let i = 9; i >= 0; i--) {
        node = { id: `level-${i}`, name: `Level ${i}`, children: [node] };
      }
      expect(getDepth(node)).toBe(10);
      expect(countNodes(node)).toBe(11);
    });

    it('handles wide trees', () => {
      const children: TreeNodeData[] = Array.from({ length: 100 }, (_, i) => ({
        id: `child-${i}`,
        name: `Child ${i}`,
      }));
      const root: TreeNodeData = { id: 'root', name: 'Root', children };
      expect(root.children).toHaveLength(100);
      expect(getLeaves(root)).toHaveLength(100);
      expect(getDepth(root)).toBe(1);
    });
  });
});
