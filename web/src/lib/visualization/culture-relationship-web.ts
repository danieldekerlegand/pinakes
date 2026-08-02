import type {
  NetworkGraphNode,
  NetworkGraphLink,
} from '../../components/visualizations/shared/NetworkGraph';

export type RelationshipType =
  | 'lineage'
  | 'linguistic'
  | 'trade'
  | 'conflict'
  | 'religious';

export interface CultureProfileLite {
  id: string;
  name: string;
  civilizationId: string | null;
  region: string;
  timePeriodStart: number;
  timePeriodEnd: number;
  associatedLanguageIds: string[];
  associatedReligionIds: string[];
}

export interface CulturalLineageLite {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  timeStart: number;
  timeEnd: number;
  confidence: number;
}

export interface LanguageContactLite {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  intensity: string;
}

export interface TradeRouteLite {
  id: string;
  name: string;
  controllingPowers: string[];
  startDate: string;
  endDate: string;
}

export interface BattleLite {
  id: string;
  name: string;
  date: string;
  belligerents: Array<{ name: string; civilization_id: string | null }>;
}

export interface CultureRelationshipLink extends NetworkGraphLink {
  relationshipType: RelationshipType;
  intensity: number;
  timeStart: number;
  timeEnd: number;
  description: string;
}

export interface CultureRelationshipNode extends NetworkGraphNode {
  id: string;
  name: string;
  group: string;
  size: number;
  timePeriodStart: number;
  timePeriodEnd: number;
  civilizationId: string | null;
}

export interface CultureRelationshipGraph {
  nodes: CultureRelationshipNode[];
  links: CultureRelationshipLink[];
}

export const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  lineage: '#8b5cf6',
  linguistic: '#3b82f6',
  trade: '#f59e0b',
  conflict: '#ef4444',
  religious: '#10b981',
};

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  lineage: 'Cultural Lineage',
  linguistic: 'Linguistic Contact',
  trade: 'Trade',
  conflict: 'Military Conflict',
  religious: 'Religious Diffusion',
};

