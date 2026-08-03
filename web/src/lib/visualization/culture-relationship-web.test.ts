import { describe, it, expect } from 'vitest';
import {
  buildCultureRelationshipGraph,
  computeTimeBounds,
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  __test__,
  type CultureProfileLite,
  type CulturalLineageLite,
  type LanguageContactLite,
  type TradeRouteLite,
  type BattleLite,
  type RelationshipType,
} from './culture-relationship-web';

function profile(overrides: Partial<CultureProfileLite> = {}): CultureProfileLite {
  return {
    id: 'cp-x',
    name: 'Test Culture',
    civilizationId: null,
    region: 'Mesopotamia',
    timePeriodStart: -3000,
    timePeriodEnd: -1000,
    associatedLanguageIds: [],
    associatedReligionIds: [],
    ...overrides,
  };
}

describe('parseYear / parseTimePeriod / intensityScore', () => {
  it('parses negative year strings', () => {
    expect(__test__.parseYear('-2500')).toBe(-2500);
    expect(__test__.parseYear('1066')).toBe(1066);
    expect(__test__.parseYear('')).toBeNull();
    expect(__test__.parseYear(null)).toBeNull();
  });

  it('parses time period strings into ranges', () => {
    expect(__test__.parseTimePeriod('1066-1400')).toEqual({ start: 1066, end: 1400 });
    expect(__test__.parseTimePeriod('-200-450')).toEqual({ start: -200, end: 450 });
    expect(__test__.parseTimePeriod('800')).toEqual({ start: 800, end: 800 });
    expect(__test__.parseTimePeriod('')).toEqual({ start: null, end: null });
  });

  it('assigns intensity scores', () => {
    expect(__test__.intensityScore('heavy')).toBe(3);
    expect(__test__.intensityScore('moderate')).toBe(2);
    expect(__test__.intensityScore('light')).toBe(1);
    expect(__test__.intensityScore('unknown')).toBe(2);
  });
});

