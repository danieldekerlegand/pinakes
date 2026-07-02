import { describe, it, expect } from 'vitest';
import type { TreeNodeData } from './shared/TreeVisualization';

// Replicate the tree-building logic from WritingSystemEvolutionView
// to test it in isolation without DOM dependencies

interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

function buildTree(systems: WritingSystem[]): TreeNodeData | null {
  if (systems.length === 0) return null;

  const nodeMap = new Map<string, TreeNodeData>();
  systems.forEach(function (sys) {
    nodeMap.set(sys.id, {
      id: sys.id,
      label: sys.name,
      parentId: sys.parentSystemId || null,
      children: [],
      metadata: {
        type: sys.type,
        direction: sys.direction,
        originDate: sys.originDate,
        originRegion: sys.originRegion,
        sampleCharacters: sys.sampleCharacters,
        characterCount: sys.characterCount,
        isActive: sys.isActive,
      },
    });
  });

  const roots: TreeNodeData[] = [];
  nodeMap.forEach(function (node) {
    const parentId = node.parentId;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });

  if (roots.length === 1) return roots[0];
  return {
    id: 'root',
    label: 'Writing Systems',
    children: roots,
    metadata: { type: 'root', isActive: true },
  };
}

const TYPE_COLORS: Record<string, string> = {
  alphabet: '#3b82f6',
  abjad: '#10b981',
  abugida: '#f59e0b',
  syllabary: '#8b5cf6',
  logographic: '#ef4444',
  featural: '#ec4899',
};

function getNodeColor(node: TreeNodeData): string {
  const type = node.metadata?.type as string;
  if (type === 'root') return '#6b7280';
  return TYPE_COLORS[type] || '#6b7280';
}

function formatOriginDate(date: string): string {
  if (date.startsWith('-')) return date.slice(1) + ' BCE';
  return date + ' CE';
}

function makeSys(overrides: Partial<WritingSystem> & { id: string; name: string }): WritingSystem {
  return {
    type: 'alphabet',
    direction: 'LTR',
    parentSystemId: '',
    languageIds: [],
    originDate: '0',
    originRegion: 'Test',
    characterCount: 26,
    sampleCharacters: 'ABC',
    unicodeBlock: 'Basic Latin',
    isActive: true,
    ...overrides,
  };
}

