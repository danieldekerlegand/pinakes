import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SankeyDiagramVisualization } from './SankeyDiagramVisualization';
import { ChordDiagramVisualization } from './ChordDiagramVisualization';
import type { SankeyData, ChordData } from '@contracts/types';

type ViewMode = 'sankey' | 'chord';

export function CulturalInfluencePanel() {
  const [viewMode, setViewMode] = useState<ViewMode>('sankey');
  const [yearStart, setYearStart] = useState<number | undefined>(undefined);
  const [yearEnd, setYearEnd] = useState<number | undefined>(undefined);

  const queryParams = new URLSearchParams();
  if (yearStart !== undefined) queryParams.set('yearStart', String(yearStart));
  if (yearEnd !== undefined) queryParams.set('yearEnd', String(yearEnd));
  const qs = queryParams.toString();

  const { data: sankeyData, isLoading: sankeyLoading } = useQuery<SankeyData>({
    queryKey: ['/api/visualizations/sankey', qs],
    queryFn: async () => {
      const res = await fetch(`/api/visualizations/sankey${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to fetch sankey data');
      return res.json();
    },
    enabled: viewMode === 'sankey',
  });

  const { data: chordData, isLoading: chordLoading } = useQuery<ChordData>({
    queryKey: ['/api/visualizations/chord', qs],
    queryFn: async () => {
      const res = await fetch(`/api/visualizations/chord${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to fetch chord data');
      return res.json();
    },
    enabled: viewMode === 'chord',
  });

  const isLoading = viewMode === 'sankey' ? sankeyLoading : chordLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b bg-white">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={function () { setViewMode('sankey'); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === 'sankey'
                ? 'bg-white shadow-sm text-gray-900 font-medium'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Sankey Flow
          </button>
          <button
            onClick={function () { setViewMode('chord'); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === 'chord'
                ? 'bg-white shadow-sm text-gray-900 font-medium'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Chord Diagram
          </button>
        </div>

        <div className="h-5 w-px bg-gray-300" />

        {/* Temporal filter */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Period:</span>
          <input
            type="number"
            placeholder="From year"
            value={yearStart ?? ''}
            onChange={function (e) {
              setYearStart(e.target.value ? parseInt(e.target.value, 10) : undefined);
            }}
            className="w-24 px-2 py-1 border rounded text-sm"
          />
          <span className="text-gray-400">to</span>
          <input
            type="number"
            placeholder="To year"
            value={yearEnd ?? ''}
            onChange={function (e) {
              setYearEnd(e.target.value ? parseInt(e.target.value, 10) : undefined);
            }}
            className="w-24 px-2 py-1 border rounded text-sm"
          />
          {(yearStart !== undefined || yearEnd !== undefined) && (
            <button
              onClick={function () { setYearStart(undefined); setYearEnd(undefined); }}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Visualization area */}
      <div className="flex-1 min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading visualization...
          </div>
        )}
        {!isLoading && viewMode === 'sankey' && sankeyData && (
          <SankeyDiagramVisualization data={sankeyData} />
        )}
        {!isLoading && viewMode === 'chord' && chordData && (
          <ChordDiagramVisualization data={chordData} />
        )}
        {!isLoading && viewMode === 'sankey' && sankeyData && !sankeyData.nodes.length && (
          <div className="flex items-center justify-center h-full text-gray-500">
            No language contact data found for the selected period.
          </div>
        )}
        {!isLoading && viewMode === 'chord' && chordData && !chordData.names.length && (
          <div className="flex items-center justify-center h-full text-gray-500">
            No inter-family influence data found for the selected period.
          </div>
        )}
      </div>
    </div>
  );
}
