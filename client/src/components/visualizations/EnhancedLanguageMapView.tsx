import React, { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMapLayers } from './hooks/useMapLayers';
import { useTimeSlider } from './hooks/useTimeSlider';
import { LanguageRangeLayer } from './map-layers/LanguageRangeLayer';
import { ArchaeologicalSitesLayer } from './map-layers/ArchaeologicalSitesLayer';
import { CivilizationLayer } from './map-layers/CivilizationLayer';
import { RoutesLayer } from './map-layers/RoutesLayer';
import { MaterialCultureHeatmap } from './map-layers/MaterialCultureHeatmap';
import { CuisineLayer } from './map-layers/CuisineLayer';
import type { CuisineFeature } from './map-layers/CuisineLayer';
import { MusicTraditionLayer } from './map-layers/MusicTraditionLayer';
import type { MusicTraditionFeature } from './map-layers/MusicTraditionLayer';
import { ReligionLayer } from './map-layers/ReligionLayer';
import type { ReligionFeature } from './map-layers/ReligionLayer';
import { TimeSlider } from './map-layers/TimeSlider';
import { LayerPanel } from './map-layers/LayerPanel';
import { MapLegend } from './map-layers/MapLegend';
import { BattlesLayer } from './map-layers/BattlesLayer';
import type { BattleFeature } from './map-layers/BattlesLayer';
import { HaplogroupLayer } from './map-layers/HaplogroupLayer';
import type { HaplogroupFeature } from './map-layers/HaplogroupLayer';
import { TimelineEventsSidebar } from './map-layers/TimelineEventsSidebar';
import { filterGeoJSONByTime } from '../../lib/visualization/geospatial-transformers';
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
  CivilizationFeature,
  CivilizationCollection,
  HistoricalRouteFeature,
  HistoricalRouteCollection,
  MaterialCultureDistribution,
  MaterialCultureCollection,
} from '../../lib/visualization/geospatial-types';
import 'leaflet/dist/leaflet.css';

interface EnhancedLanguageMapViewProps {
  onFeatureSelect?: (id: string) => void;
  selectedFeatureId?: string | null;
}

