import React, { useMemo, useRef, Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TreePine, Network, Clock, MapPin, Loader2, Link2, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Card } from './ui/card';
import { VisualizationProvider, useVisualization } from '../contexts/VisualizationContext';
import { ExportMenu } from './visualizations/shared/ExportMenu';
import {
  transformToTreeData,
  transformToNetworkData,
  transformToTimelineData,
  transformToMapData,
} from '../lib/visualization/data-transformers';
import type { LanguageFamilyWithChildren } from '../../shared/types';

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

interface LanguageFamilyVisualizationProps {
  selectedLanguageId?: string | null;
  onLanguageSelect?: (languageId: string) => void;
}

function LanguageFamilyVisualizationContent({
  selectedLanguageId,
  onLanguageSelect,
}: LanguageFamilyVisualizationProps) {
  const { state, setView, selectLanguage, state: vizState } = useVisualization();
  const treeViewSvgRef = useRef<SVGSVGElement>(null);
  const networkViewSvgRef = useRef<SVGSVGElement>(null);
  const timelineViewSvgRef = useRef<SVGSVGElement>(null);

  // Fetch language families data
  const { data: familyTree, isLoading, error } = useQuery<LanguageFamilyWithChildren[]>({
    queryKey: ['/api/language-families/tree'],
  });

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
      <Card className="w-full h-[600px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading language families...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full h-[600px] flex items-center justify-center">
        <div className="text-center p-8">
          <p className="text-red-600 mb-2">Error loading language families</p>
          <p className="text-sm text-gray-600">{(error as Error).message}</p>
        </div>
      </Card>
    );
  }

  if (!familyTree || familyTree.length === 0) {
    return (
      <Card className="w-full h-[600px] flex items-center justify-center">
        <div className="text-center p-8">
          <p className="text-gray-600 mb-2">No language families found</p>
          <p className="text-sm text-gray-500">
            Import language family data to get started.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Language Family Visualizations</h2>
          <ExportMenu
            svgRef={
              state.currentView === 'tree'
                ? treeViewSvgRef
                : state.currentView === 'network'
                ? networkViewSvgRef
                : state.currentView === 'timeline'
                ? timelineViewSvgRef
                : undefined
            }
            data={
              state.currentView === 'tree'
                ? treeData
                : state.currentView === 'network'
                ? networkData
                : state.currentView === 'timeline'
                ? timelineData
                : state.currentView === 'map'
                ? mapData
                : undefined
            }
            currentView={state.currentView}
          />
        </div>

        <Tabs value={state.currentView} onValueChange={(value) => setView(value as any)}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 mb-4" aria-label="Visualization views">
            <TabsTrigger value="tree" className="flex items-center gap-2" aria-label="Hierarchical Tree view">
              <TreePine className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Hierarchical Tree</span>
              <span className="sm:hidden">Tree</span>
            </TabsTrigger>
            <TabsTrigger value="network" className="flex items-center gap-2" aria-label="Network Graph view">
              <Network className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Network Graph</span>
              <span className="sm:hidden">Network</span>
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2" aria-label="Timeline view">
              <Clock className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Timeline</span>
              <span className="sm:hidden">Time</span>
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-2" aria-label="Geographic Map view">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Geographic Map</span>
              <span className="sm:hidden">Map</span>
            </TabsTrigger>
            <TabsTrigger value="explorer" className="flex items-center gap-2" aria-label="Cross-Domain Explorer view">
              <Link2 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cross-Domain</span>
              <span className="sm:hidden">Explore</span>
            </TabsTrigger>
            <TabsTrigger value="contribute" className="flex items-center gap-2" aria-label="Contribute data">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Contribute</span>
              <span className="sm:hidden">Add</span>
            </TabsTrigger>
          </TabsList>

          <div className="min-h-[600px]">
            <TabsContent value="tree" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading tree visualization</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" role="img" aria-label={`Hierarchical tree visualization showing ${treeData.length} language families and their descendant languages. Click nodes to explore individual languages.`}>
                  <LanguageTreeView treeData={treeData} onNodeClick={handleNodeClick} />
                </div>
              </Suspense>
            </TabsContent>

            <TabsContent value="network" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading network visualization</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" role="img" aria-label={`Force-directed network graph showing ${networkData.nodes.length} nodes and ${networkData.links.length} connections between language families and languages. Drag nodes to rearrange.`}>
                  <LanguageNetworkView networkData={networkData} onNodeClick={handleNodeClick} />
                </div>
              </Suspense>
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading timeline visualization</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" role="img" aria-label={`Timeline visualization showing ${timelineData.length} languages and their historical periods. Click events to view language details.`}>
                  <LanguageTimelineView
                    timelineData={timelineData}
                    onEventClick={(id) => handleNodeClick(id, 'language')}
                  />
                </div>
              </Suspense>
            </TabsContent>

            <TabsContent value="map" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading map visualization</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" role="img" aria-label={`Interactive geographic map showing ${mapData.length} languages plotted by their geographic location. Use map controls to zoom and pan. Supports touch gestures on mobile devices.`}>
                  <EnhancedLanguageMapView
                    onFeatureSelect={(id) => handleNodeClick(id, 'language')}
                    selectedFeatureId={vizState.selectedLanguageIds.size > 0 ? Array.from(vizState.selectedLanguageIds)[0] : null}
                  />
                </div>
              </Suspense>
            </TabsContent>

            <TabsContent value="explorer" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading cross-domain explorer</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" aria-label="Cross-domain explorer for correlating linguistic, cultural, and geographic data across languages.">
                  <CrossDomainExplorer />
                </div>
              </Suspense>
            </TabsContent>

            <TabsContent value="contribute" className="mt-0">
              <Suspense
                fallback={
                  <div className="w-full h-[400px] md:h-[600px] flex items-center justify-center bg-gray-50 rounded-lg" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
                    <span className="sr-only">Loading contribution panel</span>
                  </div>
                }
              >
                <div className="w-full h-[400px] md:h-[600px]" aria-label="Contribute new language data and corrections to the database.">
                  <ContributionPanel />
                </div>
              </Suspense>
            </TabsContent>
          </div>

          {/* Statistics footer */}
          <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-sm text-gray-600">
            <div>
              <span className="font-medium">{networkData.nodes.filter((n) => n.type === 'family').length}</span> families
            </div>
            <div>
              <span className="font-medium">{networkData.nodes.filter((n) => n.type === 'language').length}</span> languages
            </div>
            {timelineData.length > 0 && (
              <div>
                <span className="font-medium">{timelineData.length}</span> with temporal data
              </div>
            )}
            {mapData.length > 0 && (
              <div>
                <span className="font-medium">{mapData.length}</span> with geographic data
              </div>
            )}
            {state.selectedLanguageIds.size > 0 && (
              <div className="ml-auto">
                <span className="font-medium text-blue-600">{state.selectedLanguageIds.size}</span> selected
              </div>
            )}
          </div>
        </Tabs>
      </div>
    </Card>
  );
}

// Main component wrapped in VisualizationProvider
export function LanguageFamilyVisualization(props: LanguageFamilyVisualizationProps) {
  return (
    <VisualizationProvider>
      <LanguageFamilyVisualizationContent {...props} />
    </VisualizationProvider>
  );
}
