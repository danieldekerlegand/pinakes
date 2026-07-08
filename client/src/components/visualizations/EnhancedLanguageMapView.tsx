import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Maximize2, Minimize2, BookOpen, Eye, Keyboard, Camera } from 'lucide-react';
import { Button } from '../ui/button';
import { exportMapPNG } from '../../lib/visualization/export-utils';
import { useMapLayers } from './hooks/useMapLayers';
import { useTimeSlider } from './hooks/useTimeSlider';
import { DEFAULT_NARRATION_POINTS } from '../../lib/visualization/narration-points';
import { LanguageRangeLayer } from './map-layers/LanguageRangeLayer';
import { ArchaeologicalSitesLayer } from './map-layers/ArchaeologicalSitesLayer';
import { ArchaeologicalCultureLayer } from './map-layers/ArchaeologicalCultureLayer';
import { CivilizationLayer } from './map-layers/CivilizationLayer';
import { RoutesLayer } from './map-layers/RoutesLayer';
import { MaterialCultureHeatmap } from './map-layers/MaterialCultureHeatmap';
import { MaterialCultureWaveLayer } from './map-layers/MaterialCultureWaveLayer';
import type { MaterialCultureItem } from './map-layers/MaterialCultureWaveLayer';
import { CuisineLayer } from './map-layers/CuisineLayer';
import type { CuisineFeature } from './map-layers/CuisineLayer';
import { MusicTraditionLayer } from './map-layers/MusicTraditionLayer';
import type { MusicTraditionFeature } from './map-layers/MusicTraditionLayer';
import { DanceTraditionLayer } from './map-layers/DanceTraditionLayer';
import type { DanceTraditionFeature } from './map-layers/DanceTraditionLayer';
import { ReligionLayer } from './map-layers/ReligionLayer';
import type { ReligionFeature } from './map-layers/ReligionLayer';
import { TimeSlider } from './map-layers/TimeSlider';
import { LayerPanel } from './map-layers/LayerPanel';
import { MapLegend } from './map-layers/MapLegend';
import { BattlesLayer } from './map-layers/BattlesLayer';
import type { BattleFeature } from './map-layers/BattlesLayer';
import { HaplogroupLayer } from './map-layers/HaplogroupLayer';
import type { HaplogroupFeature } from './map-layers/HaplogroupLayer';
import { LanguageContactsLayer } from './map-layers/LanguageContactsLayer';
import type { LanguageContactFeature } from './map-layers/LanguageContactsLayer';
import { GeneticLinguisticCorrelationLayer } from './map-layers/GeneticLinguisticCorrelationLayer';
import type { CorrelationFeature, DivergenceAnnotation } from './map-layers/GeneticLinguisticCorrelationLayer';
import { FoodwayEventLayer } from './map-layers/FoodwayEventLayer';
import type { FoodwayEventFeature } from './map-layers/FoodwayEventLayer';
import { KinshipSystemLayer } from './map-layers/KinshipSystemLayer';
import type { KinshipSystemFeature } from './map-layers/KinshipSystemLayer';
import { ArchitecturalStylesLayer } from './map-layers/ArchitecturalStylesLayer';
import type { ArchitecturalStyleFeature } from './map-layers/ArchitecturalStylesLayer';
import { IngredientOriginsLayer } from './map-layers/IngredientOriginsLayer';
import type { IngredientOriginFeature } from './map-layers/IngredientOriginsLayer';
import { CookingTechniquesLayer } from './map-layers/CookingTechniquesLayer';
import type { CookingTechniqueFeature } from './map-layers/CookingTechniquesLayer';
import { MythologyLayer } from './map-layers/MythologyLayer';
import type { DeityFeature } from './map-layers/MythologyLayer';
import { UrheimatHypothesisLayer } from './map-layers/UrheimatHypothesisLayer';
import type { UrheimatHypothesisFeature } from './map-layers/UrheimatHypothesisLayer';
import { WhatIfScenarioLayer } from './map-layers/WhatIfScenarioLayer';
import { WhatIfScenarioControl } from './map-layers/WhatIfScenarioControl';
import {
  loadScenarios,
  getScenarioById,
  toggleScenario,
  affectedLayersFor,
  scenarioAppliesAtYear,
} from '../../lib/visualization/what-if-scenarios';
import { UrheimatHypothesisControl } from './map-layers/UrheimatHypothesisControl';
import {
  loadHypothesisRouteLinks,
  toggleHypothesis,
  getHypothesisById,
  selectRoutesForHypothesis,
  partitionRoutes,
} from '../../lib/visualization/urheimat-hypotheses';
import { CounterfactualTradeRoutesLayer } from './map-layers/CounterfactualTradeRoutesLayer';
import { CounterfactualTradeRoutesControl } from './map-layers/CounterfactualTradeRoutesControl';
import {
  loadCounterfactualRoutes,
  toggleCounterfactualRoute,
  selectAllCounterfactualRoutes,
  clearCounterfactualRoutes,
  activeCounterfactualRoutes,
  routeAppliesAtYear,
} from '../../lib/visualization/counterfactual-trade-routes';
import { SettlementsLayer } from './map-layers/SettlementsLayer';
import type { Settlement } from './map-layers/SettlementsLayer';
import { RiverWaterLayer } from './map-layers/RiverWaterLayer';
import type { RiverWaterFeature } from './map-layers/RiverWaterLayer';
import { TerritoryOverlapLayer } from './map-layers/TerritoryOverlapLayer';
import type { TerritoryFeature } from '../../lib/visualization/territory-overlap';
import type { BlendMode } from '../../lib/visualization/geospatial-types';
import { TimelineEventsSidebar } from './map-layers/TimelineEventsSidebar';
import { BoundaryDrawingLayer } from './map-layers/BoundaryDrawingLayer';
import { BaseMapSelector } from './map-layers/BaseMapSelector';
import { useBaseMap } from './hooks/useBaseMap';
import { MapLabelsLayer } from './map-layers/MapLabelsLayer';
import { useDrawingTool } from './hooks/useDrawingTool';
import { useImageGeoreference } from './hooks/useImageGeoreference';
import { ImageGeoreferenceLayer, ImageGeoreferencePanel } from './map-tools/ImageGeoreferencer';
import { StoryMode } from './map-tools/StoryMode';
import { useMeasurementTool } from './hooks/useMeasurementTool';
import { MeasurementLayer, MeasurementPanel } from './map-tools/MeasurementTools';
import { useMapFeatureExtraction } from './hooks/useMapFeatureExtraction';
import { ExtractedFeaturesLayer } from './map-tools/ExtractedFeaturesLayer';
import { MapContextMenu } from './map-layers/MapContextMenu';
import { MapFeatureInfoPanel } from './map-layers/MapFeatureInfoPanel';
import { MapSearchBar } from './map-layers/MapSearchBar';
import CultureProfilePanel from '../culture-profile-panel';
import { findCultureProfileIdForFeature } from '../../lib/visualization/culture-profile-lookup';
import type { CultureProfile } from '@shared/types';
import { useMapFeatureSelection } from './hooks/useMapFeatureSelection';
import type { FeatureLookupCollections } from './hooks/useMapFeatureSelection';
import { filterGeoJSONByTime } from '../../lib/visualization/geospatial-transformers';
import { getFamilyColor } from '../../lib/visualization/d3-helpers';
import { CIVILIZATION_PALETTE, hashIndex } from '../../lib/visualization/color-theme';
import { useMapPerformance, MapPerformanceTracker } from './hooks/useMapPerformance';
import { viewportParams } from '../../lib/visualization/map-performance';
import { useMapAccessibility } from './hooks/useMapAccessibility';
import { useMapFeatureNavigation } from './hooks/useMapFeatureNavigation';
import { describeFeature, MAP_FEATURE_NAV_SHORTCUTS } from '../../lib/visualization/map-accessibility';
import type { MapFeatureType } from '../../lib/visualization/map-accessibility';
import type { NavigableFeature } from '../../lib/visualization/map-feature-traversal';
import { TerritorialShadingProvider } from './map-layers/TerritorialShadingProvider';
import type { TerritorialFillType } from '../../lib/visualization/territorial-shading';
import { useSplitScreen } from './hooks/useSplitScreen';
import { useMapBookmarks } from './hooks/useMapBookmarks';
import type { MapViewState } from './hooks/useMapBookmarks';
import { BookmarkPanel } from './map-layers/BookmarkPanel';
import type { MapBookmark } from '../../lib/visualization/geospatial-types';
import { MapComparisonController, MapComparisonOverlays } from './map-layers/MapComparisonController';
import { DensityHeatmapLayer } from './map-layers/DensityHeatmapLayer';
import type { DensityDataSources } from './map-layers/DensityHeatmapLayer';
import {
  sampleLanguageRanges,
  sampleArchaeologicalSites,
  sampleCivilizations,
  sampleHistoricalRoutes,
  sampleMaterialCultureDistributions,
} from '../../lib/visualization/sample-map-data';
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
  MaterialCultureDistribution,
} from '../../lib/visualization/geospatial-types';
import 'leaflet/dist/leaflet.css';

/**
 * Extract a representative [lng, lat] point from any GeoJSON geometry, used to
 * anchor keyboard (spatial) feature traversal. Returns null for empty/missing
 * geometry.
 */
function representativePoint(geometry: any): [number, number] | null {
  if (!geometry) return null;
  const firstCoord = (coords: any): [number, number] | null => {
    if (!Array.isArray(coords)) return null;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return [coords[0], coords[1]];
    }
    for (const c of coords) {
      const r = firstCoord(c);
      if (r) return r;
    }
    return null;
  };
  return firstCoord(geometry.coordinates);
}

