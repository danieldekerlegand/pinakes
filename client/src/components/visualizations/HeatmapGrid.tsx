import React, { useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { exportSVG, exportPNG } from '../../lib/visualization/export-utils';
import { Download } from 'lucide-react';

export interface HeatmapCell {
  row: number;
  col: number;
  value: number | null;
  label?: string;
}

export interface HeatmapGridProps {
  /** Matrix of numeric values (rows x cols). null indicates missing data. */
  data: (number | null)[][];
  /** Labels for each row */
  rowLabels: string[];
  /** Labels for each column */
  columnLabels: string[];
  /** Color scheme: 'sequential' for 0-to-max, 'diverging' for negative-to-positive */
  colorScheme?: 'sequential' | 'diverging';
  /** Custom color range [low, high] for sequential or [low, mid, high] for diverging */
  colorRange?: string[];
  /** Called when a cell is clicked */
  onCellClick?: (cell: HeatmapCell) => void;
  /** Whether to show values inside cells */
  showValues?: boolean;
  /** Format function for cell display values */
  formatValue?: (value: number) => string;
  /** Optional title */
  title?: string;
  /** Custom className for the container */
  className?: string;
  /** Minimum and maximum domain values (auto-derived from data if not provided) */
  domain?: [number, number];
}

const MARGIN = { top: 80, right: 20, bottom: 20, left: 120 };
const MIN_CELL_SIZE = 14;
const MAX_CELL_SIZE = 60;

export function HeatmapGrid({
  data,
  rowLabels,
  columnLabels,
  colorScheme = 'sequential',
  colorRange,
  onCellClick,
  showValues = false,
  formatValue = (v) => v.toFixed(1),
  title,
  className = '',
  domain,
}: HeatmapGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width } = useVisualizationResize(containerRef);

  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const numRows = data.length;
  const numCols = data[0]?.length ?? 0;

  const { colorScale, minVal, maxVal } = useMemo(() => {
    const flat = data.flat().filter((v): v is number => v !== null);
    if (flat.length === 0) {
      return {
        colorScale: () => '#e5e7eb',
        minVal: 0,
        maxVal: 0,
      };
    }
    const min = domain?.[0] ?? d3.min(flat)!;
    const max = domain?.[1] ?? d3.max(flat)!;

    if (colorScheme === 'diverging') {
      const absMax = Math.max(Math.abs(min), Math.abs(max));
      const colors = colorRange ?? ['#2563eb', '#f5f5f5', '#dc2626'];
      const scale = d3.scaleLinear<string>()
        .domain([-absMax, 0, absMax])
        .range(colors)
        .clamp(true);
      return { colorScale: scale as (v: number) => string, minVal: -absMax, maxVal: absMax };
    }

    const colors = colorRange ?? ['#f0f9ff', '#1e40af'];
    const scale = d3.scaleLinear<string>()
      .domain([min, max])
      .range(colors)
      .clamp(true);
    return { colorScale: scale as (v: number) => string, minVal: min, maxVal: max };
  }, [data, colorScheme, colorRange, domain]);

  // Compute cell size based on available width
  const cellSize = useMemo(() => {
    if (width === 0 || numCols === 0) return MIN_CELL_SIZE;
    const availableWidth = width - MARGIN.left - MARGIN.right;
    const size = Math.floor(availableWidth / numCols);
    return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, size));
  }, [width, numCols]);

  const svgWidth = MARGIN.left + numCols * cellSize + MARGIN.right;
  const svgHeight = MARGIN.top + numRows * cellSize + MARGIN.bottom;

  const handleMouseEnter = useCallback(
    (row: number, col: number, e: React.MouseEvent) => {
      const value = data[row][col];
      setHoveredCell({
        row,
        col,
        value,
        label: `${rowLabels[row]} / ${columnLabels[col]}`,
      });
      setTooltipPos({ x: e.clientX, y: e.clientY });
    },
    [data, rowLabels, columnLabels],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!onCellClick) return;
      onCellClick({
        row,
        col,
        value: data[row][col],
        label: `${rowLabels[row]} / ${columnLabels[col]}`,
      });
    },
    [onCellClick, data, rowLabels, columnLabels],
  );

  const handleExportSVG = () => {
    if (svgRef.current) exportSVG(svgRef.current, 'heatmap.svg');
  };

  const handleExportPNG = () => {
    if (svgRef.current) exportPNG(svgRef.current, 'heatmap.png');
  };

  // Compute font size for cell text
  const cellFontSize = Math.max(8, Math.min(12, cellSize * 0.4));
  const labelFontSize = Math.max(9, Math.min(12, cellSize * 0.5));

  if (numRows === 0 || numCols === 0) {
    return (
      <div className={`flex items-center justify-center h-48 text-gray-400 ${className}`}>
        No data available
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Header with title and export */}
      <div className="flex items-center justify-between mb-2">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <div className="flex gap-1">
          <button
            onClick={handleExportSVG}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            title="Export SVG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleExportPNG}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            title="Export PNG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* SVG Heatmap */}
      <div className="overflow-auto">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          className="select-none"
        >
          {/* Column labels */}
          {columnLabels.map((label, i) => (
            <text
              key={`col-${i}`}
              x={MARGIN.left + i * cellSize + cellSize / 2}
              y={MARGIN.top - 8}
              textAnchor="end"
              transform={`rotate(-45, ${MARGIN.left + i * cellSize + cellSize / 2}, ${MARGIN.top - 8})`}
              className="fill-gray-600 dark:fill-gray-400"
              fontSize={labelFontSize}
            >
              {label.length > 15 ? label.slice(0, 14) + '\u2026' : label}
            </text>
          ))}

          {/* Row labels */}
          {rowLabels.map((label, i) => (
            <text
              key={`row-${i}`}
              x={MARGIN.left - 8}
              y={MARGIN.top + i * cellSize + cellSize / 2}
              textAnchor="end"
              dominantBaseline="central"
              className="fill-gray-600 dark:fill-gray-400"
              fontSize={labelFontSize}
            >
              {label.length > 15 ? label.slice(0, 14) + '\u2026' : label}
            </text>
          ))}

          {/* Cells */}
          {data.map((row, ri) =>
            row.map((value, ci) => {
              const x = MARGIN.left + ci * cellSize;
              const y = MARGIN.top + ri * cellSize;
              const isHovered =
                hoveredCell?.row === ri && hoveredCell?.col === ci;

              return (
                <g key={`${ri}-${ci}`}>
                  <rect
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    fill={value !== null ? colorScale(value) : '#e5e7eb'}
                    stroke={isHovered ? '#111' : '#fff'}
                    strokeWidth={isHovered ? 2 : 0.5}
                    rx={1}
                    className={onCellClick ? 'cursor-pointer' : ''}
                    onMouseEnter={(e) => handleMouseEnter(ri, ci, e)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleCellClick(ri, ci)}
                  />
                  {showValues && value !== null && cellSize >= 24 && (
                    <text
                      x={x + cellSize / 2}
                      y={y + cellSize / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={cellFontSize}
                      className="fill-gray-900 dark:fill-gray-100 pointer-events-none"
                      style={{ mixBlendMode: 'difference' }}
                    >
                      {formatValue(value)}
                    </text>
                  )}
                </g>
              );
            }),
          )}

          {/* Legend */}
          <defs>
            <linearGradient id="heatmap-legend-gradient" x1="0" x2="1" y1="0" y2="0">
              {colorScheme === 'diverging' ? (
                <>
                  <stop offset="0%" stopColor={colorRange?.[0] ?? '#2563eb'} />
                  <stop offset="50%" stopColor={colorRange?.[1] ?? '#f5f5f5'} />
                  <stop offset="100%" stopColor={colorRange?.[2] ?? '#dc2626'} />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor={colorRange?.[0] ?? '#f0f9ff'} />
                  <stop offset="100%" stopColor={colorRange?.[1] ?? '#1e40af'} />
                </>
              )}
            </linearGradient>
          </defs>
          <rect
            x={MARGIN.left}
            y={svgHeight - MARGIN.bottom + 4}
            width={Math.min(200, numCols * cellSize)}
            height={8}
            fill="url(#heatmap-legend-gradient)"
            rx={2}
          />
          <text
            x={MARGIN.left}
            y={svgHeight - MARGIN.bottom + 20}
            fontSize={9}
            className="fill-gray-500"
          >
            {formatValue(minVal)}
          </text>
          <text
            x={MARGIN.left + Math.min(200, numCols * cellSize)}
            y={svgHeight - MARGIN.bottom + 20}
            textAnchor="end"
            fontSize={9}
            className="fill-gray-500"
          >
            {formatValue(maxVal)}
          </text>
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredCell && (
        <div
          className="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 text-xs"
          style={{
            left: `${tooltipPos.x + 12}px`,
            top: `${tooltipPos.y - 12}px`,
          }}
        >
          <div className="font-semibold">{hoveredCell.label}</div>
          <div className="text-gray-500 mt-0.5">
            {hoveredCell.value !== null
              ? `Value: ${formatValue(hoveredCell.value)}`
              : 'No data'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Phoneme Heatmap Grid (table-based) ─── */

export interface PhonemeHeatmapCell {
  value: number;
  label: string;
  items: { text: string; colorIndex: number }[];
}

export interface PhonemeHeatmapGridProps {
  rows: readonly string[];
  columns: readonly string[];
  data: Record<string, Record<string, PhonemeHeatmapCell>>;
  colors: string[];
  highlightCells?: Set<string>;
  cornerLabel?: string;
}

function cellKey(row: string, col: string) {
  return `${row}|${col}`;
}

export function PhonemeHeatmapGrid({
  rows,
  columns,
  data,
  colors,
  highlightCells,
  cornerLabel = "",
}: PhonemeHeatmapGridProps) {
  const maxValue = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      for (const col of columns) {
        const cell = data[row]?.[col];
        if (cell && cell.value > max) max = cell.value;
      }
    }
    return max;
  }, [rows, columns, data]);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="border border-gray-300 px-1 py-1 bg-gray-50 text-left min-w-[80px]">
              {cornerLabel}
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="border border-gray-300 px-1 py-1 bg-gray-50 text-center"
                style={{ minWidth: "60px" }}
              >
                <span className="text-[10px] leading-tight block">{col}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="border border-gray-300 px-1 py-1 bg-gray-50 font-medium text-[10px]">
                {row}
              </td>
              {columns.map((col) => {
                const cell = data[row]?.[col];
                const isHighlighted =
                  highlightCells && cell && cell.items.length > 0 &&
                  highlightCells.has(cellKey(row, col));
                const intensity = cell && maxValue > 0 ? cell.value / maxValue : 0;

                return (
                  <td
                    key={col}
                    className={`border border-gray-300 px-1 py-1 text-center ${
                      isHighlighted ? "bg-yellow-50" : ""
                    }`}
                    style={
                      !isHighlighted && intensity > 0
                        ? { backgroundColor: `rgba(59, 130, 246, ${intensity * 0.1})` }
                        : undefined
                    }
                  >
                    {cell && cell.items.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {cell.items.map((item, i) => (
                          <span
                            key={`${item.text}-${item.colorIndex}-${i}`}
                            className={`inline-block rounded px-0.5 text-white text-[11px] font-mono ${
                              colors[item.colorIndex] || "bg-gray-500"
                            }`}
                            title={item.text}
                          >
                            {item.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
