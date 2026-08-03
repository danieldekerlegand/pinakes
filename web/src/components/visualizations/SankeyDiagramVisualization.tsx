import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, SankeyNode as D3SankeyNode, SankeyLink as D3SankeyLink } from 'd3-sankey';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { createZoomBehavior, getFamilyColor } from '../../lib/visualization/d3-helpers';
import { exportSVG, exportPNG } from '../../lib/visualization/export-utils';
import { CONTACT_TYPE_COLORS as CONTACT_COLORS, INTERACTION_COLORS, VIS_TEXT_COLORS } from '../../lib/visualization/color-theme';
import { Download } from 'lucide-react';
import type { SankeyData } from '@contracts/types';

interface SankeyDiagramVisualizationProps {
  data: SankeyData;
  onNodeClick?: (nodeId: string) => void;
}

type SNode = D3SankeyNode<{ id: string; name: string; group: string }, { contactType: string; timePeriod: string }>;
type SLink = D3SankeyLink<{ id: string; name: string; group: string }, { contactType: string; timePeriod: string }>;

export function SankeyDiagramVisualization({ data, onNodeClick }: SankeyDiagramVisualizationProps) {
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
        contactType: l.contactType,
        timePeriod: l.timePeriod,
      }));

    if (!sankeyLinks.length) return;

    const sankeyLayout = sankey<{ id: string; name: string; group: string }, { contactType: string; timePeriod: string }>()
      .nodeId((d: any) => d.index)
      .nodeWidth(18)
      .nodePadding(12)
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
      .attr('stroke', (d: any) => CONTACT_COLORS[d.contactType] || INTERACTION_COLORS.defaultFallback)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d: any) => Math.max(1, d.width || 1))
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d: any) {
        d3.select(this).attr('stroke-opacity', 0.8);
        const src = (d.source as any).name || d.source;
        const tgt = (d.target as any).name || d.target;
        setTooltip({
          content: `${src} → ${tgt}\nType: ${d.contactType}\nPeriod: ${d.timePeriod}\nIntensity: ${d.value}`,
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
      .attr('fill', (d: any) => getFamilyColor(d.group || d.id))
      .attr('stroke', INTERACTION_COLORS.defaultNodeBorder)
      .attr('stroke-width', 1);

    node.append('text')
      .attr('x', (d: any) => (d.x0 || 0) < innerWidth / 2 ? (d.x1 || 0) + 6 : (d.x0 || 0) - 6)
      .attr('y', (d: any) => ((d.y0 || 0) + (d.y1 || 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => (d.x0 || 0) < innerWidth / 2 ? 'start' : 'end')
      .attr('font-size', '11px')
      .attr('fill', VIS_TEXT_COLORS.darkest)
      .text((d: any) => d.name);

    node
      .on('click', function (_event: MouseEvent, d: any) {
        if (onNodeClick) onNodeClick(d.id);
      })
      .on('mouseover', function (event: MouseEvent, d: any) {
        setTooltip({
          content: `${d.name}\nFamily: ${d.group}`,
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
  }, [data, width, height, onNodeClick]);

  const [exporting, setExporting] = useState(false);

  async function handleExport(format: 'svg' | 'png') {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    try {
      if (format === 'svg') exportSVG(svgRef.current, 'sankey-diagram.svg');
      else await exportPNG(svgRef.current, 'sankey-diagram.png');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
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
      {/* Legend for contact types */}
      <div className="absolute top-3 right-3 bg-white/90 rounded-lg border px-3 py-2 text-xs space-y-1">
        <div className="font-medium text-gray-700 mb-1">Contact Types</div>
        {Object.entries(CONTACT_COLORS).map(function ([type, color]) {
          return (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="capitalize">{type}</span>
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom · Drag to pan · Click node to filter
      </div>
    </div>
  );
}
