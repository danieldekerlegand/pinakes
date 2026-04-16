import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { DeckGL } from '@deck.gl/react';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import { GeoJsonLayer, ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  RotateCcw,
  Mountain,
  Compass,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { useMapLayers } from './hooks/useMapLayers';
import { useTimeSlider } from './hooks/useTimeSlider';
import { DEFAULT_NARRATION_POINTS } from '../../lib/visualization/narration-points';
import { TimeSlider } from './map-layers/TimeSlider';
import { LayerPanel } from './map-layers/LayerPanel';
import { filterGeoJSONByTime } from '../../lib/visualization/geospatial-transformers';
import {
  sampleLanguageRanges,
  sampleArchaeologicalSites,
  sampleCivilizations,
  sampleHistoricalRoutes,
} from '../../lib/visualization/sample-map-data';
import {
  CIVILIZATION_PALETTE,
  CORE_PALETTE,
  ROUTE_TYPE_COLORS,
} from '../../lib/visualization/color-theme';
import type {
  LanguageRangeFeature,
  LanguageRangeCollection,
  ArchaeologicalSiteFeature,
  ArchaeologicalSiteCollection,
  ArchaeologicalCultureFeature,
  ArchaeologicalCultureCollection,
  CivilizationFeature,
  CivilizationCollection,
  HistoricalRouteFeature,
  HistoricalRouteCollection,
} from '../../lib/visualization/geospatial-types';

// ============================================================================
// Types
// ============================================================================

export type ExtrusionMetric = 'population' | 'area' | 'speakers' | 'importance';

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
}

interface TopographicMapViewProps {
  onFeatureSelect?: (id: string) => void;
  selectedFeatureId?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const INITIAL_VIEW_STATE: ViewState = {
  longitude: 0,
  latitude: 20,
  zoom: 2,
  pitch: 45,
  bearing: 0,
};

const TERRAIN_TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const BASEMAP_STYLE =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const TERRAIN_BASEMAP_STYLE =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

const MAX_EXTRUSION_HEIGHT = 500000; // meters

// ============================================================================
// Helpers
// ============================================================================

function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getLanguageFamilyColor(familyId: string): [number, number, number, number] {
  const idx = hashString(familyId) % CORE_PALETTE.length;
  return hexToRgba(CORE_PALETTE[idx], 180);
}

function getCivilizationColor(civId: string): [number, number, number, number] {
  const idx = hashString(civId) % CIVILIZATION_PALETTE.length;
  return hexToRgba(CIVILIZATION_PALETTE[idx], 160);
}

function getRouteColor(routeType: string): [number, number, number, number] {
  const colors = ROUTE_TYPE_COLORS as Record<string, string>;
  const hex = colors[routeType] || '#6b7280';
  return hexToRgba(hex, 200);
}

function getExtrusionValue(
  feature: CivilizationFeature,
  metric: ExtrusionMetric,
): number {
  const props = feature.properties;
  switch (metric) {
    case 'population':
      return props.population ? Math.min(props.population / 1e6, 100) : 5;
    case 'area':
      return 20;
    case 'speakers':
      return 10;
    case 'importance':
      return 30;
    default:
      return 10;
  }
}

// ============================================================================
// Component
// ============================================================================

export function TopographicMapView({
  onFeatureSelect,
  selectedFeatureId,
}: TopographicMapViewProps) {
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);
  const [showTerrain, setShowTerrain] = useState(true);
  const [extrusionMetric, setExtrusionMetric] = useState<ExtrusionMetric>('population');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize hooks
  const {
    state: layerState,
    isLayerVisible,
    toggleLayer,
    setLayerOpacity,
    showAll,
    hideAll,
    showCategory,
    hideCategory,
    getLayerConfig,
    applyPreset,
    activePresetId,
  } = useMapLayers();

