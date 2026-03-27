import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';

export interface TimelineItem {
  id: string;
  name: string;
  groupName: string;
  startYear: number;
  endYear: number | null;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineTooltipContent {
  title: string;
  subtitle?: string;
  fields: Array<{ label: string; value: string }>;
}

interface TimelineVisualizationProps {
  items: TimelineItem[];
  getColor: (item: TimelineItem) => string;
  getTooltipContent: (item: TimelineItem) => TimelineTooltipContent;
  onItemClick?: (id: string) => void;
  selectedItemId?: string | null;
  margin?: { top: number; right: number; bottom: number; left: number };
  helpText?: string;
}

export function TimelineVisualization({
  items,
  getColor,
  getTooltipContent,
  onItemClick,
  selectedItemId,
  margin = { top: 50, right: 50, bottom: 50, left: 180 },
  helpText = 'Click bars to select \u2022 Hover for details',
}: TimelineVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    content: TimelineTooltipContent | null;
    x: number;
    y: number;
    visible: boolean;
  }>({
    content: null,
    x: 0,
    y: 0,
    visible: false,
  });

  useEffect(() => {
    if (!svgRef.current || !items || items.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const minYear = d3.min(items, (d) => d.startYear) || -3000;
    const maxYear = d3.max(items, (d) => d.endYear || new Date().getFullYear()) || 2024;

    const xScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range([0, innerWidth]);

    const groups = Array.from(new Set(items.map((d) => d.groupName)));

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
      .data(items)
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
        if (selectedItemId === d.id) return '#3b82f6';
        return getColor(d);
      })
      .attr('stroke', (d) => selectedItemId === d.id ? '#1d4ed8' : 'none')
      .attr('stroke-width', (d) => selectedItemId === d.id ? 2 : 0)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', function (event, d) {
        event.stopPropagation();
        onItemClick?.(d.id);
      })
      .on('mouseover', function (event, d) {
        setTooltip({
          content: getTooltipContent(d),
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });
        d3.select(this).attr('opacity', 0.7);
      })
      .on('mousemove', function (event) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
      })
      .on('mouseout', function () {
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

  }, [items, width, height, selectedItemId, getColor, getTooltipContent, onItemClick, margin]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 dark:bg-gray-900 rounded-lg">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      {tooltip.visible && tooltip.content && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-w-sm">
            <div className="space-y-1.5">
              <div>
                <h4 className="font-semibold text-sm">{tooltip.content.title}</h4>
                {tooltip.content.subtitle && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">({tooltip.content.subtitle})</p>
                )}
              </div>
              <div className="text-xs space-y-0.5">
                {tooltip.content.fields.map((field, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span className="text-gray-500">{field.label}:</span>
                    <span className="font-medium">{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white dark:bg-gray-800 px-2 py-1 rounded border">
        {helpText}
      </div>
    </div>
  );
}
