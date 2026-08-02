import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { createZoomBehavior } from '../../lib/visualization/d3-helpers';
import {
  defaultNodeColor,
  defaultNodeRadius,
  defaultLabelText,
} from '../../lib/visualization/network-graph-types';
import type { GraphNode, GraphLink, GraphData, SimulationConfig } from '../../lib/visualization/network-graph-types';

export type { GraphNode, GraphLink, GraphData, SimulationConfig };
export { defaultNodeColor };

export interface NetworkGraphProps<N extends GraphNode = GraphNode, L extends GraphLink = GraphLink> {
  data: GraphData<N, L>;
  nodeColor?: (node: N) => string;
  nodeRadius?: (node: N) => number;
  nodeStroke?: (node: N) => string;
  nodeStrokeWidth?: (node: N) => number;
  linkColor?: (link: L) => string;
  linkWidth?: (link: L) => number;
  linkOpacity?: number;
  showLabel?: (node: N) => boolean;
  labelText?: (node: N) => string;
  labelFont?: (node: N) => string;
  labelColor?: string;
  canvasThreshold?: number;
  simulationConfig?: SimulationConfig;
  onNodeClick?: (node: N, event: MouseEvent) => void;
  onNodeDoubleClick?: (node: N, event: MouseEvent) => void;
  renderTooltip?: (node: N) => React.ReactNode;
  className?: string;
  statusText?: string;
}

// ============================================================================
// Simulation hook (generic)
// ============================================================================

function useForceSimulation<N extends GraphNode, L extends GraphLink>(
  nodes: N[],
  links: L[],
  width: number,
  height: number,
  config: SimulationConfig,
  onTick?: () => void,
) {
  const simulationRef = useRef<d3.Simulation<N, any> | null>(null);

  const {
    linkDistance = 100,
    chargeStrength = -300,
    centerStrength = 1,
    collisionRadius = 10,
  } = config;

  useEffect(() => {
    if (nodes.length === 0 || width === 0 || height === 0) return;

    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<N>(nodes);
    } else {
      simulationRef.current.nodes(nodes);
    }

    const simulation = simulationRef.current;

    simulation
      .force(
        'link',
        d3.forceLink<N, any>(links)
          .id((d) => d.id)
          .distance(linkDistance),
      )
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(centerStrength))
      .force(
        'collision',
        d3.forceCollide<N>().radius((d) => (d.size ?? 6) + collisionRadius),
      )
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05));

    if (onTick) {
      simulation.on('tick', onTick);
    }

    simulation.alpha(1).restart();

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, linkDistance, chargeStrength, centerStrength, collisionRadius, onTick]);

  return simulationRef.current;
}

// ============================================================================
// NetworkGraph Component
// ============================================================================

