import React, { useMemo } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import {
  CIVILIZATION_PALETTE,
  INTERACTION_COLORS,
  hashIndex,
} from '../../../lib/visualization/color-theme';
import {
  getLifecycleState,
  capitalPulse,
  type SettlementLifecyclePhase,
} from '../../../lib/visualization/settlement-lifecycle';
import { Badge } from '../../ui/badge';
import { MarkerClusterGroup } from './MarkerClusterGroup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Settlement {
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
  settlements: Settlement[];
  currentYear: number;
  opacity?: number;
  onSettlementClick?: (id: string) => void;
  selectedSettlementId?: string | null;
  reducedMotion?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLUSTER_THRESHOLD = 150;

const SETTLEMENT_TYPE_COLORS: Record<string, string> = {
  'city-state': '#f59e0b',
  capital: '#ef4444',
  'religious-center': '#8b5cf6',
  'trading-post': '#10b981',
  fortress: '#64748b',
  port: '#3b82f6',
  colony: '#f97316',
  burial: '#6b7280',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSettlementColor(type: string, civilizationId: string): string {
  if (civilizationId) {
    return CIVILIZATION_PALETTE[hashIndex(civilizationId, CIVILIZATION_PALETTE.length)];
  }
  return SETTLEMENT_TYPE_COLORS[type] ?? SETTLEMENT_TYPE_COLORS['city-state'];
}

function getBaseRadius(peakPopulation: number | null): number {
  if (!peakPopulation) return 5;
  if (peakPopulation > 100000) return 10;
  if (peakPopulation > 50000) return 8;
  if (peakPopulation > 20000) return 7;
  if (peakPopulation > 5000) return 6;
  return 5;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettlementsLayer({
  settlements,
  currentYear,
  opacity = 0.85,
  onSettlementClick,
  selectedSettlementId,
  reducedMotion = false,
}: SettlementsLayerProps) {
  // Filter & compute visibility for each settlement at the current year
  const visibleSettlements = useMemo(() => {
    const results: Array<{
      settlement: Settlement;
      phase: SettlementLifecyclePhase;
      visibility: number;
    }> = [];

    settlements.forEach((s) => {
      const { phase, visibility } = getLifecycleState(s.foundedYear, s.abandonedYear, currentYear);
      if (phase !== 'hidden') {
        results.push({ settlement: s, phase, visibility });
      }
    });

    return results;
  }, [settlements, currentYear]);

  // For large datasets use marker clustering
  const useCluster = visibleSettlements.length >= CLUSTER_THRESHOLD;

  if (visibleSettlements.length === 0) return null;

  if (useCluster) {
    const markers = visibleSettlements.map(({ settlement: s, visibility }) => ({
      position: [s.latitude, s.longitude] as [number, number],
      color: getSettlementColor(s.type, s.civilizationId),
      radius: getBaseRadius(s.peakPopulation),
      popupContent: `<div class="p-2"><strong>${s.name}</strong><br/>${s.type}${s.foundedYear != null ? ` — founded ${formatTimePeriod(s.foundedYear, s.abandonedYear)}` : ''}</div>`,
      onClick: () => onSettlementClick?.(s.id),
    }));
    return <MarkerClusterGroup markers={markers} maxClusterRadius={60} />;
  }

  return (
    <>
      {visibleSettlements.map(({ settlement: s, phase, visibility }) => {
        const isSelected = selectedSettlementId === s.id;
        const isCapital = s.type === 'capital';
        const color = getSettlementColor(s.type, s.civilizationId);
        const baseRadius = getBaseRadius(s.peakPopulation);

        // Pulsing effect for capitals
        const pulse = isCapital ? capitalPulse(currentYear, reducedMotion) : 1;

        // Destruction burst: temporarily larger & red
        const isDestroyed = phase === 'destroyed';
        const effectiveColor = isDestroyed ? '#ef4444' : color;
        const radiusMultiplier = isDestroyed ? 1.8 : 1;

        const finalRadius = baseRadius * pulse * radiusMultiplier * (isSelected ? 1.4 : 1);
        const finalOpacity = opacity * visibility * (isDestroyed ? 0.9 : 1);

        return (
          <CircleMarker
            key={`${s.id}-${phase}`}
            center={[s.latitude, s.longitude]}
            radius={finalRadius}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : effectiveColor,
              fillOpacity: isSelected ? 0.9 : finalOpacity,
              color: isSelected
                ? INTERACTION_COLORS.selectedBorder
                : isCapital
                  ? '#fbbf24'
                  : isDestroyed
                    ? '#dc2626'
                    : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : isCapital ? 2.5 : 2,
              opacity: isSelected ? 1 : visibility,
              dashArray: isDestroyed ? '3, 3' : undefined,
            }}
            eventHandlers={{
              click: () => onSettlementClick?.(s.id),
              mouseover: function () {
                if (!isSelected) {
                  this.setStyle({ fillOpacity: Math.min(1, finalOpacity * 1.3), weight: 3 });
                }
              },
              mouseout: function () {
                if (!isSelected) {
                  this.setStyle({
                    fillOpacity: isSelected ? 0.9 : finalOpacity,
                    weight: isSelected ? 3 : isCapital ? 2.5 : 2,
                  });
                }
              },
            }}
          >
            <Popup>
              <div className="p-2 min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{s.name}</h3>
                {s.modernName && (
                  <p className="text-sm text-gray-500 mb-2">Modern: {s.modernName}</p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {s.type}
                    </Badge>
                  </div>

                  {s.foundedYear != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Period:</span>
                      <span className="font-medium text-right">
                        {formatTimePeriod(s.foundedYear, s.abandonedYear)}
                      </span>
                    </div>
                  )}

                  {s.peakPopulation != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Peak Pop.:</span>
                      <span className="font-medium">
                        {s.peakPopulation.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {s.region && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Region:</span>
                      <span className="font-medium">{s.region}</span>
                    </div>
                  )}

                  {phase === 'founding' && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <span className="text-green-600 text-xs font-medium">Founding...</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-green-500 h-1.5 rounded-full"
                            style={{ width: `${Math.round(visibility * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {phase === 'abandoning' && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-600 text-xs font-medium">Declining...</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-amber-500 h-1.5 rounded-full"
                            style={{ width: `${Math.round(visibility * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {phase === 'destroyed' && (
                    <div className="pt-2 border-t">
                      <span className="text-red-600 text-xs font-medium">Destroyed / Abandoned</span>
                    </div>
                  )}

                  {s.notableFeatures.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Notable:</span>
                      <ul className="text-xs mt-1 space-y-0.5">
                        {s.notableFeatures.slice(0, 3).map((f, i) => (
                          <li key={i} className="text-gray-700">• {f}</li>
                        ))}
                        {s.notableFeatures.length > 3 && (
                          <li className="text-gray-500">
                            +{s.notableFeatures.length - 3} more
                          </li>
                        )}
                      </ul>
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
