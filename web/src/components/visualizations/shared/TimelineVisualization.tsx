import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { VisualizationTooltip } from './VisualizationTooltip';
import type { TooltipData } from '../../../lib/visualization/types';

export interface TimelineItem {
  id: string;
  name: string;
  groupName: string;
  startYear: number;
  endYear: number | null;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineVisualizationProps<T extends TimelineItem = TimelineItem> {
  data: T[];
  onItemClick?: (id: string) => void;
  colorFn: (item: T) => string;
  isSelected?: (item: T) => boolean;
  isHighlighted?: (item: T) => boolean;
  selectedColor?: string;
  selectedStrokeColor?: string;
  buildTooltip?: (item: T) => TooltipData;
  margin?: { top: number; right: number; bottom: number; left: number };
  helpText?: string;
}

export function TimelineVisualization<T extends TimelineItem = TimelineItem>({
  data,
  onItemClick,
  colorFn,
  isSelected,
  isHighlighted,
  selectedColor = '#3b82f6',
  selectedStrokeColor = '#1d4ed8',
  buildTooltip,
  margin = { top: 50, right: 50, bottom: 50, left: 150 },
  helpText = 'Click bars to select \u2022 Hover for details',
}: TimelineVisualizationProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    data: TooltipData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({
    data: null,
    x: 0,
    y: 0,
    visible: false,
  });

  useEffect(() => {
    if (!svgRef.current || !data || data.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const minYear = d3.min(data, (d) => d.startYear) || -3000;
    const maxYear = d3.max(data, (d) => d.endYear || new Date().getFullYear()) || 2024;

    const xScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range([0, innerWidth]);

    const groups = Array.from(new Set(data.map((d) => d.groupName)));

    const yScale = d3.scaleBand()
      .domain(groups)
      .range([0, innerHeight])
      .padding(0.1);

    // Gridlines
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(
        d3.axisBottom(xScale)
          .tickSize(innerHeight)
          .tickFormat(() => '')
      );

    // Timeline bars
    g.selectAll('.timeline-bar')
      .data(data)
      .join('rect')
      .attr('class', 'timeline-bar')
      .attr('x', (d) => xScale(d.startYear))
      .attr('y', (d) => yScale(d.groupName)!)
      .attr('width', (d) => {
        const endYear = d.endYear || new Date().getFullYear();
        return Math.max(2, xScale(endYear) - xScale(d.startYear));
      })
      .attr('height', yScale.bandwidth())
      .attr('fill', (d) => {
        const sel = isSelected?.(d);
        const hl = isHighlighted?.(d);
        if (sel || hl) return selectedColor;
        return colorFn(d);
      })
      .attr('stroke', (d) => {
        return isSelected?.(d) ? selectedStrokeColor : 'none';
      })
      .attr('stroke-width', (d) => {
        return isSelected?.(d) ? 2 : 0;
      })
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        onItemClick?.(d.id);
      })
      .on('mouseover', function(event, d) {
        if (buildTooltip) {
          setTooltip({
            data: buildTooltip(d),
            x: event.pageX,
            y: event.pageY - 10,
            visible: true,
          });
        }
        d3.select(this).attr('opacity', 0.7);
      })
      .on('mousemove', function(event) {
        setTooltip((prev) => ({
          ...prev,
          x: event.pageX,
          y: event.pageY - 10,
        }));
      })
      .on('mouseout', function() {
        setTooltip((prev) => ({ ...prev, visible: false }));
        d3.select(this).attr('opacity', 1);
      });

    // X-axis
    const xAxis = d3.axisBottom(xScale)
      .tickFormat((d) => {
        const year = d as number;
        if (year < 0) return `${Math.abs(year)} BCE`;
        return `${year} CE`;
      });

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    // Y-axis
    g.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(yScale))
      .selectAll('text')
      .style('font-size', '11px');

  }, [data, width, height, colorFn, isSelected, isHighlighted, onItemClick, buildTooltip, margin, selectedColor, selectedStrokeColor]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 dark:bg-gray-900 rounded-lg">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white dark:bg-gray-800 px-2 py-1 rounded border">
        {helpText}
      </div>
    </div>
  );
}
