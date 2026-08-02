import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, SankeyNode as D3SankeyNode, SankeyLink as D3SankeyLink } from 'd3-sankey';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { createZoomBehavior } from '../../lib/visualization/d3-helpers';
import { exportSVG, exportPNG } from '../../lib/visualization/export-utils';
import { Download } from 'lucide-react';

// --- Public types ---

export interface SankeyFlowNode {
  id: string;
  label: string;
  group: string;
}

export interface SankeyFlowLink {
  source: string;
  target: string;
  value: number;
  category?: string;
  metadata?: Record<string, string>;
}

export interface SankeyFlowData {
  nodes: SankeyFlowNode[];
  links: SankeyFlowLink[];
}

export interface SankeyFlowColorScheme {
  [category: string]: string;
}

export interface SankeyFlowProps {
  data: SankeyFlowData;
  colorScheme?: SankeyFlowColorScheme;
  nodeColorFn?: (node: SankeyFlowNode) => string;
  linkColorFn?: (link: SankeyFlowLink) => string;
  formatNodeTooltip?: (node: SankeyFlowNode) => string;
  formatLinkTooltip?: (link: SankeyFlowLink, sourceLabel: string, targetLabel: string) => string;
  legendTitle?: string;
  exportFilenamePrefix?: string;
  onNodeClick?: (nodeId: string) => void;
  nodeWidth?: number;
  nodePadding?: number;
  className?: string;
}

// --- Default helpers ---

const DEFAULT_COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function defaultNodeColor(node: SankeyFlowNode): string {
  return DEFAULT_COLOR_PALETTE[hashString(node.group) % DEFAULT_COLOR_PALETTE.length];
}

function defaultLinkColor(link: SankeyFlowLink, colorScheme?: SankeyFlowColorScheme): string {
  if (colorScheme && link.category && colorScheme[link.category]) {
    return colorScheme[link.category];
  }
  return '#94a3b8';
}

function defaultNodeTooltip(node: SankeyFlowNode): string {
  return `${node.label}\nGroup: ${node.group}`;
}

function defaultLinkTooltip(link: SankeyFlowLink, sourceLabel: string, targetLabel: string): string {
  let text = `${sourceLabel} → ${targetLabel}\nValue: ${link.value}`;
  if (link.category) text += `\nCategory: ${link.category}`;
  if (link.metadata) {
    for (const [key, val] of Object.entries(link.metadata)) {
      text += `\n${key}: ${val}`;
    }
  }
  return text;
}

// --- D3 internal types ---

type NodeExtra = { id: string; label: string; group: string };
type LinkExtra = { category?: string; metadata?: Record<string, string> };
type SNode = D3SankeyNode<NodeExtra, LinkExtra>;
type SLink = D3SankeyLink<NodeExtra, LinkExtra>;

// --- Component ---

