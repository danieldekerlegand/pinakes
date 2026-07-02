/**
 * Cross-Domain Timeline Service
 *
 * Normalizes entities from multiple datasets (empires, battles, civilizations,
 * migrations, trade routes, art traditions, music traditions, archaeological sites)
 * into a unified timeline event format for visualization on a single timeline.
 */

import { TsvStorage } from "../tsv-storage";

export type TimelineDomain =
  | "empire"
  | "battle"
  | "civilization"
  | "migration"
  | "trade-route"
  | "art-tradition"
  | "music-tradition"
  | "archaeological-site";

export interface CrossDomainTimelineEvent {
  id: string;
  name: string;
  domain: TimelineDomain;
  startYear: number;
  endYear: number | null;
  description?: string;
  associatedLanguageIds: string[];
  region?: string;
  metadata?: Record<string, unknown>;
}

export interface CrossDomainTimelineResult {
  events: CrossDomainTimelineEvent[];
  domains: TimelineDomain[];
  temporalRange: { min: number; max: number };
  count: number;
}

/**
 * Parse a date string (which may be a negative year like "-1274") into a number.
 * Returns null if unparseable.
 */
function parseYear(dateStr: string | number | null | undefined): number | null {
  if (dateStr == null) return null;
  if (typeof dateStr === "number") return dateStr;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? null : num;
}

export class CrossDomainTimeline {
  constructor(private storage: TsvStorage) {}

  async getTimeline(filters?: {
    domains?: TimelineDomain[];
    yearStart?: number;
    yearEnd?: number;
  }): Promise<CrossDomainTimelineResult> {
    const events: CrossDomainTimelineEvent[] = [];
    const activeDomains = filters?.domains;

    const shouldInclude = (d: TimelineDomain) =>
      !activeDomains || activeDomains.includes(d);

    const promises: Promise<void>[] = [];

    if (shouldInclude("empire")) {
      promises.push(this.loadEmpires(events));
    }
    if (shouldInclude("battle")) {
      promises.push(this.loadBattles(events));
    }
    if (shouldInclude("civilization")) {
      promises.push(this.loadCivilizations(events));
    }
    if (shouldInclude("migration")) {
      promises.push(this.loadMigrations(events));
    }
    if (shouldInclude("trade-route")) {
      promises.push(this.loadTradeRoutes(events));
    }
    if (shouldInclude("art-tradition")) {
      promises.push(this.loadArtTraditions(events));
    }
    if (shouldInclude("music-tradition")) {
      promises.push(this.loadMusicTraditions(events));
    }
    if (shouldInclude("archaeological-site")) {
      promises.push(this.loadArchaeologicalSites(events));
    }

    await Promise.all(promises);

    // Filter out events with invalid years
    let filtered = events.filter(
      (e) => Number.isFinite(e.startYear),
    );
    if (filters?.yearStart != null) {
      filtered = filtered.filter(
        (e) => (e.endYear ?? e.startYear) >= filters.yearStart!,
      );
    }
    if (filters?.yearEnd != null) {
      filtered = filtered.filter((e) => e.startYear <= filters.yearEnd!);
    }

    // Sort by start year
    filtered.sort((a, b) => a.startYear - b.startYear);

    // Compute temporal range
    const domains = Array.from(new Set(filtered.map((e) => e.domain)));
    const min =
      filtered.length > 0
        ? Math.min(...filtered.map((e) => e.startYear))
        : -3000;
    const max =
      filtered.length > 0
        ? Math.max(
            ...filtered.map((e) => e.endYear ?? e.startYear),
          )
        : 2024;

    return {
      events: filtered,
      domains,
      temporalRange: { min, max },
      count: filtered.length,
    };
  }

  private async loadEmpires(events: CrossDomainTimelineEvent[]): Promise<void> {
    const empireEvents = await this.storage.getEmpireTimeline();
    // Group by empire to create span events (founding to collapse)
    const empireSpans = new Map<
      string,
      { name: string; minYear: number; maxYear: number; langs: string[]; desc: string }
    >();
    for (const e of empireEvents) {
      const existing = empireSpans.get(e.empireId);
      if (existing) {
        existing.minYear = Math.min(existing.minYear, e.year);
        existing.maxYear = Math.max(existing.maxYear, e.year);
        for (const l of e.associatedLanguageIds) {
          if (!existing.langs.includes(l)) existing.langs.push(l);
        }
      } else {
        empireSpans.set(e.empireId, {
          name: e.empireName,
          minYear: e.year,
          maxYear: e.year,
          langs: [...e.associatedLanguageIds],
          desc: e.description,
        });
      }
    }
    for (const [id, span] of Array.from(empireSpans.entries())) {
      events.push({
        id: `empire-${id}`,
        name: span.name,
        domain: "empire",
        startYear: span.minYear,
        endYear: span.maxYear !== span.minYear ? span.maxYear : null,
        description: span.desc,
        associatedLanguageIds: span.langs,
      });
    }
  }

