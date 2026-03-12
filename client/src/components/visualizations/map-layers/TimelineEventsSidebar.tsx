import React, { useMemo } from 'react';
import { Clock, Swords, MapPin, Route } from 'lucide-react';
import type { CivilizationFeature, HistoricalRouteFeature, ArchaeologicalSiteFeature } from '../../../lib/visualization/geospatial-types';
import type { BattleFeature } from './BattlesLayer';

interface TimelineEventsSidebarProps {
  currentYear: number;
  civilizations: CivilizationFeature[];
  routes: HistoricalRouteFeature[];
  archaeologicalSites: ArchaeologicalSiteFeature[];
  battles: BattleFeature[];
  isVisible: boolean;
}

interface TimelineEvent {
  type: 'civilization' | 'battle' | 'site' | 'route';
  name: string;
  detail: string;
  year: number;
}

export function TimelineEventsSidebar({
  currentYear,
  civilizations,
  routes,
  archaeologicalSites,
  battles,
  isVisible,
}: TimelineEventsSidebarProps) {
  const formatYear = (year: number) => {
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };

  const getEraLabel = (year: number): string => {
    if (year < -3000) return 'Prehistoric';
    if (year < -1200) return 'Bronze Age';
    if (year < -500) return 'Iron Age';
    if (year < 500) return 'Classical';
    if (year < 1500) return 'Medieval';
    if (year < 1800) return 'Early Modern';
    return 'Modern';
  };

  const events = useMemo(() => {
    const items: TimelineEvent[] = [];
    const windowSize = 100; // Show events within 100 years

    // Civilizations active at current time
    for (const civ of civilizations) {
      const { start, end } = civ.properties.timePeriod;
      if (start <= currentYear && (end === null || end >= currentYear)) {
        // Highlight if it just started or is about to end
        if (Math.abs(start - currentYear) < windowSize) {
          items.push({
            type: 'civilization',
            name: civ.properties.name,
            detail: `Founded ${formatYear(start)}`,
            year: start,
          });
        } else if (end !== null && Math.abs(end - currentYear) < windowSize) {
          items.push({
            type: 'civilization',
            name: civ.properties.name,
            detail: `Falls ${formatYear(end)}`,
            year: end,
          });
        }
      }
    }

    // Battles near current year
    for (const battle of battles) {
      const year = parseInt(battle.date);
      if (!isNaN(year) && Math.abs(year - currentYear) <= windowSize) {
        items.push({
          type: 'battle',
          name: battle.name,
          detail: `${formatYear(year)}${battle.warName ? ` - ${battle.warName}` : ''}`,
          year,
        });
      }
    }

    // Archaeological sites being founded
    for (const site of archaeologicalSites) {
      const { start } = site.properties.timePeriod;
      if (Math.abs(start - currentYear) <= windowSize) {
        items.push({
          type: 'site',
          name: site.properties.name,
          detail: `Founded ${formatYear(start)}`,
          year: start,
        });
      }
    }

    // Routes active at current time
    for (const route of routes) {
      const { start, end } = route.properties.timePeriod;
      if (Math.abs(start - currentYear) <= windowSize) {
        items.push({
          type: 'route',
          name: route.properties.name,
          detail: `Begins ${formatYear(start)}`,
          year: start,
        });
      }
    }

    // Sort by proximity to current year
    items.sort((a, b) => Math.abs(a.year - currentYear) - Math.abs(b.year - currentYear));

    return items.slice(0, 8); // Max 8 events
  }, [currentYear, civilizations, battles, archaeologicalSites, routes]);

  if (!isVisible) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'battle': return <Swords className="h-3.5 w-3.5 text-red-500" />;
      case 'civilization': return <Clock className="h-3.5 w-3.5 text-purple-500" />;
      case 'site': return <MapPin className="h-3.5 w-3.5 text-amber-500" />;
      case 'route': return <Route className="h-3.5 w-3.5 text-blue-500" />;
      default: return <Clock className="h-3.5 w-3.5 text-gray-500" />;
    }
  };

  return (
    <div className="absolute top-4 right-[320px] z-[999] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border w-[240px] max-h-[400px] overflow-hidden">
      <div className="p-3 border-b bg-gray-50">
        <div className="text-sm font-semibold text-gray-900">{formatYear(currentYear)}</div>
        <div className="text-xs text-gray-500">{getEraLabel(currentYear)}</div>
      </div>

      {events.length === 0 ? (
        <div className="p-3 text-xs text-gray-400 text-center">
          No notable events nearby
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[340px]">
          {events.map((event, idx) => (
            <div
              key={`${event.type}-${event.name}-${idx}`}
              className="px-3 py-2 border-b last:border-b-0 hover:bg-gray-50"
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex-shrink-0">{getIcon(event.type)}</div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">{event.name}</div>
                  <div className="text-xs text-gray-500">{event.detail}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
