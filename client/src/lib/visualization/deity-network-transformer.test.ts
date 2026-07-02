import { describe, it, expect } from 'vitest';
import {
  buildDeityNetwork,
  filterDeityNetwork,
  type DeityData,
} from './deity-network-transformer';

const sampleDeities: DeityData[] = [
  {
    id: 'zeus',
    name: 'Zeus',
    nativeName: 'Ζεύς',
    mythology: 'greek',
    domain: ['sky', 'thunder', 'kingship'],
    equivalentDeityIds: ['jupiter', 'thor'],
  },
  {
    id: 'athena',
    name: 'Athena',
    nativeName: 'Ἀθηνᾶ',
    mythology: 'greek',
    domain: ['wisdom', 'warfare'],
    equivalentDeityIds: ['minerva'],
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    nativeName: 'Iuppiter',
    mythology: 'roman',
    domain: ['sky', 'thunder', 'kingship'],
    equivalentDeityIds: ['zeus'],
  },
  {
    id: 'minerva',
    name: 'Minerva',
    nativeName: 'Minerva',
    mythology: 'roman',
    domain: ['wisdom', 'warfare'],
    equivalentDeityIds: ['athena'],
  },
  {
    id: 'thor',
    name: 'Thor',
    nativeName: 'Þórr',
    mythology: 'norse',
    domain: ['thunder', 'strength'],
    equivalentDeityIds: ['zeus'],
  },
];

describe('buildDeityNetwork', () => {
  it('creates pantheon hub nodes for each unique mythology', () => {
    const result = buildDeityNetwork(sampleDeities);
    const pantheonNodes = result.nodes.filter((n) => n.type === 'family');
    expect(pantheonNodes.map((n) => n.group).sort()).toEqual(['greek', 'norse', 'roman']);
    expect(result.pantheons).toEqual(['greek', 'norse', 'roman']);
  });

  it('creates deity nodes with correct group assignment', () => {
    const result = buildDeityNetwork(sampleDeities);
    const deityNodes = result.nodes.filter((n) => n.type === 'language');
    expect(deityNodes).toHaveLength(5);

    const zeus = deityNodes.find((n) => n.id === 'zeus');
    expect(zeus).toBeDefined();
    expect(zeus!.group).toBe('greek');
    expect(zeus!.name).toBe('Zeus');
  });

  it('creates pantheon membership links for every deity', () => {
    const result = buildDeityNetwork(sampleDeities);
    const membershipLinks = result.links.filter((l) => l.type === 'family-child');
    expect(membershipLinks).toHaveLength(5);

    // Zeus should link to pantheon-greek
    const zeusLink = membershipLinks.find((l) => l.target === 'zeus');
    expect(zeusLink).toBeDefined();
    expect(zeusLink!.source).toBe('pantheon-greek');
  });

  it('creates syncretism links between equivalent deities without duplicates', () => {
    const result = buildDeityNetwork(sampleDeities);
    const syncLinks = result.links.filter((l) => l.type === 'language-family');

    // zeus<->jupiter, zeus<->thor, athena<->minerva = 3 unique links
    expect(syncLinks).toHaveLength(3);

    // Check no duplicate (both zeus->jupiter and jupiter->zeus should produce only one link)
    const linkKeys = syncLinks.map((l) => {
      const src = typeof l.source === 'string' ? l.source : l.source.id;
      const tgt = typeof l.target === 'string' ? l.target : l.target.id;
      return [src, tgt].sort().join('::');
    });
    const unique = new Set(linkKeys);
    expect(unique.size).toBe(linkKeys.length);
  });

  it('ignores syncretism references to deities not in the dataset', () => {
    const limited: DeityData[] = [
      {
        id: 'zeus',
        name: 'Zeus',
        nativeName: 'Ζεύς',
        mythology: 'greek',
        domain: ['sky'],
        equivalentDeityIds: ['jupiter', 'nonexistent-deity'],
      },
    ];
    const result = buildDeityNetwork(limited);
    const syncLinks = result.links.filter((l) => l.type === 'language-family');
    expect(syncLinks).toHaveLength(0);
  });

  it('handles empty input', () => {
    const result = buildDeityNetwork([]);
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(result.pantheons).toHaveLength(0);
  });

  it('scales node sizes based on deity domain count', () => {
    const result = buildDeityNetwork(sampleDeities);
    const zeus = result.nodes.find((n) => n.id === 'zeus')!;
    const athena = result.nodes.find((n) => n.id === 'athena')!;
    // Zeus has 3 domains, Athena has 2
    expect(zeus.size).toBeGreaterThan(athena.size);
  });
});

describe('filterDeityNetwork', () => {
  it('returns full network when no filter is applied', () => {
    const full = buildDeityNetwork(sampleDeities);
    const filtered = filterDeityNetwork(full, null);
    expect(filtered.nodes).toHaveLength(full.nodes.length);
    expect(filtered.links).toHaveLength(full.links.length);
  });

  it('returns full network when filter set is empty', () => {
    const full = buildDeityNetwork(sampleDeities);
    const filtered = filterDeityNetwork(full, new Set());
    expect(filtered.nodes).toHaveLength(full.nodes.length);
  });

  it('filters to only selected pantheons', () => {
    const full = buildDeityNetwork(sampleDeities);
    const filtered = filterDeityNetwork(full, new Set(['greek']));

    // Should have pantheon-greek + zeus + athena = 3 nodes
    expect(filtered.nodes).toHaveLength(3);
    expect(filtered.nodes.every((n) => n.group === 'greek')).toBe(true);
  });

  it('removes cross-pantheon syncretism links when one side is filtered out', () => {
    const full = buildDeityNetwork(sampleDeities);
    const filtered = filterDeityNetwork(full, new Set(['greek']));

    // Only membership links remain, no syncretism links (roman/norse filtered out)
    const syncLinks = filtered.links.filter((l) => l.type === 'language-family');
    expect(syncLinks).toHaveLength(0);
  });

  it('keeps syncretism links between included pantheons', () => {
    const full = buildDeityNetwork(sampleDeities);
    const filtered = filterDeityNetwork(full, new Set(['greek', 'roman']));

    const syncLinks = filtered.links.filter((l) => l.type === 'language-family');
    // zeus<->jupiter, athena<->minerva = 2 links
    expect(syncLinks).toHaveLength(2);
  });
});
