import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { useD3Simulation, useNodePinning } from './hooks/useD3Simulation';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { NetworkNode, NetworkLink, TooltipData } from '../../lib/visualization/types';
import {
  createDragBehavior,
  createZoomBehavior,
} from '../../lib/visualization/d3-helpers';

export interface NetworkGraphData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

export interface NetworkGraphProps {
  data: NetworkGraphData;
  /** Return a fill color for each node */
  nodeColor: (node: NetworkNode) => string;
  /** Return a stroke color for each node (default: white) */
  nodeStroke?: (node: NetworkNode) => string;
  /** Return stroke style for each link */
  linkColor?: (link: NetworkLink) => string;
  linkDasharray?: (link: NetworkLink) => string | undefined;
  linkWidth?: (link: NetworkLink) => number;
  /** Build tooltip data from a node */
  tooltipContent?: (node: NetworkNode) => TooltipData;
  /** Whether to show labels on all nodes (default: only large nodes) */
  showLabels?: boolean;
  /** Label size threshold – nodes with size >= this get labels (default: 6) */
  labelThreshold?: number;
  /** Simulation config overrides */
  linkDistance?: number;
  chargeStrength?: number;
  /** Called when a node is clicked */
  onNodeClick?: (node: NetworkNode) => void;
  /** Status bar text override */
  statusText?: string;
}

export function NetworkGraph({
  data,
  nodeColor,
  nodeStroke,
  linkColor,
  linkDasharray,
  linkWidth,
  tooltipContent,
  showLabels = false,
  labelThreshold = 6,
  linkDistance = 100,
  chargeStrength = -300,
  onNodeClick,
  statusText,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const { togglePin, isPinned } = useNodePinning();

  const [tooltip, setTooltip] = useState<{
    data: TooltipData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ data: null, x: 0, y: 0, visible: false });

  const svgTick = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGLineElement, NetworkLink>('.link')
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    svg.selectAll<SVGCircleElement, NetworkNode>('.node')
      .attr('cx', (d) => d.x!)
      .attr('cy', (d) => d.y!);

    svg.selectAll<SVGTextElement, NetworkNode>('.label')
      .attr('x', (d) => d.x!)
      .attr('y', (d) => d.y! + d.size + 12);
  }, []);

  const simulation = useD3Simulation(
    data.nodes,
    data.links,
    width,
    height,
    { linkDistance, chargeStrength },
    svgTick,
  );

  useEffect(() => {
    if (!svgRef.current || !data || data.nodes.length === 0 || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');
    createZoomBehavior(svg, g, 0.1, 4);

    // Draw links
    g.selectAll('.link')
      .data(data.links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', (d) => linkColor ? linkColor(d) : '#cbd5e0')
      .attr('stroke-width', (d) => linkWidth ? linkWidth(d) : 1)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', (d) => linkDasharray ? (linkDasharray(d) ?? '') : '');

    // Draw nodes
    const node = g.selectAll('.node')
      .data(data.nodes)
      .join('circle')
      .attr('class', 'node')
      .attr('r', (d) => d.size)
      .attr('fill', (d) => nodeColor(d))
      .attr('stroke', (d) => {
        if (isPinned(d.id)) return '#ef4444';
        return nodeStroke ? nodeStroke(d) : '#fff';
      })
      .attr('stroke-width', (d) => isPinned(d.id) ? 3 : 2)
      .style('cursor', 'pointer')
      .call(simulation ? createDragBehavior(simulation) : (() => {}) as any);

    // Labels
    const labelNodes = showLabels
      ? data.nodes
      : data.nodes.filter((d) => d.size >= labelThreshold);

    g.selectAll('.label')
      .data(labelNodes)
      .join('text')
      .attr('class', 'label')
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => d.size >= labelThreshold ? '11px' : '9px')
      .attr('font-weight', (d) => d.size >= labelThreshold ? 600 : 400)
      .attr('fill', '#374151')
      .attr('pointer-events', 'none')
      .text((d) => d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name);

    // Interactions
    node
      .on('click', function (event, d) {
        event.stopPropagation();
        if (event.detail === 2) {
          const pinState = togglePin(d.id, d.x, d.y);
          d.fx = pinState.fx;
          d.fy = pinState.fy;
          d3.select(this)
            .attr('stroke', isPinned(d.id) ? '#ef4444' : (nodeStroke ? nodeStroke(d) : '#fff'))
            .attr('stroke-width', isPinned(d.id) ? 3 : 2);
        } else if (onNodeClick) {
          onNodeClick(d);
        }
      })
      .on('mouseover', function (event, d) {
        const tipData = tooltipContent
          ? tooltipContent(d)
          : { id: d.id, name: d.name, type: d.type };
        setTooltip({ data: tipData, x: event.pageX, y: event.pageY - 10, visible: true });
      })
      .on('mousemove', function (event) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
      })
      .on('mouseout', function () {
        setTooltip((prev) => ({ ...prev, visible: false }));
      });
  }, [data, width, height, simulation, showLabels, labelThreshold, nodeColor, nodeStroke, linkColor, linkDasharray, linkWidth, isPinned, togglePin, onNodeClick, tooltipContent]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      <VisualizationTooltip data={tooltip.data} x={tooltip.x} y={tooltip.y} visible={tooltip.visible} />
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        {statusText ?? `${data.nodes.length} nodes • ${data.links.length} links`} • Drag nodes • Double-click to pin • Scroll to zoom
      </div>
    </div>
  );
}