  private async loadBattles(events: CrossDomainTimelineEvent[]): Promise<void> {
    const battles = await this.storage.getBattles();
    for (const b of battles) {
      const year = parseYear(b.date);
      if (year == null) continue;
      events.push({
        id: `battle-${b.id}`,
        name: b.name,
        domain: "battle",
        startYear: year,
        endYear: null,
        description: b.significance,
        associatedLanguageIds: [],
        metadata: { warName: b.warName, outcome: b.outcome },
      });
    }
  }

  private async loadCivilizations(events: CrossDomainTimelineEvent[]): Promise<void> {
    const civs = await this.storage.getCivilizations();
    for (const c of civs) {
      const start = c.properties?.timePeriod?.start;
      if (start == null) continue;
      events.push({
        id: `civ-${c.id ?? c.properties?.civilizationId}`,
        name: c.properties?.name ?? "Unknown",
        domain: "civilization",
        startYear: start,
        endYear: c.properties?.timePeriod?.end ?? null,
        associatedLanguageIds: c.properties?.associatedLanguageIds ?? [],
      });
    }
  }

  private async loadMigrations(events: CrossDomainTimelineEvent[]): Promise<void> {
    const routes = await this.storage.getMigrationRoutes();
    for (const r of routes) {
      const start = parseYear(r.startDate);
      if (start == null) continue;
      events.push({
        id: `migration-${r.id}`,
        name: r.name,
        domain: "migration",
        startYear: start,
        endYear: parseYear(r.endDate),
        description: r.description,
        associatedLanguageIds: r.associatedLanguages ?? [],
      });
    }
  }

  private async loadTradeRoutes(events: CrossDomainTimelineEvent[]): Promise<void> {
    const routes = await this.storage.getTradeRoutes();
    for (const r of routes) {
      const start = parseYear(r.startDate);
      if (start == null) continue;
      events.push({
        id: `trade-${r.id}`,
        name: r.name,
        domain: "trade-route",
        startYear: start,
        endYear: parseYear(r.endDate),
        description: r.description,
        associatedLanguageIds: r.associatedLanguages ?? [],
      });
    }
  }

  private async loadArtTraditions(events: CrossDomainTimelineEvent[]): Promise<void> {
    const arts = await this.storage.getArtTraditions();
    for (const a of arts) {
      if (a.originDate == null) continue;
      events.push({
        id: `art-${a.id}`,
        name: a.name,
        domain: "art-tradition",
        startYear: a.originDate,
        endYear: a.endDate ?? null,
        description: a.description,
        associatedLanguageIds: a.associatedLanguages ?? [],
        metadata: { category: a.category, stylePeriod: a.stylePeriod },
      });
    }
  }

  private async loadMusicTraditions(events: CrossDomainTimelineEvent[]): Promise<void> {
    const music = await this.storage.getMusicTraditions({});
    for (const m of music) {
      if (m.timeOrigin == null) continue;
      events.push({
        id: `music-${m.id}`,
        name: m.name,
        domain: "music-tradition",
        startYear: m.timeOrigin,
        endYear: m.timeEnd,
        description: m.description,
        associatedLanguageIds: m.associatedLanguageIds ?? [],
        region: m.region,
      });
    }
  }

  private async loadArchaeologicalSites(events: CrossDomainTimelineEvent[]): Promise<void> {
    const sites = await this.storage.getArchaeologicalSites();
    for (const s of sites) {
      const start = s.properties?.timePeriod?.start;
      if (start == null) continue;
      events.push({
        id: `arch-${s.id ?? s.properties?.siteId}`,
        name: s.properties?.name ?? "Unknown",
        domain: "archaeological-site",
        startYear: start,
        endYear: s.properties?.timePeriod?.end ?? null,
        associatedLanguageIds: s.properties?.associatedLanguageIds ?? [],
      });
    }
  }
}