function parseYear(value: string | number | undefined | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).match(/-?\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

function parseTimePeriod(period: string): { start: number | null; end: number | null } {
  if (!period) return { start: null, end: null };
  const trimmed = period.trim();
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const parts = body.split(/[-\u2013\u2014]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    return {
      start: Number.isFinite(start) ? (negative ? -start : start) : null,
      end: Number.isFinite(end) ? end : null,
    };
  }
  const year = parseInt(body, 10);
  if (!Number.isFinite(year)) return { start: null, end: null };
  const signed = negative ? -year : year;
  return { start: signed, end: signed };
}

function intensityScore(level: string): number {
  const s = (level || '').toLowerCase();
  if (s.includes('heavy') || s === 'strong') return 3;
  if (s.includes('moderate') || s === 'medium') return 2;
  if (s.includes('light') || s === 'weak') return 1;
  return 2;
}

function addLink(
  dedup: Map<string, CultureRelationshipLink>,
  a: string,
  b: string,
  link: Omit<CultureRelationshipLink, 'source' | 'target'>,
) {
  if (a === b) return;
  const key = a < b
    ? `${a}||${b}||${link.relationshipType}`
    : `${b}||${a}||${link.relationshipType}`;

  const existing = dedup.get(key);
  if (existing) {
    existing.intensity += link.intensity;
    if (link.timeStart < existing.timeStart) existing.timeStart = link.timeStart;
    if (link.timeEnd > existing.timeEnd) existing.timeEnd = link.timeEnd;
    return;
  }

  dedup.set(key, {
    source: a,
    target: b,
    ...link,
  });
}

interface BuildInput {
  profiles: CultureProfileLite[];
  lineages?: CulturalLineageLite[];
  languageContacts?: LanguageContactLite[];
  tradeRoutes?: TradeRouteLite[];
  battles?: BattleLite[];
  enabledTypes?: Set<RelationshipType>;
  timeRange?: { start: number; end: number };
}

/**
 * Lineage IDs reference language proto-forms; link culture profiles whose
 * associated languages appear as source/target of a lineage record.
 */
function buildLineageLinks(
  profiles: CultureProfileLite[],
  lineages: CulturalLineageLite[],
  dedup: Map<string, CultureRelationshipLink>,
  timeRange?: { start: number; end: number },
) {
  const profilesByLang = new Map<string, CultureProfileLite[]>();
  for (const p of profiles) {
    for (const lang of p.associatedLanguageIds) {
      if (!profilesByLang.has(lang)) profilesByLang.set(lang, []);
      profilesByLang.get(lang)!.push(p);
    }
  }

  for (const lin of lineages) {
    if (timeRange && (lin.timeEnd < timeRange.start || lin.timeStart > timeRange.end)) {
      continue;
    }
    const sources = profilesByLang.get(lin.sourceId) ?? [];
    const targets = profilesByLang.get(lin.targetId) ?? [];
    for (const s of sources) {
      for (const t of targets) {
        addLink(dedup, s.id, t.id, {
          relationshipType: 'lineage',
          intensity: Math.max(1, Math.round((lin.confidence || 50) / 25)),
          timeStart: lin.timeStart,
          timeEnd: lin.timeEnd,
          description: lin.relationshipType,
        });
      }
    }
  }
}

function buildLinguisticLinks(
  profiles: CultureProfileLite[],
  contacts: LanguageContactLite[],
  dedup: Map<string, CultureRelationshipLink>,
  timeRange?: { start: number; end: number },
) {
  const profilesByLang = new Map<string, CultureProfileLite[]>();
  for (const p of profiles) {
    for (const lang of p.associatedLanguageIds) {
      if (!profilesByLang.has(lang)) profilesByLang.set(lang, []);
      profilesByLang.get(lang)!.push(p);
    }
  }

  for (const c of contacts) {
    const { start, end } = parseTimePeriod(c.timePeriod);
    const cStart = start ?? -10000;
    const cEnd = end ?? new Date().getFullYear();
    if (timeRange && (cEnd < timeRange.start || cStart > timeRange.end)) continue;

    const sources = profilesByLang.get(c.sourceLanguageId) ?? [];
    const targets = profilesByLang.get(c.targetLanguageId) ?? [];
    for (const s of sources) {
      for (const t of targets) {
        addLink(dedup, s.id, t.id, {
          relationshipType: 'linguistic',
          intensity: intensityScore(c.intensity),
          timeStart: cStart,
          timeEnd: cEnd,
          description: c.contactType,
        });
      }
    }
  }
}

function buildTradeLinks(
  profiles: CultureProfileLite[],
  routes: TradeRouteLite[],
  dedup: Map<string, CultureRelationshipLink>,
  timeRange?: { start: number; end: number },
) {
  const profilesByCiv = new Map<string, CultureProfileLite[]>();
  const profilesByName = new Map<string, CultureProfileLite[]>();
  for (const p of profiles) {
    if (p.civilizationId) {
      if (!profilesByCiv.has(p.civilizationId)) profilesByCiv.set(p.civilizationId, []);
      profilesByCiv.get(p.civilizationId)!.push(p);
    }
    const nameKey = p.name.toLowerCase();
    if (!profilesByName.has(nameKey)) profilesByName.set(nameKey, []);
    profilesByName.get(nameKey)!.push(p);
  }

  const resolvePower = (power: string): CultureProfileLite[] => {
    const byCiv = profilesByCiv.get(power);
    if (byCiv && byCiv.length) return byCiv;
    const lower = power.toLowerCase();
    const byName = profilesByName.get(lower);
    if (byName && byName.length) return byName;
    const partial: CultureProfileLite[] = [];
    profilesByName.forEach((list, key) => {
      if (lower.includes(key) || key.includes(lower)) partial.push(...list);
    });
    return partial;
  };

  for (const route of routes) {
    const rStart = parseYear(route.startDate) ?? -10000;
    const rEnd = parseYear(route.endDate) ?? new Date().getFullYear();
    if (timeRange && (rEnd < timeRange.start || rStart > timeRange.end)) continue;

    const groups: CultureProfileLite[][] = route.controllingPowers
      .map(resolvePower)
      .filter((g) => g.length > 0);

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const a of groups[i]) {
          for (const b of groups[j]) {
            addLink(dedup, a.id, b.id, {
              relationshipType: 'trade',
              intensity: 2,
              timeStart: rStart,
              timeEnd: rEnd,
              description: route.name,
            });
          }
        }
      }
    }
  }
}

function buildConflictLinks(
  profiles: CultureProfileLite[],
  battles: BattleLite[],
  dedup: Map<string, CultureRelationshipLink>,
  timeRange?: { start: number; end: number },
) {
  const profilesByCiv = new Map<string, CultureProfileLite[]>();
  for (const p of profiles) {
    if (p.civilizationId) {
      if (!profilesByCiv.has(p.civilizationId)) profilesByCiv.set(p.civilizationId, []);
      profilesByCiv.get(p.civilizationId)!.push(p);
    }
  }

  for (const battle of battles) {
    const year = parseYear(battle.date);
    if (timeRange && year !== null && (year < timeRange.start || year > timeRange.end)) {
      continue;
    }
    const belligerents = battle.belligerents || [];
    for (let i = 0; i < belligerents.length; i++) {
      for (let j = i + 1; j < belligerents.length; j++) {
        const civA = belligerents[i].civilization_id;
        const civB = belligerents[j].civilization_id;
        if (!civA || !civB) continue;
        const aList = profilesByCiv.get(civA) ?? [];
        const bList = profilesByCiv.get(civB) ?? [];
        for (const a of aList) {
          for (const b of bList) {
            addLink(dedup, a.id, b.id, {
              relationshipType: 'conflict',
              intensity: 2,
              timeStart: year ?? a.timePeriodStart,
              timeEnd: year ?? a.timePeriodEnd,
              description: battle.name,
            });
          }
        }
      }
    }
  }
}

