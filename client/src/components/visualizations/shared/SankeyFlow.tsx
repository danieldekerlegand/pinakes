import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, SankeyNode as D3SankeyNode, SankeyLink as D3SankeyLink } from 'd3-sankey';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { createZoomBehavior } from '../../../lib/visualization/d3-helpers';

export interface SankeyFlowNode {
  id: string;
  name: string;
  group: string;
}

export interface SankeyFlowLink {
  source: string;
  target: string;
  value: number;
  label?: string;
  category?: string;
}

export interface SankeyFlowProps {
  nodes: SankeyFlowNode[];
  links: SankeyFlowLink[];
  nodeColorFn?: (node: SankeyFlowNode) => string;
  linkColorFn?: (link: SankeyFlowLink) => string;
  onNodeClick?: (nodeId: string) => void;
  onLinkClick?: (link: SankeyFlowLink) => void;
  nodeWidth?: number;
  nodePadding?: number;
  formatTooltip?: (type: 'node' | 'link', datum: any) => string;
  className?: string;
}

type SNode = D3SankeyNode<SankeyFlowNode, SankeyFlowLink>;
type SLink = D3SankeyLink<SankeyFlowNode, SankeyFlowLink>;

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function defaultNodeColor(node: SankeyFlowNode): string {
  let hash = 0;
  for (let i = 0; i < node.group.length; i++) {
    hash = node.group.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

function defaultLinkColor(_link: SankeyFlowLink): string {
  return '#94a3b8';
}

function defaultFormatTooltip(type: 'node' | 'link', datum: any): string {
  if (type === 'node') {
    return `${datum.name}\nGroup: ${datum.group}`;
  }
  const src = (datum.source as any).name || datum.source;
  const tgt = (datum.target as any).name || datum.target;
  return `${src} → ${tgt}\n${datum.label ? `Type: ${datum.label}\n` : ''}Value: ${datum.value}`;
}

export function SankeyFlow({
  nodes,
  links,
  nodeColorFn = defaultNodeColor,
  linkColorFn = defaultLinkColor,
  onNodeClick,
  onLinkClick,
  nodeWidth = 18,
  nodePadding = 12,
  formatTooltip = defaultFormatTooltip,
  className = '',
}: SankeyFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  useEffect(() => {
    if (!svgRef.current || !nodes.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('class', 'sankey-main')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    createZoomBehavior(svg, svg.select('.sankey-main') as any, 0.3, 5);

    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const sankeyNodes = nodes.map((n) => ({ ...n }));
    const sankeyLinks = links
      .filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target))
      .map((l) => ({
        source: nodeIndex.get(l.source)!,
        target: nodeIndex.get(l.target)!,
        value: l.value,
        label: l.label,
        category: l.category,
      }));

    if (!sankeyLinks.length) return;

    const sankeyLayout = sankey<SankeyFlowNode, SankeyFlowLink>()
      .nodeId((d: any) => d.index)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([[0, 0], [innerWidth, innerHeight]]);

    const graph = sankeyLayout({
      nodes: sankeyNodes.map((n, i) => ({ ...n, index: i })) as any,
      links: sankeyLinks as any,
    });

    // Links
    g.append('g')
      .attr('class', 'sankey-links')
      .selectAll('path')
      .data(graph.links as SLink[])
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('fill', 'none')
      .attr('stroke', (d: any) => linkColorFn(d))
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d: any) => Math.max(1, d.width || 1))
      .style('cursor', onLinkClick ? 'pointer' : 'default')
      .on('mouseover', function (event: MouseEvent, d: any) {
        d3.select(this).attr('stroke-opacity', 0.8);
        setTooltip({
          content: formatTooltip('link', d),
          x: event.pageX,
          y: event.pageY,
          visible: true,
        });
      })
      .on('mousemove', function (event: MouseEvent) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY }));
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke-opacity', 0.4);
        setTooltip((prev) => ({ ...prev, visible: false }));
      })
      .on('click', function (_event: MouseEvent, d: any) {
        if (onLinkClick) onLinkClick(d);
      });

    // Nodes
    const node = g.append('g')
      .attr('class', 'sankey-nodes')
      .selectAll('g')
      .data(graph.nodes as SNode[])
      .join('g')
      .style('cursor', onNodeClick ? 'pointer' : 'default');

    node.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => (d.x1 || 0) - (d.x0 || 0))
      .attr('height', (d: any) => Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
      .attr('fill', (d: any) => nodeColorFn(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    node.append('text')
      .attr('x', (d: any) => (d.x0 || 0) < innerWidth / 2 ? (d.x1 || 0) + 6 : (d.x0 || 0) - 6)
      .attr('y', (d: any) => ((d.y0 || 0) + (d.y1 || 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => (d.x0 || 0) < innerWidth / 2 ? 'start' : 'end')
      .attr('font-size', '11px')
      .attr('fill', '#1e293b')
      .text((d: any) => d.name);

    node
      .on('click', function (_event: MouseEvent, d: any) {
        if (onNodeClick) onNodeClick(d.id);
      })
      .on('mouseover', function (event: MouseEvent, d: any) {
        setTooltip({
          content: formatTooltip('node', d),
          x: event.pageX,
          y: event.pageY,
          visible: true,
        });
      })
      .on('mousemove', function (event: MouseEvent) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY }));
      })
      .on('mouseout', function () {
        setTooltip((prev) => ({ ...prev, visible: false }));
      });
  }, [nodes, links, width, height, nodeColorFn, linkColorFn, onNodeClick, onLinkClick, nodeWidth, nodePadding, formatTooltip]);

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
        Scroll to zoom · Drag to pan
      </div>
    </div>
  );
}
