import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, SankeyNode as D3SankeyNode, SankeyLink as D3SankeyLink } from 'd3-sankey';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { createZoomBehavior, getFamilyColor } from '../../lib/visualization/d3-helpers';
import { exportSVG, exportPNG } from '../../lib/visualization/export-utils';
import {
  buildMigrationFlowData,
  buildGeoMigrationRoutes,
  getMigrationGroups,
  type MigrationFlowData,
  type MigrationFlowNode,
  type MigrationFlowLink,
  type GeoMigrationRoute,
} from '../../lib/visualization/migration-flow-data';
import { Download, Map as MapIcon, GitBranch, Filter } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type ViewMode = 'sankey' | 'geo' | 'split';

type SNode = D3SankeyNode<
  { id: string; name: string; group: string },
  { migrationName: string; routeType: string; timePeriod: string }
>;
type SLink = D3SankeyLink<
  { id: string; name: string; group: string },
  { migrationName: string; routeType: string; timePeriod: string }
>;

interface MigrationFlowVisualizationProps {
  data?: MigrationFlowData;
  onNodeClick?: (nodeId: string) => void;
}

const ROUTE_COLORS: Record<string, string> = {
  migration: '#3b82f6',
  conquest: '#ef4444',
  diaspora: '#8b5cf6',
  colonization: '#f59e0b',
  trade: '#10b981',
};

// ============================================================================
// Sankey Panel
// ============================================================================