/** Rendered inside MapContainer — flies to the given target whenever it changes. */
function MapFlyTo({ target }: { target: { center: [number, number]; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target.center, target.zoom, { duration: 1.5 });
    }
  }, [map, target]);
  return null;
}

// ---------------------------------------------------------------------------
// Inner component that provides map view access via useMap()
// ---------------------------------------------------------------------------
function MapViewTracker({
  onViewChange,
  flyToTarget,
}: {
  onViewChange: (center: { lat: number; lng: number }, zoom: number) => void;
  flyToTarget: { lat: number; lng: number; zoom: number } | null;
}) {
  const map = useMap();

  useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onViewChange({ lat: c.lat, lng: c.lng }, map.getZoom());
    },
    zoomend: () => {
      const c = map.getCenter();
      onViewChange({ lat: c.lat, lng: c.lng }, map.getZoom());
    },
  });

  React.useEffect(() => {
    if (flyToTarget) {
      map.flyTo([flyToTarget.lat, flyToTarget.lng], flyToTarget.zoom, { duration: 1.2 });
    }
  }, [flyToTarget, map]);

  return null;
}

interface EnhancedLanguageMapViewProps {
  onFeatureSelect?: (id: string) => void;
  selectedFeatureId?: string | null;
  drawingToolRef?: React.MutableRefObject<ReturnType<typeof useDrawingTool> | null>;
}

