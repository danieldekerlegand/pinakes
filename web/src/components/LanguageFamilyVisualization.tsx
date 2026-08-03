import React, { useMemo, useRef, Suspense, lazy } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useVisualization } from '../contexts/VisualizationContext';
import { ExportMenu } from './visualizations/shared/ExportMenu';
import {
  transformToTreeData,
  transformToNetworkData,
  transformToTimelineData,
  transformToMapData,
} from '../lib/visualization/data-transformers';
import type { LanguageFamilyWithChildren } from '@contracts/types';

// Lazy load visualization components for better performance
const LanguageTreeView = lazy(() =>
  import('./visualizations/LanguageTreeView').then((m) => ({ default: m.LanguageTreeView }))
);
const LanguageNetworkView = lazy(() =>
  import('./visualizations/LanguageNetworkView').then((m) => ({ default: m.LanguageNetworkView }))
);
const LanguageTimelineView = lazy(() =>
  import('./visualizations/LanguageTimelineView').then((m) => ({ default: m.LanguageTimelineView }))
);
const LanguageMapView = lazy(() =>
  import('./visualizations/LanguageMapView').then((m) => ({ default: m.LanguageMapView }))
);
const EnhancedLanguageMapView = lazy(() =>
  import('./visualizations/EnhancedLanguageMapView').then((m) => ({ default: m.EnhancedLanguageMapView }))
);
const CrossDomainExplorer = lazy(() =>
  import('./visualizations/CrossDomainExplorer').then((m) => ({ default: m.CrossDomainExplorer }))
);
const ContributionPanel = lazy(() =>
  import('./visualizations/ContributionPanel').then((m) => ({ default: m.ContributionPanel }))
);
const CulturalLineageExplorer = lazy(() =>
  import('./visualizations/CulturalLineageExplorer').then((m) => ({ default: m.CulturalLineageExplorer }))
);
const TopographicMapView = lazy(() =>
  import('./visualizations/TopographicMapView').then((m) => ({ default: m.TopographicMapView }))
);

interface LanguageFamilyVisualizationProps {
  selectedLanguageId?: string | null;
  onLanguageSelect?: (languageId: string) => void;
}

const VIEW_LABELS: Record<string, string> = {
  tree: 'Hierarchical Tree',
  network: 'Network Graph',
  timeline: 'Timeline',
  map: 'Geographic Map',
  'map-3d': '3D Topographic Map',
  explorer: 'Cross-Domain Explorer',
  lineage: 'Cultural Lineage',
  contribute: 'Contribute Data',
};

function LoadingFallback({ label }: { label: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg" role="status">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
        <span className="text-sm text-gray-500">Loading {label}...</span>
      </div>
    </div>
  );
}

