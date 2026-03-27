import React, { useRef, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { ParallelCoordinates, type ParallelAxis, type ParallelDatum } from './shared/ParallelCoordinates';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { TooltipData } from '../../lib/visualization/types';

interface Correlation {
  haplogroupId: string;
  haplogroupName: string;
  haplogroupType: string;
  languageFamilyId: string;
  languageFamilyName: string;
  overlapScore: number;
  sharedRegions: string[];
  divergence: string | null;
}

interface CorrelationResponse {
  correlations: Correlation[];
  divergences: { haplogroupName: string; languageFamilyName: string; annotation: string }[];
  summary: string;
}

const HAPLOGROUP_TYPE_COLORS: Record<string, string> = {
  'Y-DNA': '#3b82f6',
  'mtDNA': '#ec4899',
};

const AXES: ParallelAxis[] = [
  { key: 'haplogroupType', label: 'Haplogroup Type', type: 'ordinal', domain: ['Y-DNA', 'mtDNA'] },
  { key: 'overlapScore', label: 'Overlap Score', type: 'numeric', domain: [0, 1] },
  { key: 'sharedRegionCount', label: 'Shared Regions', type: 'numeric' },
  { key: 'hasDivergence', label: 'Divergence', type: 'ordinal', domain: ['Yes', 'No'] },
  { key: 'languageFamily', label: 'Language Family', type: 'ordinal' },
];

function correlationsToParallelData(correlations: Correlation[]): ParallelDatum[] {
  return correlations.map(c => ({
    id: `${c.haplogroupId}__${c.languageFamilyId}`,
    label: `${c.haplogroupName} ↔ ${c.languageFamilyName}`,
    category: c.haplogroupType,
    values: {
      haplogroupType: c.haplogroupType,
      overlapScore: c.overlapScore,
      sharedRegionCount: c.sharedRegions.length,
      hasDivergence: c.divergence ? 'Yes' : 'No',
      languageFamily: c.languageFamilyName,
    },
  }));
}

export function GeneticLinguisticParallelView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const [tooltip, setTooltip] = useState<{ data: TooltipData; x: number; y: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const { data: response, isLoading, error } = useQuery<CorrelationResponse>({
    queryKey: ['genetic-linguistic-correlations'],
    queryFn: async () => {
      const res = await fetch('/api/genetic-linguistic-correlations');
      if (!res.ok) throw new Error('Failed to fetch correlations');
      return res.json();
    },
  });

  const filteredCorrelations = useMemo(() => {
    if (!response?.correlations) return [];
    if (filterType === 'all') return response.correlations;
    return response.correlations.filter(c =>
      c.haplogroupType.toLowerCase().replace('-', '') === filterType.toLowerCase().replace('-', '')
    );
  }, [response, filterType]);

  const parallelData = useMemo(
    () => correlationsToParallelData(filteredCorrelations),
    [filteredCorrelations]
  );

  // Build axes with dynamic language family domain
  const dynamicAxes = useMemo(() => {
    const families = Array.from(new Set(filteredCorrelations.map(c => c.languageFamilyName))).sort();
    return AXES.map(a =>
      a.key === 'languageFamily' ? { ...a, domain: families } : a
    );
  }, [filteredCorrelations]);

  const handleLineHover = useCallback((datum: ParallelDatum | null) => {
    if (!datum) {
      setTooltip(null);
      setHighlightedId(null);
      return;
    }
    setHighlightedId(datum.id);
    const correlation = filteredCorrelations.find(
      c => `${c.haplogroupId}__${c.languageFamilyId}` === datum.id
    );
    if (!correlation) return;

    setTooltip({
      data: {
        id: datum.id,
        name: datum.label,
        type: 'family',
        region: correlation.sharedRegions.join(', '),
        haplogroupType: correlation.haplogroupType,
        overlapScore: `${(correlation.overlapScore * 100).toFixed(0)}%`,
        ...(correlation.divergence ? { divergence: correlation.divergence } : {}),
      },
      x: 0,
      y: 0,
    });
  }, [filteredCorrelations]);

  // Track mouse for tooltip positioning
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY - 20 } : null);
  }, []);

  if (isLoading) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading genetic-linguistic correlations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center min-h-[400px]">
        <div className="text-red-500">Error loading data: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full min-h-[400px] relative" onMouseMove={handleMouseMove}>
      {/* Controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-2 items-center text-sm">
        <label className="text-gray-600 dark:text-gray-400">Filter:</label>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600"
        >
          <option value="all">All</option>
          <option value="ydna">Y-DNA</option>
          <option value="mtdna">mtDNA</option>
        </select>
        <div className="flex gap-3 ml-4">
          {Object.entries(HAPLOGROUP_TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-600 dark:text-gray-400">{type}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Summary */}
      {response?.summary && (
        <div className="absolute top-2 left-2 z-10 text-xs text-gray-500 dark:text-gray-400 max-w-md">
          {response.summary}
        </div>
      )}

      {/* Divergences badge */}
      {response?.divergences && response.divergences.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10 text-xs bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded px-2 py-1 max-w-sm">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            {response.divergences.length} notable divergence{response.divergences.length > 1 ? 's' : ''}
          </span>
          {' — '}
          <span className="text-amber-600 dark:text-amber-400">
            Brush the Divergence axis to isolate
          </span>
        </div>
      )}

      {/* Chart */}
      <ParallelCoordinates
        axes={dynamicAxes}
        data={parallelData}
        width={width}
        height={Math.max(height, 400)}
        colorByCategory
        categoryColors={HAPLOGROUP_TYPE_COLORS}
        onLineHover={handleLineHover}
        highlightedId={highlightedId}
      />

      {/* Tooltip */}
      <VisualizationTooltip
        data={tooltip?.data ?? null}
        x={tooltip?.x ?? 0}
        y={tooltip?.y ?? 0}
        visible={!!tooltip}
      />
    </div>
  );
}
