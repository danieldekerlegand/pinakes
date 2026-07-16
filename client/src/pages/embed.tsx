import { useMemo, Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { VisualizationProvider, useVisualization } from '../contexts/VisualizationContext';
import {
  transformToTreeData,
  transformToNetworkData,
  transformToTimelineData,
  transformToMapData,
} from '../lib/visualization/data-transformers';
import type { ViewMode } from '../lib/visualization/types';
import type { LanguageFamilyWithChildren } from '@shared/types';

const LanguageTreeView = lazy(() =>
  import('../components/visualizations/LanguageTreeView').then((m) => ({ default: m.LanguageTreeView }))
);
const LanguageNetworkView = lazy(() =>
  import('../components/visualizations/LanguageNetworkView').then((m) => ({ default: m.LanguageNetworkView }))
);
const LanguageTimelineView = lazy(() =>
  import('../components/visualizations/LanguageTimelineView').then((m) => ({ default: m.LanguageTimelineView }))
);
const EnhancedLanguageMapView = lazy(() =>
  import('../components/visualizations/EnhancedLanguageMapView').then((m) => ({ default: m.EnhancedLanguageMapView }))
);
const CrossDomainExplorer = lazy(() =>
  import('../components/visualizations/CrossDomainExplorer').then((m) => ({ default: m.CrossDomainExplorer }))
);

const VALID_VIEWS: ViewMode[] = ['tree', 'network', 'timeline', 'map', 'explorer'];

function getEmbedParams() {
  const params = new URLSearchParams(window.location.search);
  const view = (params.get('view') || 'tree') as ViewMode;
  const theme = params.get('theme') || 'light';
  return {
    view: VALID_VIEWS.includes(view) ? view : 'tree',
    theme: theme === 'dark' ? 'dark' : 'light',
  };
}

function EmbedContent() {
  const { view, theme } = useMemo(getEmbedParams, []);
  const { state, setView } = useVisualization();

  // Set view on mount
  useMemo(() => {
    if (state.currentView !== view) {
      setView(view);
    }
  }, [view]);

  const { data: familyTree, isLoading, error } = useQuery<LanguageFamilyWithChildren[]>({
    queryKey: ['/api/language-families/tree'],
  });

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

  const isDark = theme === 'dark';

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !familyTree || familyTree.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
        {error ? 'Error loading data' : 'No data available'}
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex flex-col ${isDark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          }
        >
          {view === 'tree' && (
            <div className="w-full h-full">
              <LanguageTreeView treeData={treeData} onNodeClick={() => {}} />
            </div>
          )}
          {view === 'network' && (
            <div className="w-full h-full">
              <LanguageNetworkView networkData={networkData} onNodeClick={() => {}} />
            </div>
          )}
          {view === 'timeline' && (
            <div className="w-full h-full">
              <LanguageTimelineView timelineData={timelineData} onEventClick={() => {}} />
            </div>
          )}
          {view === 'map' && (
            <div className="w-full h-full">
              <EnhancedLanguageMapView onFeatureSelect={() => {}} selectedFeatureId={null} />
            </div>
          )}
          {view === 'explorer' && (
            <div className="w-full h-full">
              <CrossDomainExplorer />
            </div>
          )}
        </Suspense>
      </div>
      {/* Attribution bar */}
      <div className={`flex items-center justify-end px-3 py-1.5 text-xs border-t ${isDark ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
        Powered by pinakes
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <VisualizationProvider>
      <EmbedContent />
    </VisualizationProvider>
  );
}
