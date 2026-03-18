import React, { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, FeatureCollection, Polygon } from 'geojson';

export interface UrheimatHypothesisFeature {
  id: string;
  languageFamilyId: string;
  hypothesisName: string;
  proposedRegion: string;
  proposedCoordinates: { lat: number; lng: number };
  proposedBoundary: { type: string; coordinates: number[][][] };
  timeRangeStart: number | null;
  timeRangeEnd: number | null;
  supportingEvidence: {
    linguistic: string[];
    archaeological: string[];
    genetic: string[];
  };
  competingHypotheses: string[];
  scholarlyConsensusLevel: number;
  keyProponents: string[];
  sources: string[];
}

interface UrheimatHypothesisLayerProps {
  hypotheses: UrheimatHypothesisFeature[];
  opacity?: number;
  currentYear?: number;
  onHypothesisClick?: (id: string) => void;
  selectedHypothesisId?: string | null;
}

// Colors keyed by language family prefix for consistent coloring
const FAMILY_COLORS: Record<string, string> = {
  indo_european: '#e74c3c',
  afro_asiatic: '#f39c12',
  austronesian: '#2ecc71',
  niger_congo: '#9b59b6',
  uralic: '#3498db',
  sino_tibetan: '#e67e22',
  dravidian: '#1abc9c',
  turkic: '#c0392b',
  kartvelian: '#8e44ad',
  kra_dai: '#27ae60',
  austroasiatic: '#2980b9',
  eskimo_aleut: '#7f8c8d',
  na_dene: '#16a085',
  hmong_mien: '#d35400',
  nilo_saharan: '#f1c40f',
  japonic: '#e84393',
  quechuan: '#6c5ce7',
  mayan: '#00b894',
  uto_aztecan: '#fd79a8',
  tupian: '#a29bfe',
  algic: '#74b9ff',
};

