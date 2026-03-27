import React, { useMemo, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
export type { HeatmapCell } from "./heatmap-utils";
export { makeColorScale } from "./heatmap-utils";
import type { HeatmapCell } from "./heatmap-utils";

export interface HeatmapGridProps {
  rows: string[];
  columns: string[];
  cells: HeatmapCell[];
  colorScale?: (value: number) => string;
  formatValue?: (value: number) => string;
  formatTooltip?: (row: string, col: string, value: number) => string;
  onCellClick?: (row: string, col: string, value: number) => void;
  title?: string;
  description?: string;
  emptyColor?: string;
  maxHeight?: string;
  cellSize?: "sm" | "md" | "lg";
}

const DEFAULT_COLOR_SCALE = (value: number): string => {
  if (value <= 0) return "bg-gray-100 dark:bg-gray-800";
  if (value < 0.2) return "bg-blue-100 dark:bg-blue-900";
  if (value < 0.4) return "bg-blue-200 dark:bg-blue-800";
  if (value < 0.6) return "bg-blue-300 dark:bg-blue-700";
  if (value < 0.8) return "bg-blue-400 dark:bg-blue-600";
  return "bg-blue-500 dark:bg-blue-500";
};

const CELL_SIZES = {
  sm: "min-w-[2rem] h-8 text-[10px]",
  md: "min-w-[3rem] h-10 text-xs",
  lg: "min-w-[4rem] h-12 text-sm",
};

export function HeatmapGrid({
  rows,
  columns,
  cells,
  colorScale = DEFAULT_COLOR_SCALE,
  formatValue = (v) => v.toFixed(2),
  formatTooltip,
  onCellClick,
  title,
  description,
  emptyColor = "bg-gray-50 dark:bg-gray-900",
  maxHeight = "h-[500px]",
  cellSize = "md",
}: HeatmapGridProps) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of cells) {
      map.set(`${cell.row}:${cell.col}`, cell);
    }
    return map;
  }, [cells]);

  const getCell = useCallback(
    (rowIdx: number, colIdx: number) => cellMap.get(`${rowIdx}:${colIdx}`),
    [cellMap]
  );

  const sizeClass = CELL_SIZES[cellSize];

  return (
    <div>
      {title && (
        <div className="mb-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {description && <p className="text-sm text-gray-500">{description}</p>}
        </div>
      )}
      <ScrollArea className={maxHeight}>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-1 text-left font-medium sticky left-0 bg-white dark:bg-gray-950 z-10" />
                {columns.map((col, ci) => (
                  <th
                    key={ci}
                    className="p-1 text-left font-medium text-xs"
                    title={col}
                  >
                    <div className="w-16 truncate -rotate-45 origin-bottom-left translate-y-1">
                      {col}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="p-1 font-medium text-xs whitespace-nowrap sticky left-0 bg-white dark:bg-gray-950 z-10 border-r border-gray-200 dark:border-gray-700">
                    {row}
                  </td>
                  {columns.map((col, ci) => {
                    const cell = getCell(ri, ci);
                    const value = cell?.value ?? -1;
                    const color = value >= 0 ? colorScale(value) : emptyColor;
                    const isHovered = hoveredCell?.row === ri && hoveredCell?.col === ci;
                    const tooltip = formatTooltip
                      ? formatTooltip(row, col, value)
                      : `${row} × ${col}: ${value >= 0 ? formatValue(value) : "N/A"}`;

                    return (
                      <td
                        key={ci}
                        className={`${sizeClass} ${color} text-center font-mono cursor-default transition-opacity ${
                          isHovered ? "ring-2 ring-blue-500 ring-inset" : ""
                        } ${onCellClick ? "cursor-pointer" : ""}`}
                        title={tooltip}
                        onMouseEnter={() => setHoveredCell({ row: ri, col: ci })}
                        onMouseLeave={() => setHoveredCell(null)}
                        onClick={() => {
                          if (onCellClick && value >= 0) onCellClick(row, col, value);
                        }}
                      >
                        {cell?.label ?? (value >= 0 ? formatValue(value) : "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    </div>
  );
}