export function SankeyFlow({
  data,
  colorScheme,
  nodeColorFn,
  linkColorFn,
  formatNodeTooltip,
  formatLinkTooltip,
  legendTitle,
  exportFilenamePrefix = 'sankey-flow',
  onNodeClick,
  nodeWidth = 18,
  nodePadding = 12,
  className,
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

  const getNodeColor = useCallback(
    (node: SankeyFlowNode) => nodeColorFn ? nodeColorFn(node) : defaultNodeColor(node),
    [nodeColorFn],
  );

  const getLinkColor = useCallback(
    (link: SankeyFlowLink) => linkColorFn ? linkColorFn(link) : defaultLinkColor(link, colorScheme),
    [linkColorFn, colorScheme],
  );

  const getNodeTooltipText = useCallback(
    (node: SankeyFlowNode) => formatNodeTooltip ? formatNodeTooltip(node) : defaultNodeTooltip(node),
    [formatNodeTooltip],
  );

  const getLinkTooltipText = useCallback(
    (link: SankeyFlowLink, src: string, tgt: string) =>
      formatLinkTooltip ? formatLinkTooltip(link, src, tgt) : defaultLinkTooltip(link, src, tgt),
    [formatLinkTooltip],
  );

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('class', 'main-group')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    createZoomBehavior(svg, svg.select('.main-group') as any, 0.3, 5);

    // Build index maps for d3-sankey (requires numeric indices)
    const nodeIndex = new Map(data.nodes.map((n, i) => [n.id, i]));
    const sankeyNodes = data.nodes.map((n) => ({ ...n }));
    const sankeyLinks = data.links
      .filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target))
      .map((l) => ({
        source: nodeIndex.get(l.source)!,
        target: nodeIndex.get(l.target)!,
        value: l.value,
        category: l.category,
        metadata: l.metadata,
      }));

    if (!sankeyLinks.length) return;

    const sankeyLayout = sankey<NodeExtra, LinkExtra>()
      .nodeId((d: any) => d.index)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([[0, 0], [innerWidth, innerHeight]]);

    const graph = sankeyLayout({
      nodes: sankeyNodes.map((n, i) => ({ ...n, index: i })) as any,
      links: sankeyLinks as any,
    });

    // Draw links
    g.append('g')
      .attr('class', 'links')
      .selectAll('path')
      .data(graph.links as SLink[])
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('fill', 'none')
      .attr('stroke', (d: any) => getLinkColor(d))
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d: any) => Math.max(1, d.width || 1))
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d: any) {
        d3.select(this).attr('stroke-opacity', 0.8);
        const src = (d.source as any).label || d.source;
        const tgt = (d.target as any).label || d.target;
        setTooltip({
          content: getLinkTooltipText(d, src, tgt),
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
      });

    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(graph.nodes as SNode[])
      .join('g')
      .style('cursor', 'pointer');

    node.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => (d.x1 || 0) - (d.x0 || 0))
      .attr('height', (d: any) => Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
      .attr('fill', (d: any) => getNodeColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    node.append('text')
      .attr('x', (d: any) => (d.x0 || 0) < innerWidth / 2 ? (d.x1 || 0) + 6 : (d.x0 || 0) - 6)
      .attr('y', (d: any) => ((d.y0 || 0) + (d.y1 || 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => (d.x0 || 0) < innerWidth / 2 ? 'start' : 'end')
      .attr('font-size', '11px')
      .attr('fill', '#1e293b')
      .text((d: any) => d.label);

    node
      .on('click', function (_event: MouseEvent, d: any) {
        if (onNodeClick) onNodeClick(d.id);
      })
      .on('mouseover', function (event: MouseEvent, d: any) {
        setTooltip({
          content: getNodeTooltipText(d),
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
  }, [data, width, height, onNodeClick, getNodeColor, getLinkColor, getNodeTooltipText, getLinkTooltipText, nodeWidth, nodePadding]);

  const [exporting, setExporting] = useState(false);

  async function handleExport(format: 'svg' | 'png') {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    try {
      if (format === 'svg') exportSVG(svgRef.current, `${exportFilenamePrefix}.svg`);
      else await exportPNG(svgRef.current, `${exportFilenamePrefix}.png`);
    } finally {
      setExporting(false);
    }
  }

  // Derive legend entries from colorScheme
  const legendEntries = colorScheme ? Object.entries(colorScheme) : null;

  return (
    <div ref={containerRef} className={`w-full h-full relative bg-gray-50 rounded-lg ${className || ''}`}>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
      <div className="absolute top-3 left-3 flex gap-1">
        <button
          onClick={function () { handleExport('svg'); }}
          disabled={exporting}
          className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
        >
          <Download className="h-3 w-3" /> SVG
        </button>
        <button
          onClick={function () { handleExport('png'); }}
          disabled={exporting}
          className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
        >
          <Download className="h-3 w-3" /> PNG
        </button>
      </div>
      {legendEntries && legendEntries.length > 0 && (
        <div className="absolute top-3 right-3 bg-white/90 rounded-lg border px-3 py-2 text-xs space-y-1">
          {legendTitle && <div className="font-medium text-gray-700 mb-1">{legendTitle}</div>}
          {legendEntries.map(function ([label, color]) {
            return (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="capitalize">{label}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom · Drag to pan · Click node to filter
      </div>
    </div>
  );
}
