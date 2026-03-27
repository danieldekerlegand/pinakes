import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { getFamilyColor } from '../../lib/visualization/d3-helpers';
import { ExportMenu } from './shared/ExportMenu';
import type {
  ParallelCoordinatesData,
  ParallelCoordinatesDimension,
  ParallelCoordinatesDataPoint,
} from '../../lib/visualization/parallel-coordinates';
import {
  normalizeValue,
  computePath,
  filterByBrush,
} from '../../lib/visualization/parallel-coordinates';

interface ParallelCoordinatesVisualizationProps {
  data: ParallelCoordinatesData;
  onLineClick?: (dataPoint: ParallelCoordinatesDataPoint) => void;
  onBrushChange?: (filtered: ParallelCoordinatesDataPoint[]) => void;
  colorByGroup?: boolean;
  lineOpacity?: number;
  highlightedIds?: Set<string>;
}

const MARGIN = { top: 40, right: 40, bottom: 20, left: 40 };

export function ParallelCoordinatesVisualization({
  data,
  onLineClick,
  onBrushChange,
  colorByGroup = true,
  lineOpacity = 0.4,
  highlightedIds,
}: ParallelCoordinatesVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const [brushes, setBrushes] = useState<Record<string, [number, number]>>({});

  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  const getColor = useCallback(
    (point: ParallelCoordinatesDataPoint) => {
      if (!colorByGroup || !point.group) return '#6366f1';
      return getFamilyColor(point.group, 1);
    },
    [colorByGroup]
  );

  useEffect(() => {
    if (!svgRef.current || !data.dimensions.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = height - MARGIN.top - MARGIN.bottom;
    if (innerWidth <= 0 || innerHeight <= 0) return;

    const g = svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const { dimensions, dataPoints } = data;

    // X scale maps dimension index to horizontal position
    const xScale = d3
      .scalePoint<number>()
      .domain(dimensions.map((_, i) => i))
      .range([0, innerWidth]);

    // Y scale maps normalized [0,1] to vertical position (inverted)
    const yScale = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);

    // Determine which points pass all brush filters
    const brushKeys = Object.keys(brushes);
    const filtered = brushKeys.length > 0
      ? new Set(filterByBrush(dataPoints, dimensions, brushes).map((d) => d.id))
      : null;

    // Line generator
    const line = d3
      .line<[number, number]>()
      .x(([dimIdx]) => xScale(dimIdx)!)
      .y(([, norm]) => yScale(norm))
      .curve(d3.curveMonotoneX);

    // Draw lines
    const linesGroup = g.append('g').attr('class', 'lines');

    linesGroup
      .selectAll('path')
      .data(dataPoints)
      .join('path')
      .attr('d', (point) => {
        const path = computePath(point, dimensions);
        return path.length >= 2 ? line(path) : null;
      })
      .attr('fill', 'none')
      .attr('stroke', (point) => getColor(point))
      .attr('stroke-width', (point) =>
        highlightedIds?.has(point.id) ? 2.5 : 1.5
      )
      .attr('stroke-opacity', (point) => {
        if (highlightedIds && !highlightedIds.has(point.id)) return 0.05;
        if (filtered && !filtered.has(point.id)) return 0.05;
        return lineOpacity;
      })
      .style('cursor', 'pointer')
      .on('mouseover', function (event, point) {
        d3.select(this)
          .attr('stroke-width', 3)
          .attr('stroke-opacity', 1)
          .raise();

        const dimSummary = dimensions
          .map((dim) => {
            const val = point.values[dim.key];
            return val !== null ? `${dim.label}: ${val}` : null;
          })
          .filter(Boolean)
          .join('\n');

        setTooltip({
          content: `${point.label}\n${dimSummary}`,
          x: event.pageX + 12,
          y: event.pageY - 12,
          visible: true,
        });
      })
      .on('mousemove', (event) => {
        setTooltip((prev) => ({ ...prev, x: event.pageX + 12, y: event.pageY - 12 }));
      })
      .on('mouseout', function (_, point) {
        const isHighlighted = highlightedIds?.has(point.id);
        const isFiltered = !filtered || filtered.has(point.id);
        d3.select(this)
          .attr('stroke-width', isHighlighted ? 2.5 : 1.5)
          .attr('stroke-opacity', isHighlighted || isFiltered ? lineOpacity : 0.05);
        setTooltip((prev) => ({ ...prev, visible: false }));
      })
      .on('click', (_, point) => {
        onLineClick?.(point);
      });

    // Draw axes
    const axesGroup = g.append('g').attr('class', 'axes');

    dimensions.forEach((dim, i) => {
      const xPos = xScale(i)!;
      const axisG = axesGroup.append('g').attr('transform', `translate(${xPos},0)`);

      if (dim.type === 'numeric' && dim.domain) {
        const axisScale = d3.scaleLinear().domain(dim.domain).range([innerHeight, 0]);
        const axis = d3.axisLeft(axisScale).ticks(5).tickFormat(d3.format('.2s'));
        axisG.call(axis);
      } else if (dim.type === 'categorical' && dim.categories) {
        const catScale = d3
          .scalePoint()
          .domain(dim.categories)
          .range([innerHeight, 0]);
        const axis = d3.axisLeft(catScale);
        axisG.call(axis);
      }

      // Axis label
      axisG
        .append('text')
        .attr('y', -12)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('font-size', '12px')
        .attr('font-weight', 600)
        .text(dim.label);

      // Brush per axis
      const brushHeight = innerHeight;
      const brush = d3
        .brushY()
        .extent([
          [-10, 0],
          [10, brushHeight],
        ])
        .on('brush end', (event) => {
          if (!event.selection) {
            setBrushes((prev) => {
              const next = { ...prev };
              delete next[dim.key];
              return next;
            });
            return;
          }
          const [y0, y1] = event.selection as [number, number];
          // Convert pixel selection to normalized range (inverted y)
          const normHi = 1 - y0 / brushHeight;
          const normLo = 1 - y1 / brushHeight;
          setBrushes((prev) => ({ ...prev, [dim.key]: [normLo, normHi] }));
        });

      axisG.append('g').attr('class', 'brush').call(brush);
    });

    // Style axis lines and ticks
    axesGroup
      .selectAll('.domain')
      .attr('stroke', 'hsl(var(--border))');
    axesGroup
      .selectAll('.tick line')
      .attr('stroke', 'hsl(var(--border))');
    axesGroup
      .selectAll('.tick text')
      .attr('fill', 'hsl(var(--muted-foreground))')
      .attr('font-size', '10px');
  }, [data, width, height, brushes, getColor, lineOpacity, highlightedIds, onLineClick]);

  // Notify parent of brush-filtered data
  useEffect(() => {
    if (!onBrushChange) return;
    const filtered = filterByBrush(data.dataPoints, data.dimensions, brushes);
    onBrushChange(filtered);
  }, [brushes, data, onBrushChange]);

  if (!data.dimensions.length || !data.dataPoints.length) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No data available for parallel coordinates visualization.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <div className="absolute top-2 right-2 z-10">
        <ExportMenu svgRef={svgRef} data={data.dataPoints} currentView="parallel-coordinates" />
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      {tooltip.visible && (
        <div
          className="fixed z-50 px-3 py-2 text-xs rounded-md shadow-lg bg-popover text-popover-foreground border whitespace-pre-line pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
