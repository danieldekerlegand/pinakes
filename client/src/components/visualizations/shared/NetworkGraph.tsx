import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';

export interface NetworkGraphNode {
  id: string;
  label: string;
  category: string;
  size?: number;
  metadata?: Record<string, any>;
}

export interface NetworkGraphEdge {
  source: string;
  target: string;
  type?: string;
  weight?: number;
  metadata?: Record<string, any>;
}

export interface NetworkGraphProps {
  nodes: NetworkGraphNode[];
  edges: NetworkGraphEdge[];
  colorScale?: (category: string) => string;
  onNodeClick?: (node: NetworkGraphNode) => void;
  selectedNodeId?: string | null;
  className?: string;
  linkDistance?: number;
  chargeStrength?: number;
  showLabels?: boolean;
}

interface SimNode extends NetworkGraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
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

export function NetworkGraph({
  nodes,
  edges,
  colorScale = defaultColorScale,
  onNodeClick,
  selectedNodeId,
  className = '',
  linkDistance = 80,
  chargeStrength = -200,
  showLabels = true,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const simulationRef = useRef<d3.Simulation<SimNode, any> | null>(null);
  const [tooltip, setTooltip] = useState<{ node: NetworkGraphNode; x: number; y: number } | null>(null);

  const render = useCallback(() => {
    if (!svgRef.current || width === 0 || height === 0 || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Clone nodes for simulation
    const simNodes: SimNode[] = nodes.map(n => ({ ...n }));
    const simEdges = edges.map(e => ({ ...e }));

    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, any>(simEdges)
        .id((d: SimNode) => d.id)
        .distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => (d.size || 6) + 4));

    simulationRef.current = simulation;

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d: any) => Math.max(1, (d.weight || 1) * 1.5));

    // Nodes
    const node = g.append('g')
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', (d) => d.size || 6)
      .attr('fill', (d) => selectedNodeId === d.id ? '#3b82f6' : colorScale(d.category))
      .attr('stroke', (d) => selectedNodeId === d.id ? '#1d4ed8' : '#fff')
      .attr('stroke-width', (d) => selectedNodeId === d.id ? 3 : 1.5)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => onNodeClick?.(d))
      .on('mouseenter', (event, d) => {
        setTooltip({ node: d, x: event.pageX, y: event.pageY });
      })
      .on('mouseleave', () => setTooltip(null))
      .call(d3.drag<SVGCircleElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Labels
    let labels: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown> | null = null;
    if (showLabels) {
      labels = g.append('g')
        .selectAll<SVGTextElement, SimNode>('text')
        .data(simNodes)
        .join('text')
        .text(d => d.label.length > 20 ? d.label.slice(0, 17) + '...' : d.label)
        .attr('font-size', 10)
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => (d.size || 6) + 14)
        .attr('fill', '#374151')
        .attr('pointer-events', 'none');
    }

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);

      if (labels) {
        labels
          .attr('x', d => d.x ?? 0)
          .attr('y', d => d.y ?? 0);
      }
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, width, height, colorScale, onNodeClick, selectedNodeId, linkDistance, chargeStrength, showLabels]);

  useEffect(() => {
    const cleanup = render();
    return () => cleanup?.();
  }, [render]);

  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full h-full min-h-[300px] ${className}`}>
      <svg ref={svgRef} width={width} height={height} className="bg-gray-50 rounded" />
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-sm max-w-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}
        >
          <div className="font-semibold">{tooltip.node.label}</div>
          <div className="text-xs text-gray-500">{tooltip.node.category}</div>
          {tooltip.node.metadata && Object.entries(tooltip.node.metadata).slice(0, 3).map(([k, v]) => (
            <div key={k} className="text-xs text-gray-600">{k}: {String(v)}</div>
          ))}
        </div>
      )}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
          No data to display
        </div>
      )}
    </div>
  );
}

export default NetworkGraph;