function getFamilyColor(familyId: string): string {
  // Extract the top-level family prefix
  const prefix = familyId.split('__')[0];
  if (FAMILY_COLORS[prefix]) return FAMILY_COLORS[prefix];

  // Fallback: hash-based color
  let hash = 0;
  for (let i = 0; i < familyId.length; i++) {
    hash = familyId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function consensusLabel(level: number): string {
  if (level >= 80) return 'Strong consensus';
  if (level >= 60) return 'Moderate consensus';
  if (level >= 40) return 'Debated';
  if (level >= 20) return 'Minority view';
  return 'Fringe hypothesis';
}

function consensusBadgeColor(level: number): string {
  if (level >= 80) return 'bg-green-100 text-green-800';
  if (level >= 60) return 'bg-blue-100 text-blue-800';
  if (level >= 40) return 'bg-yellow-100 text-yellow-800';
  if (level >= 20) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

export function UrheimatHypothesisLayer({
  hypotheses,
  opacity = 0.6,
  currentYear,
  onHypothesisClick,
  selectedHypothesisId,
}: UrheimatHypothesisLayerProps) {
  // Filter by current time if provided
  const filteredHypotheses = useMemo(() => {
    if (currentYear === undefined) return hypotheses;
    return hypotheses.filter((h) => {
      if (h.timeRangeStart === null && h.timeRangeEnd === null) return true;
      const start = h.timeRangeStart ?? -Infinity;
      const end = h.timeRangeEnd ?? Infinity;
      return currentYear >= start && currentYear <= end;
    });
  }, [hypotheses, currentYear]);

  // Convert to GeoJSON FeatureCollection
  const geoJsonData: FeatureCollection = useMemo(() => ({
    type: 'FeatureCollection',
    features: filteredHypotheses
      .filter((h) => h.proposedBoundary && h.proposedBoundary.type === 'Polygon')
      .map((h) => ({
        type: 'Feature' as const,
        id: h.id,
        geometry: h.proposedBoundary as unknown as Polygon,
        properties: {
          id: h.id,
          languageFamilyId: h.languageFamilyId,
          hypothesisName: h.hypothesisName,
          proposedRegion: h.proposedRegion,
          timeRangeStart: h.timeRangeStart,
          timeRangeEnd: h.timeRangeEnd,
          supportingEvidence: h.supportingEvidence,
          competingHypotheses: h.competingHypotheses,
          scholarlyConsensusLevel: h.scholarlyConsensusLevel,
          keyProponents: h.keyProponents,
          sources: h.sources,
        },
      })),
  }), [filteredHypotheses]);

  // Style function: color by family, opacity by consensus level
  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedHypothesisId === feature.id;
    const familyColor = getFamilyColor(props.languageFamilyId);
    const consensus = props.scholarlyConsensusLevel || 50;
    // Higher consensus = more opaque fill
    const consensusOpacity = 0.2 + (consensus / 100) * 0.4;

    return {
      fillColor: isSelected ? '#3b82f6' : familyColor,
      fillOpacity: isSelected ? 0.4 : opacity * consensusOpacity,
      color: isSelected ? '#1d4ed8' : familyColor,
      weight: isSelected ? 3 : Math.max(1.5, consensus / 40),
      opacity: isSelected ? 1 : 0.8,
      dashArray: consensus >= 60 ? undefined : '6, 4',
    };
  };

  // Event handlers for each feature
  const onEachFeature = (feature: any, layer: any) => {
    const props = feature.properties;
    const familyName = props.languageFamilyId.split('__').pop()?.replace(/_/g, ' ') || props.languageFamilyId;
    const timeRange = props.timeRangeStart !== null && props.timeRangeEnd !== null
      ? `${formatYear(props.timeRangeStart)} – ${formatYear(props.timeRangeEnd)}`
      : 'Unknown';

    const evidence = props.supportingEvidence || { linguistic: [], archaeological: [], genetic: [] };
    const badgeClass = consensusBadgeColor(props.scholarlyConsensusLevel);

    layer.bindPopup(() => {
      const container = document.createElement('div');
      container.className = 'p-2 min-w-[280px] max-w-[360px]';

      container.innerHTML = `
        <div>
          <h3 class="font-bold text-base mb-1">${props.hypothesisName}</h3>
          <p class="text-sm text-gray-600 mb-2 capitalize">${familyName} family</p>

          <div class="space-y-1.5 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Region:</span>
              <span class="font-medium text-right">${props.proposedRegion}</span>
            </div>

            <div class="flex justify-between">
              <span class="text-gray-600">Time Range:</span>
              <span class="font-medium">${timeRange}</span>
            </div>

            <div class="flex justify-between items-center">
              <span class="text-gray-600">Consensus:</span>
              <span class="inline-block px-2 py-0.5 text-xs rounded ${badgeClass}">
                ${props.scholarlyConsensusLevel}% – ${consensusLabel(props.scholarlyConsensusLevel)}
              </span>
            </div>

            ${evidence.linguistic.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs font-medium">Linguistic Evidence:</span>
                <ul class="mt-1 text-xs text-gray-700 list-disc pl-4">
                  ${evidence.linguistic.slice(0, 2).map((e: string) => `<li>${e}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${evidence.archaeological.length > 0 ? `
              <div class="pt-1">
                <span class="text-gray-600 text-xs font-medium">Archaeological Evidence:</span>
                <ul class="mt-1 text-xs text-gray-700 list-disc pl-4">
                  ${evidence.archaeological.slice(0, 2).map((e: string) => `<li>${e}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${evidence.genetic.length > 0 ? `
              <div class="pt-1">
                <span class="text-gray-600 text-xs font-medium">Genetic Evidence:</span>
                <ul class="mt-1 text-xs text-gray-700 list-disc pl-4">
                  ${evidence.genetic.slice(0, 2).map((e: string) => `<li>${e}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${props.keyProponents && props.keyProponents.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs font-medium">Key Proponents:</span>
                <span class="text-xs text-gray-700 ml-1">${props.keyProponents.join(', ')}</span>
              </div>
            ` : ''}

            ${props.competingHypotheses && props.competingHypotheses.length > 0 ? `
              <div class="pt-1">
                <span class="text-gray-600 text-xs font-medium">Competing:</span>
                <span class="text-xs text-gray-700 ml-1">${props.competingHypotheses.join(', ')}</span>
              </div>
            ` : ''}

            ${props.sources && props.sources.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs">${props.sources.length} source(s)</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      return container;
    });

    // Tooltip on hover
    layer.bindTooltip(`${props.hypothesisName} (${props.scholarlyConsensusLevel}%)`, {
      sticky: true,
      className: 'text-xs',
    });

    // Click handler
    layer.on('click', () => {
      if (onHypothesisClick) {
        onHypothesisClick(props.id);
      }
    });

    // Hover effects
    layer.on('mouseover', function(this: any) {
      if (feature.id !== selectedHypothesisId) {
        this.setStyle({
          fillOpacity: opacity * 0.5,
          weight: 3,
        });
      }
    });

    layer.on('mouseout', function(this: any) {
      if (feature.id !== selectedHypothesisId) {
        const consensus = props.scholarlyConsensusLevel || 50;
        const consensusOpacity = 0.2 + (consensus / 100) * 0.4;
        this.setStyle({
          fillOpacity: opacity * consensusOpacity,
          weight: Math.max(1.5, consensus / 40),
        });
      }
    });
  };

  if (geoJsonData.features.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      key={JSON.stringify(filteredHypotheses.map(h => h.id))}
      data={geoJsonData}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}
