import React from 'react';
import { Polyline, CircleMarker, Popup } from 'react-leaflet';
import type { LatLngExpression, Path } from 'leaflet';
import { Badge } from '../../ui/badge';
import { LANGUAGE_CONTACT_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface LanguageContactFeature {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  region: string;
  featuresTransferred: {
    phonological: string[];
    lexical: string[];
    grammatical: string[];
  };
  exampleFeatures: string;
  intensity: string;
}

interface LanguageCoords {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface LanguageContactsLayerProps {
  contacts: LanguageContactFeature[];
  languageCoords: Map<string, LanguageCoords>;
  opacity?: number;
  onContactClick?: (id: string) => void;
  selectedContactId?: string | null;
}

const getContactColor = (contactType: string): string => {
  return LANGUAGE_CONTACT_COLORS[contactType] || INTERACTION_COLORS.defaultFallback;
};

const getIntensityWeight = (intensity: string): number => {
  switch (intensity) {
    case 'heavy': return 4;
    case 'moderate': return 2.5;
    case 'light': return 1.5;
    default: return 2;
  }
};

// Offset curve control point for curved lines between languages
function getCurvedPositions(
  from: [number, number],
  to: [number, number]
): LatLngExpression[] {
  const midLat = (from[0] + to[0]) / 2;
  const midLng = (from[1] + to[1]) / 2;
  // Offset perpendicular to the line for a curve effect
  const dx = to[1] - from[1];
  const dy = to[0] - from[0];
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = dist * 0.15;
  const controlLat = midLat + (dx / dist) * offset;
  const controlLng = midLng - (dy / dist) * offset;

  // Approximate curve with segments
  const points: LatLngExpression[] = [];
  for (let t = 0; t <= 1; t += 0.1) {
    const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * controlLat + t * t * to[0];
    const lng = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * controlLng + t * t * to[1];
    points.push([lat, lng]);
  }
  return points;
}

export function LanguageContactsLayer({
  contacts,
  languageCoords,
  opacity = 0.7,
  onContactClick,
  selectedContactId,
}: LanguageContactsLayerProps) {
  if (contacts.length === 0) return null;

  // Collect unique language nodes that appear in contacts
  const languageNodes = new Map<string, LanguageCoords>();
  for (const contact of contacts) {
    const src = languageCoords.get(contact.sourceLanguageId);
    const tgt = languageCoords.get(contact.targetLanguageId);
    if (src) languageNodes.set(contact.sourceLanguageId, src);
    if (tgt) languageNodes.set(contact.targetLanguageId, tgt);
  }

  return (
    <>
      {/* Contact edges as curved polylines */}
      {contacts.map((contact) => {
        const src = languageCoords.get(contact.sourceLanguageId);
        const tgt = languageCoords.get(contact.targetLanguageId);
        if (!src || !tgt) return null;

        const isSelected = selectedContactId === contact.id;
        const color = getContactColor(contact.contactType);
        const weight = getIntensityWeight(contact.intensity);
        const positions = getCurvedPositions([src.lat, src.lng], [tgt.lat, tgt.lng]);

        const totalFeatures =
          (contact.featuresTransferred?.phonological?.length || 0) +
          (contact.featuresTransferred?.lexical?.length || 0) +
          (contact.featuresTransferred?.grammatical?.length || 0);

        return (
          <Polyline
            key={contact.id}
            positions={positions}
            pathOptions={{
              color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
              weight: isSelected ? weight + 2 : weight,
              opacity: isSelected ? 1 : opacity,
              dashArray: contact.contactType === 'substrate' ? '8, 4' : undefined,
            }}
            eventHandlers={{
              click: () => onContactClick?.(contact.id),
              mouseover: function (this: Path) {
                if (!isSelected) {
                  this.setStyle({ weight: weight + 2, opacity: 1 });
                }
              },
              mouseout: function (this: Path) {
                if (!isSelected) {
                  this.setStyle({ weight, opacity });
                }
              },
            }}
          >
            <Popup>
              <div className="p-2 min-w-[240px]">
                <h3 className="font-bold text-base mb-1">
                  {src.name} → {tgt.name}
                </h3>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {contact.contactType}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Intensity:</span>
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${
                        contact.intensity === 'heavy'
                          ? 'border-red-300 text-red-700'
                          : contact.intensity === 'moderate'
                          ? 'border-yellow-300 text-yellow-700'
                          : 'border-green-300 text-green-700'
                      }`}
                    >
                      {contact.intensity}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">{contact.timePeriod}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Region:</span>
                    <span className="font-medium">{contact.region}</span>
                  </div>
                  {totalFeatures > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Features transferred:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {contact.featuresTransferred.phonological.length > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">
                            {contact.featuresTransferred.phonological.length} phonological
                          </span>
                        )}
                        {contact.featuresTransferred.lexical.length > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                            {contact.featuresTransferred.lexical.length} lexical
                          </span>
                        )}
                        {contact.featuresTransferred.grammatical.length > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">
                            {contact.featuresTransferred.grammatical.length} grammatical
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {contact.exampleFeatures && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Examples:</span>
                      <p className="text-xs mt-1 text-gray-700">{contact.exampleFeatures}</p>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </Polyline>
        );
      })}

      {/* Language nodes as circle markers */}
      {Array.from(languageNodes.values()).map((lang) => (
        <CircleMarker
          key={`contact-node-${lang.id}`}
          center={[lang.lat, lang.lng]}
          radius={6}
          pathOptions={{
            color: INTERACTION_COLORS.selectedBorder,
            fillColor: INTERACTION_COLORS.selected,
            fillOpacity: 0.8,
            weight: 2,
          }}
        >
          <Popup>
            <div className="p-1">
              <span className="font-bold text-sm">{lang.name}</span>
              <span className="text-xs text-gray-500 ml-1">({lang.id})</span>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
