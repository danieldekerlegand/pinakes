import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualization } from '../../contexts/VisualizationContext';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { TimelineEvent, TooltipData } from '../../lib/visualization/types';
import {
  getFamilyColor,
  createZoomBehavior,
} from '../../lib/visualization/d3-helpers';

interface LanguageTimelineViewProps {
  timelineData: TimelineEvent[];
  onEventClick?: (id: string) => void;
}

export function LanguageTimelineView({ timelineData, onEventClick }: LanguageTimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const { state, isLanguageSelected, isHighlighted } = useVisualization();

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
    if (!svgRef.current || !timelineData || timelineData.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 50, right: 50, bottom: 50, left: 150 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Create main group
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Get time extent
    const minYear = d3.min(timelineData, (d) => d.startYear) || -3000;
    const maxYear = d3.max(timelineData, (d) => d.endYear || new Date().getFullYear()) || 2024;

    // Create scales
    const xScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range([0, innerWidth]);

    // Group by family or region
    const groupBy = state.viewSettings.timeline.groupBy;
    const groups = Array.from(new Set(timelineData.map((d) => d.groupName)));

    const yScale = d3.scaleBand()
      .domain(groups)
      .range([0, innerHeight])
      .padding(0.1);

    // Draw timeline bars
    g.selectAll('.timeline-bar')
      .data(timelineData)
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
        const selected = isLanguageSelected(d.id);
        const highlighted = isHighlighted(d.id);
        if (selected || highlighted) return '#3b82f6';
        return getFamilyColor(d.familyId, 0.7);
      })
      .attr('stroke', (d) => {
        const selected = isLanguageSelected(d.id);
        if (selected) return '#1d4ed8';
        return 'none';
      })
      .attr('stroke-width', (d) => {
        const selected = isLanguageSelected(d.id);
        return selected ? 2 : 0;
      })
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onEventClick) {
          onEventClick(d.id);
        }
      })
      .on('mouseover', function(event, d) {
        const tooltipData: TooltipData = {
          id: d.id,
          name: d.name,
          nativeName: d.nativeName,
          type: d.type,
          familyName: d.familyName,
          region: d.region,
          status: d.status,
          totalSpeakers: d.totalSpeakers,
          timeOrigin: `${d.startYear} ${d.startYear < 0 ? 'BCE' : 'CE'}`,
          timeEnd: d.endYear ? `${d.endYear} ${d.endYear < 0 ? 'BCE' : 'CE'}` : 'Present',
        };

        setTooltip({
          data: tooltipData,
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });

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

    // Add x-axis
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

    // Add y-axis
    const yAxis = d3.axisLeft(yScale);

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis);

    // Add gridlines
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(
        d3.axisBottom(xScale)
          .tickSize(innerHeight)
          .tickFormat(() => '')
      );

  }, [timelineData, width, height, state.viewSettings.timeline.groupBy, isLanguageSelected, isHighlighted, onEventClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
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
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Click bars to select • Hover for details
      </div>
    </div>
  );
}
