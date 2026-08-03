import React, { useMemo } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import type { Path } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { ArchaeologicalSiteFeature } from '../../../lib/visualization/geospatial-types';
import { ARCHAEOLOGICAL_SITE_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { MarkerClusterGroup } from './MarkerClusterGroup';

const CLUSTER_THRESHOLD = 200;

interface ArchaeologicalSitesLayerProps {
  features: ArchaeologicalSiteFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
}

// Get color based on site type
const getSiteColor = (siteType: string): string => {
  return ARCHAEOLOGICAL_SITE_COLORS[siteType] || ARCHAEOLOGICAL_SITE_COLORS.unknown;
};

// Calculate marker radius based on importance
const getMarkerRadius = (importance: number): number => {
  return 4 + (importance / 100) * 8;
};

export function ArchaeologicalSitesLayer({
  features,
  opacity = 0.8,
  onFeatureClick,
  selectedFeatureId,
}: ArchaeologicalSitesLayerProps) {
  // Use clustering for large datasets
  const clusterMarkers = useMemo(() => {
    if (features.length < CLUSTER_THRESHOLD) return null;
    return features.map((feature) => {
      const props = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;
      return {
        position: [lat, lng] as [number, number],
        color: getSiteColor(props.siteType),
        radius: getMarkerRadius(props.importance),
        popupContent: `<div class="p-2"><strong>${props.name}</strong><br/>${props.siteType} - ${formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}</div>`,
        onClick: () => onFeatureClick?.(props.siteId),
      };
    });
  }, [features, onFeatureClick]);

  if (features.length === 0) {
    return null;
  }

  // Use clustered rendering for large datasets
  if (clusterMarkers) {
    return <MarkerClusterGroup markers={clusterMarkers} maxClusterRadius={60} />;
  }

  // Standard rendering for smaller datasets
  return (
    <>
      {features.map((feature) => {
        const props = feature.properties;
        const [lng, lat] = feature.geometry.coordinates;
        const isSelected = selectedFeatureId === feature.id;
        const color = getSiteColor(props.siteType);
        const radius = getMarkerRadius(props.importance);

        return (
          <CircleMarker
            key={feature.id}
            center={[lat, lng]}
            radius={isSelected ? radius * 1.5 : radius}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (onFeatureClick) {
                  onFeatureClick(props.siteId);
                }
              },
              mouseover: function (this: Path) {
                if (!isSelected) {
                  this.setStyle({
                    fillOpacity: opacity * 1.2,
                    weight: 3,
                  });
                }
              },
              mouseout: function (this: Path) {
                if (!isSelected) {
                  this.setStyle({
                    fillOpacity: opacity,
                    weight: 2,
                  });
                }
              },
            }}
          >
            <Popup>
              <div className="p-2 min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{props.name}</h3>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Site Type:</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {props.siteType}
                    </Badge>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Time Period:</span>
                    <span className="font-medium text-right">
                      {formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Excavation:</span>
                    <span className="font-medium capitalize">{props.excavationStatus}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Importance:</span>
                    <span className="font-medium">{props.importance}%</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Confidence:</span>
                    <span className="font-medium">{props.confidence}%</span>
                  </div>

                  {props.findings && props.findings.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Major Findings:</span>
                      <ul className="text-xs mt-1 space-y-0.5">
                        {props.findings.slice(0, 3).map((finding, idx) => (
                          <li key={idx} className="text-gray-700">• {finding}</li>
                        ))}
                        {props.findings.length > 3 && (
                          <li className="text-gray-500">+{props.findings.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {props.associatedLanguageIds && props.associatedLanguageIds.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs">
                        Associated with {props.associatedLanguageIds.length} language(s)
                      </span>
                    </div>
                  )}

                  {props.sources && props.sources.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs">
                        {props.sources.length} source(s)
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => {
                    if (onFeatureClick) {
                      onFeatureClick(props.siteId);
                    }
                  }}
                >
                  View Details
                </Button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
