import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { KINSHIP_SYSTEM_COLORS, KINSHIP_TERM_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface KinshipSystemFeature {
  id: string;
  systemType: string;
  languageIds: string[];
  terminology: Record<string, string>;
  descentRule: string;
  residenceRule: string;
  associatedCivilizations: string;
  coordinates?: { lat: number; lng: number };
}

interface KinshipSystemLayerProps {
  systems: KinshipSystemFeature[];
  opacity?: number;
  onSystemClick?: (id: string) => void;
  selectedSystemId?: string | null;
}

// Kinship system type color scheme
const getSystemColor = (systemType: string): string => {
  return KINSHIP_SYSTEM_COLORS[systemType] || INTERACTION_COLORS.defaultFallback;
};

// Descent rule icons
const getDescentLabel = (rule: string): string => {
  const labels: Record<string, string> = {
    'bilateral': 'Bilateral',
    'patrilineal': 'Patrilineal',
    'matrilineal': 'Matrilineal',
    'ambilineal': 'Ambilineal',
    'double': 'Double descent',
  };
  return labels[rule] || rule;
};

// Kinship term grouping colors for the ego-centric diagram
const TERM_COLORS = KINSHIP_TERM_COLORS;

function KinshipDiagram({ terminology, systemType }: { terminology: Record<string, string>; systemType: string }) {
  const terms = Object.entries(terminology);
  if (terms.length === 0) return null;

  return (
    <div className="mt-2 border-t pt-2">
      <div className="text-xs font-medium text-gray-600 mb-1.5">Kinship Terms ({systemType} system):</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {terms.map(([relation, term]) => (
          <div key={relation} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: TERM_COLORS[relation] || INTERACTION_COLORS.defaultFallback }}
            />
            <span className="text-gray-500 capitalize">{relation}:</span>
            <span className="font-medium truncate" title={term}>{term}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KinshipSystemLayer({
  systems,
  opacity = 0.8,
  onSystemClick,
  selectedSystemId,
}: KinshipSystemLayerProps) {
  if (systems.length === 0) {
    return null;
  }

  return (
    <>
      {systems.map((system) => {
        if (!system.coordinates) return null;
        const { lat, lng } = system.coordinates;
        const isSelected = selectedSystemId === system.id;
        const color = getSystemColor(system.systemType);

        return (
          <CircleMarker
            key={system.id}
            center={[lat, lng]}
            radius={isSelected ? 12 : 8}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (onSystemClick) {
                  onSystemClick(system.id);
                }
              },
            }}
          >
            <Popup>
              <div className="min-w-[260px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{system.systemType} System</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {system.descentRule}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Descent:</span>
                    <span className="font-medium">{getDescentLabel(system.descentRule)}</span>
                  </div>

                  {system.residenceRule && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Residence:</span>
                      <span className="font-medium capitalize">{system.residenceRule}</span>
                    </div>
                  )}

                  {system.associatedCivilizations && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Culture:</span>
                      <span className="font-medium text-right max-w-[160px] truncate">
                        {system.associatedCivilizations}
                      </span>
                    </div>
                  )}

                  {system.languageIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Languages:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {system.languageIds.slice(0, 4).join(', ')}
                        {system.languageIds.length > 4 &&
                          ` +${system.languageIds.length - 4}`}
                      </span>
                    </div>
                  )}
                </div>

                <KinshipDiagram terminology={system.terminology} systemType={system.systemType} />
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default KinshipSystemLayer;
