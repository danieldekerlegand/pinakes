import React from 'react';
import { formatNumber } from '../../../lib/visualization/d3-helpers';
import type { TooltipData } from '../../../lib/visualization/types';

interface VisualizationTooltipProps {
  data: TooltipData | null;
  x: number;
  y: number;
  visible: boolean;
}

export function VisualizationTooltip({ data, x, y, visible }: VisualizationTooltipProps) {
  if (!visible || !data) return null;

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-w-sm">
        <div className="space-y-1.5">
          <div>
            <h4 className="font-semibold text-sm">{data.name}</h4>
            {data.nativeName && (
              <p className="text-xs text-gray-600 dark:text-gray-400">({data.nativeName})</p>
            )}
          </div>

          <div className="text-xs space-y-0.5">
            {data.type && (
              <div className="flex justify-between">
                <span className="text-gray-500">Type:</span>
                <span className="font-medium capitalize">{data.type}</span>
              </div>
            )}

            {data.familyName && (
              <div className="flex justify-between">
                <span className="text-gray-500">Family:</span>
                <span className="font-medium">{data.familyName}</span>
              </div>
            )}

            {data.region && (
              <div className="flex justify-between">
                <span className="text-gray-500">Region:</span>
                <span className="font-medium">{data.region}</span>
              </div>
            )}

            {data.status && (
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                <span className="font-medium capitalize">{data.status}</span>
              </div>
            )}

            {data.totalSpeakers !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Speakers:</span>
                <span className="font-medium">{formatNumber(data.totalSpeakers)}</span>
              </div>
            )}

            {data.nativeSpeakers !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Native:</span>
                <span className="font-medium">{formatNumber(data.nativeSpeakers)}</span>
              </div>
            )}

            {data.languageCount !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Languages:</span>
                <span className="font-medium">{data.languageCount}</span>
              </div>
            )}

            {data.timeOrigin && (
              <div className="flex justify-between">
                <span className="text-gray-500">Origin:</span>
                <span className="font-medium">{data.timeOrigin}</span>
              </div>
            )}

            {data.coordinates && (
              <div className="flex justify-between">
                <span className="text-gray-500">Coordinates:</span>
                <span className="font-medium text-xs">
                  {data.coordinates.lat.toFixed(2)}, {data.coordinates.lng.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