describe('WritingSystemEvolutionView tree building', () => {
  it('returns null for empty systems', () => {
    expect(buildTree([])).toBeNull();
  });

  it('builds single root when one system has no parent', () => {
    const systems = [makeSys({ id: 'ws_001', name: 'Latin' })];
    const tree = buildTree(systems);
    expect(tree).not.toBeNull();
    expect(tree!.id).toBe('ws_001');
    expect(tree!.label).toBe('Latin');
    expect(tree!.children).toHaveLength(0);
  });

  it('builds parent-child relationships correctly', () => {
    const systems = [
      makeSys({ id: 'ws_001', name: 'Phoenician' }),
      makeSys({ id: 'ws_002', name: 'Greek', parentSystemId: 'ws_001' }),
      makeSys({ id: 'ws_003', name: 'Latin', parentSystemId: 'ws_002' }),
    ];
    const tree = buildTree(systems);
    expect(tree!.id).toBe('ws_001');
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children![0].id).toBe('ws_002');
    expect(tree!.children![0].children).toHaveLength(1);
    expect(tree!.children![0].children![0].id).toBe('ws_003');
  });

  it('creates virtual root for multiple root systems', () => {
    const systems = [
      makeSys({ id: 'ws_001', name: 'Latin' }),
      makeSys({ id: 'ws_002', name: 'Hangul', type: 'featural' }),
    ];
    const tree = buildTree(systems);
    expect(tree!.id).toBe('root');
    expect(tree!.label).toBe('Writing Systems');
    expect(tree!.children).toHaveLength(2);
  });

  it('handles orphaned parent references as roots', () => {
    const systems = [
      makeSys({ id: 'ws_001', name: 'Latin', parentSystemId: 'nonexistent' }),
    ];
    const tree = buildTree(systems);
    expect(tree!.id).toBe('ws_001');
    expect(tree!.children).toHaveLength(0);
  });

  it('preserves metadata on nodes', () => {
    const systems = [
      makeSys({
        id: 'ws_007',
        name: 'Chinese (Hanzi)',
        type: 'logographic',
        direction: 'LTR',
        originDate: '-1200',
        originRegion: 'China',
        characterCount: 50000,
        sampleCharacters: '人 大 中',
        isActive: true,
      }),
    ];
    const tree = buildTree(systems);
    expect(tree!.metadata?.type).toBe('logographic');
    expect(tree!.metadata?.originRegion).toBe('China');
    expect(tree!.metadata?.characterCount).toBe(50000);
    expect(tree!.metadata?.isActive).toBe(true);
  });

  it('builds complex multi-branch tree', () => {
    const systems = [
      makeSys({ id: 'p', name: 'Phoenician' }),
      makeSys({ id: 'g', name: 'Greek', parentSystemId: 'p' }),
      makeSys({ id: 'l', name: 'Latin', parentSystemId: 'g' }),
      makeSys({ id: 'c', name: 'Cyrillic', parentSystemId: 'g' }),
      makeSys({ id: 'a', name: 'Aramaic', type: 'abjad', parentSystemId: 'p' }),
      makeSys({ id: 'h', name: 'Hebrew', type: 'abjad', parentSystemId: 'a' }),
      makeSys({ id: 'ar', name: 'Arabic', type: 'abjad', parentSystemId: 'a' }),
    ];
    const tree = buildTree(systems);
    expect(tree!.id).toBe('p');
    expect(tree!.children).toHaveLength(2); // Greek and Aramaic
    const greek = tree!.children!.find(c => c.id === 'g');
    expect(greek!.children).toHaveLength(2); // Latin and Cyrillic
    const aramaic = tree!.children!.find(c => c.id === 'a');
    expect(aramaic!.children).toHaveLength(2); // Hebrew and Arabic
  });
});

describe('WritingSystemEvolutionView helpers', () => {
  it('colors nodes by type', () => {
    expect(getNodeColor({ id: '1', label: 'test', metadata: { type: 'alphabet' } })).toBe('#3b82f6');
    expect(getNodeColor({ id: '2', label: 'test', metadata: { type: 'abjad' } })).toBe('#10b981');
    expect(getNodeColor({ id: '3', label: 'test', metadata: { type: 'logographic' } })).toBe('#ef4444');
    expect(getNodeColor({ id: '4', label: 'test', metadata: { type: 'root' } })).toBe('#6b7280');
    expect(getNodeColor({ id: '5', label: 'test', metadata: { type: 'unknown' } })).toBe('#6b7280');
  });

  it('formats origin dates correctly', () => {
    expect(formatOriginDate('-1200')).toBe('1200 BCE');
    expect(formatOriginDate('900')).toBe('900 CE');
    expect(formatOriginDate('-700')).toBe('700 BCE');
    expect(formatOriginDate('1443')).toBe('1443 CE');
  });
});

describe('TreeNodeData interface', () => {
  it('supports optional fields', () => {
    const node: TreeNodeData = { id: '1', label: 'Test' };
    expect(node.parentId).toBeUndefined();
    expect(node.children).toBeUndefined();
    expect(node.metadata).toBeUndefined();
  });

  it('supports full fields', () => {
    const node: TreeNodeData = {
      id: '1',
      label: 'Test',
      parentId: 'parent',
      children: [{ id: '2', label: 'Child' }],
      metadata: { key: 'value' },
    };
    expect(node.children).toHaveLength(1);
    expect(node.metadata?.key).toBe('value');
  });
});
