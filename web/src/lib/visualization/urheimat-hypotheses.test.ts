import { describe, it, expect } from 'vitest';
import {
  parseHypothesisRouteLinks,
  loadHypothesisRouteLinks,
  toggleHypothesis,
  getHypothesisById,
  groupHypothesesByFamily,
  competingFamilies,
  resolveAssociatedRouteIds,
  selectRoutesForHypothesis,
  routeEmphasis,
  partitionRoutes,
  consensusLabel,
  consensusBadgeColor,
  familyLabel,
  type UrheimatHypothesisLike,
  type HypothesisRouteLinks,
} from './urheimat-hypotheses';

function hyp(over: Partial<UrheimatHypothesisLike> & { id: string }): UrheimatHypothesisLike {
  return {
    languageFamilyId: 'indo-european',
    hypothesisName: over.id,
    proposedRegion: 'Somewhere',
    scholarlyConsensusLevel: 50,
    keyProponents: [],
    competingHypotheses: [],
    sources: [],
    ...over,
  };
}

const LINKS: HypothesisRouteLinks = {
  byFamily: {
    'indo-european': ['ie-expansion', 'indo-aryan'],
    uralic: ['uralic-migration'],
  },
  byHypothesis: {
    'ie-anatolian': ['ie-expansion'],
  },
};

describe('parseHypothesisRouteLinks', () => {
  it('parses well-formed link maps and dedups route ids', () => {
    const parsed = parseHypothesisRouteLinks({
      byFamily: { 'indo-european': ['a', 'a', 'b'] },
      byHypothesis: { x: ['c'] },
    });
    expect(parsed.byFamily['indo-european']).toEqual(['a', 'b']);
    expect(parsed.byHypothesis.x).toEqual(['c']);
  });

  it('degrades malformed input to empty maps rather than throwing', () => {
    expect(parseHypothesisRouteLinks(null)).toEqual({ byFamily: {}, byHypothesis: {} });
    expect(parseHypothesisRouteLinks({ byFamily: 'nope' })).toEqual({
      byFamily: {},
      byHypothesis: {},
    });
    // Non-string-array values are dropped.
    const parsed = parseHypothesisRouteLinks({ byFamily: { good: ['a'], bad: [1, 2] } });
    expect(parsed.byFamily).toEqual({ good: ['a'] });
  });

  it('loads bundled authored links with expected shape', () => {
    const links = loadHypothesisRouteLinks();
    expect(links.byFamily['indo-european']).toContain('indo-european-expansion');
    // The Anatolian override differs from the family default.
    expect(links.byHypothesis['ie-anatolian']).toEqual(['indo-european-expansion']);
  });
});

describe('toggleHypothesis', () => {
  it('selects, switches, and toggles off', () => {
    expect(toggleHypothesis(null, 'a')).toBe('a');
    expect(toggleHypothesis('a', 'b')).toBe('b');
    expect(toggleHypothesis('a', 'a')).toBeNull();
  });
});

describe('groupHypothesesByFamily / competingFamilies', () => {
  const hyps = [
    hyp({ id: 'ie-steppe', languageFamilyId: 'indo-european', scholarlyConsensusLevel: 70 }),
    hyp({ id: 'ie-anatolian', languageFamilyId: 'indo-european', scholarlyConsensusLevel: 40 }),
    hyp({ id: 'uralic-1', languageFamilyId: 'uralic', scholarlyConsensusLevel: 55 }),
  ];

  it('groups by family in first-seen order, sorted by consensus desc within', () => {
    const groups = groupHypothesesByFamily(hyps);
    expect(groups.map((g) => g.familyId)).toEqual(['indo-european', 'uralic']);
    expect(groups[0].hypotheses.map((h) => h.id)).toEqual(['ie-steppe', 'ie-anatolian']);
  });

  it('competingFamilies keeps only families with 2+ hypotheses', () => {
    const comp = competingFamilies(hyps);
    expect(comp.map((g) => g.familyId)).toEqual(['indo-european']);
  });
});