  const {
    state: timeState,
    currentYear,
    isPlaying,
    activeNarration,
    toggle,
    setCurrentYear,
    setPlaybackSpeed,
    setStepSize,
    stepForward,
    stepBackward,
    jumpToStart,
    jumpToEnd,
    dismissNarration,
  } = useTimeSlider({}, true, DEFAULT_NARRATION_POINTS);

  // ---- Data fetching (same as EnhancedLanguageMapView) ----
  const { data: languageRangesData, isLoading: loadingRanges } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-ranges'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('language-ranges'),
  });

  const { data: languageRangePolygonsData, isLoading: loadingRangePolygons } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-range-polygons'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('language-range-polygons'),
  });

  const { data: archaeologicalSitesData, isLoading: loadingSites } = useQuery<ArchaeologicalSiteCollection>({
    queryKey: ['/api/map/archaeological-sites'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('archaeological-sites'),
  });

  const { data: archaeologicalCulturesData, isLoading: loadingCultures } = useQuery<ArchaeologicalCultureCollection>({
    queryKey: ['/api/map/archaeological-cultures'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('archaeological-cultures'),
  });

  const { data: civilizationsData, isLoading: loadingCivilizations } = useQuery<CivilizationCollection>({
    queryKey: ['/api/map/civilizations'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('civilizations'),
  });

  const { data: routesData, isLoading: loadingRoutes } = useQuery<HistoricalRouteCollection>({
    queryKey: ['/api/map/routes'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('routes'),
  });

  // ---- Fallback to sample data ----
  const allLanguageRanges = useMemo(() => {
    if (languageRangesData?.features?.length) return languageRangesData.features;
    return sampleLanguageRanges;
  }, [languageRangesData]);

  const allLanguageRangePolygons = useMemo(
    () => languageRangePolygonsData?.features ?? [],
    [languageRangePolygonsData],
  );

  const allArchaeologicalSites = useMemo(() => {
    if (archaeologicalSitesData?.features?.length) return archaeologicalSitesData.features;
    return sampleArchaeologicalSites;
  }, [archaeologicalSitesData]);

  const allArchaeologicalCultures = useMemo(
    () => archaeologicalCulturesData?.features ?? [],
    [archaeologicalCulturesData],
  );

  const allCivilizations = useMemo(() => {
    if (civilizationsData?.features?.length) return civilizationsData.features;
    return sampleCivilizations;
  }, [civilizationsData]);

  const allRoutes = useMemo(() => {
    if (routesData?.features?.length) return routesData.features;
    return sampleHistoricalRoutes;
  }, [routesData]);

  // ---- Time filtering ----
  const filteredLanguageRanges = useMemo(
    () => filterGeoJSONByTime(allLanguageRanges, currentYear),
    [allLanguageRanges, currentYear],
  );

  const filteredLanguageRangePolygons = useMemo(
    () => filterGeoJSONByTime(allLanguageRangePolygons, currentYear),
    [allLanguageRangePolygons, currentYear],
  );

  const filteredArchaeologicalSites = useMemo(
    () => filterGeoJSONByTime(allArchaeologicalSites, currentYear),
    [allArchaeologicalSites, currentYear],
  );

  const filteredArchaeologicalCultures = useMemo(
    () => filterGeoJSONByTime(allArchaeologicalCultures, currentYear),
    [allArchaeologicalCultures, currentYear],
  );

  const filteredCivilizations = useMemo(
    () => filterGeoJSONByTime(allCivilizations, currentYear),
    [allCivilizations, currentYear],
  );

  const filteredRoutes = useMemo(
    () => filterGeoJSONByTime(allRoutes, currentYear),
    [allRoutes, currentYear],
  );

  // ---- Camera controls ----
  const resetView = useCallback(() => {
    setViewState({ ...INITIAL_VIEW_STATE, transitionDuration: 1000 });
  }, []);

  const adjustPitch = useCallback((delta: number) => {
    setViewState((prev) => ({
      ...prev,
      pitch: Math.max(0, Math.min(85, prev.pitch + delta)),
      transitionDuration: 300,
    }));
  }, []);

  const adjustBearing = useCallback((delta: number) => {
    setViewState((prev) => ({
      ...prev,
      bearing: (prev.bearing + delta) % 360,
      transitionDuration: 300,
    }));
  }, []);

  // Orbit animation
  const orbitRef = useRef<number | null>(null);
  const [isOrbiting, setIsOrbiting] = useState(false);

  const toggleOrbit = useCallback(() => {
    if (isOrbiting && orbitRef.current !== null) {
      cancelAnimationFrame(orbitRef.current);
      orbitRef.current = null;
      setIsOrbiting(false);
      return;
    }
    setIsOrbiting(true);
    const animate = () => {
      setViewState((prev) => ({
        ...prev,
        bearing: (prev.bearing + 0.2) % 360,
      }));
      orbitRef.current = requestAnimationFrame(animate);
    };
    orbitRef.current = requestAnimationFrame(animate);
  }, [isOrbiting]);

  useEffect(() => {
    return () => {
      if (orbitRef.current !== null) cancelAnimationFrame(orbitRef.current);
    };
  }, []);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepForward();
          break;
        case 'Home':
          e.preventDefault();
          jumpToStart();
          break;
        case 'End':
          e.preventDefault();
          jumpToEnd();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, stepBackward, stepForward, jumpToStart, jumpToEnd]);

  // ---- Feature click handler ----
  const handleClick = useCallback(
    (info: any) => {
      if (info.object && onFeatureSelect) {
        const props = info.object.properties || info.object;
        const id =
          props.civilizationId ||
          props.languageId ||
          props.siteId ||
          props.routeId ||
          props.id;
        if (id) onFeatureSelect(id);
      }
    },
    [onFeatureSelect],
  );

  // ---- Build deck.gl layers ----
  const deckLayers = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];

    // Terrain layer
    if (showTerrain) {
      layers.push(
        new TerrainLayer({
          id: 'terrain',
          minZoom: 0,
          maxZoom: 15,
          elevationDecoder: {
            rScaler: 256,
            gScaler: 1,
            bScaler: 1 / 256,
            offset: -32768,
          },
          elevationData: TERRAIN_TILE_URL,
          texture: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          meshMaxError: 4.0,
        }),
      );
    }

    // Language Ranges Layer (flat polygons)
    if (isLayerVisible('language-ranges') && filteredLanguageRanges.length > 0) {
      const opacity = getLayerConfig('language-ranges')?.opacity ?? 0.6;
      layers.push(
        new GeoJsonLayer({
          id: 'language-ranges-3d',
          data: {
            type: 'FeatureCollection',
            features: filteredLanguageRanges,
          },
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          getFillColor: (f: any) => {
            const color = getLanguageFamilyColor(f.properties.familyId);
            return [...color.slice(0, 3), Math.round(color[3] * opacity)] as [number, number, number, number];
          },
          getLineColor: (f: any) => {
            const color = getLanguageFamilyColor(f.properties.familyId);
            return [...color.slice(0, 3), 220] as [number, number, number, number];
          },
          getLineWidth: 1,
          lineWidthUnits: 'pixels' as const,
          onClick: handleClick,
          onHover: (info: any) => {
            setHoveredFeatureId(info.object?.properties?.languageId ?? null);
          },
          updateTriggers: {
            getFillColor: [opacity],
          },
        }),
      );
    }

    // Language Range Polygons (expanded dataset)
    if (isLayerVisible('language-range-polygons') && filteredLanguageRangePolygons.length > 0) {
      const opacity = getLayerConfig('language-range-polygons')?.opacity ?? 0.5;
      layers.push(
        new GeoJsonLayer({
          id: 'language-range-polygons-3d',
          data: {
            type: 'FeatureCollection',
            features: filteredLanguageRangePolygons,
          },
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          getFillColor: (f: any) => {
            const color = getLanguageFamilyColor(f.properties.familyId);
            return [...color.slice(0, 3), Math.round(color[3] * opacity)] as [number, number, number, number];
          },
          getLineColor: [100, 100, 100, 150] as [number, number, number, number],
          getLineWidth: 1,
          lineWidthUnits: 'pixels' as const,
          onClick: handleClick,
          updateTriggers: {
            getFillColor: [opacity],
          },
        }),
      );
    }

    // Archaeological Cultures Layer (flat polygons)
    if (isLayerVisible('archaeological-cultures') && filteredArchaeologicalCultures.length > 0) {
      const opacity = getLayerConfig('archaeological-cultures')?.opacity ?? 0.5;
      layers.push(
        new GeoJsonLayer({
          id: 'archaeological-cultures-3d',
          data: {
            type: 'FeatureCollection',
            features: filteredArchaeologicalCultures,
          },
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          getFillColor: (f: any) => {
            const idx = hashString(f.properties.cultureId || f.properties.name || '') % CORE_PALETTE.length;
            return hexToRgba(CORE_PALETTE[idx], Math.round(160 * opacity));
          },
          getLineColor: [139, 92, 46, 200] as [number, number, number, number],
          getLineWidth: 2,
          lineWidthUnits: 'pixels' as const,
          onClick: handleClick,
          updateTriggers: {
            getFillColor: [opacity],
          },
        }),
      );
    }

    // Civilizations Layer (extruded 3D polygons!)
    if (isLayerVisible('civilizations') && filteredCivilizations.length > 0) {
      const opacity = getLayerConfig('civilizations')?.opacity ?? 0.5;
      layers.push(
        new (GeoJsonLayer as any)({
          id: 'civilizations-3d',
          data: {
            type: 'FeatureCollection',
            features: filteredCivilizations,
          },
          pickable: true,
          stroked: true,
          filled: true,
          extruded: true,
          wireframe: true,
          getFillColor: (f: any) => {
            const isSelected = selectedFeatureId === f.properties.civilizationId;
            if (isSelected) return [59, 130, 246, 200] as [number, number, number, number];
            const color = getCivilizationColor(f.properties.civilizationId);
            return [...color.slice(0, 3), Math.round(color[3] * opacity)] as [number, number, number, number];
          },
          getLineColor: (f: any) => {
            const isSelected = selectedFeatureId === f.properties.civilizationId;
            if (isSelected) return [29, 78, 216, 255] as [number, number, number, number];
            const color = getCivilizationColor(f.properties.civilizationId);
            return [...color.slice(0, 3), 220] as [number, number, number, number];
          },
          getElevation: (f: any) => {
            const value = getExtrusionValue(f as CivilizationFeature, extrusionMetric);
            return (value / 100) * MAX_EXTRUSION_HEIGHT;
          },
          getLineWidth: 2,
          lineWidthUnits: 'pixels' as const,
          elevationScale: 1,
          onClick: handleClick,
          onHover: (info: any) => {
            setHoveredFeatureId(info.object?.properties?.civilizationId ?? null);
          },
          updateTriggers: {
            getFillColor: [opacity, selectedFeatureId],
            getLineColor: [selectedFeatureId],
            getElevation: [extrusionMetric],
          },
        }),
      );
    }

    // Archaeological Sites Layer (scatterplot)
    if (isLayerVisible('archaeological-sites') && filteredArchaeologicalSites.length > 0) {
      const opacity = getLayerConfig('archaeological-sites')?.opacity ?? 0.8;
      layers.push(
        new ScatterplotLayer({
          id: 'archaeological-sites-3d',
          data: filteredArchaeologicalSites,
          pickable: true,
          getPosition: (d: any) => d.geometry.coordinates,
          getRadius: (d: any) => Math.max(3000, (d.properties.importance || 50) * 200),
          getFillColor: (d: any) => {
            const siteTypeColors: Record<string, [number, number, number, number]> = {
              settlement: [245, 158, 11, Math.round(255 * opacity)],
              burial: [139, 92, 246, Math.round(255 * opacity)],
              temple: [236, 72, 153, Math.round(255 * opacity)],
              fortification: [239, 68, 68, Math.round(255 * opacity)],
              workshop: [20, 184, 166, Math.round(255 * opacity)],
              ceremonial: [249, 115, 22, Math.round(255 * opacity)],
            };
            return siteTypeColors[d.properties.siteType] || [107, 114, 128, Math.round(255 * opacity)];
          },
          getLineColor: [255, 255, 255, 200] as [number, number, number, number],
          lineWidthMinPixels: 1,
          stroked: true,
          radiusUnits: 'meters' as const,
          radiusMinPixels: 4,
          radiusMaxPixels: 20,
          onClick: handleClick,
          updateTriggers: {
            getFillColor: [opacity],
          },
        }),
      );
    }

    // Routes Layer (path layer)
    if (isLayerVisible('routes') && filteredRoutes.length > 0) {
      const opacity = getLayerConfig('routes')?.opacity ?? 0.7;
      layers.push(
        new PathLayer({
          id: 'routes-3d',
          data: filteredRoutes,
          pickable: true,
          getPath: (d: any) => d.geometry.coordinates,
          getColor: (d: any) => {
            const color = getRouteColor(d.properties.routeType);
            return [...color.slice(0, 3), Math.round(color[3] * opacity)] as [number, number, number, number];
          },
          getWidth: (d: any) => {
            const importance = d.properties.importance || 50;
            return Math.max(2, importance / 10);
          },
          widthUnits: 'pixels' as const,
          widthMinPixels: 2,
          widthMaxPixels: 10,
          capRounded: true,
          jointRounded: true,
          onClick: handleClick,
          updateTriggers: {
            getColor: [opacity],
          },
        }),
      );
    }

    return layers;
  }, [
    showTerrain,
    isLayerVisible,
    getLayerConfig,
    filteredLanguageRanges,
    filteredLanguageRangePolygons,
    filteredArchaeologicalSites,
    filteredArchaeologicalCultures,
    filteredCivilizations,
    filteredRoutes,
    selectedFeatureId,
    extrusionMetric,
    handleClick,
  ]);

  // ---- Tooltip rendering ----
  const getTooltip = useCallback((info: any) => {
    if (!info.object) return null;
    const props = info.object.properties || info.object;
    const name =
      props.name || props.languageName || props.familyName || 'Feature';
    const period = props.timePeriod
      ? `${props.timePeriod.start < 0 ? Math.abs(props.timePeriod.start) + ' BCE' : props.timePeriod.start + ' CE'} – ${props.timePeriod.end === null ? 'present' : props.timePeriod.end < 0 ? Math.abs(props.timePeriod.end) + ' BCE' : props.timePeriod.end + ' CE'}`
      : '';
    const pop = props.population
      ? `Pop: ${props.population.toLocaleString()}`
      : '';

    return {
      html: `<div style="padding:8px;max-width:280px">
        <strong>${name}</strong>
        ${period ? `<br/><span style="color:#666">${period}</span>` : ''}
        ${pop ? `<br/><span style="color:#666">${pop}</span>` : ''}
        ${props.politicalStructure ? `<br/><span style="color:#666">${props.politicalStructure}</span>` : ''}
      </div>`,
      style: {
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        fontSize: '13px',
      },
    };
  }, []);

  // ---- Loading state ----
  const isLoadingAnyLayer =
    (loadingRanges && isLayerVisible('language-ranges')) ||
    (loadingRangePolygons && isLayerVisible('language-range-polygons')) ||
    (loadingSites && isLayerVisible('archaeological-sites')) ||
    (loadingCultures && isLayerVisible('archaeological-cultures')) ||
    (loadingCivilizations && isLayerVisible('civilizations')) ||
    (loadingRoutes && isLayerVisible('routes'));

  if (isLoadingAnyLayer) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading 3D map data...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative rounded-lg overflow-hidden ${isFullscreen ? 'bg-white' : ''}`}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        controller={true}
        layers={deckLayers}
        getTooltip={getTooltip}
        style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0' }}
      >
        <MapLibreMap
          mapStyle={showTerrain ? TERRAIN_BASEMAP_STYLE : BASEMAP_STYLE}
          attributionControl={false}
        />
      </DeckGL>

      {/* 3D Camera Controls */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2">
        <div className="bg-white rounded-lg shadow-lg border p-2 flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600 mb-1 text-center">Camera</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Increase pitch"
            onClick={() => adjustPitch(10)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Decrease pitch"
            onClick={() => adjustPitch(-10)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Rotate left"
            onClick={() => adjustBearing(-15)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant={isOrbiting ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            title="Toggle orbit animation"
            onClick={toggleOrbit}
          >
            <Compass className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Reset view"
            onClick={resetView}
          >
            <Mountain className="h-4 w-4" />
          </Button>
        </div>

        {/* Terrain toggle */}
        <div className="bg-white rounded-lg shadow-lg border p-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showTerrain}
              onChange={(e) => setShowTerrain(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs font-medium text-gray-700">Terrain</span>
          </label>
        </div>

        {/* Extrusion metric selector */}
        {isLayerVisible('civilizations') && (
          <div className="bg-white rounded-lg shadow-lg border p-2">
            <span className="text-xs font-medium text-gray-600 block mb-1">
              Extrude by
            </span>
            {(['population', 'area', 'importance'] as ExtrusionMetric[]).map(
              (metric) => (
                <label
                  key={metric}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="extrusion-metric"
                    checked={extrusionMetric === metric}
                    onChange={() => setExtrusionMetric(metric)}
                    className="w-3 h-3"
                  />
                  <span className="text-xs capitalize text-gray-700">
                    {metric}
                  </span>
                </label>
              ),
            )}
          </div>
        )}
      </div>

      {/* Pitch/Bearing indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 rounded-full px-3 py-1 text-xs text-gray-600 shadow">
        Pitch: {Math.round(viewState.pitch)}° · Bearing: {Math.round(viewState.bearing)}°
      </div>

      {/* Layer Controls Panel */}
      <LayerPanel
        layerConfigs={layerState.layerConfigs}
        activeLayers={layerState.activeLayers}
        onToggleLayer={toggleLayer}
        onOpacityChange={setLayerOpacity}
        onShowAll={showAll}
        onHideAll={hideAll}
        onShowCategory={showCategory}
        onHideCategory={hideCategory}
        onApplyPreset={applyPreset}
        activePresetId={activePresetId}
      />

      {/* Fullscreen Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleFullscreen}
        className="absolute bottom-4 right-4 z-[1000] bg-white shadow-lg"
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </Button>

      {/* Time Slider */}
      <TimeSlider
        currentYear={currentYear}
        minYear={timeState.minYear}
        maxYear={timeState.maxYear}
        isPlaying={isPlaying}
        playbackSpeed={timeState.playbackSpeed}
        stepSize={timeState.stepSize}
        narrationPoints={DEFAULT_NARRATION_POINTS}
        activeNarration={activeNarration}
        onYearChange={setCurrentYear}
        onPlayPause={toggle}
        onStepForward={stepForward}
        onStepBackward={stepBackward}
        onSpeedChange={setPlaybackSpeed}
        onStepSizeChange={setStepSize}
        onJumpToStart={jumpToStart}
        onJumpToEnd={jumpToEnd}
        onDismissNarration={dismissNarration}
      />

      {/* Playing indicator */}
      {isPlaying && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[1001] bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium">
          Playing: {currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`}
        </div>
      )}
    </div>
  );
}
