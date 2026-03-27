import React, { useMemo, useCallback } from 'react';
import { useVisualization } from '../../contexts/VisualizationContext';
import { useNodePinning } from './hooks/useD3Simulation';
import { NetworkGraph } from './NetworkGraph';
import type { NetworkData } from '../../lib/visualization/types';
import type { GraphNode, GraphLink } from '../../lib/visualization/network-graph-types';
import { formatNumber, getFamilyColor } from '../../lib/visualization/d3-helpers';

interface LanguageNetworkNode extends GraphNode {
  type: 'family' | 'language';
  name: string;
  level: number;
  totalSpeakers?: number;
  region?: string;
  status?: string;
}

interface LanguageNetworkLink extends GraphLink {
  type: 'family-child' | 'language-family' | 'language-parent';
}

interface LanguageNetworkViewProps {
  networkData: NetworkData;
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
}

export function LanguageNetworkView({ networkData, onNodeClick }: LanguageNetworkViewProps) {
  const { state, isLanguageSelected, isHighlighted } = useVisualization();
  const { togglePin, isPinned } = useNodePinning();

  // Map NetworkData to GraphData with label field
  const graphData = useMemo(() => {
    const nodes: LanguageNetworkNode[] = networkData.nodes.map((n) => ({
      ...n,
      label: n.name,
    }));
    const links: LanguageNetworkLink[] = networkData.links as LanguageNetworkLink[];
    return { nodes, links };
  }, [networkData]);

  const simulationConfig = useMemo(() => ({
    linkDistance: state.viewSettings.network.linkDistance,
    chargeStrength: state.viewSettings.network.chargeStrength,
  }), [state.viewSettings.network.linkDistance, state.viewSettings.network.chargeStrength]);

  const showLabels = state.viewSettings.network.showLabels;

  // Language-specific styling
  const nodeColor = useCallback((node: LanguageNetworkNode) => {
    const selected = node.type === 'language' && isLanguageSelected(node.id);
    const highlighted = isHighlighted(node.id);
    if (selected || highlighted) return '#3b82f6';
    return getFamilyColor(node.group ?? '');
  }, [isLanguageSelected, isHighlighted]);

  const nodeRadius = useCallback((node: LanguageNetworkNode) => node.size ?? 6, []);

  const nodeStroke = useCallback((node: LanguageNetworkNode) => {
    const selected = node.type === 'language' && isLanguageSelected(node.id);
    if (selected) return '#1d4ed8';
    if (isPinned(node.id)) return '#ef4444';
    return '#ffffff';
  }, [isLanguageSelected, isPinned]);

  const nodeStrokeWidth = useCallback((node: LanguageNetworkNode) => {
    const selected = node.type === 'language' && isLanguageSelected(node.id);
    if (selected || isPinned(node.id)) return 3;
    return 2;
  }, [isLanguageSelected, isPinned]);

  const linkWidth = useCallback((link: LanguageNetworkLink) =>
    link.type === 'family-child' ? 2 : 1, []);

  const shouldShowLabel = useCallback((node: LanguageNetworkNode) =>
    node.type === 'family' || showLabels, [showLabels]);

  const labelFont = useCallback((node: LanguageNetworkNode) =>
    node.type === 'family' ? '600 12px sans-serif' : '400 10px sans-serif', []);

  const handleNodeClick = useCallback((node: LanguageNetworkNode) => {
    onNodeClick?.(node.id, node.type);
  }, [onNodeClick]);

  const handleNodeDoubleClick = useCallback((node: LanguageNetworkNode) => {
    const pinState = togglePin(node.id, node.x, node.y);
    node.fx = pinState.fx;
    node.fy = pinState.fy;
  }, [togglePin]);

  const renderTooltip = useCallback((node: LanguageNetworkNode) => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-w-sm">
      <div className="space-y-1.5">
        <h4 className="font-semibold text-sm">{node.name}</h4>
        <div className="text-xs space-y-0.5">
          {node.type && (
            <div className="flex justify-between">
              <span className="text-gray-500">Type:</span>
              <span className="font-medium capitalize">{node.type}</span>
            </div>
          )}
          {node.region && (
            <div className="flex justify-between">
              <span className="text-gray-500">Region:</span>
              <span className="font-medium">{node.region}</span>
            </div>
          )}
          {node.status && (
            <div className="flex justify-between">
              <span className="text-gray-500">Status:</span>
              <span className="font-medium capitalize">{node.status}</span>
            </div>
          )}
          {node.totalSpeakers !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-500">Speakers:</span>
              <span className="font-medium">{formatNumber(node.totalSpeakers)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  ), []);

  return (
    <NetworkGraph<LanguageNetworkNode, LanguageNetworkLink>
      data={graphData}
      nodeColor={nodeColor}
      nodeRadius={nodeRadius}
      nodeStroke={nodeStroke}
      nodeStrokeWidth={nodeStrokeWidth}
      linkWidth={linkWidth}
      showLabel={shouldShowLabel}
      labelFont={labelFont}
      labelColor="#374151"
      simulationConfig={simulationConfig}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      renderTooltip={renderTooltip}
    />
  );
}
