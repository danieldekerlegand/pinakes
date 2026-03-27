import React, { useEffect, useMemo, useRef } from 'react';
import { GeoJSON, TileLayer, useMap } from 'react-leaflet';
import type { PathOptions, Map as LeafletMap } from 'leaflet';
import { filterGeoJSONByTime } from '../../../lib/visualization/geospatial-transformers';
import { CIVILIZATION_PALETTE } from '../../../lib/visualization/color-theme';
import type {
  CivilizationFeature,
  LanguageRangeFeature,
} from '../../../lib/visualization/geospatial-types';

const COMPARISON_PANE = 'comparison-overlay';
const COMPARISON_PANE_ZINDEX = 450; // Above default overlay pane (400)

interface ComparisonOverlayProps {
  year: number;
  dividerPosition: number; // 0-100, controls clip-path
  civilizations: CivilizationFeature[];
  languageRanges: LanguageRangeFeature[];
  civilizationOpacity?: number;
  languageRangeOpacity?: number;
}

/**
 * Renders comparison layers in a custom Leaflet pane with CSS clip-path.
 * The pane is clipped to the right side of the map (past the divider),
 * so the "comparison" data only shows on the right.
 */
export function ComparisonOverlay({
  year,
  dividerPosition,
  civilizations,
  languageRanges,
  civilizationOpacity = 0.5,
  languageRangeOpacity = 0.6,
}: ComparisonOverlayProps) {
  const map = useMap();
  const paneCreated = useRef(false);

  // Create custom pane on mount
  useEffect(() => {
    if (!map || paneCreated.current) return;

    const existingPane = map.getPane(COMPARISON_PANE);
    if (!existingPane) {
      const pane = map.createPane(COMPARISON_PANE);
      pane.style.zIndex = String(COMPARISON_PANE_ZINDEX);
    }
    paneCreated.current = true;
  }, [map]);

  // Update clip-path when divider position changes
  useEffect(() => {
    if (!map) return;
    const pane = map.getPane(COMPARISON_PANE);
    if (pane) {
      pane.style.clipPath = `inset(0 0 0 ${dividerPosition}%)`;
    }
  }, [map, dividerPosition]);

  // Clean up pane clip on unmount
  useEffect(() => {
    return () => {
      if (!map) return;
      const pane = map.getPane(COMPARISON_PANE);
      if (pane) {
        pane.style.clipPath = '';
      }
    };
  }, [map]);

  // Filter data to the comparison year
  const filteredCivilizations = useMemo(
    () => filterGeoJSONByTime(civilizations, year),
    [civilizations, year],
  );

  const filteredLanguageRanges = useMemo(
    () => filterGeoJSONByTime(languageRanges, year),
    [languageRanges, year],
  );

  const getCivilizationColor = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CIVILIZATION_PALETTE[Math.abs(hash) % CIVILIZATION_PALETTE.length];
  };

  return (
    <>
      {/* Comparison tile layer with different style */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        pane={COMPARISON_PANE}
      />

      {/* Comparison civilizations */}
      {filteredCivilizations.map((feature) => {
        const color = getCivilizationColor(feature.properties.id || feature.properties.name || '');
        const style: PathOptions = {
          fillColor: color,
          fillOpacity: civilizationOpacity * 0.8,
          color: color,
          weight: 2,
          opacity: civilizationOpacity,
          dashArray: '6 4',
        };

        return (
          <GeoJSON
            key={`comp-civ-${feature.properties.id || feature.properties.name}-${year}`}
            data={feature as any}
            style={() => style}
            pane={COMPARISON_PANE}
          />
        );
      })}

      {/* Comparison language ranges */}
      {filteredLanguageRanges.map((feature) => {
        const style: PathOptions = {
          fillColor: '#3b82f6',
          fillOpacity: languageRangeOpacity * 0.6,
          color: '#2563eb',
          weight: 1.5,
          opacity: languageRangeOpacity,
          dashArray: '4 3',
        };

        return (
          <GeoJSON
            key={`comp-lr-${feature.properties.id || feature.properties.name}-${year}`}
            data={feature as any}
            style={() => style}
            pane={COMPARISON_PANE}
          />
        );
      })}
    </>
  );
}

/**
 * Also clip the default overlay pane to the LEFT side of the divider,
 * so the "current" layers only show on the left.
 */
export function useClipDefaultPane(map: LeafletMap | null, dividerPosition: number, isActive: boolean) {
  useEffect(() => {
    if (!map) return;
    const overlayPane = map.getPane('overlayPane');
    const tilePane = map.getPane('tilePane');

    if (isActive) {
      if (overlayPane) {
        overlayPane.style.clipPath = `inset(0 ${100 - dividerPosition}% 0 0)`;
      }
      if (tilePane) {
        tilePane.style.clipPath = `inset(0 ${100 - dividerPosition}% 0 0)`;
      }
    }

    return () => {
      if (overlayPane) overlayPane.style.clipPath = '';
      if (tilePane) tilePane.style.clipPath = '';
    };
  }, [map, dividerPosition, isActive]);
}