function SankeyFlowPanel({
  data,
  width,
  height,
  onNodeClick,
}: {
  data: MigrationFlowData;
  width: number;
  height: number;
  onNodeClick?: (nodeId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
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

    const g = svg
      .append('g')
      .attr('class', 'main-group')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    createZoomBehavior(svg, svg.select('.main-group') as any, 0.3, 5);

    const nodeIndex = new Map(data.nodes.map((n, i) => [n.id, i]));
    const sankeyNodes = data.nodes.map((n) => ({ ...n }));
    const sankeyLinks = data.links
      .filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target))
      .map((l) => ({
        source: nodeIndex.get(l.source)!,
        target: nodeIndex.get(l.target)!,
        value: l.value,
        migrationName: l.migrationName,
        routeType: l.routeType,
        timePeriod: l.timePeriod,
      }));

    if (!sankeyLinks.length) return;

    const sankeyLayout = sankey<
      { id: string; name: string; group: string },
      { migrationName: string; routeType: string; timePeriod: string }
    >()
      .nodeId((d: any) => d.index)
      .nodeWidth(18)
      .nodePadding(14)
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ]);

    const graph = sankeyLayout({
      nodes: sankeyNodes.map((n, i) => ({ ...n, index: i })) as any,
      links: sankeyLinks as any,
    });

    // Links
    g.append('g')
      .attr('class', 'links')
      .selectAll('path')
      .data(graph.links as SLink[])
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('fill', 'none')
      .attr('stroke', (d: any) => ROUTE_COLORS[d.routeType] || '#94a3b8')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d: any) => Math.max(1, d.width || 1))
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d: any) {
        d3.select(this).attr('stroke-opacity', 0.8);
        const src = (d.source as any).name || d.source;
        const tgt = (d.target as any).name || d.target;
        setTooltip({
          content: `${d.migrationName}\n${src} → ${tgt}\nType: ${d.routeType}\nPeriod: ${d.timePeriod}\nIntensity: ${d.value}`,
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

    // Nodes
    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(graph.nodes as SNode[])
      .join('g')
      .style('cursor', 'pointer');

    node
      .append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => (d.x1 || 0) - (d.x0 || 0))
      .attr('height', (d: any) => Math.max(1, (d.y1 || 0) - (d.y0 || 0)))
      .attr('fill', (d: any) => getFamilyColor(d.group || d.id))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    node
      .append('text')
      .attr('x', (d: any) => ((d.x0 || 0) < innerWidth / 2 ? (d.x1 || 0) + 6 : (d.x0 || 0) - 6))
      .attr('y', (d: any) => ((d.y0 || 0) + (d.y1 || 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => ((d.x0 || 0) < innerWidth / 2 ? 'start' : 'end'))
      .attr('font-size', '11px')
      .attr('fill', '#1e293b')
      .text((d: any) => d.name);

    node
      .on('click', function (_event: MouseEvent, d: any) {
        if (onNodeClick) onNodeClick(d.id);
      })
      .on('mouseover', function (event: MouseEvent, d: any) {
        setTooltip({
          content: `${d.name}\nRegion: ${d.group}`,
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

  return (
    <>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Geo Distribution Panel (SVG-based world projection)
// ============================================================================

function GeoDistributionPanel({
  routes,
  nodes,
  width,
  height,
}: {
  routes: GeoMigrationRoute[];
  nodes: MigrationFlowNode[];
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const projection = d3
      .geoNaturalEarth1()
      .fitSize([width - 40, height - 40], { type: 'Sphere' } as any)
      .translate([width / 2, height / 2]);

    const pathGenerator = d3.geoPath().projection(projection);

    const g = svg.append('g').attr('class', 'map-group');

    createZoomBehavior(svg, g as any, 0.5, 8);

    // World outline
    g.append('path')
      .datum({ type: 'Sphere' } as any)
      .attr('d', pathGenerator as any)
      .attr('fill', '#f0f9ff')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1);

    // Graticule
    const graticule = d3.geoGraticule();
    g.append('path')
      .datum(graticule())
      .attr('d', pathGenerator as any)
      .attr('fill', 'none')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 0.5);

    // Draw migration routes as curved lines
    for (const route of routes) {
      const coords = route.coordinates;
      if (coords.length < 2) continue;

      const lineData: [number, number][] = coords.map(
        (c) => projection(c) as [number, number]
      ).filter(Boolean);

      if (lineData.length < 2) continue;

      const lineGenerator = d3
        .line<[number, number]>()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRom.alpha(0.5));

      const color = ROUTE_COLORS[route.routeType] || '#94a3b8';

      // Route path
      g.append('path')
        .datum(lineData)
        .attr('d', lineGenerator)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', Math.max(1.5, route.value / 30))
        .attr('stroke-opacity', 0.6)
        .attr('stroke-linecap', 'round')
        .style('cursor', 'pointer')
        .on('mouseover', function (event: MouseEvent) {
          d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', Math.max(3, route.value / 20));
          setTooltip({
            content: `${route.name}\nType: ${route.routeType}\nPeriod: ${route.timePeriod.label}\nLanguages: ${route.languageIds.length}`,
            x: event.pageX,
            y: event.pageY,
            visible: true,
          });
        })
        .on('mousemove', function (event: MouseEvent) {
          setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY }));
        })
        .on('mouseout', function () {
          d3.select(this).attr('stroke-opacity', 0.6).attr('stroke-width', Math.max(1.5, route.value / 30));
          setTooltip((prev) => ({ ...prev, visible: false }));
        });

      // Arrow at destination
      const lastTwo = lineData.slice(-2);
      if (lastTwo.length === 2) {
        const dx = lastTwo[1][0] - lastTwo[0][0];
        const dy = lastTwo[1][1] - lastTwo[0][1];
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        g.append('polygon')
          .attr('points', '0,-5 12,0 0,5')
          .attr('fill', color)
          .attr('fill-opacity', 0.7)
          .attr('transform', `translate(${lastTwo[1][0]},${lastTwo[1][1]}) rotate(${angle})`);
      }
    }

    // Draw node points
    for (const node of nodes) {
      if (node.lat == null || node.lng == null) continue;
      const pos = projection([node.lng, node.lat]);
      if (!pos) continue;

      g.append('circle')
        .attr('cx', pos[0])
        .attr('cy', pos[1])
        .attr('r', 5)
        .attr('fill', getFamilyColor(node.group))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .on('mouseover', function (event: MouseEvent) {
          d3.select(this).attr('r', 8);
          setTooltip({
            content: `${node.name}\nRegion: ${node.group}`,
            x: event.pageX,
            y: event.pageY,
            visible: true,
          });
        })
        .on('mousemove', function (event: MouseEvent) {
          setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY }));
        })
        .on('mouseout', function () {
          d3.select(this).attr('r', 5);
          setTooltip((prev) => ({ ...prev, visible: false }));
        });
    }
  }, [routes, nodes, width, height]);

  return (
    <>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function MigrationFlowVisualization({ data, onNodeClick }: MigrationFlowVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [filterGroup, setFilterGroup] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  const groups = useMemo(() => getMigrationGroups(), []);

  const flowData = useMemo(() => {
    if (data) return data;
    return buildMigrationFlowData(filterGroup ? { filterGroup } : undefined);
  }, [data, filterGroup]);

  const geoRoutes = useMemo(() => {
    return buildGeoMigrationRoutes(filterGroup ? { filterGroup } : undefined);
  }, [filterGroup]);

  const panelWidth = viewMode === 'split' ? Math.floor(width / 2) : width;
  const panelHeight = height - 48; // account for toolbar

  async function handleExport(format: 'svg' | 'png') {
    if (!containerRef.current || exporting) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;
    setExporting(true);
    try {
      if (format === 'svg') exportSVG(svgEl as SVGSVGElement, 'migration-flow.svg');
      else await exportPNG(svgEl as SVGSVGElement, 'migration-flow.png');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-white/80 rounded-t-lg shrink-0">
        <div className="flex gap-1 bg-gray-100 rounded p-0.5">
          <button
            onClick={() => setViewMode('sankey')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'sankey' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <GitBranch className="h-3 w-3" /> Sankey
          </button>
          <button
            onClick={() => setViewMode('geo')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'geo' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MapIcon className="h-3 w-3" /> Map
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'split' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Split
          </button>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <Filter className="h-3 w-3 text-gray-400" />
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            className="text-xs border rounded px-1.5 py-1 bg-white text-gray-700"
          >
            <option value="">All Regions</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex gap-1">
          <button
            onClick={() => handleExport('svg')}
            disabled={exporting}
            className="flex items-center gap-1 bg-white hover:bg-gray-50 border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          >
            <Download className="h-3 w-3" /> SVG
          </button>
          <button
            onClick={() => handleExport('png')}
            disabled={exporting}
            className="flex items-center gap-1 bg-white hover:bg-gray-50 border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          >
            <Download className="h-3 w-3" /> PNG
          </button>
        </div>
      </div>

      {/* Panels */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {(viewMode === 'sankey' || viewMode === 'split') && (
          <div className={`relative ${viewMode === 'split' ? 'w-1/2 border-r' : 'w-full'}`}>
            <SankeyFlowPanel
              data={flowData}
              width={panelWidth}
              height={panelHeight}
              onNodeClick={onNodeClick}
            />
          </div>
        )}
        {(viewMode === 'geo' || viewMode === 'split') && (
          <div className={`relative ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
            <GeoDistributionPanel
              routes={geoRoutes}
              nodes={flowData.nodes}
              width={panelWidth}
              height={panelHeight}
            />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 bg-white/90 rounded-lg border px-3 py-2 text-xs space-y-1">
        <div className="font-medium text-gray-700 mb-1">Migration Types</div>
        {Object.entries(ROUTE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="capitalize">{type}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-3 left-3 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom · Drag to pan · Hover for details
      </div>
    </div>
  );
}