export function NetworkGraph<N extends GraphNode = GraphNode, L extends GraphLink = GraphLink>({
  data,
  nodeColor = defaultNodeColor as (node: N) => string,
  nodeRadius = defaultNodeRadius as (node: N) => number,
  nodeStroke,
  nodeStrokeWidth,
  linkColor,
  linkWidth,
  linkOpacity = 0.6,
  showLabel,
  labelText = defaultLabelText as (node: N) => string,
  labelFont,
  labelColor = '#374151',
  canvasThreshold = 500,
  simulationConfig = {},
  onNodeClick,
  onNodeDoubleClick,
  renderTooltip,
  className = '',
  statusText,
}: NetworkGraphProps<N, L>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const transformRef = useRef(d3.zoomIdentity);

  const useCanvas = data.nodes.length > canvasThreshold;

  const [tooltip, setTooltip] = useState<{
    node: N | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ node: null, x: 0, y: 0, visible: false });

  // Memoize resolved styling functions
  const getColor = useMemo(() => nodeColor, [nodeColor]);
  const getRadius = useMemo(() => nodeRadius, [nodeRadius]);
  const getStroke = useMemo(() => nodeStroke ?? (() => '#ffffff'), [nodeStroke]);
  const getStrokeWidth = useMemo(() => nodeStrokeWidth ?? (() => 2), [nodeStrokeWidth]);
  const getLinkColor = useMemo(() => linkColor ?? (() => '#cbd5e0'), [linkColor]);
  const getLinkWidth = useMemo(() => linkWidth ?? (() => 1), [linkWidth]);
  const shouldShowLabel = useMemo(() => showLabel ?? (() => true), [showLabel]);
  const getLabelFont = useMemo(() => labelFont ?? (() => '400 10px sans-serif'), [labelFont]);

  // Find nearest node to a point
  const findNearestNode = useCallback(
    (px: number, py: number): N | null => {
      let closest: N | null = null;
      let minDist = Infinity;
      for (const node of data.nodes) {
        const dx = (node.x ?? 0) - px;
        const dy = (node.y ?? 0) - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = getRadius(node);
        if (dist < r + 4 && dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }
      return closest;
    },
    [data.nodes, getRadius],
  );

  // Canvas tick handler
  const canvasTick = useCallback(() => {
    if (!canvasRef.current || !useCanvas) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const transform = transformRef.current;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Draw links
    ctx.globalAlpha = linkOpacity;
    for (const link of data.links) {
      const source = link.source as any;
      const target = link.target as any;
      ctx.strokeStyle = getLinkColor(link);
      ctx.lineWidth = getLinkWidth(link);
      ctx.beginPath();
      ctx.moveTo(source.x ?? 0, source.y ?? 0);
      ctx.lineTo(target.x ?? 0, target.y ?? 0);
      ctx.stroke();
    }

    // Draw nodes
    ctx.globalAlpha = 1;
    for (const node of data.nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = getRadius(node);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = getColor(node);
      ctx.fill();
      ctx.strokeStyle = getStroke(node);
      ctx.lineWidth = getStrokeWidth(node);
      ctx.stroke();
    }

    // Draw labels
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    for (const node of data.nodes) {
      if (!shouldShowLabel(node)) continue;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.font = getLabelFont(node);
      ctx.fillText(labelText(node), x, y + getRadius(node) + 12);
    }

    ctx.restore();
  }, [data, width, height, useCanvas, getColor, getRadius, getStroke, getStrokeWidth, getLinkColor, getLinkWidth, linkOpacity, shouldShowLabel, labelText, labelColor, getLabelFont]);

  // SVG tick handler
  const svgTick = useCallback(() => {
    if (!svgRef.current || useCanvas) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGLineElement, L>('.ng-link')
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    svg.selectAll<SVGCircleElement, N>('.ng-node')
      .attr('cx', (d) => d.x!)
      .attr('cy', (d) => d.y!);

    svg.selectAll<SVGTextElement, N>('.ng-label')
      .attr('x', (d) => d.x!)
      .attr('y', (d) => d.y! + getRadius(d) + 12);
  }, [useCanvas, getRadius]);

  // Force simulation
  const simulation = useForceSimulation(
    data.nodes,
    data.links,
    width,
    height,
    simulationConfig,
    useCanvas ? canvasTick : svgTick,
  );

  // Canvas interactions
  useEffect(() => {
    if (!canvasRef.current || !useCanvas || width === 0 || height === 0) return;

    const canvas = d3.select(canvasRef.current);

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        canvasTick();
      });

    canvas.call(zoom);

    canvas.on('click', (event) => {
      const [mx, my] = d3.pointer(event);
      const transform = transformRef.current;
      const x = (mx - transform.x) / transform.k;
      const y = (my - transform.y) / transform.k;
      const node = findNearestNode(x, y);

      if (node) {
        if (event.detail === 2 && onNodeDoubleClick) {
          onNodeDoubleClick(node, event);
        } else if (onNodeClick) {
          onNodeClick(node, event);
        }
      }
    });

    canvas.on('mousemove', (event) => {
      const [mx, my] = d3.pointer(event);
      const transform = transformRef.current;
      const x = (mx - transform.x) / transform.k;
      const y = (my - transform.y) / transform.k;
      const node = findNearestNode(x, y);

      if (node) {
        setTooltip({ node, x: event.pageX, y: event.pageY - 10, visible: true });
      } else {
        setTooltip((prev) => ({ ...prev, visible: false }));
      }
    });

    return () => {
      canvas.on('.zoom', null);
      canvas.on('click', null);
      canvas.on('mousemove', null);
    };
  }, [useCanvas, data, width, height, canvasTick, findNearestNode, onNodeClick, onNodeDoubleClick]);

  // SVG rendering
  useEffect(() => {
    if (useCanvas) return;
    if (!svgRef.current || data.nodes.length === 0 || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');
    createZoomBehavior(svg, g, 0.1, 4);

    // Links
    g.selectAll('.ng-link')
      .data(data.links)
      .join('line')
      .attr('class', 'ng-link')
      .attr('stroke', (d) => getLinkColor(d))
      .attr('stroke-width', (d) => getLinkWidth(d))
      .attr('stroke-opacity', linkOpacity);

    // Nodes
    const nodeSelection = g.selectAll('.ng-node')
      .data(data.nodes)
      .join('circle')
      .attr('class', 'ng-node')
      .attr('r', (d) => getRadius(d))
      .attr('fill', (d) => getColor(d))
      .attr('stroke', (d) => getStroke(d))
      .attr('stroke-width', (d) => getStrokeWidth(d))
      .style('cursor', 'pointer');

    // Drag behavior
    if (simulation) {
      const drag = d3.drag<any, N>()
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
        });

      nodeSelection.call(drag);
    }

    // Labels
    g.selectAll('.ng-label')
      .data(data.nodes.filter((d) => shouldShowLabel(d)))
      .join('text')
      .attr('class', 'ng-label')
      .attr('text-anchor', 'middle')
      .attr('font', (d) => getLabelFont(d))
      .attr('fill', labelColor)
      .attr('pointer-events', 'none')
      .text((d) => labelText(d));

    // Interactions
    nodeSelection
      .on('click', function (event, d) {
        event.stopPropagation();
        if (event.detail === 2 && onNodeDoubleClick) {
          onNodeDoubleClick(d, event);
        } else if (onNodeClick) {
          onNodeClick(d, event);
        }
      })
      .on('mouseover', function (event, d) {
        setTooltip({ node: d, x: event.pageX, y: event.pageY - 10, visible: true });
      })
      .on('mousemove', function (event) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
      })
      .on('mouseout', function () {
        setTooltip((prev) => ({ ...prev, visible: false }));
      });
  }, [useCanvas, data, width, height, simulation, getColor, getRadius, getStroke, getStrokeWidth, getLinkColor, getLinkWidth, linkOpacity, shouldShowLabel, labelText, labelColor, getLabelFont, onNodeClick, onNodeDoubleClick]);

  const modeLabel = useCanvas ? 'Canvas mode' : 'SVG mode';
  const defaultStatus = `${modeLabel} (${data.nodes.length} nodes) \u2022 ${useCanvas ? 'Click' : 'Drag'} nodes \u2022 Scroll to zoom \u2022 Drag background to pan`;

  return (
    <div ref={containerRef} className={`w-full h-full relative bg-gray-50 rounded-lg ${className}`}>
      {useCanvas ? (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full h-full"
          style={{ cursor: 'pointer' }}
        />
      ) : (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="w-full h-full"
        />
      )}
      {tooltip.visible && tooltip.node && renderTooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, transform: 'translate(-50%, -100%)' }}
        >
          {renderTooltip(tooltip.node)}
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        {statusText ?? defaultStatus}
      </div>
    </div>
  );
}
