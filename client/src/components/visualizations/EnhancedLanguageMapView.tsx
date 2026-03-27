import React, { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useMapLayers } from './hooks/useMapLayers';
import { useTimeSlider } from './hooks/useTimeSlider';
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
import { SettlementsLayer } from './map-layers/SettlementsLayer';
import type { SettlementFeature } from './map-layers/SettlementsLayer';
import { TimelineEventsSidebar } from './map-layers/TimelineEventsSidebar';
import { BoundaryDrawingLayer } from './map-layers/BoundaryDrawingLayer';
import { BaseMapSelector } from './map-layers/BaseMapSelector';
import { useBaseMap } from './hooks/useBaseMap';
import { useDrawingTool } from './hooks/useDrawingTool';
import { useImageGeoreference } from './hooks/useImageGeoreference';
import { ImageGeoreferenceLayer, ImageGeoreferencePanel } from './map-tools/ImageGeoreferencer';
import { MapContextMenu } from './map-layers/MapContextMenu';
import { MapFeatureInfoPanel } from './map-layers/MapFeatureInfoPanel';
import { useMapFeatureSelection } from './hooks/useMapFeatureSelection';
import type { FeatureLookupCollections } from './hooks/useMapFeatureSelection';
import { filterGeoJSONByTime } from '../../lib/visualization/geospatial-transformers';
import { CIVILIZATION_PALETTE } from '../../lib/visualization/color-theme';
import { TerritorialShadingProvider } from './map-layers/TerritorialShadingProvider';
import type { TerritorialFillType } from '../../lib/visualization/territorial-shading';
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

  // Initialize drawing tool
  const drawingTool = useDrawingTool();

  // Initialize image georeferencing tool
  const georefTool = useImageGeoreference();

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
  } = useTimeSlider();

  // Fetch language range data
  const { data: languageRangesData, isLoading: loadingRanges } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-ranges'],
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: isLayerVisible('language-ranges'),
  });

  // Fetch language range polygons data (expanded dataset)
  const { data: languageRangePolygonsData, isLoading: loadingRangePolygons } = useQuery<LanguageRangeCollection>({
    queryKey: ['/api/map/language-range-polygons'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('language-range-polygons'),
  });

  // Fetch archaeological sites data
  const { data: archaeologicalSitesData, isLoading: loadingSites } = useQuery<ArchaeologicalSiteCollection>({
    queryKey: ['/api/map/archaeological-sites'],
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
  const { data: settlementsData, isLoading: loadingSettlements } = useQuery<{ settlements: SettlementFeature[]; count: number }>({
    queryKey: ['/api/settlements'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('settlements'),
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

  // Filter features by current time
  const filteredLanguageRanges = useMemo(() => {
    return filterGeoJSONByTime(allLanguageRanges, currentYear);
  }, [allLanguageRanges, currentYear]);

  const filteredLanguageRangePolygons = useMemo(() => {
    return filterGeoJSONByTime(allLanguageRangePolygons, currentYear);
  }, [allLanguageRangePolygons, currentYear]);

  const filteredArchaeologicalSites = useMemo(() => {
    return filterGeoJSONByTime(allArchaeologicalSites, currentYear);
  }, [allArchaeologicalSites, currentYear]);

  const filteredArchaeologicalCultures = useMemo(() => {
    return filterGeoJSONByTime(allArchaeologicalCultures, currentYear);
  }, [allArchaeologicalCultures, currentYear]);

  const filteredCivilizations = useMemo(() => {
    return filterGeoJSONByTime(allCivilizations, currentYear);
  }, [allCivilizations, currentYear]);

  const filteredRoutes = useMemo(() => {
    return filterGeoJSONByTime(allRoutes, currentYear);
  }, [allRoutes, currentYear]);

  const filteredMaterialCultures = useMemo(() => {
    // Material cultures don't have a time period directly, filter based on associated period
    // For now, show all material cultures (they're already point data with implicit time)
    return allMaterialCultures;
  }, [allMaterialCultures]);

  // Derive the active selected feature ID — internal selection takes priority
  const activeSelectedFeatureId = internalSelectedFeatureId ?? selectedFeatureId ?? null;

  // Handle feature clicks — open info panel and notify parent
  const handleFeatureClick = useCallback(
    (id: string) => {
      selectFeature(id);
      if (onFeatureSelect) {
        onFeatureSelect(id);
      }
    },
    [onFeatureSelect, selectFeature]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
  }, [toggle, stepBackward, stepForward, jumpToStart, jumpToEnd]);

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

  if (isLoadingAnyLayer) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading map data...</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapContainerRef} className={`w-full h-full relative rounded-lg overflow-hidden ${isFullscreen ? 'bg-white' : ''}`}>
      <MapContainer
        center={initialCenter}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        className="z-0"
      >
        <TileLayer
          key={baseMap.id}
          attribution={baseMap.attribution}
          url={baseMap.url}
          maxZoom={baseMap.maxZoom}
        />

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
            selectedHypothesisId={selectedFeatureId}
          />
        )}

        {/* Image Georeferencing Layer */}
        <ImageGeoreferenceLayer georef={georefTool} />

        {/* Boundary Drawing Layer */}
        <BoundaryDrawingLayer drawing={drawingTool} />

        {/* Map Context Menu (right-click "What was here?") */}
        <MapContextMenu
          currentYear={currentYear}
          onFeatureSelect={handleFeatureClick}
        />
      </MapContainer>

      {/* Image Georeferencing Panel */}
      <ImageGeoreferencePanel
        georef={georefTool}
        mapCenter={initialCenter}
        mapZoom={2}
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

      {/* Fullscreen Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleFullscreen}
        className="absolute bottom-4 right-4 z-[1000] bg-white shadow-lg"
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
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
        onYearChange={setCurrentYear}
        onPlayPause={toggle}
        onStepForward={stepForward}
        onStepBackward={stepBackward}
        onSpeedChange={setPlaybackSpeed}
        onStepSizeChange={setStepSize}
        onJumpToStart={jumpToStart}
        onJumpToEnd={jumpToEnd}
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
    </div>
  );
}
