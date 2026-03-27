import React, { useMemo } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { MarkerClusterGroup } from './MarkerClusterGroup';
import { SETTLEMENT_TYPE_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface SettlementFeature {
  id: string;
  name: string;
  alternateNames: string[];
  latitude: number;
  longitude: number;
  type: string;
  cultureId: string;
  civilizationId: string;
  foundedYear: number | null;
  abandonedYear: number | null;
  peakPopulation: number | null;
  notableFeatures: string[];
  associatedLanguages: string[];
  modernName: string;
  region: string;
}

interface SettlementsLayerProps {
  settlements: SettlementFeature[];
  currentYear: number;
  opacity?: number;
  onSettlementClick?: (id: string) => void;
  selectedSettlementId?: string | null;
}

/** Map marker radius from peak population (log-scaled, clamped 5–18). */
function populationToRadius(pop: number | null): number {
  if (!pop || pop <= 0) return 5;
  // log10(1000)=3 → 5,  log10(200000)≈5.3 → 18
  const log = Math.log10(pop);
  return Math.min(18, Math.max(5, 2 + log * 3));
}

function typeColor(type: string): string {
  return SETTLEMENT_TYPE_COLORS[type] ?? SETTLEMENT_TYPE_COLORS.unknown;
}

function typeLabel(type: string): string {
  return type
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatYear(year: number | null): string {
  if (year === null || year === undefined) return 'unknown';
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatPopulation(pop: number | null): string {
  if (!pop) return 'unknown';
  if (pop >= 1_000_000) return `~${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `~${(pop / 1_000).toFixed(0)}K`;
  return `~${pop}`;
}

const CLUSTER_THRESHOLD = 200;

export function SettlementsLayer({
  settlements,
  currentYear,
  opacity = 0.9,
  onSettlementClick,
  selectedSettlementId,
}: SettlementsLayerProps) {
  // Filter to settlements that existed at the current year
  const visibleSettlements = useMemo(() => {
    return settlements.filter((s) => {
      if (s.foundedYear !== null && s.foundedYear > currentYear) return false;
      if (s.abandonedYear !== null && s.abandonedYear < currentYear) return false;
      return true;
    });
  }, [settlements, currentYear]);

  // Cluster markers for large datasets
  const clusterMarkers = useMemo(() => {
    if (visibleSettlements.length < CLUSTER_THRESHOLD) return null;
    return visibleSettlements.map((s) => ({
      position: [s.latitude, s.longitude] as [number, number],
      color: typeColor(s.type),
      radius: populationToRadius(s.peakPopulation),
      popupContent: `<div class="p-2"><strong>${s.name}</strong><br/>${typeLabel(s.type)}</div>`,
      onClick: onSettlementClick ? () => onSettlementClick(s.id) : undefined,
    }));
  }, [visibleSettlements, onSettlementClick]);

  if (visibleSettlements.length === 0) return null;

  if (clusterMarkers) {
    return <MarkerClusterGroup markers={clusterMarkers} maxClusterRadius={60} />;
  }

  return (
    <>
      {visibleSettlements.map((s) => {
        const isSelected = s.id === selectedSettlementId;
        const color = typeColor(s.type);
        const radius = populationToRadius(s.peakPopulation);

        return (
          <CircleMarker
            key={s.id}
            center={[s.latitude, s.longitude]}
            radius={isSelected ? radius + 4 : radius}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : '#ffffff',
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onSettlementClick?.(s.id),
            }}
          >
            <Popup>
              <div className="p-2 min-w-[240px]">
                <h3 className="font-bold text-base mb-0.5">{s.name}</h3>
                {s.alternateNames.length > 0 && (
                  <p className="text-xs text-gray-500 mb-1.5 italic">
                    aka {s.alternateNames.join(', ')}
                  </p>
                )}
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span
                      className="font-medium px-1.5 py-0.5 rounded text-xs text-white"
                      style={{ backgroundColor: color }}
                    >
                      {typeLabel(s.type)}
                    </span>
                  </div>
                  {s.civilizationId && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Civilization:</span>
                      <span className="font-medium">{s.civilizationId}</span>
                    </div>
                  )}
                  {s.cultureId && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Culture:</span>
                      <span className="font-medium">{s.cultureId}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatYear(s.foundedYear)} &ndash; {s.abandonedYear ? formatYear(s.abandonedYear) : 'present'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Peak Pop:</span>
                    <span className="font-medium">{formatPopulation(s.peakPopulation)}</span>
                  </div>
                  {s.region && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Region:</span>
                      <span className="font-medium">{s.region}</span>
                    </div>
                  )}
                  {s.modernName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Modern:</span>
                      <span className="font-medium">{s.modernName}</span>
                    </div>
                  )}
                  {s.notableFeatures.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Notable Features:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.notableFeatures.map((f, i) => (
                          <span
                            key={i}
                            className="inline-block px-2 py-0.5 text-xs bg-amber-100 text-amber-800 rounded"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {s.associatedLanguages.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Languages:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.associatedLanguages.map((lang, i) => (
                          <span
                            key={i}
                            className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded"
                          >
                            {lang}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