function LanguageFamilyVisualizationContent({
  selectedLanguageId,
  onLanguageSelect,
}: LanguageFamilyVisualizationProps) {
  const { state, selectLanguage, state: vizState } = useVisualization();
  const networkViewSvgRef = useRef<SVGSVGElement>(null);
  const timelineViewSvgRef = useRef<SVGSVGElement>(null);

  // Fetch language families data
  const { data: familyTree, isLoading, error } = useQuery<LanguageFamilyWithChildren[]>({
    queryKey: ['/api/language-families/tree'],
  });

  // Prefetch cultural lineages so data is ready when the Lineage tab is opened
  const queryClient = useQueryClient();
  React.useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['/api/cultural-lineages'],
      staleTime: 60 * 1000,
    });
  }, [queryClient]);

  // Transform data for each view (memoized for performance)
  const treeData = useMemo(() => {
    if (!familyTree) return [];
    return transformToTreeData(familyTree, state.filters);
  }, [familyTree, state.filters]);

  const networkData = useMemo(() => {
    if (!familyTree) return { nodes: [], links: [] };
    return transformToNetworkData(familyTree, state.filters);
  }, [familyTree, state.filters]);

  const timelineData = useMemo(() => {
    if (!familyTree) return [];
    return transformToTimelineData(familyTree, state.filters, state.viewSettings.timeline.groupBy);
  }, [familyTree, state.filters, state.viewSettings.timeline.groupBy]);

  const mapData = useMemo(() => {
    if (!familyTree) return [];
    return transformToMapData(familyTree, state.filters);
  }, [familyTree, state.filters]);

  // Handle node/marker clicks
  const handleNodeClick = (id: string, type: 'family' | 'language') => {
    if (type === 'language') {
      selectLanguage(id);
      if (onLanguageSelect) {
        onLanguageSelect(id);
      }
    }
  };

  // Sync selected language from props
  React.useEffect(() => {
    if (selectedLanguageId) {
      selectLanguage(selectedLanguageId);
    }
  }, [selectedLanguageId, selectLanguage]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading language families...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center p-8">
          <p className="text-red-600 mb-2">Error loading language families</p>
          <p className="text-sm text-gray-600">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (!familyTree || familyTree.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center p-8">
          <p className="text-gray-600 mb-2">No language families found</p>
          <p className="text-sm text-gray-500">
            Import language family data to get started.
          </p>
        </div>
      </div>
    );
  }

  const currentView = state.currentView;
  const svgRef = currentView === 'network' ? networkViewSvgRef
    : currentView === 'timeline' ? timelineViewSvgRef
    : undefined;

  const exportData = currentView === 'tree' ? treeData
    : currentView === 'network' ? networkData
    : currentView === 'timeline' ? timelineData
    : currentView === 'map' ? mapData
    : undefined;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Compact header with export */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">
            {VIEW_LABELS[currentView] || currentView}
          </h2>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>{networkData.nodes.filter((n) => n.type === 'family').length} families</span>
            <span>{networkData.nodes.filter((n) => n.type === 'language').length} languages</span>
            {timelineData.length > 0 && <span>{timelineData.length} with temporal data</span>}
            {mapData.length > 0 && <span>{mapData.length} with geographic data</span>}
            {state.selectedLanguageIds.size > 0 && (
              <span className="text-blue-600 font-medium">{state.selectedLanguageIds.size} selected</span>
            )}
          </div>
        </div>
        <ExportMenu svgRef={svgRef} data={exportData} currentView={currentView} />
      </div>

      {/* Visualization content — fills remaining space */}
      <div className="flex-1 min-h-0">
        {currentView === 'tree' && (
          <Suspense fallback={<LoadingFallback label="tree" />}>
            <LanguageTreeView treeData={treeData} onNodeClick={handleNodeClick} />
          </Suspense>
        )}

        {currentView === 'network' && (
          <Suspense fallback={<LoadingFallback label="network" />}>
            <div className="w-full h-full">
              <LanguageNetworkView networkData={networkData} onNodeClick={handleNodeClick} />
            </div>
          </Suspense>
        )}

        {currentView === 'timeline' && (
          <Suspense fallback={<LoadingFallback label="timeline" />}>
            <LanguageTimelineView
              timelineData={timelineData}
              onEventClick={(id) => handleNodeClick(id, 'language')}
            />
          </Suspense>
        )}

        {currentView === 'map' && (
          <Suspense fallback={<LoadingFallback label="map" />}>
            <div className="w-full h-full">
              <EnhancedLanguageMapView
                onFeatureSelect={(id) => handleNodeClick(id, 'language')}
                selectedFeatureId={vizState.selectedLanguageIds.size > 0 ? Array.from(vizState.selectedLanguageIds)[0] : null}
              />
            </div>
          </Suspense>
        )}

        {currentView === 'map-3d' && (
          <Suspense fallback={<LoadingFallback label="3D map" />}>
            <div className="w-full h-full">
              <TopographicMapView
                onFeatureSelect={(id) => handleNodeClick(id, 'language')}
                selectedFeatureId={vizState.selectedLanguageIds.size > 0 ? Array.from(vizState.selectedLanguageIds)[0] : null}
              />
            </div>
          </Suspense>
        )}

        {currentView === 'explorer' && (
          <Suspense fallback={<LoadingFallback label="explorer" />}>
            <div className="w-full h-full">
              <CrossDomainExplorer />
            </div>
          </Suspense>
        )}

        {currentView === 'lineage' && (
          <Suspense fallback={<LoadingFallback label="lineage" />}>
            <div className="w-full h-full">
              <CulturalLineageExplorer />
            </div>
          </Suspense>
        )}

        {currentView === 'contribute' && (
          <Suspense fallback={<LoadingFallback label="contribute" />}>
            <div className="w-full h-full">
              <ContributionPanel />
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}

// Main component — uses the VisualizationProvider from App.tsx
export function LanguageFamilyVisualization(props: LanguageFamilyVisualizationProps) {
  return <LanguageFamilyVisualizationContent {...props} />;
}
