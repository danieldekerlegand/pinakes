import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { createZoomBehavior } from '../../../lib/visualization/d3-helpers';

export interface NetworkGraphNode {
  id: string;
  /** Used by musical-tradition-explorer and similar consumers */
  label?: string;
  /** Used by musical-tradition-explorer and similar consumers */
  category?: string;
  /** Used by trade-network and similar consumers */
  name?: string;
  /** Used by trade-network and similar consumers */
  group?: string;
  size?: number;
  metadata?: Record<string, any>;
  // D3 force simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface NetworkGraphEdge {
  source: string;
  target: string;
  type?: string;
  weight?: number;
  metadata?: Record<string, any>;
}

export interface NetworkGraphLink {
  source: string | NetworkGraphNode;
  target: string | NetworkGraphNode;
  value?: number;
  label?: string;
}

export interface NetworkGraphProps {
  nodes: NetworkGraphNode[];
  /** HEAD-style edge data */
  edges?: NetworkGraphEdge[];
  /** Incoming-style link data */
  links?: NetworkGraphLink[];
  /** Simple color scale by category string (HEAD API) */
  colorScale?: (category: string) => string;
  /** Function-based node color (incoming API) */
  nodeColorFn?: (node: NetworkGraphNode) => string;
  /** Function-based link color (incoming API) */
  linkColorFn?: (link: NetworkGraphLink) => string;
  /** Function-based node radius (incoming API) */
  nodeRadiusFn?: (node: NetworkGraphNode) => number;
  /** HEAD API: receives the full node object */
  onNodeClick?: ((node: NetworkGraphNode) => void) | ((nodeId: string) => void);
  selectedNodeId?: string | null;
  formatTooltip?: (type: 'node' | 'link', datum: any) => string;
  linkDistance?: number;
  chargeStrength?: number;
  showLabels?: boolean;
  className?: string;
}

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function defaultColorScale(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

function getNodeLabel(node: NetworkGraphNode): string {
  return node.label || node.name || node.id;
}

function getNodeCategory(node: NetworkGraphNode): string {
  return node.category || node.group || '';
}

export function NetworkGraph({
  nodes,
  edges,
  links,
  colorScale = defaultColorScale,
  nodeColorFn,
  linkColorFn,
  nodeRadiusFn,
  onNodeClick,
  selectedNodeId,
  formatTooltip,
  linkDistance = 80,
  chargeStrength = -200,
  showLabels = true,
  className = '',
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<NetworkGraphNode, any> | null>(null);
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

  // Determine which data to use: links (incoming API) or edges (HEAD API) converted to links
  const resolvedLinks: NetworkGraphLink[] = React.useMemo(() => {
    if (links) return links;
    if (edges) return edges.map(e => ({ source: e.source, target: e.target, value: e.weight, label: e.type }));
    return [];
  }, [links, edges]);

  const getNodeColor = useCallback((node: NetworkGraphNode): string => {
    if (nodeColorFn) return nodeColorFn(node);
    if (selectedNodeId === node.id) return '#3b82f6';
    return colorScale(getNodeCategory(node));
  }, [nodeColorFn, colorScale, selectedNodeId]);

  const getNodeRadius = useCallback((node: NetworkGraphNode): number => {
    if (nodeRadiusFn) return nodeRadiusFn(node);
    return node.size || 6;
  }, [nodeRadiusFn]);

  const getDefaultTooltip = useCallback((node: NetworkGraphNode): string => {
    const label = getNodeLabel(node);
    const category = getNodeCategory(node);
    let text = label;
    if (category) text += `\n${category}`;
    if (node.metadata) {
      for (const [k, v] of Object.entries(node.metadata).slice(0, 3)) {
        text += `\n${k}: ${String(v)}`;
      }
    }
    return text;
  }, []);

  useEffect(() => {
    if (!svgRef.current || !nodes.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'network-main');
    createZoomBehavior(svg, g, 0.1, 4);

    // Copy nodes/links so D3 can mutate them
    const simNodes = nodes.map((n) => ({ ...n }));
    const simLinks = resolvedLinks.map((l) => ({ ...l }));

    const simulation = d3.forceSimulation<NetworkGraphNode>(simNodes)
      .force('link', d3.forceLink<NetworkGraphNode, NetworkGraphLink>(simLinks as any)
        .id((d) => d.id)
        .distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<NetworkGraphNode>().radius((d) => getNodeRadius(d) + 2));

    simulationRef.current = simulation;

    // Links
    const link = g.selectAll('.network-link')
      .data(simLinks)
      .join('line')
      .attr('class', 'network-link')
      .attr('stroke', (d) => linkColorFn ? linkColorFn(d as NetworkGraphLink) : '#cbd5e1')
      .attr('stroke-width', (d: any) => Math.max(1, Math.sqrt(d.value || d.weight || 1)))
      .attr('stroke-opacity', 0.6);

    // Nodes
    const node = g.selectAll('.network-node')
      .data(simNodes)
      .join('circle')
      .attr('class', 'network-node')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => getNodeColor(d))
      .attr('stroke', (d) => selectedNodeId === d.id ? '#1d4ed8' : '#fff')
      .attr('stroke-width', (d) => selectedNodeId === d.id ? 3 : 2)
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
    let labels: d3.Selection<SVGTextElement, NetworkGraphNode, SVGGElement, unknown> | null = null;
    if (showLabels) {
      labels = g.selectAll('.network-label')
        .data(simNodes)
        .join('text')
        .attr('class', 'network-label')
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#374151')
        .attr('pointer-events', 'none')
        .text((d) => {
          const lbl = getNodeLabel(d);
          return lbl.length > 18 ? lbl.substring(0, 15) + '...' : lbl;
        }) as any;
    }

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d) => d.x!)
        .attr('cy', (d) => d.y!);

      if (labels) {
        labels
          .attr('x', (d: any) => d.x!)
          .attr('y', (d: any) => d.y! + getNodeRadius(d) + 12);
      }
    });

    // Interactions
    node
      .on('click', function (_event, d) {
        if (onNodeClick) (onNodeClick as any)(d);
      })
      .on('mouseover', function (event, d) {
        const content = formatTooltip
          ? formatTooltip('node', d)
          : getDefaultTooltip(d);
        setTooltip({
          content,
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
  }, [nodes, resolvedLinks, width, height, getNodeColor, getNodeRadius, onNodeClick, formatTooltip, linkDistance, chargeStrength, showLabels, hideTooltip, linkColorFn, selectedNodeId, getDefaultTooltip]);

  return (
    <div ref={containerRef} className={`w-full h-full relative bg-gray-50 rounded-lg min-h-[300px] ${className}`}>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" data-testid="network-graph-svg" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
          No data to display
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Drag nodes · Scroll to zoom · Drag background to pan
      </div>
    </div>
  );
}

export default NetworkGraph;
