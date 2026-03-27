import React, { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { NetworkGraph } from './NetworkGraph';
import type { NetworkNode, NetworkLink, TooltipData } from '../../lib/visualization/types';
import {
  buildDeityNetwork,
  filterDeityNetwork,
  type DeityData,
} from '../../lib/visualization/deity-network-transformer';

const PANTHEON_COLORS: Record<string, string> = {
  greek: '#3b82f6',
  roman: '#ef4444',
  norse: '#6366f1',
  hindu: '#f59e0b',
  egyptian: '#d97706',
  mesopotamian: '#8b5cf6',
  japanese: '#ec4899',
  aztec: '#10b981',
  slavic: '#06b6d4',
  celtic: '#84cc16',
  sumerian: '#a855f7',
};

function getPantheonColor(group: string): string {
  return PANTHEON_COLORS[group] ?? '#6b7280';
}

interface DeityPantheonGraphProps {
  onDeitySelect?: (deityId: string) => void;
}

export function DeityPantheonGraph({ onDeitySelect }: DeityPantheonGraphProps) {
  const [selectedPantheons, setSelectedPantheons] = useState<Set<string>>(new Set());

  const { data: deitiesResponse, isLoading } = useQuery<{ deities: DeityData[]; count: number }>({
    queryKey: ['/api/deities'],
    staleTime: 5 * 60 * 1000,
  });

  const deities = deitiesResponse?.deities ?? [];

  const fullNetwork = useMemo(() => buildDeityNetwork(deities), [deities]);

  const filteredNetwork = useMemo(
    () => filterDeityNetwork(fullNetwork, selectedPantheons.size > 0 ? selectedPantheons : null),
    [fullNetwork, selectedPantheons],
  );

  const togglePantheon = useCallback((pantheon: string) => {
    setSelectedPantheons((prev) => {
      const next = new Set(prev);
      if (next.has(pantheon)) {
        next.delete(pantheon);
      } else {
        next.add(pantheon);
      }
      return next;
    });
  }, []);

  const nodeColor = useCallback((node: NetworkNode) => getPantheonColor(node.group), []);

  const nodeStroke = useCallback(
    (node: NetworkNode) => (node.type === 'family' ? '#1f2937' : '#fff'),
    [],
  );

  const linkColor = useCallback(
    (link: NetworkLink) => (link.type === 'language-family' ? '#f59e0b' : '#cbd5e0'),
    [],
  );

  const linkDasharray = useCallback(
    (link: NetworkLink) => (link.type === 'language-family' ? '4 3' : undefined),
    [],
  );

  const linkWidth = useCallback(
    (link: NetworkLink) => (link.type === 'language-family' ? 1.5 : 1),
    [],
  );

  const tooltipContent = useCallback(
    (node: NetworkNode): TooltipData => {
      if (node.type === 'family') {
        const count = deities.filter((d) => d.mythology === node.group).length;
        return {
          id: node.id,
          name: node.name,
          type: 'family',
          languageCount: count,
        };
      }
      const deity = deities.find((d) => d.id === node.id);
      return {
        id: node.id,
        name: node.name,
        type: 'language',
        familyName: node.group.charAt(0).toUpperCase() + node.group.slice(1),
        region: deity?.domain.join(', '),
      };
    },
    [deities],
  );

  const handleNodeClick = useCallback(
    (node: NetworkNode) => {
      if (node.type === 'family') {
        togglePantheon(node.group);
      } else if (onDeitySelect) {
        onDeitySelect(node.id);
      }
    },
    [togglePantheon, onDeitySelect],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500">Loading deity data...</span>
      </div>
    );
  }

  if (deities.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No deity data available. Run the mythology scraper to populate data.
      </div>
    );
  }

  const syncretismCount = filteredNetwork.links.filter((l) => l.type === 'language-family').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header & pantheon filter chips */}
      <div className="p-3 border-b space-y-2">
        <h3 className="text-lg font-semibold">Deity Pantheon Network</h3>
        <div className="flex flex-wrap gap-1.5">
          {fullNetwork.pantheons.map((p) => {
            const active = selectedPantheons.size === 0 || selectedPantheons.has(p);
            return (
              <button
                key={p}
                className="px-2.5 py-0.5 rounded-full text-xs border capitalize transition-opacity"
                style={{
                  backgroundColor: active ? getPantheonColor(p) : 'transparent',
                  color: active ? '#fff' : '#6b7280',
                  borderColor: getPantheonColor(p),
                  opacity: active ? 1 : 0.5,
                }}
                onClick={() => togglePantheon(p)}
              >
                {p}
              </button>
            );
          })}
          {selectedPantheons.size > 0 && (
            <button
              className="px-2.5 py-0.5 rounded-full text-xs border text-gray-500"
              onClick={() => setSelectedPantheons(new Set())}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 min-h-0">
        <NetworkGraph
          data={filteredNetwork}
          nodeColor={nodeColor}
          nodeStroke={nodeStroke}
          linkColor={linkColor}
          linkDasharray={linkDasharray}
          linkWidth={linkWidth}
          tooltipContent={tooltipContent}
          showLabels={filteredNetwork.nodes.length < 40}
          linkDistance={120}
          chargeStrength={-400}
          onNodeClick={handleNodeClick}
          statusText={`${deities.length} deities • ${fullNetwork.pantheons.length} pantheons • ${syncretismCount} syncretism links`}
        />
      </div>

      {/* Legend */}
      <div className="p-2 border-t flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-gray-400" /> Pantheon membership
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-amber-500" /> Syncretism link
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-gray-300 border border-gray-800" style={{ width: 10, height: 10 }} /> Pantheon hub
        </span>
      </div>
    </div>
  );
}

export default DeityPantheonGraph;
