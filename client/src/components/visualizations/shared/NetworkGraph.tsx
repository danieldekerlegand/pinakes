import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { createZoomBehavior } from '../../../lib/visualization/d3-helpers';

export interface NetworkGraphNode {
  id: string;
  name: string;
  group: string;
  size?: number;
  // D3 force simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface NetworkGraphLink {
  source: string | NetworkGraphNode;
  target: string | NetworkGraphNode;
  value?: number;
  label?: string;
}

export interface NetworkGraphProps {
  nodes: NetworkGraphNode[];
  links: NetworkGraphLink[];
  nodeColorFn?: (node: NetworkGraphNode) => string;
  linkColorFn?: (link: NetworkGraphLink) => string;
  nodeRadiusFn?: (node: NetworkGraphNode) => number;
  onNodeClick?: (nodeId: string) => void;
  formatTooltip?: (type: 'node' | 'link', datum: any) => string;
  linkDistance?: number;
  chargeStrength?: number;
  className?: string;
}

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function defaultNodeColor(node: NetworkGraphNode): string {
  let hash = 0;
  for (let i = 0; i < node.group.length; i++) {
    hash = node.group.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

function defaultLinkColor(_link: NetworkGraphLink): string {
  return '#cbd5e0';
}

function defaultNodeRadius(node: NetworkGraphNode): number {
  return node.size ?? 6;
}

function defaultFormatTooltip(type: 'node' | 'link', datum: any): string {
  if (type === 'node') {
    return `${datum.name}\nGroup: ${datum.group}`;
  }
  const src = typeof datum.source === 'string' ? datum.source : datum.source.name;
  const tgt = typeof datum.target === 'string' ? datum.target : datum.target.name;
  return `${src} — ${tgt}${datum.label ? `\n${datum.label}` : ''}`;
}

export function NetworkGraph({
  nodes,
  links,
  nodeColorFn = defaultNodeColor,
  linkColorFn = defaultLinkColor,
  nodeRadiusFn = defaultNodeRadius,
  onNodeClick,
  formatTooltip = defaultFormatTooltip,
  linkDistance = 80,
  chargeStrength = -200,
  className = '',
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<NetworkGraphNode, NetworkGraphLink> | null>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  const hideTooltip = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    if (!svgRef.current || !nodes.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'network-main');
    createZoomBehavior(svg, g, 0.1, 4);

    // Copy nodes/links so D3 can mutate them
    const simNodes = nodes.map((n) => ({ ...n }));
    const simLinks = links.map((l) => ({ ...l }));

    const simulation = d3.forceSimulation<NetworkGraphNode>(simNodes)
      .force('link', d3.forceLink<NetworkGraphNode, NetworkGraphLink>(simLinks as any)
        .id((d) => d.id)
        .distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<NetworkGraphNode>().radius((d) => nodeRadiusFn(d) + 2));

    simulationRef.current = simulation;

    // Links
    const link = g.selectAll('.network-link')
      .data(simLinks)
      .join('line')
      .attr('class', 'network-link')
      .attr('stroke', (d) => linkColorFn(d as NetworkGraphLink))
      .attr('stroke-width', (d: any) => Math.max(1, Math.sqrt(d.value || 1)))
      .attr('stroke-opacity', 0.6);

    // Nodes
    const node = g.selectAll('.network-node')
      .data(simNodes)
      .join('circle')
      .attr('class', 'network-node')
      .attr('r', (d) => nodeRadiusFn(d))
      .attr('fill', (d) => nodeColorFn(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', onNodeClick ? 'pointer' : 'default')
      .call(d3.drag<any, NetworkGraphNode>()
        .on('start', (event) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        })
        .on('drag', (event) => {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        })
        .on('end', (event) => {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
        }) as any);

    // Labels
    const label = g.selectAll('.network-label')
      .data(simNodes)
      .join('text')
      .attr('class', 'network-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#374151')
      .attr('pointer-events', 'none')
      .text((d) => d.name.length > 18 ? d.name.substring(0, 15) + '...' : d.name);

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d) => d.x!)
        .attr('cy', (d) => d.y!);

      label
        .attr('x', (d) => d.x!)
        .attr('y', (d) => d.y! + nodeRadiusFn(d) + 12);
    });

    // Interactions
    node
      .on('click', function (_event, d) {
        if (onNodeClick) onNodeClick(d.id);
      })
      .on('mouseover', function (event, d) {
        setTooltip({
          content: formatTooltip('node', d),
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });
      })
      .on('mousemove', function (event) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
      })
      .on('mouseout', hideTooltip);

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, nodeColorFn, linkColorFn, nodeRadiusFn, onNodeClick, formatTooltip, linkDistance, chargeStrength, hideTooltip]);

  return (
    <div ref={containerRef} className={`w-full h-full relative bg-gray-50 rounded-lg ${className}`}>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Drag nodes · Scroll to zoom · Drag background to pan
      </div>
    </div>
  );
}