describe('resolveAssociatedRouteIds', () => {
  it('uses per-hypothesis override when present', () => {
    expect(resolveAssociatedRouteIds(hyp({ id: 'ie-anatolian' }), LINKS)).toEqual(['ie-expansion']);
  });

  it('falls back to the family default', () => {
    expect(resolveAssociatedRouteIds(hyp({ id: 'ie-steppe' }), LINKS)).toEqual([
      'ie-expansion',
      'indo-aryan',
    ]);
  });

  it('returns empty for a family with no links', () => {
    expect(
      resolveAssociatedRouteIds(hyp({ id: 'x', languageFamilyId: 'unknown-family' }), LINKS),
    ).toEqual([]);
  });
});

describe('selectRoutesForHypothesis', () => {
  it('returns an empty selection with no active hypothesis', () => {
    expect(selectRoutesForHypothesis(null, LINKS)).toEqual({
      hypothesisId: null,
      familyId: null,
      associatedRouteIds: [],
    });
  });

  it('drives family routes from the selected hypothesis', () => {
    expect(selectRoutesForHypothesis(hyp({ id: 'ie-steppe' }), LINKS)).toEqual({
      hypothesisId: 'ie-steppe',
      familyId: 'indo-european',
      associatedRouteIds: ['ie-expansion', 'indo-aryan'],
    });
  });

  it('competing hypotheses of the same family can select different routes', () => {
    const steppe = selectRoutesForHypothesis(hyp({ id: 'ie-steppe' }), LINKS);
    const anatolian = selectRoutesForHypothesis(hyp({ id: 'ie-anatolian' }), LINKS);
    expect(steppe.associatedRouteIds).not.toEqual(anatolian.associatedRouteIds);
    expect(anatolian.associatedRouteIds).toEqual(['ie-expansion']);
  });
});

describe('routeEmphasis / partitionRoutes', () => {
  const allRoutes = ['ie-expansion', 'indo-aryan', 'silk-road', 'bantu-expansion'];

  it('everything is normal with no active hypothesis', () => {
    const sel = selectRoutesForHypothesis(null, LINKS);
    for (const r of allRoutes) expect(routeEmphasis(r, sel)).toBe('normal');
    expect(partitionRoutes(allRoutes, sel)).toEqual({ highlighted: [], dimmed: [] });
  });

  it('highlights associated routes and dims the rest when active', () => {
    const sel = selectRoutesForHypothesis(hyp({ id: 'ie-steppe' }), LINKS);
    expect(routeEmphasis('ie-expansion', sel)).toBe('highlight');
    expect(routeEmphasis('indo-aryan', sel)).toBe('highlight');
    expect(routeEmphasis('silk-road', sel)).toBe('dim');
    expect(routeEmphasis('bantu-expansion', sel)).toBe('dim');

    expect(partitionRoutes(allRoutes, sel)).toEqual({
      highlighted: ['ie-expansion', 'indo-aryan'],
      dimmed: ['silk-road', 'bantu-expansion'],
    });
  });
});

describe('getHypothesisById', () => {
  const hyps = [hyp({ id: 'a' }), hyp({ id: 'b' })];
  it('finds by id, returns null for missing/empty', () => {
    expect(getHypothesisById(hyps, 'b')?.id).toBe('b');
    expect(getHypothesisById(hyps, 'zzz')).toBeNull();
    expect(getHypothesisById(hyps, null)).toBeNull();
  });
});

describe('labels', () => {
  it('consensusLabel tiers', () => {
    expect(consensusLabel(85)).toBe('Strong consensus');
    expect(consensusLabel(65)).toBe('Moderate consensus');
    expect(consensusLabel(45)).toBe('Debated');
    expect(consensusLabel(25)).toBe('Minority view');
    expect(consensusLabel(10)).toBe('Fringe hypothesis');
  });

  it('consensusBadgeColor maps to tailwind classes', () => {
    expect(consensusBadgeColor(85)).toContain('green');
    expect(consensusBadgeColor(10)).toContain('red');
  });

  it('familyLabel titlecases a family id', () => {
    expect(familyLabel('indo-european')).toBe('Indo European');
    expect(familyLabel('niger-congo')).toBe('Niger Congo');
    expect(familyLabel('root__sino-tibetan')).toBe('Sino Tibetan');
  });
});
