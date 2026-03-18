import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualization } from '../../contexts/VisualizationContext';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { useD3Simulation, useNodePinning } from './hooks/useD3Simulation';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { NetworkData, NetworkNode, NetworkLink, TooltipData } from '../../lib/visualization/types';
import {
  getFamilyColor,
  createDragBehavior,
  createZoomBehavior,
} from '../../lib/visualization/d3-helpers';

const CANVAS_THRESHOLD = 500;

interface LanguageNetworkViewProps {
  networkData: NetworkData;
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
}

export function LanguageNetworkView({ networkData, onNodeClick }: LanguageNetworkViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const { state, isLanguageSelected, isHighlighted } = useVisualization();
  const { togglePin, isPinned } = useNodePinning();

  const useCanvas = networkData.nodes.length > CANVAS_THRESHOLD;

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

  // Canvas transform state for zoom/pan
  const transformRef = useRef(d3.zoomIdentity);

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
    ctx.strokeStyle = '#cbd5e0';
    ctx.globalAlpha = 0.6;
    for (const link of networkData.links) {
      const source = link.source as any;
      const target = link.target as any;
      ctx.lineWidth = link.type === 'family-child' ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(source.x ?? 0, source.y ?? 0);
      ctx.lineTo(target.x ?? 0, target.y ?? 0);
      ctx.stroke();
    }

    // Draw nodes
    ctx.globalAlpha = 1;
    for (const node of networkData.nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const selected = node.type === 'language' && isLanguageSelected(node.id);
      const highlighted = isHighlighted(node.id);

      ctx.beginPath();
      ctx.arc(x, y, node.size, 0, 2 * Math.PI);

      ctx.fillStyle = (selected || highlighted) ? '#3b82f6' : getFamilyColor(node.group);
      ctx.fill();

      ctx.strokeStyle = selected ? '#1d4ed8' : isPinned(node.id) ? '#ef4444' : '#ffffff';
      ctx.lineWidth = (selected || isPinned(node.id)) ? 3 : 2;
      ctx.stroke();
    }

    // Draw labels for family nodes
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'center';
    for (const node of networkData.nodes) {
      if (node.type !== 'family' && !state.viewSettings.network.showLabels) continue;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.font = node.type === 'family' ? '600 12px sans-serif' : '400 10px sans-serif';
      const label = node.name.length > 20 ? node.name.substring(0, 17) + '...' : node.name;
      ctx.fillText(label, x, y + node.size + 12);
    }

    ctx.restore();
  }, [networkData, width, height, useCanvas, isLanguageSelected, isHighlighted, isPinned, state.viewSettings.network.showLabels]);

  // SVG tick handler
  const svgTick = useCallback(() => {
    if (!svgRef.current || useCanvas) return;

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
  }, [useCanvas]);

  // Use the D3 simulation hook
  const simulation = useD3Simulation(
    networkData.nodes,
    networkData.links,
    width,
    height,
    state.viewSettings.network,
    useCanvas ? canvasTick : svgTick,
  );

  // Canvas zoom/pan and interactions
  useEffect(() => {
    if (!canvasRef.current || !useCanvas || width === 0 || height === 0) return;

    const canvas = d3.select(canvasRef.current);

    // Zoom behavior for canvas
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        canvasTick();
      });

    canvas.call(zoom);

    // Click handler - find nearest node
    canvas.on('click', (event) => {
      const [mx, my] = d3.pointer(event);
      const transform = transformRef.current;
      const x = (mx - transform.x) / transform.k;
      const y = (my - transform.y) / transform.k;

      let closest: NetworkNode | null = null;
      let minDist = Infinity;
      for (const node of networkData.nodes) {
        const dx = (node.x ?? 0) - x;
        const dy = (node.y ?? 0) - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < node.size + 4 && dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }

      if (closest && onNodeClick) {
        onNodeClick(closest.id, closest.type);
      }
    });

    // Mousemove handler for tooltips
    canvas.on('mousemove', (event) => {
      const [mx, my] = d3.pointer(event);
      const transform = transformRef.current;
      const x = (mx - transform.x) / transform.k;
      const y = (my - transform.y) / transform.k;

      let closest: NetworkNode | null = null;
      let minDist = Infinity;
      for (const node of networkData.nodes) {
        const dx = (node.x ?? 0) - x;
        const dy = (node.y ?? 0) - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < node.size + 4 && dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }

      if (closest) {
        setTooltip({
          data: {
            id: closest.id,
            name: closest.name,
            type: closest.type,
            region: closest.region,
            status: closest.status,
            totalSpeakers: closest.totalSpeakers,
          },
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });
      } else {
        setTooltip((prev) => ({ ...prev, visible: false }));
      }
    });

    return () => {
      canvas.on('.zoom', null);
      canvas.on('click', null);
      canvas.on('mousemove', null);
    };
  }, [useCanvas, networkData, width, height, canvasTick, onNodeClick]);

  // SVG rendering effect (only when not using canvas)
  useEffect(() => {
    if (useCanvas) return;
    if (!svgRef.current || !networkData || networkData.nodes.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create main group for zoom/pan
    const g = svg.append('g').attr('class', 'main-group');

    // Set up zoom
    createZoomBehavior(svg, g, 0.1, 4);

    // Draw links
    g.selectAll('.link')
      .data(networkData.links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#cbd5e0')
      .attr('stroke-width', (d) => d.type === 'family-child' ? 2 : 1)
      .attr('stroke-opacity', 0.6);

    // Draw nodes
    const node = g.selectAll('.node')
      .data(networkData.nodes)
      .join('circle')
      .attr('class', 'node')
      .attr('r', (d) => d.size)
      .attr('fill', (d) => {
        const selected = d.type === 'language' && isLanguageSelected(d.id);
        const highlighted = isHighlighted(d.id);
        if (selected || highlighted) return '#3b82f6';
        return getFamilyColor(d.group);
      })
      .attr('stroke', (d) => {
        const selected = d.type === 'language' && isLanguageSelected(d.id);
        if (selected) return '#1d4ed8';
        if (isPinned(d.id)) return '#ef4444';
        return '#fff';
      })
      .attr('stroke-width', (d) => {
        const selected = d.type === 'language' && isLanguageSelected(d.id);
        if (selected || isPinned(d.id)) return 3;
        return 2;
      })
      .style('cursor', 'pointer')
      .call(simulation ? createDragBehavior(simulation) : (() => {}) as any);

    // Add labels (show only for selected or family nodes)
    g.selectAll('.label')
      .data(networkData.nodes.filter((d) => d.type === 'family' || state.viewSettings.network.showLabels))
      .join('text')
      .attr('class', 'label')
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => d.type === 'family' ? '12px' : '10px')
      .attr('font-weight', (d) => d.type === 'family' ? 600 : 400)
      .attr('fill', '#374151')
      .attr('pointer-events', 'none')
      .text((d) => d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name);

    // Add interactions
    node
      .on('click', function(event, d) {
        event.stopPropagation();
        if (event.detail === 2) {
          // Double-click to pin/unpin
          const pinState = togglePin(d.id, d.x, d.y);
          d.fx = pinState.fx;
          d.fy = pinState.fy;

          // Update stroke to show pinned state
          d3.select(this)
            .attr('stroke', isPinned(d.id) ? '#ef4444' : '#fff')
            .attr('stroke-width', isPinned(d.id) ? 3 : 2);
        } else {
          if (onNodeClick) {
            onNodeClick(d.id, d.type);
          }
        }
      })
      .on('mouseover', function(event, d) {
        const tooltipData: TooltipData = {
          id: d.id,
          name: d.name,
          type: d.type,
          region: d.region,
          status: d.status,
          totalSpeakers: d.totalSpeakers,
        };

        setTooltip({
          data: tooltipData,
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });
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
      });

  }, [useCanvas, networkData, width, height, simulation, isLanguageSelected, isHighlighted, onNodeClick, state.viewSettings.network.showLabels, isPinned, togglePin]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
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
      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        {useCanvas ? 'Canvas mode' : 'SVG mode'} ({networkData.nodes.length} nodes) • {useCanvas ? 'Click' : 'Drag'} nodes • Scroll to zoom • Drag background to pan
      </div>
    </div>
  );
}