export function EnhancedLanguageMapView({
  onFeatureSelect,
  selectedFeatureId,
  drawingToolRef,
}: EnhancedLanguageMapViewProps) {
  // Initialize base map selection
  const { baseMapId, baseMap, setBaseMap, availableMaps } = useBaseMap();

  // Territorial fill type for cultural region shading
  const [territorialFillType, setTerritorialFillType] = React.useState<TerritorialFillType>('solid');

  // Blend mode state for territory overlap visualization
  const [blendMode, setBlendMode] = React.useState<BlendMode>('multiply');

  // Label layer toggles (independent of parent layers)
  const [enabledLabelLayers, setEnabledLabelLayers] = React.useState<Set<string>>(
    new Set(['region-labels', 'civilization-labels', 'culture-labels', 'settlement-labels', 'route-labels'])
  );

  const toggleLabelLayer = React.useCallback((layerId: string) => {
    setEnabledLabelLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  // Initialize drawing tool
  const drawingTool = useDrawingTool();

  // Initialize image georeferencing tool
  const georefTool = useImageGeoreference();

  // Initialize measurement tool
  const measurementTool = useMeasurementTool();

  // Initialize AI feature extraction
  const featureExtraction = useMapFeatureExtraction();

  // Expose drawing tool via ref for external panels
  React.useEffect(() => {
    if (drawingToolRef) {
      drawingToolRef.current = drawingTool;
    }
  }, [drawingToolRef, drawingTool]);

  // Initialize hooks
  const {
    state: layerState,
    isLayerVisible,
    toggleLayer,
    setLayerOpacity,
    setLayerVisibility,
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
    play,
    pause,
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

  // Performance: viewport culling and level-of-detail
  const perf = useMapPerformance();

  // Accessibility: high-contrast mode, screen reader, keyboard help
  const a11y = useMapAccessibility();

  // Split-screen comparison
  const splitScreen = useSplitScreen(currentYear, timeState.minYear, timeState.maxYear);

  // Story mode state
  const [showStoryMode, setShowStoryMode] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; zoom: number } | null>(null);

  // What-If scenario overlays (US-001) — data-driven speculative overlays.
  const whatIfScenarios = useMemo(() => loadScenarios(), []);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const activeScenario = getScenarioById(whatIfScenarios, activeScenarioId);
  // Layers we auto-revealed for the active scenario, so we can restore them on clear.
  const scenarioAutoEnabledRef = React.useRef<string[]>([]);

  const restoreScenarioLayers = useCallback(() => {
    for (const layerId of scenarioAutoEnabledRef.current) {
      setLayerVisibility(layerId, false);
    }
    scenarioAutoEnabledRef.current = [];
  }, [setLayerVisibility]);

  const handleSelectScenario = useCallback(
    (id: string) => {
      const next = toggleScenario(activeScenarioId, id);
      // Restore any layers a previous scenario revealed before switching.
      restoreScenarioLayers();
      setActiveScenarioId(next);
      if (next) {
        const scenario = getScenarioById(whatIfScenarios, next);
        // View-only adjustment: reveal affected base layers for comparison.
        // Never mutates the underlying datasets.
        const toReveal = affectedLayersFor(scenario).filter((l) => !isLayerVisible(l));
        toReveal.forEach((l) => setLayerVisibility(l, true));
        scenarioAutoEnabledRef.current = toReveal;
      }
    },
    [activeScenarioId, whatIfScenarios, restoreScenarioLayers, isLayerVisible, setLayerVisibility],
  );

  const handleClearScenario = useCallback(() => {
    restoreScenarioLayers();
    setActiveScenarioId(null);
  }, [restoreScenarioLayers]);

  // Alternative-Urheimat migration toggle (US-002) — switch between competing homeland
  // hypotheses; the active one drives which migration routes highlight vs dim.
  const hypothesisRouteLinks = useMemo(() => loadHypothesisRouteLinks(), []);
  const [activeHypothesisId, setActiveHypothesisId] = useState<string | null>(null);
  // Layers we auto-revealed for the active hypothesis, so we can restore them on clear.
  const hypothesisAutoEnabledRef = React.useRef<string[]>([]);

  const restoreHypothesisLayers = useCallback(() => {
    for (const layerId of hypothesisAutoEnabledRef.current) {
      setLayerVisibility(layerId, false);
    }
    hypothesisAutoEnabledRef.current = [];
  }, [setLayerVisibility]);

  const handleSelectHypothesis = useCallback(
    (id: string) => {
      const next = toggleHypothesis(activeHypothesisId, id);
      restoreHypothesisLayers();
      setActiveHypothesisId(next);
      if (next) {
        // View-only: reveal the routes + hypotheses layers so the effect is visible.
        const toReveal = ['routes', 'urheimat-hypotheses'].filter((l) => !isLayerVisible(l));
        toReveal.forEach((l) => setLayerVisibility(l, true));
        hypothesisAutoEnabledRef.current = toReveal;
      }
    },
    [activeHypothesisId, restoreHypothesisLayers, isLayerVisible, setLayerVisibility],
  );

  const handleClearHypothesis = useCallback(() => {
    restoreHypothesisLayers();
    setActiveHypothesisId(null);
  }, [restoreHypothesisLayers]);

  // Counterfactual trade routes (US-003) — speculative "what-if economic geography"
  // overlays, a SEPARATE dataset from the real trade routes, toggled independently.
  const counterfactualRoutes = useMemo(() => loadCounterfactualRoutes(), []);
  const [activeCounterfactualIds, setActiveCounterfactualIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handleToggleCounterfactual = useCallback((id: string) => {
    setActiveCounterfactualIds((prev) => toggleCounterfactualRoute(prev, id));
  }, []);

  const handleSelectAllCounterfactual = useCallback(() => {
    setActiveCounterfactualIds(selectAllCounterfactualRoutes(counterfactualRoutes));
  }, [counterfactualRoutes]);

  const handleClearCounterfactual = useCallback(() => {
    setActiveCounterfactualIds(clearCounterfactualRoutes());
  }, []);

  const handleStoryNavigate = useCallback((center: [number, number], zoom: number) => {
    setFlyTarget({ center, zoom });
  }, []);

  const handleStoryTimeChange = useCallback((year: number) => {
    setCurrentYear(year);
  }, [setCurrentYear]);

  const handleStoryLayersChange = useCallback((layers: string[]) => {
    hideAll();
    for (const layerId of layers) {
      setLayerVisibility(layerId, true);
    }
  }, [hideAll, setLayerVisibility]);

  // Bookmark system
  const {
    bookmarks: userBookmarks,
    builtInPresets,
    saveBookmark,
    deleteBookmark,
    getShareableURL,
  } = useMapBookmarks();

  // Track current map view (center/zoom) via MapViewTracker
  const [mapCenter, setMapCenter] = React.useState<{ lat: number; lng: number }>({ lat: 20, lng: 0 });
  const [mapZoom, setMapZoom] = React.useState(2);
  const [flyToTarget, setFlyToTarget] = React.useState<{ lat: number; lng: number; zoom: number } | null>(null);

  const handleViewChange = React.useCallback((center: { lat: number; lng: number }, zoom: number) => {
    setMapCenter(center);
    setMapZoom(zoom);
  }, []);

  const currentViewState = React.useMemo((): MapViewState => {
    const opacities: Record<string, number> = {};
    layerState.layerConfigs.forEach((config) => {
      const defaultOpacity = config.opacity;
      if (defaultOpacity !== undefined) {
        opacities[config.id] = config.opacity;
      }
    });
    return {
      center: mapCenter,
      zoom: mapZoom,
      activeLayers: Array.from(layerState.activeLayers),
      layerOpacities: opacities,
      year: currentYear,
      baseMapId,
    };
  }, [mapCenter, mapZoom, layerState.activeLayers, layerState.layerConfigs, currentYear, baseMapId]);

  const handleApplyBookmark = React.useCallback((bookmark: MapBookmark) => {
    // Fly to the bookmark's location
    setFlyToTarget({ lat: bookmark.center.lat, lng: bookmark.center.lng, zoom: bookmark.zoom });

    // Apply layer state
    hideAll();
    for (const layerId of bookmark.activeLayers) {
      setLayerVisibility(layerId, true);
    }
    if (bookmark.layerOpacities) {
      for (const [layerId, opacity] of Object.entries(bookmark.layerOpacities)) {
        setLayerOpacity(layerId, opacity);
      }
    }

    // Apply time
    if (bookmark.year != null) {
      setCurrentYear(bookmark.year);
    }

    // Apply base map
    if (bookmark.baseMapId) {
      setBaseMap(bookmark.baseMapId);
    }

    // Clear flyTo target after a delay so it can be re-triggered
    setTimeout(() => setFlyToTarget(null), 1500);
  }, [hideAll, setLayerVisibility, setLayerOpacity, setCurrentYear, setBaseMap]);

  // In blink mode, override the displayed year
  const [blinkOverrideYear, setBlinkOverrideYear] = React.useState<number | null>(null);
  const displayYear = splitScreen.state.isActive && splitScreen.state.mode === 'blink'
    ? splitScreen.activeYear
    : currentYear;

  // Server-side viewport culling: pass the current bbox/zoom so the API returns
  // only features intersecting the viewport (empty until the map first settles,
  // in which case the server returns the full layer). See map-performance.ts.
  const viewportKey = viewportParams(perf.viewport, perf.zoom);

  // Fetch language range data
  const { data: languageRangesData, isLoading: loadingRanges } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-ranges', viewportKey],
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: isLayerVisible('language-ranges'),
  });

  // Fetch language range polygons data (expanded dataset)
  const { data: languageRangePolygonsData, isLoading: loadingRangePolygons } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-range-polygons', viewportKey],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('language-range-polygons'),
  });

  // Fetch archaeological sites data
  const { data: archaeologicalSitesData, isLoading: loadingSites } = useQuery<ArchaeologicalSiteCollection>({
    queryKey: ['/api/map/archaeological-sites', viewportKey],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('archaeological-sites'),
  });

  // Fetch archaeological cultures data
  const { data: archaeologicalCulturesData, isLoading: loadingCultures } = useQuery<ArchaeologicalCultureCollection>({
    queryKey: ['/api/map/archaeological-cultures'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('archaeological-cultures'),
  });

  // Fetch civilizations data
  const { data: civilizationsData, isLoading: loadingCivilizations } = useQuery<CivilizationCollection>({
    queryKey: ['/api/map/civilizations'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('civilizations'),
  });

  // Fetch routes data
  const { data: routesData, isLoading: loadingRoutes } = useQuery<HistoricalRouteCollection>({
    queryKey: ['/api/map/routes'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('routes'),
  });

  // Fetch material cultures heatmap data
  const { data: materialCulturesData, isLoading: loadingMaterialCultures } = useQuery<{ distributions: MaterialCultureDistribution[]; metadata: unknown }>({
    queryKey: ['/api/map/material-cultures'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('material-culture-heatmap'),
  });

  // Fetch material culture items for wave visualization
  const { data: materialCultureItemsData, isLoading: loadingMaterialCultureItems } = useQuery<{ items: MaterialCultureItem[]; count: number }>({
    queryKey: ['/api/material-culture'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('material-culture'),
  });

  // Fetch cuisines data with temporal filtering
  const { data: cuisinesData, isLoading: loadingCuisines } = useQuery<{ cuisines: CuisineFeature[]; count: number }>({
    queryKey: ['/api/cuisines', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('cuisines'),
  });

  // Fetch music traditions data with temporal filtering
  const { data: musicData, isLoading: loadingMusic } = useQuery<{ traditions: MusicTraditionFeature[]; count: number }>({
    queryKey: ['/api/music-traditions', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('music'),
  });

  // Fetch dance traditions data with temporal filtering
  const { data: danceData, isLoading: loadingDance } = useQuery<{ traditions: DanceTraditionFeature[]; count: number }>({
    queryKey: ['/api/dance-traditions', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('dance'),
  });

  // Fetch religions data with temporal filtering
  const { data: religionsData, isLoading: loadingReligions } = useQuery<{ religions: ReligionFeature[]; count: number }>({
    queryKey: ['/api/religions', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('religions'),
  });

  // Fetch deities data
  const { data: deitiesData, isLoading: loadingDeities } = useQuery<{ deities: DeityFeature[]; count: number }>({
    queryKey: ['/api/deities', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('mythology'),
  });

  // Fetch settlements data
  const { data: settlementsData, isLoading: loadingSettlements } = useQuery<{ settlements: Settlement[]; count: number }>({
    queryKey: ['/api/settlements'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('settlements'),
  });

  // Fetch rivers and water features data
  const { data: riversData, isLoading: loadingRivers } = useQuery<{ features: RiverWaterFeature[]; count: number }>({
    queryKey: ['/api/rivers-and-waters'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('rivers-and-waters'),
  });

  // Fetch battles data
  const { data: battlesData, isLoading: loadingBattles } = useQuery<{ battles: BattleFeature[]; count: number }>({
    queryKey: ['/api/battles'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('battles'),
  });

  // Fetch haplogroups data
  const { data: haplogroupsData, isLoading: loadingHaplogroups } = useQuery<{ haplogroups: HaplogroupFeature[]; count: number }>({
    queryKey: ['/api/haplogroups'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('haplogroups'),
    select: (data) => {
      // Transform haplogroup data to include coordinates from geographic_origin
      const haplogroups = (data.haplogroups || []).map((h: any) => ({
        id: h.id,
        name: h.name,
        haplogroupType: h.haplogroupType || h.haplogroup_type || 'Y-DNA',
        geographicOrigin: h.geographicOrigin || h.geographic_origin || 'Unknown',
        timeOrigin: h.timeOrigin || h.time_origin || null,
        description: h.description || '',
        associatedLanguageFamilyIds: h.associatedLanguageFamilyIds || h.associated_language_family_ids || [],
        associatedCivilizationIds: h.associatedCivilizationIds || h.associated_civilization_ids || [],
        coordinates: { lat: 0, lng: 0 }, // Will be resolved by layer component from geographicOrigin
      }));
      return { haplogroups, count: haplogroups.length };
    },
  });

  // Fetch language contacts data
  const { data: languageContactsData, isLoading: loadingContacts } = useQuery<{ contacts: LanguageContactFeature[]; count: number }>({
    queryKey: ['/api/language-contacts'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('language-contacts'),
  });

  // Fetch genetic-linguistic correlations
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const mapContainerRef = React.useRef<HTMLDivElement>(null);

  const [isExportingImage, setIsExportingImage] = React.useState(false);
  const exportMapImage = React.useCallback(async () => {
    if (!mapContainerRef.current) return;
    setIsExportingImage(true);
    try {
      const year = currentYear < 0 ? `${Math.abs(currentYear)}bce` : `${currentYear}ce`;
      await exportMapPNG(mapContainerRef.current, `linguascrape-map-${year}.png`);
    } finally {
      setIsExportingImage(false);
    }
  }, [currentYear]);

  const toggleFullscreen = React.useCallback(() => {
    if (!document.fullscreenElement) {
      mapContainerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  React.useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const [glcHaplogroupTypeFilter, setGlcHaplogroupTypeFilter] = React.useState<'Y-chromosome' | 'mtDNA' | null>(null);
  const { data: glcData, isLoading: loadingGlc } = useQuery<{
    correlations: CorrelationFeature[];
    divergences: DivergenceAnnotation[];
    summary: string;
  }>({
    queryKey: ['/api/genetic-linguistic-correlations', { haplogroupType: glcHaplogroupTypeFilter }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('genetic-linguistic-correlation'),
  });

  // Fetch foodway events data
  const { data: foodwayEventsData, isLoading: loadingFoodwayEvents } = useQuery<{ events: FoodwayEventFeature[]; count: number }>({
    queryKey: ['/api/foodway-events'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('foodway-events'),
  });

  // Fetch kinship systems data
  const { data: kinshipSystemsData, isLoading: loadingKinshipSystems } = useQuery<{ systems: KinshipSystemFeature[]; count: number }>({
    queryKey: ['/api/kinship-systems'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('kinship-systems'),
  });

  // Fetch architectural styles data
  const { data: architecturalStylesData, isLoading: loadingArchitecturalStyles } = useQuery<{ styles: ArchitecturalStyleFeature[]; count: number }>({
    queryKey: ['/api/architectural-styles'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('architectural-styles'),
  });

  // Fetch ingredient origins data
  const { data: ingredientOriginsData, isLoading: loadingIngredientOrigins } = useQuery<{ ingredients: IngredientOriginFeature[]; count: number }>({
    queryKey: ['/api/ingredient-origins', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('ingredient-origins'),
  });

  // Fetch cooking techniques data
  const { data: cookingTechniquesData, isLoading: loadingCookingTechniques } = useQuery<{ techniques: CookingTechniqueFeature[]; count: number }>({
    queryKey: ['/api/cooking-techniques', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('cooking-techniques'),
  });

  // Fetch urheimat hypotheses data
  const { data: urheimatData, isLoading: loadingUrheimat } = useQuery<{ hypotheses: UrheimatHypothesisFeature[]; count: number }>({
    queryKey: ['/api/urheimat-hypotheses'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('urheimat-hypotheses'),
  });

  // Fetch languages for coordinate resolution (needed by language contacts and kinship systems layers)
  const { data: languagesForCoords } = useQuery<{ id: string; name: string; coordinates: { lat: number; lng: number } | null }[]>({
    queryKey: ['/api/languages'],
    staleTime: 10 * 60 * 1000,
    enabled: isLayerVisible('language-contacts') || isLayerVisible('kinship-systems'),
    select: (data: any[]) =>
      data.map((l: any) => ({
        id: l.id,
        name: l.name,
        coordinates: l.coordinates || null,
      })),
  });

  // Use sample data as fallback when API returns empty data
  const allLanguageRanges = useMemo(() => {
    if (languageRangesData?.features && languageRangesData.features.length > 0) {
      return languageRangesData.features;
    }
    return sampleLanguageRanges;
  }, [languageRangesData]);

  const allLanguageRangePolygons = useMemo(() => {
    return languageRangePolygonsData?.features ?? [];
  }, [languageRangePolygonsData]);

  const allArchaeologicalSites = useMemo(() => {
    if (archaeologicalSitesData?.features && archaeologicalSitesData.features.length > 0) {
      return archaeologicalSitesData.features;
    }
    return sampleArchaeologicalSites;
  }, [archaeologicalSitesData]);

  const allArchaeologicalCultures = useMemo(() => {
    if (archaeologicalCulturesData?.features && archaeologicalCulturesData.features.length > 0) {
      return archaeologicalCulturesData.features;
    }
    return [];
  }, [archaeologicalCulturesData]);

  const allCivilizations = useMemo(() => {
    if (civilizationsData?.features && civilizationsData.features.length > 0) {
      return civilizationsData.features;
    }
    return sampleCivilizations;
  }, [civilizationsData]);

  const allRoutes = useMemo(() => {
    if (routesData?.features && routesData.features.length > 0) {
      return routesData.features;
    }
    return sampleHistoricalRoutes;
  }, [routesData]);

  const allMaterialCultures = useMemo(() => {
    if (materialCulturesData?.distributions && materialCulturesData.distributions.length > 0) {
      return materialCulturesData.distributions;
    }
    return sampleMaterialCultureDistributions;
  }, [materialCulturesData]);

  const materialCultureItems = useMemo(() => {
    return materialCultureItemsData?.items ?? [];
  }, [materialCultureItemsData]);

  // Cuisine data (already filtered by year on server)
  const filteredCuisines = useMemo(() => {
    return cuisinesData?.cuisines ?? [];
  }, [cuisinesData]);

  // Music tradition data (already filtered by year on server)
  const filteredMusicTraditions = useMemo(() => {
    return musicData?.traditions ?? [];
  }, [musicData]);

  // Dance tradition data (already filtered by year on server)
  const filteredDanceTraditions = useMemo(() => {
    return danceData?.traditions ?? [];
  }, [danceData]);

  // Religion data (already filtered by year on server)
  const filteredReligions = useMemo(() => {
    return religionsData?.religions ?? [];
  }, [religionsData]);

  // Deities data
  const filteredDeities = useMemo(() => {
    return deitiesData?.deities ?? [];
  }, [deitiesData]);

  // Settlements data
  const allSettlements = useMemo(() => {
    return settlementsData?.settlements ?? [];
  }, [settlementsData]);

  // Rivers and water features data
  const allRiversAndWaters = useMemo(() => {
    return riversData?.features ?? [];
  }, [riversData]);

  // Battles data
  const allBattles = useMemo(() => {
    return battlesData?.battles ?? [];
  }, [battlesData]);

  // Haplogroups data
  const allHaplogroups = useMemo(() => {
    return haplogroupsData?.haplogroups ?? [];
  }, [haplogroupsData]);

  // Language contacts data
  const allLanguageContacts = useMemo(() => {
    return languageContactsData?.contacts ?? [];
  }, [languageContactsData]);

  // Genetic-linguistic correlation data
  const glcCorrelations = useMemo(() => glcData?.correlations ?? [], [glcData]);
  const glcDivergences = useMemo(() => glcData?.divergences ?? [], [glcData]);

  // Foodway events data
  const allFoodwayEvents = useMemo(() => {
    return foodwayEventsData?.events ?? [];
  }, [foodwayEventsData]);

  // Kinship systems data with coordinate resolution
  const allKinshipSystems = useMemo(() => {
    const systems = kinshipSystemsData?.systems ?? [];
    if (!languagesForCoords || languagesForCoords.length === 0) return systems;
    const langMap = new Map(languagesForCoords.map((l) => [l.id, l.coordinates]));
    return systems.map((s) => {
      // Resolve coordinates from first language with known coordinates
      for (const langId of s.languageIds) {
        const coords = langMap.get(langId);
        if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
          return { ...s, coordinates: coords };
        }
      }
      return s;
    });
  }, [kinshipSystemsData, languagesForCoords]);

  // Architectural styles data
  const allArchitecturalStyles = useMemo(() => {
    return architecturalStylesData?.styles ?? [];
  }, [architecturalStylesData]);

  // Ingredient origins data (already filtered by year on server)
  const allIngredientOrigins = useMemo(() => {
    return ingredientOriginsData?.ingredients ?? [];
  }, [ingredientOriginsData]);

  // Cooking techniques data (already filtered by year on server)
  const allCookingTechniques = useMemo(() => {
    return cookingTechniquesData?.techniques ?? [];
  }, [cookingTechniquesData]);

  // Urheimat hypotheses data
  const allUrheimatHypotheses = useMemo(() => {
    return urheimatData?.hypotheses ?? [];
  }, [urheimatData]);

  // Build language coordinate map for contacts layer
  const languageCoordsMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; lat: number; lng: number }>();
    if (languagesForCoords) {
      for (const lang of languagesForCoords) {
        if (lang.coordinates && Number.isFinite(lang.coordinates.lat) && Number.isFinite(lang.coordinates.lng)) {
          map.set(lang.id, {
            id: lang.id,
            name: lang.name,
            lat: lang.coordinates.lat,
            lng: lang.coordinates.lng,
          });
        }
      }
    }
    return map;
  }, [languagesForCoords]);

  // Build feature lookup collections for the info panel
  const featureLookupCollections = useMemo<FeatureLookupCollections>(() => ({
    languageRanges: allLanguageRanges,
    archaeologicalSites: allArchaeologicalSites,
    archaeologicalCultures: allArchaeologicalCultures,
    civilizations: allCivilizations,
    routes: allRoutes,
    cuisines: filteredCuisines,
    music: filteredMusicTraditions,
    dance: filteredDanceTraditions,
    religions: filteredReligions,
    battles: allBattles,
    deities: filteredDeities,
    haplogroups: allHaplogroups,
    foodwayEvents: allFoodwayEvents,
    kinshipSystems: allKinshipSystems,
    architecturalStyles: allArchitecturalStyles,
    ingredientOrigins: allIngredientOrigins,
    cookingTechniques: allCookingTechniques,
    urheimatHypotheses: allUrheimatHypotheses,
  }), [
    allLanguageRanges, allArchaeologicalSites, allArchaeologicalCultures,
    allCivilizations, allRoutes, filteredCuisines, filteredMusicTraditions,
    filteredDanceTraditions, filteredReligions, allBattles, filteredDeities,
    allHaplogroups, allFoodwayEvents, allKinshipSystems, allArchitecturalStyles,
    allIngredientOrigins, allCookingTechniques, allUrheimatHypotheses,
  ]);

  // Feature selection state with URL deep-linking
  const {
    selectedFeatureData,
    selectedFeatureId: internalSelectedFeatureId,
    selectFeature,
    clearSelection,
  } = useMapFeatureSelection(featureLookupCollections);

  // Culture profiles — used to open CultureProfilePanel when a feature click
  // maps to a known profile (via civilizationId, archaeologicalCultureId, or id).
  const { data: cultureProfilesData } = useQuery<{ profiles: CultureProfile[]; count: number }>({
    queryKey: ['/api/culture-profiles'],
    staleTime: 5 * 60 * 1000,
  });
  const cultureProfiles = useMemo(
    () => cultureProfilesData?.profiles ?? [],
    [cultureProfilesData],
  );

  const [selectedCultureProfileId, setSelectedCultureProfileId] = useState<string | null>(null);

  // Filter features by display time, then apply viewport culling + LOD simplification
  const filteredLanguageRanges = useMemo(() => {
    const byTime = filterGeoJSONByTime(allLanguageRanges, displayYear);
    const culled = perf.cullFeatures(byTime);
    return perf.simplifyPolygons(culled);
  }, [allLanguageRanges, displayYear, perf.cullFeatures, perf.simplifyPolygons]);

  const filteredLanguageRangePolygons = useMemo(() => {
    const byTime = filterGeoJSONByTime(allLanguageRangePolygons, displayYear);
    const culled = perf.cullFeatures(byTime);
    return perf.simplifyPolygons(culled);
  }, [allLanguageRangePolygons, displayYear, perf.cullFeatures, perf.simplifyPolygons]);

  const filteredArchaeologicalSites = useMemo(() => {
    const byTime = filterGeoJSONByTime(allArchaeologicalSites, displayYear);
    return perf.cullFeatures(byTime);
  }, [allArchaeologicalSites, displayYear, perf.cullFeatures]);

  const filteredArchaeologicalCultures = useMemo(() => {
    const byTime = filterGeoJSONByTime(allArchaeologicalCultures, displayYear);
    const culled = perf.cullFeatures(byTime);
    return perf.simplifyPolygons(culled);
  }, [allArchaeologicalCultures, displayYear, perf.cullFeatures, perf.simplifyPolygons]);

  const filteredCivilizations = useMemo(() => {
    const byTime = filterGeoJSONByTime(allCivilizations, displayYear);
    const culled = perf.cullFeatures(byTime);
    return perf.simplifyPolygons(culled);
  }, [allCivilizations, displayYear, perf.cullFeatures, perf.simplifyPolygons]);

  const filteredRoutes = useMemo(() => {
    const byTime = filterGeoJSONByTime(allRoutes, displayYear);
    return perf.cullFeatures(byTime);
  }, [allRoutes, displayYear, perf.cullFeatures]);

  // Urheimat-hypothesis route emphasis (US-002): the active hypothesis highlights the
  // migration routes it implies and dims the rest. Empty when no hypothesis is active.
  const activeHypothesis = useMemo(
    () => getHypothesisById(allUrheimatHypotheses, activeHypothesisId),
    [allUrheimatHypotheses, activeHypothesisId],
  );
  const highlightedRouteIds = useMemo(() => {
    const selection = selectRoutesForHypothesis(activeHypothesis, hypothesisRouteLinks);
    if (!selection.hypothesisId) return [] as string[];
    const routeIds = filteredRoutes.map((r) => r.properties.routeId);
    return partitionRoutes(routeIds, selection).highlighted;
  }, [activeHypothesis, hypothesisRouteLinks, filteredRoutes]);

  const filteredMaterialCultures = useMemo(() => {
    // Material cultures don't have a time period directly, filter based on associated period
    // For now, show all material cultures (they're already point data with implicit time)
    return allMaterialCultures;
  }, [allMaterialCultures]);

  // Build density heatmap data from all point-like data sources
  const densityHeatmapSources = useMemo<DensityDataSources>(() => {
    const allFeatures: Array<{ geometry: { type: string; coordinates: any }; properties: Record<string, any> }> = [];
    const allCoordItems: Array<Record<string, any>> = [];

    // GeoJSON polygon/point features → centroid heat points
    if (filteredLanguageRanges.length > 0) {
      allFeatures.push(...(filteredLanguageRanges as any));
    }
    if (filteredArchaeologicalSites.length > 0) {
      allFeatures.push(...(filteredArchaeologicalSites as any));
    }
    if (filteredCivilizations.length > 0) {
      allFeatures.push(...(filteredCivilizations as any));
    }

    // Coordinate-bearing items
    if (filteredCuisines.length > 0) {
      allCoordItems.push(...filteredCuisines);
    }
    if (filteredMusicTraditions.length > 0) {
      allCoordItems.push(...filteredMusicTraditions);
    }
    if (filteredReligions.length > 0) {
      allCoordItems.push(...filteredReligions);
    }
    if (allBattles.length > 0) {
      allCoordItems.push(...allBattles);
    }
    if (allSettlements.length > 0) {
      allCoordItems.push(...allSettlements);
    }

    return {
      features: allFeatures.length > 0 ? allFeatures : undefined,
      coordItems: allCoordItems.length > 0 ? allCoordItems : undefined,
    };
  }, [
    filteredLanguageRanges, filteredArchaeologicalSites, filteredCivilizations,
    filteredCuisines, filteredMusicTraditions, filteredReligions,
    allBattles, allSettlements,
  ]);

  // Derive the active selected feature ID — internal selection takes priority
  const activeSelectedFeatureId = internalSelectedFeatureId ?? selectedFeatureId ?? null;

  // Collect active polygon territories for overlap detection
  const overlapTerritories = useMemo((): TerritoryFeature[] => {
    const territories: TerritoryFeature[] = [];

    if (isLayerVisible('language-ranges')) {
      for (const f of filteredLanguageRanges) {
        territories.push({
          id: `lr-${f.id ?? f.properties.languageId}`,
          layerId: 'language-ranges',
          color: getFamilyColor(f.properties.familyId),
          feature: f,
        });
      }
    }

    if (isLayerVisible('language-range-polygons')) {
      for (const f of filteredLanguageRangePolygons) {
        territories.push({
          id: `lrp-${f.id ?? f.properties.languageId}`,
          layerId: 'language-range-polygons',
          color: getFamilyColor(f.properties.familyId),
          feature: f,
        });
      }
    }

    if (isLayerVisible('civilizations')) {
      for (const f of filteredCivilizations) {
        const civId = f.properties.civilizationId;
        const colorIdx = hashIndex(civId, CIVILIZATION_PALETTE.length);
        territories.push({
          id: `civ-${f.id ?? civId}`,
          layerId: 'civilizations',
          color: CIVILIZATION_PALETTE[colorIdx],
          feature: f,
        });
      }
    }

    if (isLayerVisible('archaeological-cultures')) {
      for (const f of filteredArchaeologicalCultures) {
        territories.push({
          id: `ac-${f.id ?? f.properties.cultureId}`,
          layerId: 'archaeological-cultures',
          color: '#f59e0b', // amber default for archaeological cultures
          feature: f as any,
        });
      }
    }

    return territories;
  }, [
    isLayerVisible,
    filteredLanguageRanges,
    filteredLanguageRangePolygons,
    filteredCivilizations,
    filteredArchaeologicalCultures,
  ]);

  // Handle feature clicks — open info panel and notify parent.
  // If the clicked feature maps to a CultureProfile (via civilization /
  // archaeological-culture cross-reference or direct id), also surface the
  // richer CultureProfilePanel.
  const handleFeatureClick = useCallback(
    (id: string) => {
      selectFeature(id);
      const cultureId = findCultureProfileIdForFeature(id, cultureProfiles);
      if (cultureId) {
        setSelectedCultureProfileId(cultureId);
      }
      if (onFeatureSelect) {
        onFeatureSelect(id);
      }
    },
    [onFeatureSelect, selectFeature, cultureProfiles]
  );

  // Build the flat list of keyboard-navigable features from the currently
  // visible layers. Each feature carries a representative point so arrow-key
  // (spatial) traversal works; ids match what handleFeatureClick expects.
  const navigableFeatures = useMemo<NavigableFeature[]>(() => {
    const out: NavigableFeature[] = [];
    const pushGeo = (
      items: any[],
      type: MapFeatureType,
      getId: (f: any) => string | undefined,
      getName: (f: any) => string | undefined,
    ) => {
      for (const f of items) {
        const id = getId(f);
        if (!id) continue;
        const pt = representativePoint(f.geometry);
        if (!pt) continue;
        out.push({
          id,
          name: getName(f) || id,
          type,
          lng: pt[0],
          lat: pt[1],
        });
      }
    };

    if (isLayerVisible('language-ranges')) {
      pushGeo(filteredLanguageRanges, 'language-range',
        (f) => f.properties?.languageId || f.id,
        (f) => f.properties?.languageName || f.properties?.name);
    }
    if (isLayerVisible('archaeological-sites')) {
      pushGeo(filteredArchaeologicalSites, 'archaeological-site',
        (f) => f.properties?.siteId || f.id,
        (f) => f.properties?.name || f.properties?.siteName);
    }
    if (isLayerVisible('civilizations')) {
      pushGeo(filteredCivilizations, 'civilization',
        (f) => f.properties?.civilizationId || f.id,
        (f) => f.properties?.name || f.properties?.civilizationName);
    }
    return out;
  }, [
    isLayerVisible,
    filteredLanguageRanges,
    filteredArchaeologicalSites,
    filteredCivilizations,
  ]);

  const featureNav = useMapFeatureNavigation(navigableFeatures, {
    onSelect: (f) => handleFeatureClick(f.id),
  });
  const focusedNavFeature = useMemo(
    () => navigableFeatures.find((f) => f.id === featureNav.focusedId) ?? null,
    [navigableFeatures, featureNav.focusedId],
  );

  // Keyboard shortcuts (timeline + accessibility)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Let accessibility handler try first (h = high-contrast, ? = help)
      if (a11y.handleAccessibilityKey(e)) {
        e.preventDefault();
        return;
      }

      // Feature navigation mode intercepts arrow keys / Enter / etc.
      if (featureNav.handleFeatureNavKey(e)) {
        e.preventDefault();
        return;
      }

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
  }, [toggle, stepBackward, stepForward, jumpToStart, jumpToEnd, a11y.handleAccessibilityKey, featureNav.handleFeatureNavKey]);

  // Calculate initial map center and zoom
  const initialCenter: [number, number] = useMemo(() => {
    if (filteredLanguageRanges.length > 0) {
      // Calculate average position from features
      const lats = filteredLanguageRanges.map((f) => {
        const coords = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates[0][0]
          : f.geometry.coordinates[0][0][0];
        return coords[1];
      });
      const lngs = filteredLanguageRanges.map((f) => {
        const coords = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates[0][0]
          : f.geometry.coordinates[0][0][0];
        return coords[0];
      });

      const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const avgLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

      return [avgLat, avgLng];
    }
    return [20, 0]; // Default world view
  }, [filteredLanguageRanges]);

  // Check if any enabled layers are loading
  const isLoadingAnyLayer =
    (loadingRanges && isLayerVisible('language-ranges')) ||
    (loadingRangePolygons && isLayerVisible('language-range-polygons')) ||
    (loadingSites && isLayerVisible('archaeological-sites')) ||
    (loadingCultures && isLayerVisible('archaeological-cultures')) ||
    (loadingCivilizations && isLayerVisible('civilizations')) ||
    (loadingRoutes && isLayerVisible('routes')) ||
    (loadingMaterialCultures && isLayerVisible('material-culture-heatmap')) ||
    (loadingMaterialCultureItems && isLayerVisible('material-culture')) ||
    (loadingCuisines && isLayerVisible('cuisines')) ||
    (loadingMusic && isLayerVisible('music')) ||
    (loadingReligions && isLayerVisible('religions')) ||
    (loadingDeities && isLayerVisible('mythology')) ||
    (loadingSettlements && isLayerVisible('settlements')) ||
    (loadingRivers && isLayerVisible('rivers-and-waters')) ||
    (loadingBattles && isLayerVisible('battles')) ||
    (loadingHaplogroups && isLayerVisible('haplogroups')) ||
    (loadingContacts && isLayerVisible('language-contacts')) ||
    (loadingGlc && isLayerVisible('genetic-linguistic-correlation')) ||
    (loadingFoodwayEvents && isLayerVisible('foodway-events')) ||
    (loadingKinshipSystems && isLayerVisible('kinship-systems')) ||
    (loadingArchitecturalStyles && isLayerVisible('architectural-styles')) ||
    (loadingIngredientOrigins && isLayerVisible('ingredient-origins')) ||
    (loadingCookingTechniques && isLayerVisible('cooking-techniques')) ||
    (loadingUrheimat && isLayerVisible('urheimat-hypotheses'));

  // Compute pattern specs for TerritorialShadingProvider
  const territorialPatterns = useMemo(() => {
    if (territorialFillType === 'solid' || territorialFillType === 'gradient') return [];
    const colors = new Set<string>();
    // Collect colors from civilization palette
    for (const c of CIVILIZATION_PALETTE) colors.add(c);
    return Array.from(colors).map((color) => ({
      fillType: territorialFillType,
      color,
    }));
  }, [territorialFillType]);

  // Total visible feature count for screen reader summary.
  // Must be declared BEFORE the early-return below — otherwise React's
  // Rules of Hooks fire when isLoadingAnyLayer flips false and these hooks
  // are encountered for the first time mid-tree.
  const totalVisibleFeatures = useMemo(() =>
    filteredLanguageRanges.length + filteredLanguageRangePolygons.length +
    filteredArchaeologicalSites.length + filteredArchaeologicalCultures.length +
    filteredCivilizations.length + filteredRoutes.length +
    filteredCuisines.length + filteredMusicTraditions.length +
    filteredDanceTraditions.length + filteredReligions.length +
    filteredDeities.length + allSettlements.length + allBattles.length,
    [filteredLanguageRanges, filteredLanguageRangePolygons, filteredArchaeologicalSites,
     filteredArchaeologicalCultures, filteredCivilizations, filteredRoutes,
     filteredCuisines, filteredMusicTraditions, filteredDanceTraditions,
     filteredReligions, filteredDeities, allSettlements, allBattles]
  );

  const visibleLayerCount = useMemo(() =>
    Array.from(layerState.activeLayers).length,
    [layerState.activeLayers]
  );

  if (isLoadingAnyLayer) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg" role="status" aria-label="Loading map data">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
          <p className="text-sm text-gray-600">Loading map data...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      className={`w-full h-full relative rounded-lg overflow-hidden ${isFullscreen ? 'bg-white' : ''} ${a11y.highContrast ? 'map-high-contrast' : ''}`}
      role="application"
      aria-label="Interactive historical map"
      aria-roledescription="map"
    >
      {/* Screen reader summary (visually hidden) */}
      <div className="sr-only" aria-live="polite">
        {visibleLayerCount} layers active, {totalVisibleFeatures} features visible.
        Current year: {currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`}.
        Press question mark for keyboard shortcuts.
      </div>

      <MapContainer
        center={initialCenter}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        className="z-0"
        keyboard={true}
      >
        {/* Performance: track viewport bounds and zoom for culling/LOD */}
        <MapPerformanceTracker
          onViewportChange={perf.setViewport}
          onZoomChange={perf.setZoom}
        />

        <TileLayer
          key={baseMap.id}
          attribution={baseMap.attribution}
          url={baseMap.url}
          maxZoom={baseMap.maxZoom}
        />

        {/* Story mode fly-to controller */}
        <MapFlyTo target={flyTarget} />

        {/* Track map center/zoom and handle flyTo for bookmarks */}
        <MapViewTracker onViewChange={handleViewChange} flyToTarget={flyToTarget} />

        {/* Geographic Search Bar */}
        <MapSearchBar />

        {/* SVG pattern definitions for hatched/striped fills */}
        {territorialPatterns.length > 0 && (
          <TerritorialShadingProvider patterns={territorialPatterns} />
        )}

        {/* Language Range Layer */}
        {isLayerVisible('language-ranges') && filteredLanguageRanges.length > 0 && (
          <LanguageRangeLayer
            features={filteredLanguageRanges}
            opacity={getLayerConfig('language-ranges')?.opacity || 0.6}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
            fillType={territorialFillType}
          />
        )}

        {/* Language Range Polygons Layer (expanded dataset) */}
        {isLayerVisible('language-range-polygons') && filteredLanguageRangePolygons.length > 0 && (
          <LanguageRangeLayer
            features={filteredLanguageRangePolygons}
            opacity={getLayerConfig('language-range-polygons')?.opacity || 0.5}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
            fillType={territorialFillType}
          />
        )}

        {/* Archaeological Sites Layer */}
        {isLayerVisible('archaeological-sites') && filteredArchaeologicalSites.length > 0 && (
          <ArchaeologicalSitesLayer
            features={filteredArchaeologicalSites}
            opacity={getLayerConfig('archaeological-sites')?.opacity || 0.8}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
          />
        )}

        {/* Archaeological Cultures Layer */}
        {isLayerVisible('archaeological-cultures') && filteredArchaeologicalCultures.length > 0 && (
          <ArchaeologicalCultureLayer
            features={filteredArchaeologicalCultures}
            opacity={getLayerConfig('archaeological-cultures')?.opacity || 0.5}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
            fillType={territorialFillType}
          />
        )}

        {/* Rivers & Water Features Layer */}
        {isLayerVisible('rivers-and-waters') && allRiversAndWaters.length > 0 && (
          <RiverWaterLayer
            features={allRiversAndWaters}
            currentYear={currentYear}
            opacity={getLayerConfig('rivers-and-waters')?.opacity || 0.8}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
          />
        )}

        {/* Civilizations Layer */}
        {isLayerVisible('civilizations') && filteredCivilizations.length > 0 && (
          <CivilizationLayer
            features={filteredCivilizations}
            opacity={getLayerConfig('civilizations')?.opacity || 0.5}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
            fillType={territorialFillType}
          />
        )}

        {/* Routes Layer */}
        {isLayerVisible('routes') && filteredRoutes.length > 0 && (
          <RoutesLayer
            features={filteredRoutes}
            opacity={getLayerConfig('routes')?.opacity || 0.7}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={activeSelectedFeatureId}
            isAnimating={isPlaying}
            highlightedRouteIds={highlightedRouteIds}
          />
        )}

        {/* Material Culture Wave Layer */}
        {isLayerVisible('material-culture') && materialCultureItems.length > 0 && (
          <MaterialCultureWaveLayer
            items={materialCultureItems}
            opacity={getLayerConfig('material-culture')?.opacity || 0.7}
            currentYear={currentYear}
            onItemClick={handleFeatureClick}
            selectedItemId={selectedFeatureId}
            animationEnabled={isPlaying}
          />
        )}

        {/* Material Culture Heatmap */}
        {isLayerVisible('material-culture-heatmap') && filteredMaterialCultures.length > 0 && (
          <MaterialCultureHeatmap
            distributions={filteredMaterialCultures}
            opacity={getLayerConfig('material-culture-heatmap')?.opacity || 0.6}
          />
        )}

        {/* Density Heatmap Overlay */}
        {isLayerVisible('density-heatmap') && (
          <DensityHeatmapLayer
            sources={densityHeatmapSources}
            radius={getLayerConfig('density-heatmap')?.renderStyle?.heatmap?.radius ?? 20}
            blur={getLayerConfig('density-heatmap')?.renderStyle?.heatmap?.blur ?? 15}
            maxZoom={getLayerConfig('density-heatmap')?.renderStyle?.heatmap?.maxZoom ?? 12}
            gradient={getLayerConfig('density-heatmap')?.renderStyle?.heatmap?.gradient ?? 'thermal'}
            opacity={getLayerConfig('density-heatmap')?.opacity ?? 0.6}
          />
        )}

        {/* Cuisine Layer */}
        {isLayerVisible('cuisines') && filteredCuisines.length > 0 && (
          <CuisineLayer
            cuisines={filteredCuisines}
            opacity={getLayerConfig('cuisines')?.opacity || 0.8}
            onCuisineClick={handleFeatureClick}
            selectedCuisineId={selectedFeatureId}
          />
        )}

        {/* Music Tradition Layer */}
        {isLayerVisible('music') && filteredMusicTraditions.length > 0 && (
          <MusicTraditionLayer
            traditions={filteredMusicTraditions}
            opacity={getLayerConfig('music')?.opacity || 0.8}
            onTraditionClick={handleFeatureClick}
            selectedTraditionId={selectedFeatureId}
          />
        )}

        {/* Dance Tradition Layer */}
        {isLayerVisible('dance') && filteredDanceTraditions.length > 0 && (
          <DanceTraditionLayer
            traditions={filteredDanceTraditions}
            opacity={getLayerConfig('dance')?.opacity || 0.8}
            onTraditionClick={handleFeatureClick}
            selectedTraditionId={selectedFeatureId}
          />
        )}

        {/* Religion Layer */}
        {isLayerVisible('religions') && filteredReligions.length > 0 && (
          <ReligionLayer
            religions={filteredReligions}
            opacity={getLayerConfig('religions')?.opacity || 0.8}
            onReligionClick={handleFeatureClick}
            selectedReligionId={selectedFeatureId}
          />
        )}

        {/* Mythology Layer */}
        {isLayerVisible('mythology') && filteredDeities.length > 0 && (
          <MythologyLayer
            deities={filteredDeities}
            opacity={getLayerConfig('mythology')?.opacity || 0.8}
            onDeityClick={handleFeatureClick}
            selectedDeityId={selectedFeatureId}
          />
        )}

        {/* Settlements Layer */}
        {isLayerVisible('settlements') && allSettlements.length > 0 && (
          <SettlementsLayer
            settlements={allSettlements}
            currentYear={currentYear}
            opacity={getLayerConfig('settlements')?.opacity || 0.9}
            onSettlementClick={handleFeatureClick}
            selectedSettlementId={selectedFeatureId}
          />
        )}

        {/* Battles Layer */}
        {isLayerVisible('battles') && allBattles.length > 0 && (
          <BattlesLayer
            battles={allBattles}
            currentYear={currentYear}
            opacity={getLayerConfig('battles')?.opacity || 0.9}
          />
        )}

        {/* Haplogroup Layer */}
        {isLayerVisible('haplogroups') && allHaplogroups.length > 0 && (
          <HaplogroupLayer
            haplogroups={allHaplogroups}
            opacity={getLayerConfig('haplogroups')?.opacity || 0.7}
            onHaplogroupClick={handleFeatureClick}
            selectedHaplogroupId={selectedFeatureId}
          />
        )}
        {/* Language Contacts Layer */}
        {isLayerVisible('language-contacts') && allLanguageContacts.length > 0 && (
          <LanguageContactsLayer
            contacts={allLanguageContacts}
            languageCoords={languageCoordsMap}
            opacity={getLayerConfig('language-contacts')?.opacity || 0.7}
            onContactClick={handleFeatureClick}
            selectedContactId={selectedFeatureId}
          />
        )}

        {/* Genetic-Linguistic Correlation Layer */}
        {isLayerVisible('genetic-linguistic-correlation') && glcCorrelations.length > 0 && (
          <GeneticLinguisticCorrelationLayer
            correlations={glcCorrelations}
            divergences={glcDivergences}
            opacity={getLayerConfig('genetic-linguistic-correlation')?.opacity || 0.7}
            haplogroupTypeFilter={glcHaplogroupTypeFilter}
            onFilterChange={setGlcHaplogroupTypeFilter}
          />
        )}

        {/* Foodway Events Layer */}
        {isLayerVisible('foodway-events') && allFoodwayEvents.length > 0 && (
          <FoodwayEventLayer
            events={allFoodwayEvents}
            opacity={getLayerConfig('foodway-events')?.opacity || 0.8}
            onEventClick={handleFeatureClick}
            selectedEventId={selectedFeatureId}
            isAnimating={isPlaying}
          />
        )}

        {/* Kinship Systems Layer */}
        {isLayerVisible('kinship-systems') && allKinshipSystems.length > 0 && (
          <KinshipSystemLayer
            systems={allKinshipSystems}
            opacity={getLayerConfig('kinship-systems')?.opacity || 0.8}
            onSystemClick={handleFeatureClick}
            selectedSystemId={selectedFeatureId}
          />
        )}

        {/* Architectural Styles Layer */}
        {isLayerVisible('architectural-styles') && allArchitecturalStyles.length > 0 && (
          <ArchitecturalStylesLayer
            styles={allArchitecturalStyles}
            opacity={getLayerConfig('architectural-styles')?.opacity || 0.8}
            onStyleClick={handleFeatureClick}
            selectedStyleId={selectedFeatureId}
          />
        )}

        {/* Ingredient Origins Layer */}
        {isLayerVisible('ingredient-origins') && allIngredientOrigins.length > 0 && (
          <IngredientOriginsLayer
            ingredients={allIngredientOrigins}
            opacity={getLayerConfig('ingredient-origins')?.opacity || 0.8}
            onIngredientClick={handleFeatureClick}
            selectedIngredientId={selectedFeatureId}
          />
        )}

        {/* Cooking Techniques Layer */}
        {isLayerVisible('cooking-techniques') && allCookingTechniques.length > 0 && (
          <CookingTechniquesLayer
            techniques={allCookingTechniques}
            opacity={getLayerConfig('cooking-techniques')?.opacity || 0.8}
            onTechniqueClick={handleFeatureClick}
            selectedTechniqueId={selectedFeatureId}
          />
        )}

        {/* Urheimat Hypotheses Layer */}
        {isLayerVisible('urheimat-hypotheses') && allUrheimatHypotheses.length > 0 && (
          <UrheimatHypothesisLayer
            hypotheses={allUrheimatHypotheses}
            opacity={getLayerConfig('urheimat-hypotheses')?.opacity || 0.6}
            currentYear={currentYear}
            onHypothesisClick={handleFeatureClick}
            selectedHypothesisId={activeHypothesisId ?? selectedFeatureId}
          />
        )}

        {/* What-If Scenario Overlay (US-001) — speculative, rendered over real layers */}
        {activeScenario && scenarioAppliesAtYear(activeScenario, currentYear) && (
          <WhatIfScenarioLayer scenario={activeScenario} opacity={0.5} />
        )}

        {/* Counterfactual Trade Routes (US-003) — speculative, separate from real routes */}
        {activeCounterfactualIds.size > 0 && (
          <CounterfactualTradeRoutesLayer
            routes={activeCounterfactualRoutes(counterfactualRoutes, activeCounterfactualIds).filter(
              (r) => routeAppliesAtYear(r, currentYear),
            )}
            opacity={0.85}
          />
        )}

        {/* Measurement Layer */}
        <MeasurementLayer measurement={measurementTool} />

        {/* Image Georeferencing Layer */}
        <ImageGeoreferenceLayer georef={georefTool} />

        {/* AI-Extracted Features Layer */}
        {featureExtraction.state.reviewableFeatures.length > 0 && (
          <ExtractedFeaturesLayer features={featureExtraction.state.reviewableFeatures} />
        )}

        {/* Map Labels Layer */}
        <MapLabelsLayer
          languageRanges={filteredLanguageRanges}
          civilizations={filteredCivilizations}
          archaeologicalCultures={filteredArchaeologicalCultures}
          archaeologicalSites={filteredArchaeologicalSites}
          routes={filteredRoutes}
          enabledLabelLayers={enabledLabelLayers}
        />

        {/* Territory Overlap Layer */}
        {overlapTerritories.length >= 2 && (
          <TerritoryOverlapLayer
            territories={overlapTerritories}
            blendMode={blendMode}
            opacity={0.5}
          />
        )}

        {/* Map Comparison Controller (renders comparison layers inside the map) */}
        <MapComparisonController
          currentYear={currentYear}
          minYear={timeState.minYear}
          maxYear={timeState.maxYear}
          allCivilizations={allCivilizations}
          allLanguageRanges={allLanguageRanges}
          onActiveYearChange={setBlinkOverrideYear}
          civilizationOpacity={getLayerConfig('civilizations')?.opacity}
          languageRangeOpacity={getLayerConfig('language-ranges')?.opacity}
        />

        {/* Boundary Drawing Layer */}
        <BoundaryDrawingLayer drawing={drawingTool} />

        {/* Map Context Menu (right-click "What was here?") */}
        <MapContextMenu
          currentYear={currentYear}
          onFeatureSelect={handleFeatureClick}
        />
      </MapContainer>

      {/* Measurement Panel */}
      <MeasurementPanel measurement={measurementTool} />

      {/* Image Georeferencing Panel */}
      <ImageGeoreferencePanel
        georef={georefTool}
        mapCenter={initialCenter}
        mapZoom={2}
        extractionState={featureExtraction.state}
        onExtractFeatures={() => {
          const bounds = georefTool.georeferencedBounds || georefTool.state.bounds;
          if (georefTool.state.imageUrl && bounds) {
            featureExtraction.extractFeatures(georefTool.state.imageUrl, bounds);
          }
        }}
        onToggleFeatureAccepted={featureExtraction.toggleAccepted}
        onToggleFeatureVisible={featureExtraction.toggleVisible}
        onRemoveFeature={featureExtraction.removeFeature}
        onAcceptAllFeatures={featureExtraction.acceptAll}
        onRejectAllFeatures={featureExtraction.rejectAll}
        onConfirmFeatures={() => {
          // Features are already displayed on the map; confirming is acknowledgment
          // In the future this could save to TSV storage
          featureExtraction.dismiss();
        }}
        onDismissFeatures={featureExtraction.dismiss}
      />

      {/* Map Comparison Overlays (toggle, divider, control panel) */}
      <MapComparisonOverlays
        isActive={splitScreen.state.isActive}
        mode={splitScreen.state.mode}
        leftYear={splitScreen.state.leftYear}
        rightYear={splitScreen.state.rightYear}
        dividerPosition={splitScreen.state.dividerPosition}
        blinkInterval={splitScreen.state.blinkInterval}
        blinkShowingLeft={splitScreen.state.blinkShowingLeft}
        minYear={timeState.minYear}
        maxYear={timeState.maxYear}
        onToggle={splitScreen.toggle}
        onClose={splitScreen.deactivate}
        onModeChange={splitScreen.setMode}
        onLeftYearChange={splitScreen.setLeftYear}
        onRightYearChange={splitScreen.setRightYear}
        onDividerPositionChange={splitScreen.setDividerPosition}
        onBlinkIntervalChange={splitScreen.setBlinkInterval}
        onSwapYears={splitScreen.swapYears}
        leftLayers={splitScreen.state.leftLayers}
        rightLayers={splitScreen.state.rightLayers}
        onToggleLeftLayer={splitScreen.toggleLeftLayer}
        onToggleRightLayer={splitScreen.toggleRightLayer}
      />

      {/* Map Bookmarks & View Presets */}
      <BookmarkPanel
        builtInPresets={builtInPresets}
        userBookmarks={userBookmarks}
        onApplyBookmark={handleApplyBookmark}
        onSaveBookmark={saveBookmark}
        onDeleteBookmark={deleteBookmark}
        onGetShareableURL={getShareableURL}
        currentViewState={currentViewState}
      />

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
        enabledLabelLayers={enabledLabelLayers}
        onToggleLabelLayer={toggleLabelLayer}
        blendMode={blendMode}
        onBlendModeChange={setBlendMode}
      />

      {/* Territorial Fill Type Selector */}
      {(isLayerVisible('civilizations') || isLayerVisible('archaeological-cultures') || isLayerVisible('language-ranges') || isLayerVisible('language-range-polygons')) && (
        <div className="absolute top-4 left-[280px] z-[1000] bg-white rounded-lg shadow-lg border p-2 flex items-center gap-1.5 text-xs">
          <span className="font-medium text-gray-700 mr-1">Fill:</span>
          {(['solid', 'gradient', 'hatched', 'striped'] as const).map((ft) => (
            <button
              key={ft}
              onClick={() => setTerritorialFillType(ft)}
              className={`px-2 py-1 rounded capitalize ${territorialFillType === ft ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {ft}
            </button>
          ))}
        </div>
      )}

      {/* Genetic-Linguistic Haplogroup Type Toggle */}
      {isLayerVisible('genetic-linguistic-correlation') && (
        <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-lg border p-2 flex items-center gap-1.5 text-xs">
          <span className="font-medium text-gray-700 mr-1">Filter:</span>
          <button
            onClick={() => setGlcHaplogroupTypeFilter(glcHaplogroupTypeFilter === null ? null : null)}
            className={`px-2 py-1 rounded ${glcHaplogroupTypeFilter === null ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All
          </button>
          <button
            onClick={() => setGlcHaplogroupTypeFilter(glcHaplogroupTypeFilter === 'Y-chromosome' ? null : 'Y-chromosome')}
            className={`px-2 py-1 rounded ${glcHaplogroupTypeFilter === 'Y-chromosome' ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Y-DNA
          </button>
          <button
            onClick={() => setGlcHaplogroupTypeFilter(glcHaplogroupTypeFilter === 'mtDNA' ? null : 'mtDNA')}
            className={`px-2 py-1 rounded ${glcHaplogroupTypeFilter === 'mtDNA' ? 'bg-purple-100 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            mtDNA
          </button>
        </div>
      )}

      {/* Map Legend */}
      <MapLegend
        layerConfigs={layerState.layerConfigs}
        activeLayers={layerState.activeLayers}
      />

      {/* Base Map Selector */}
      <BaseMapSelector
        currentBaseMapId={baseMapId}
        availableMaps={availableMaps}
        onSelect={setBaseMap}
      />

      {/* Timeline Events Sidebar */}
      <TimelineEventsSidebar
        currentYear={currentYear}
        civilizations={filteredCivilizations}
        routes={filteredRoutes}
        archaeologicalSites={filteredArchaeologicalSites}
        battles={allBattles}
        isVisible={isPlaying || filteredCivilizations.length > 0 || allBattles.length > 0}
      />

      {/* Story Mode Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowStoryMode((prev) => !prev)}
        className="absolute bottom-4 right-[13.5rem] z-[1000] bg-white shadow-lg"
        title="Historical Tours"
      >
        <BookOpen className="h-4 w-4" />
      </Button>

      {/* Story Mode Panel */}
      {showStoryMode && (
        <StoryMode
          onNavigate={handleStoryNavigate}
          onTimeChange={handleStoryTimeChange}
          onLayersChange={handleStoryLayersChange}
          onClose={() => setShowStoryMode(false)}
        />
      )}

      {/* What-If Scenario Control + persistent speculative banner (US-001) */}
      <WhatIfScenarioControl
        scenarios={whatIfScenarios}
        activeScenarioId={activeScenarioId}
        onSelectScenario={handleSelectScenario}
        onClear={handleClearScenario}
      />

      {/* Alternative-Urheimat migration toggle (US-002) */}
      <UrheimatHypothesisControl
        hypotheses={allUrheimatHypotheses}
        activeHypothesisId={activeHypothesisId}
        onSelectHypothesis={handleSelectHypothesis}
        onClear={handleClearHypothesis}
      />

      {/* Counterfactual trade-route overlays (US-003) */}
      <CounterfactualTradeRoutesControl
        routes={counterfactualRoutes}
        activeRouteIds={activeCounterfactualIds}
        onToggleRoute={handleToggleCounterfactual}
        onSelectAll={handleSelectAllCounterfactual}
        onClear={handleClearCounterfactual}
      />

      {/* Export Map Image */}
      <Button
        variant="outline"
        size="sm"
        onClick={exportMapImage}
        disabled={isExportingImage}
        className="absolute bottom-4 right-[10.5rem] z-[1000] bg-white shadow-lg"
        title="Export map as PNG image"
        aria-label="Export map as PNG image"
      >
        {isExportingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
      </Button>

      {/* High-Contrast Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={a11y.toggleHighContrast}
        className="absolute bottom-4 right-[7.5rem] z-[1000] bg-white shadow-lg"
        title={a11y.highContrast ? 'Disable high-contrast mode (H)' : 'Enable high-contrast mode (H)'}
        aria-pressed={a11y.highContrast}
        aria-label="Toggle high-contrast mode"
      >
        <Eye className={`h-4 w-4 ${a11y.highContrast ? 'text-yellow-600' : ''}`} />
      </Button>

      {/* Keyboard Help Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={a11y.toggleKeyboardHelp}
        className="absolute bottom-4 right-[4.5rem] z-[1000] bg-white shadow-lg"
        title="Keyboard shortcuts (?)"
        aria-label="Show keyboard shortcuts"
      >
        <Keyboard className="h-4 w-4" />
      </Button>

      {/* Feature-navigation focus indicator (visible + SR status) */}
      {featureNav.navActive && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001] bg-blue-600 text-white text-sm px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-none"
          role="status"
        >
          <span className="font-medium">Feature nav</span>
          <span className="opacity-90">
            {focusedNavFeature
              ? `${focusedNavFeature.name}`
              : navigableFeatures.length === 0
                ? 'no features'
                : 'use arrow keys'}
          </span>
        </div>
      )}

      {/* Keyboard Shortcuts Help Dialog */}
      {a11y.showKeyboardHelp && (
        <div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[1002] bg-white rounded-lg shadow-xl border p-6 max-w-sm w-full"
          role="dialog"
          aria-label="Keyboard shortcuts"
          aria-modal="true"
        >
          <h3 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h3>
          <ul className="space-y-1.5 text-sm">
            {a11y.keyboardShortcuts.map((s) => (
              <li key={s.key} className="flex justify-between">
                <span className="text-gray-600">{s.description}</span>
                <kbd className="ml-2 px-1.5 py-0.5 bg-gray-100 border rounded text-xs font-mono">{s.key}</kbd>
              </li>
            ))}
          </ul>
          <h4 className="text-sm font-semibold mt-4 mb-2">Feature Navigation</h4>
          <ul className="space-y-1.5 text-sm">
            {MAP_FEATURE_NAV_SHORTCUTS.map((s) => (
              <li key={s.key} className="flex justify-between">
                <span className="text-gray-600">{s.description}</span>
                <kbd className="ml-2 px-1.5 py-0.5 bg-gray-100 border rounded text-xs font-mono">{s.key}</kbd>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            onClick={a11y.toggleKeyboardHelp}
            className="mt-4 w-full"
            aria-label="Close keyboard shortcuts"
          >
            Close
          </Button>
        </div>
      )}

      {/* Fullscreen Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleFullscreen}
        className="absolute bottom-4 right-4 z-[1000] bg-white shadow-lg"
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
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

      {/* Instructions Overlay */}
      {filteredLanguageRanges.length === 0 &&
        filteredArchaeologicalSites.length === 0 &&
        filteredCivilizations.length === 0 &&
        filteredRoutes.length === 0 &&
        filteredMaterialCultures.length === 0 &&
        !isLoadingAnyLayer && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[1000] text-center p-8 bg-white rounded-lg shadow-lg border">
            <h3 className="text-lg font-semibold mb-2">No Data Available</h3>
            <p className="text-sm text-gray-600 mb-4">
              No map data is available for the current time period ({currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`}).
            </p>
            <p className="text-xs text-gray-500">
              Try adjusting the time slider or enabling different layers.
            </p>
          </div>
        )}

      {/* Loading indicator for time changes */}
      {isPlaying && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1001] bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium">
          Playing: {currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`}
        </div>
      )}

      {/* Feature Info Panel (Detail Drawer) */}
      <MapFeatureInfoPanel
        data={selectedFeatureData}
        onClose={clearSelection}
      />

      {/* Culture Profile Panel — opened when a clicked feature resolves to a
          known CultureProfile (via civilization/arc-culture cross-reference). */}
      {selectedCultureProfileId && (
        <CultureProfilePanel
          cultureId={selectedCultureProfileId}
          onClose={() => setSelectedCultureProfileId(null)}
        />
      )}
    </div>
  );
}
