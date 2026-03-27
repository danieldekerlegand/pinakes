import React, { useRef, useState, useCallback } from 'react';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { VisualizationTooltip } from './VisualizationTooltip';
import { ExportMenu } from './ExportMenu';
import type { TooltipData } from '../../../lib/visualization/types';

export interface TooltipState {
  data: TooltipData | null;
  x: number;
  y: number;
  visible: boolean;
}

const INITIAL_TOOLTIP: TooltipState = {
  data: null,
  x: 0,
  y: 0,
  visible: false,
};

export interface VisualizationContainerProps {
  /** The current view name, used for export filenames */
  currentView: string;
  /** Interaction hint shown at bottom-left (e.g. "Scroll to zoom") */
  interactionHint?: string;
  /** Optional data passed to ExportMenu for CSV/JSON export */
  exportData?: any;
  /** Whether to show the export menu (default: true) */
  showExport?: boolean;
  /** Optional loading state */
  loading?: boolean;
  /** Optional empty state message */
  emptyMessage?: string;
  /** Whether data is empty */
  isEmpty?: boolean;
  /** Additional className for the outer container */
  className?: string;
  /** Render function receiving container dimensions, refs, and tooltip helpers */
  children: (context: VisualizationRenderContext) => React.ReactNode;
}

export interface VisualizationRenderContext {
  width: number;
  height: number;
  containerRef: React.RefObject<HTMLDivElement>;
  svgRef: React.RefObject<SVGSVGElement>;
  tooltip: TooltipState;
  showTooltip: (data: TooltipData, x: number, y: number) => void;
  moveTooltip: (x: number, y: number) => void;
  hideTooltip: () => void;
}

export function VisualizationContainer({
  currentView,
  interactionHint,
  exportData,
  showExport = true,
  loading = false,
  emptyMessage = 'No data available',
  isEmpty = false,
  className,
  children,
}: VisualizationContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const svgRef = useRef<SVGSVGElement>(null!);
  const { width, height } = useVisualizationResize(containerRef);
  const [tooltip, setTooltip] = useState<TooltipState>(INITIAL_TOOLTIP);

  const showTooltip = useCallback((data: TooltipData, x: number, y: number) => {
    setTooltip({ data, x, y, visible: true });
  }, []);

  const moveTooltip = useCallback((x: number, y: number) => {
    setTooltip((prev) => ({ ...prev, x, y }));
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  const context: VisualizationRenderContext = {
    width,
    height,
    containerRef,
    svgRef,
    tooltip,
    showTooltip,
    moveTooltip,
    hideTooltip,
  };

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative bg-gray-50 rounded-lg ${className ?? ''}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10 rounded-lg">
          <div className="text-sm text-gray-500">Loading visualization...</div>
        </div>
      )}

      {isEmpty && !loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg">
          <div className="text-sm text-gray-500">{emptyMessage}</div>
        </div>
      )}

      {!loading && !isEmpty && children(context)}

      {showExport && (
        <div className="absolute top-3 right-3 z-10">
          <ExportMenu svgRef={svgRef} data={exportData} currentView={currentView} />
        </div>
      )}

      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />

      {interactionHint && (
        <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
          {interactionHint}
        </div>
      )}
    </div>
  );
}