function buildReligiousLinks(
  profiles: CultureProfileLite[],
  dedup: Map<string, CultureRelationshipLink>,
  timeRange?: { start: number; end: number },
) {
  const profilesByReligion = new Map<string, CultureProfileLite[]>();
  for (const p of profiles) {
    for (const rel of p.associatedReligionIds) {
      if (!profilesByReligion.has(rel)) profilesByReligion.set(rel, []);
      profilesByReligion.get(rel)!.push(p);
    }
  }

  profilesByReligion.forEach((list, religion) => {
    if (list.length < 2) return;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const start = Math.max(a.timePeriodStart, b.timePeriodStart);
        const end = Math.min(a.timePeriodEnd, b.timePeriodEnd);
        if (end < start) continue;
        if (timeRange && (end < timeRange.start || start > timeRange.end)) continue;
        addLink(dedup, a.id, b.id, {
          relationshipType: 'religious',
          intensity: 2,
          timeStart: start,
          timeEnd: end,
          description: `Shared religion: ${religion}`,
        });
      }
    }
  });
}

export function buildCultureRelationshipGraph(input: BuildInput): CultureRelationshipGraph {
  const {
    profiles,
    lineages = [],
    languageContacts = [],
    tradeRoutes = [],
    battles = [],
    enabledTypes,
    timeRange,
  } = input;

  const isEnabled = (t: RelationshipType) => !enabledTypes || enabledTypes.has(t);

  const filteredProfiles = timeRange
    ? profiles.filter(
        (p) => p.timePeriodEnd >= timeRange.start && p.timePeriodStart <= timeRange.end,
      )
    : profiles;

  const profileIds = new Set(filteredProfiles.map((p) => p.id));
  const dedup = new Map<string, CultureRelationshipLink>();

  if (isEnabled('lineage')) {
    buildLineageLinks(filteredProfiles, lineages, dedup, timeRange);
  }
  if (isEnabled('linguistic')) {
    buildLinguisticLinks(filteredProfiles, languageContacts, dedup, timeRange);
  }
  if (isEnabled('trade')) {
    buildTradeLinks(filteredProfiles, tradeRoutes, dedup, timeRange);
  }
  if (isEnabled('conflict')) {
    buildConflictLinks(filteredProfiles, battles, dedup, timeRange);
  }
  if (isEnabled('religious')) {
    buildReligiousLinks(filteredProfiles, dedup, timeRange);
  }

  const links = Array.from(dedup.values()).filter(
    (l) => profileIds.has(l.source as string) && profileIds.has(l.target as string),
  );

  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source as string, (degree.get(l.source as string) ?? 0) + 1);
    degree.set(l.target as string, (degree.get(l.target as string) ?? 0) + 1);
  }

  const nodes: CultureRelationshipNode[] = filteredProfiles.map((p) => ({
    id: p.id,
    name: p.name,
    group: p.region,
    size: 6 + Math.min(12, (degree.get(p.id) ?? 0)),
    timePeriodStart: p.timePeriodStart,
    timePeriodEnd: p.timePeriodEnd,
    civilizationId: p.civilizationId,
  }));

  return { nodes, links };
}

/** Overall temporal bounds across profiles and relationship datasets. */
export function computeTimeBounds(input: {
  profiles: CultureProfileLite[];
  lineages?: CulturalLineageLite[];
  tradeRoutes?: TradeRouteLite[];
  battles?: BattleLite[];
}): { start: number; end: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of input.profiles) {
    if (Number.isFinite(p.timePeriodStart)) min = Math.min(min, p.timePeriodStart);
    if (Number.isFinite(p.timePeriodEnd)) max = Math.max(max, p.timePeriodEnd);
  }
  for (const l of input.lineages ?? []) {
    if (Number.isFinite(l.timeStart)) min = Math.min(min, l.timeStart);
    if (Number.isFinite(l.timeEnd)) max = Math.max(max, l.timeEnd);
  }
  for (const r of input.tradeRoutes ?? []) {
    const s = parseYear(r.startDate);
    const e = parseYear(r.endDate);
    if (s !== null) min = Math.min(min, s);
    if (e !== null) max = Math.max(max, e);
  }
  for (const b of input.battles ?? []) {
    const y = parseYear(b.date);
    if (y !== null) {
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { start: -3000, end: 2000 };
  }
  return { start: Math.floor(min), end: Math.ceil(max) };
}

export const __test__ = { parseYear, parseTimePeriod, intensityScore };
