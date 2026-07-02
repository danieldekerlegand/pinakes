import React from 'react';
import { CircleMarker, Popup, Polyline } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { MYTHOLOGY_COLORS, INTERACTION_COLORS, VIS_TEXT_COLORS } from '../../../lib/visualization/color-theme';

export interface DeityFeature {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  equivalentDeityIds: string[];
  attributes: string[];
  symbols: string[];
  description: string;
}

interface MythologyLayerProps {
  deities: DeityFeature[];
  opacity?: number;
  onDeityClick?: (id: string) => void;
  selectedDeityId?: string | null;
  showEquivalentLinks?: boolean;
}

const getMythologyColor = (mythology: string): string => {
  return MYTHOLOGY_COLORS[mythology] || INTERACTION_COLORS.defaultFallback;
};

const formatTimePeriod = (start: number | null, end: number | null): string => {
  const formatYear = (year: number) => {
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };
  if (start === null && end === null) return 'Unknown period';
  if (start === null) return `Until ${formatYear(end!)}`;
  if (end === null) return `Since ${formatYear(start)}`;
  return `${formatYear(start)} – ${formatYear(end)}`;
};

export function MythologyLayer({
  deities,
  opacity = 0.8,
  onDeityClick,
  selectedDeityId,
  showEquivalentLinks = true,
}: MythologyLayerProps) {
  if (deities.length === 0) return null;

  // Build equivalent links between deities that are both in the dataset
  const deityMap = new Map(deities.map((d) => [d.id, d]));
  const equivalentLinks: Array<{ from: DeityFeature; to: DeityFeature }> = [];

  if (showEquivalentLinks) {
    const seen = new Set<string>();
    for (const deity of deities) {
      for (const eqId of deity.equivalentDeityIds) {
        const other = deityMap.get(eqId);
        if (!other) continue;
        const key = [deity.id, eqId].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        equivalentLinks.push({ from: deity, to: other });
      }
    }
  }

  return (
    <>
      {/* Equivalent deity connection lines */}
      {equivalentLinks.map(({ from, to }) => (
        <Polyline
          key={`link-${from.id}-${to.id}`}
          positions={[
            [from.coordinates.lat, from.coordinates.lng],
            [to.coordinates.lat, to.coordinates.lng],
          ]}
          pathOptions={{
            color: VIS_TEXT_COLORS.muted,
            weight: 1.5,
            opacity: 0.4,
            dashArray: '6 4',
          }}
        />
      ))}

      {/* Deity markers */}
      {deities.map((deity) => {
        const { lat, lng } = deity.coordinates;
        const isSelected = selectedDeityId === deity.id;
        const color = getMythologyColor(deity.mythology);

        return (
          <CircleMarker
            key={deity.id}
            center={[lat, lng]}
            radius={isSelected ? 12 : 8}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onDeityClick?.(deity.id),
            }}
          >
            <Popup>
              <div className="min-w-[240px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{deity.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs capitalize"
                    style={{ borderColor: color, color }}
                  >
                    {deity.mythology}
                  </Badge>
                </div>

                {deity.nativeName && deity.nativeName !== deity.name && (
                  <p className="text-sm text-gray-600 mb-2">{deity.nativeName}</p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatTimePeriod(deity.timeOrigin, deity.timeEnd)}
                    </span>
                  </div>

                  {deity.domain.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Domains:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {deity.domain.join(', ')}
                      </span>
                    </div>
                  )}

                  {deity.symbols.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Symbols:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {deity.symbols.slice(0, 3).join(', ')}
                        {deity.symbols.length > 3 && ` +${deity.symbols.length - 3}`}
                      </span>
                    </div>
                  )}

                  {deity.equivalentDeityIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Equivalents:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {deity.equivalentDeityIds.slice(0, 3).join(', ')}
                        {deity.equivalentDeityIds.length > 3 &&
                          ` +${deity.equivalentDeityIds.length - 3}`}
                      </span>
                    </div>
                  )}
                </div>

                {deity.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {deity.description}
                  </p>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default MythologyLayer;