describe('buildCultureRelationshipGraph', () => {
  const baseProfiles: CultureProfileLite[] = [
    profile({
      id: 'cp-a',
      name: 'Culture A',
      civilizationId: 'civ-a',
      region: 'Mesopotamia',
      associatedLanguageIds: ['lang-a'],
      associatedReligionIds: ['rel-1'],
      timePeriodStart: -2000,
      timePeriodEnd: 500,
    }),
    profile({
      id: 'cp-b',
      name: 'Culture B',
      civilizationId: 'civ-b',
      region: 'Levant',
      associatedLanguageIds: ['lang-b'],
      associatedReligionIds: ['rel-1'],
      timePeriodStart: -1500,
      timePeriodEnd: 200,
    }),
    profile({
      id: 'cp-c',
      name: 'Culture C',
      civilizationId: 'civ-c',
      region: 'Egypt',
      associatedLanguageIds: ['lang-c'],
      associatedReligionIds: ['rel-2'],
      timePeriodStart: -3000,
      timePeriodEnd: -1000,
    }),
  ];

  it('creates a node per profile with degree-weighted size', () => {
    const battles: BattleLite[] = [
      {
        id: 'b1',
        name: 'Battle X',
        date: '-1200',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'B', civilization_id: 'civ-b' },
        ],
      },
    ];

    const { nodes, links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      battles,
      enabledTypes: new Set<RelationshipType>(['conflict']),
    });
    expect(nodes.map((n) => n.id).sort()).toEqual(['cp-a', 'cp-b', 'cp-c']);
    expect(links.length).toBe(1);
    const nodeA = nodes.find((n) => n.id === 'cp-a')!;
    const nodeC = nodes.find((n) => n.id === 'cp-c')!;
    expect(nodeA.size).toBeGreaterThan(nodeC.size);
  });

  it('builds conflict links from shared battles', () => {
    const battles: BattleLite[] = [
      {
        id: 'b-kadesh',
        name: 'Kadesh',
        date: '-1274',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'B', civilization_id: 'civ-b' },
        ],
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      battles,
      enabledTypes: new Set<RelationshipType>(['conflict']),
    });
    expect(links).toHaveLength(1);
    expect(links[0].relationshipType).toBe('conflict');
    expect(new Set([links[0].source, links[0].target])).toEqual(new Set(['cp-a', 'cp-b']));
  });

  it('builds trade links from shared controlling powers on a route', () => {
    const routes: TradeRouteLite[] = [
      {
        id: 'tr-1',
        name: 'Silk Road',
        controllingPowers: ['civ-a', 'civ-b'],
        startDate: '-200',
        endDate: '1450',
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      tradeRoutes: routes,
      enabledTypes: new Set<RelationshipType>(['trade']),
    });
    expect(links).toHaveLength(1);
    expect(links[0].relationshipType).toBe('trade');
    expect(links[0].description).toBe('Silk Road');
  });

  it('builds linguistic links via shared languages in contacts', () => {
    const contacts: LanguageContactLite[] = [
      {
        id: 'lc-1',
        sourceLanguageId: 'lang-a',
        targetLanguageId: 'lang-b',
        contactType: 'superstrate',
        timePeriod: '-500-500',
        intensity: 'heavy',
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      languageContacts: contacts,
      enabledTypes: new Set<RelationshipType>(['linguistic']),
    });
    expect(links).toHaveLength(1);
    expect(links[0].relationshipType).toBe('linguistic');
    expect(links[0].intensity).toBe(3);
  });

  it('builds lineage links from source/target language IDs', () => {
    const lineages: CulturalLineageLite[] = [
      {
        id: 'cl-1',
        sourceId: 'lang-a',
        targetId: 'lang-b',
        relationshipType: 'influenced',
        timeStart: -1000,
        timeEnd: 0,
        confidence: 75,
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      lineages,
      enabledTypes: new Set<RelationshipType>(['lineage']),
    });
    expect(links).toHaveLength(1);
    expect(links[0].relationshipType).toBe('lineage');
  });

  it('builds religious links between profiles sharing a religion id', () => {
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      enabledTypes: new Set<RelationshipType>(['religious']),
    });
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.relationshipType).toBe('religious');
    expect(new Set([link.source, link.target])).toEqual(new Set(['cp-a', 'cp-b']));
  });

  it('deduplicates links of the same type and merges time ranges', () => {
    const battles: BattleLite[] = [
      {
        id: 'b1',
        name: 'Battle 1',
        date: '-1274',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'B', civilization_id: 'civ-b' },
        ],
      },
      {
        id: 'b2',
        name: 'Battle 2',
        date: '-1200',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'B', civilization_id: 'civ-b' },
        ],
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      battles,
      enabledTypes: new Set<RelationshipType>(['conflict']),
    });
    expect(links).toHaveLength(1);
    expect(links[0].intensity).toBeGreaterThan(2);
    expect(links[0].timeStart).toBeLessThanOrEqual(-1274);
    expect(links[0].timeEnd).toBeGreaterThanOrEqual(-1200);
  });

  it('filters profiles and links by temporal range', () => {
    const battles: BattleLite[] = [
      {
        id: 'b-old',
        name: 'Ancient',
        date: '-2500',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'C', civilization_id: 'civ-c' },
        ],
      },
      {
        id: 'b-recent',
        name: 'Recent',
        date: '200',
        belligerents: [
          { name: 'A', civilization_id: 'civ-a' },
          { name: 'B', civilization_id: 'civ-b' },
        ],
      },
    ];

    const { nodes, links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      battles,
      enabledTypes: new Set<RelationshipType>(['conflict']),
      timeRange: { start: 0, end: 500 },
    });
    expect(nodes.map((n) => n.id).sort()).toEqual(['cp-a', 'cp-b']);
    expect(links).toHaveLength(1);
    expect(links[0].description).toBe('Recent');
  });

  it('respects enabledTypes filter when building graph', () => {
    const lineages: CulturalLineageLite[] = [
      {
        id: 'cl-1',
        sourceId: 'lang-a',
        targetId: 'lang-b',
        relationshipType: 'influenced',
        timeStart: -500,
        timeEnd: 100,
        confidence: 80,
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      lineages,
      enabledTypes: new Set<RelationshipType>(['trade']),
    });
    expect(links).toHaveLength(0);
  });

  it('produces no links when no profile IDs resolve on either end', () => {
    const battles: BattleLite[] = [
      {
        id: 'b',
        name: 'Unknown',
        date: '-1000',
        belligerents: [
          { name: 'X', civilization_id: 'nope-a' },
          { name: 'Y', civilization_id: 'nope-b' },
        ],
      },
    ];
    const { links } = buildCultureRelationshipGraph({
      profiles: baseProfiles,
      battles,
      enabledTypes: new Set<RelationshipType>(['conflict']),
    });
    expect(links).toHaveLength(0);
  });
});

describe('computeTimeBounds', () => {
  it('derives inclusive bounds across profiles and datasets', () => {
    const bounds = computeTimeBounds({
      profiles: [
        profile({ id: 'a', timePeriodStart: -2000, timePeriodEnd: 500 }),
        profile({ id: 'b', timePeriodStart: -1000, timePeriodEnd: 1500 }),
      ],
      battles: [
        {
          id: 'b1',
          name: 'X',
          date: '-2500',
          belligerents: [],
        },
      ],
      tradeRoutes: [
        {
          id: 't',
          name: 'r',
          controllingPowers: [],
          startDate: '-300',
          endDate: '1700',
        },
      ],
    });
    expect(bounds.start).toBe(-2500);
    expect(bounds.end).toBe(1700);
  });

  it('returns fallback bounds when all inputs are empty', () => {
    expect(computeTimeBounds({ profiles: [] })).toEqual({ start: -3000, end: 2000 });
  });
});

describe('relationship metadata', () => {
  it('provides color and label for every relationship type', () => {
    const types: RelationshipType[] = ['lineage', 'linguistic', 'trade', 'conflict', 'religious'];
    for (const t of types) {
      expect(RELATIONSHIP_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(RELATIONSHIP_LABELS[t]).toBeTruthy();
    }
  });
});