export function EnhancedLanguageMapView({
  onFeatureSelect,
  selectedFeatureId,
}: EnhancedLanguageMapViewProps) {
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

  // Fetch archaeological sites data
  const { data: archaeologicalSitesData, isLoading: loadingSites } = useQuery<ArchaeologicalSiteCollection>({
    queryKey: ['/api/map/archaeological-sites'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('archaeological-sites'),
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

  // Fetch material cultures data
  const { data: materialCulturesData, isLoading: loadingMaterialCultures } = useQuery<MaterialCultureCollection>({
    queryKey: ['/api/map/material-cultures'],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('material-cultures'),
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

  // Fetch religions data with temporal filtering
  const { data: religionsData, isLoading: loadingReligions } = useQuery<{ religions: ReligionFeature[]; count: number }>({
    queryKey: ['/api/religions', { year: currentYear }],
    staleTime: 5 * 60 * 1000,
    enabled: isLayerVisible('religions'),
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

  // Use sample data as fallback when API returns empty data
  const allLanguageRanges = useMemo(() => {
    if (languageRangesData?.features && languageRangesData.features.length > 0) {
      return languageRangesData.features;
    }
    return sampleLanguageRanges;
  }, [languageRangesData]);

  const allArchaeologicalSites = useMemo(() => {
    if (archaeologicalSitesData?.features && archaeologicalSitesData.features.length > 0) {
      return archaeologicalSitesData.features;
    }
    return sampleArchaeologicalSites;
  }, [archaeologicalSitesData]);

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

  // Cuisine data (already filtered by year on server)
  const filteredCuisines = useMemo(() => {
    return cuisinesData?.cuisines ?? [];
  }, [cuisinesData]);

  // Music tradition data (already filtered by year on server)
  const filteredMusicTraditions = useMemo(() => {
    return musicData?.traditions ?? [];
  }, [musicData]);

  // Religion data (already filtered by year on server)
  const filteredReligions = useMemo(() => {
    return religionsData?.religions ?? [];
  }, [religionsData]);

  // Battles data
  const allBattles = useMemo(() => {
    return battlesData?.battles ?? [];
  }, [battlesData]);

  // Haplogroups data
  const allHaplogroups = useMemo(() => {
    return haplogroupsData?.haplogroups ?? [];
  }, [haplogroupsData]);

  // Filter features by current time
  const filteredLanguageRanges = useMemo(() => {
    return filterGeoJSONByTime(allLanguageRanges, currentYear);
  }, [allLanguageRanges, currentYear]);

  const filteredArchaeologicalSites = useMemo(() => {
    return filterGeoJSONByTime(allArchaeologicalSites, currentYear);
  }, [allArchaeologicalSites, currentYear]);

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

  // Handle feature clicks
  const handleFeatureClick = useCallback(
    (id: string) => {
      if (onFeatureSelect) {
        onFeatureSelect(id);
      }
    },
    [onFeatureSelect]
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
    (loadingSites && isLayerVisible('archaeological-sites')) ||
    (loadingCivilizations && isLayerVisible('civilizations')) ||
    (loadingRoutes && isLayerVisible('routes')) ||
    (loadingMaterialCultures && isLayerVisible('material-cultures')) ||
    (loadingCuisines && isLayerVisible('cuisines')) ||
    (loadingMusic && isLayerVisible('music')) ||
    (loadingReligions && isLayerVisible('religions')) ||
    (loadingBattles && isLayerVisible('battles')) ||
    (loadingHaplogroups && isLayerVisible('haplogroups'));

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
    <div className="w-full h-full relative rounded-lg overflow-hidden">
      <MapContainer
        center={initialCenter}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Language Range Layer */}
        {isLayerVisible('language-ranges') && filteredLanguageRanges.length > 0 && (
          <LanguageRangeLayer
            features={filteredLanguageRanges}
            opacity={getLayerConfig('language-ranges')?.opacity || 0.6}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeatureId}
          />
        )}

        {/* Archaeological Sites Layer */}
        {isLayerVisible('archaeological-sites') && filteredArchaeologicalSites.length > 0 && (
          <ArchaeologicalSitesLayer
            features={filteredArchaeologicalSites}
            opacity={getLayerConfig('archaeological-sites')?.opacity || 0.8}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeatureId}
          />
        )}

        {/* Civilizations Layer */}
        {isLayerVisible('civilizations') && filteredCivilizations.length > 0 && (
          <CivilizationLayer
            features={filteredCivilizations}
            opacity={getLayerConfig('civilizations')?.opacity || 0.5}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeatureId}
          />
        )}

        {/* Routes Layer */}
        {isLayerVisible('routes') && filteredRoutes.length > 0 && (
          <RoutesLayer
            features={filteredRoutes}
            opacity={getLayerConfig('routes')?.opacity || 0.7}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeatureId}
            isAnimating={isPlaying}
          />
        )}

        {/* Material Culture Heatmap */}
        {isLayerVisible('material-cultures') && filteredMaterialCultures.length > 0 && (
          <MaterialCultureHeatmap
            distributions={filteredMaterialCultures}
            opacity={getLayerConfig('material-cultures')?.opacity || 0.6}
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

        {/* Religion Layer */}
        {isLayerVisible('religions') && filteredReligions.length > 0 && (
          <ReligionLayer
            religions={filteredReligions}
            opacity={getLayerConfig('religions')?.opacity || 0.8}
            onReligionClick={handleFeatureClick}
            selectedReligionId={selectedFeatureId}
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
      </MapContainer>

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

      {/* Map Legend */}
      <MapLegend
        layerConfigs={layerState.layerConfigs}
        activeLayers={layerState.activeLayers}
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
    </div>
  );
}
