import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Info } from 'lucide-react';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useVisualizationResize } from './hooks/useVisualizationResize';

interface CulturalLineage {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  relationshipType: string;
  timeStart: number;
  timeEnd: number;
  confidence: number;
  evidenceTypes: string[];
  description: string;
  sources: string[];
}

interface LineageNode {
  id: string;
  name: string;
  timeStart: number;
  timeEnd: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

interface LineageLink {
  source: string | LineageNode;
  target: string | LineageNode;
  relationshipType: string;
  confidence: number;
  evidenceTypes: string[];
  description: string;
  timeStart: number;
  timeEnd: number;
}

const RELATIONSHIP_COLORS: Record<string, string> = {
  'split-from': '#3b82f6',
  'evolved-into': '#10b981',
  'gave-rise-to': '#f59e0b',
  'influenced': '#8b5cf6',
  'associated-with': '#ec4899',
  'possibly-associated': '#94a3b8',
  'preceded-by': '#f97316',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  'split-from': 'Split From',
  'evolved-into': 'Evolved Into',
  'gave-rise-to': 'Gave Rise To',
  'influenced': 'Influenced',
  'associated-with': 'Associated With',
  'possibly-associated': 'Possibly Associated',
  'preceded-by': 'Preceded By',
};

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function buildGraph(lineages: CulturalLineage[]): { nodes: LineageNode[]; links: LineageLink[] } {
  const nodeMap = new Map<string, LineageNode>();

  for (const l of lineages) {
    if (!nodeMap.has(l.sourceId)) {
      nodeMap.set(l.sourceId, {
        id: l.sourceId,
        name: l.sourceName,
        timeStart: l.timeStart,
        timeEnd: l.timeEnd,
      });
    }
    if (!nodeMap.has(l.targetId)) {
      nodeMap.set(l.targetId, {
        id: l.targetId,
        name: l.targetName,
        timeStart: l.timeStart,
        timeEnd: l.timeEnd,
      });
    }
  }

  const links: LineageLink[] = lineages.map((l) => ({
    source: l.sourceId,
    target: l.targetId,
    relationshipType: l.relationshipType,
    confidence: l.confidence,
    evidenceTypes: l.evidenceTypes,
    description: l.description,
    timeStart: l.timeStart,
    timeEnd: l.timeEnd,
  }));

  return { nodes: Array.from(nodeMap.values()), links };
}

export function CulturalLineageExplorer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: { title: string; details: string[]; } | null;
  }>({ visible: false, x: 0, y: 0, content: null });

  const { data: lineages, isLoading } = useQuery<CulturalLineage[]>({
    queryKey: ['/api/cultural-lineages'],
    staleTime: 60 * 1000,
  });

  const { data: selectedAncestors } = useQuery<CulturalLineage[]>({
    queryKey: [`/api/cultural-lineages/ancestors/${selectedNode}`],
    enabled: !!selectedNode,
    staleTime: 30 * 1000,
  });

  const { data: selectedDescendants } = useQuery<CulturalLineage[]>({
    queryKey: [`/api/cultural-lineages/descendants/${selectedNode}`],
    enabled: !!selectedNode,
    staleTime: 30 * 1000,
  });

  const graph = useMemo(() => {
    if (!lineages) return { nodes: [], links: [] };
    return buildGraph(lineages);
  }, [lineages]);

  const filteredGraph = useMemo(() => {
    if (!searchQuery.trim()) return graph;
    const q = searchQuery.toLowerCase();
    const matchingNodeIds = new Set(
      graph.nodes
        .filter((n) => n.name.toLowerCase().includes(q))
        .map((n) => n.id)
    );
    const filteredLinks = graph.links.filter((l) => {
      const srcId = typeof l.source === 'string' ? l.source : l.source.id;
      const tgtId = typeof l.target === 'string' ? l.target : l.target.id;
      return matchingNodeIds.has(srcId) || matchingNodeIds.has(tgtId);
    });
    // Include connected nodes too
    for (const l of filteredLinks) {
      const srcId = typeof l.source === 'string' ? l.source : l.source.id;
      const tgtId = typeof l.target === 'string' ? l.target : l.target.id;
      matchingNodeIds.add(srcId);
      matchingNodeIds.add(tgtId);
    }
    const filteredNodes = graph.nodes.filter((n) => matchingNodeIds.has(n.id));
    return { nodes: filteredNodes, links: filteredLinks };
  }, [graph, searchQuery]);

  // Highlighted lineage IDs from ancestor/descendant queries
  const highlightedIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const ids = new Set<string>([selectedNode]);
    if (selectedAncestors) {
      for (const a of selectedAncestors) {
        ids.add(a.sourceId);
        ids.add(a.targetId);
      }
    }
    if (selectedDescendants) {
      for (const d of selectedDescendants) {
        ids.add(d.sourceId);
        ids.add(d.targetId);
      }
    }
    return ids;
  }, [selectedNode, selectedAncestors, selectedDescendants]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || filteredGraph.nodes.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Time scale for horizontal positioning
    const timeExtent = d3.extent(filteredGraph.nodes, (n) => n.timeStart) as [number, number];
    const timeScale = d3.scaleLinear()
      .domain([timeExtent[0] - 500, timeExtent[1] + 500])
      .range([100, width - 100]);

    // Arrow marker for directed links
    const defs = svg.append('defs');
    Object.entries(RELATIONSHIP_COLORS).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color);
    });

    // Confidence-based stroke width
    const confidenceScale = d3.scaleLinear()
      .domain([30, 90])
      .range([1, 3])
      .clamp(true);

    // Create simulation with temporal x-positioning
    const simulation = d3.forceSimulation<LineageNode>(filteredGraph.nodes)
      .force('link', d3.forceLink<LineageNode, LineageLink>(filteredGraph.links)
        .id((d) => d.id)
        .distance(80)
        .strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('x', d3.forceX<LineageNode>((d) => timeScale(d.timeStart)).strength(0.3))
      .force('y', d3.forceY(height / 2).strength(0.05))
      .force('collision', d3.forceCollide(25));

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(filteredGraph.links)
      .enter()
      .append('line')
      .attr('stroke', (d) => RELATIONSHIP_COLORS[d.relationshipType] || '#94a3b8')
      .attr('stroke-width', (d) => confidenceScale(d.confidence))
      .attr('stroke-opacity', (d) => {
        if (!selectedNode) return 0.6;
        const srcId = typeof d.source === 'string' ? d.source : d.source.id;
        const tgtId = typeof d.target === 'string' ? d.target : d.target.id;
        return highlightedIds.has(srcId) && highlightedIds.has(tgtId) ? 0.9 : 0.15;
      })
      .attr('marker-end', (d) => `url(#arrow-${d.relationshipType})`)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        const color = RELATIONSHIP_COLORS[d.relationshipType] || '#94a3b8';
        d3.select(this).attr('stroke-width', confidenceScale(d.confidence) + 2);
        setTooltip({
          visible: true,
          x: event.pageX,
          y: event.pageY,
          content: {
            title: `${RELATIONSHIP_LABELS[d.relationshipType] || d.relationshipType}`,
            details: [
              `${formatYear(d.timeStart)} - ${formatYear(d.timeEnd)}`,
              `Confidence: ${d.confidence}%`,
              d.description,
              `Evidence: ${d.evidenceTypes.join(', ')}`,
            ],
          },
        });
      })
      .on('mouseout', function (_event, d) {
        d3.select(this).attr('stroke-width', confidenceScale(d.confidence));
        setTooltip({ visible: false, x: 0, y: 0, content: null });
      });

    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(filteredGraph.nodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, LineageNode>()
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
        })
      )
      .on('click', (_event, d) => {
        handleNodeClick(d.id);
      })
      .on('mouseover', function (event, d) {
        d3.select(this).select('circle').attr('stroke-width', 3);
        setTooltip({
          visible: true,
          x: event.pageX,
          y: event.pageY,
          content: {
            title: d.name,
            details: [
              `Period: ${formatYear(d.timeStart)} - ${formatYear(d.timeEnd)}`,
              `ID: ${d.id}`,
            ],
          },
        });
      })
      .on('mouseout', function () {
        d3.select(this).select('circle').attr('stroke-width', (d: any) =>
          d.id === selectedNode ? 3 : 1.5
        );
        setTooltip({ visible: false, x: 0, y: 0, content: null });
      });

    node.append('circle')
      .attr('r', (d) => (d.id === selectedNode ? 12 : 8))
      .attr('fill', (d) => {
        if (d.id === selectedNode) return '#2563eb';
        if (highlightedIds.has(d.id)) return '#60a5fa';
        return '#cbd5e1';
      })
      .attr('stroke', (d) => {
        if (d.id === selectedNode) return '#1d4ed8';
        if (highlightedIds.has(d.id)) return '#3b82f6';
        return '#94a3b8';
      })
      .attr('stroke-width', (d) => (d.id === selectedNode ? 3 : 1.5))
      .attr('opacity', (d) => {
        if (!selectedNode) return 1;
        return highlightedIds.has(d.id) ? 1 : 0.3;
      });

    node.append('text')
      .text((d) => d.name)
      .attr('dx', 14)
      .attr('dy', 4)
      .attr('font-size', '11px')
      .attr('fill', (d) => {
        if (!selectedNode) return '#374151';
        return highlightedIds.has(d.id) ? '#1f2937' : '#9ca3af';
      })
      .attr('font-weight', (d) => (d.id === selectedNode ? 'bold' : 'normal'));

    // Time axis at the bottom
    const axisG = g.append('g')
      .attr('class', 'time-axis')
      .attr('transform', `translate(0, ${height - 30})`);

    const timeAxis = d3.axisBottom(timeScale)
      .tickFormat((d) => formatYear(d as number))
      .ticks(8);

    axisG.call(timeAxis)
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#6b7280');

    axisG.select('.domain').attr('stroke', '#d1d5db');
    axisG.selectAll('.tick line').attr('stroke', '#e5e7eb');

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as LineageNode).x ?? 0)
        .attr('y1', (d) => (d.source as LineageNode).y ?? 0)
        .attr('x2', (d) => (d.target as LineageNode).x ?? 0)
        .attr('y2', (d) => (d.target as LineageNode).y ?? 0);

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Initial zoom to fit
    const padding = 40;
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(padding, padding)
        .scale(Math.min(
          (width - 2 * padding) / width,
          (height - 2 * padding) / height,
          1
        ))
    );

    return () => {
      simulation.stop();
    };
  }, [filteredGraph, width, height, selectedNode, highlightedIds, handleNodeClick]);

  // Relationship type counts for legend
  const relationshipCounts = useMemo(() => {
    if (!lineages) return {};
    const counts: Record<string, number> = {};
    for (const l of lineages) {
      counts[l.relationshipType] = (counts[l.relationshipType] || 0) + 1;
    }
    return counts;
  }, [lineages]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-gray-600">Loading cultural lineages...</span>
      </div>
    );
  }

  if (!lineages || lineages.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gray-500">No cultural lineage data available</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-white">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search cultures..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Info className="h-3.5 w-3.5" />
          <span>{graph.nodes.length} entities, {graph.links.length} connections</span>
        </div>
        {selectedNode && (
          <button
            onClick={() => setSelectedNode(null)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            Clear selection
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 border-b bg-gray-50 text-xs">
        {Object.entries(RELATIONSHIP_COLORS).map(([type, color]) => {
          const count = relationshipCounts[type];
          if (!count) return null;
          return (
            <span key={type} className="flex items-center gap-1">
              <span className="w-4 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
              <span className="text-gray-600">{RELATIONSHIP_LABELS[type] || type} ({count})</span>
            </span>
          );
        })}
      </div>

      {/* D3 visualization */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="w-full h-full"
        />

        {/* Tooltip */}
        {tooltip.visible && tooltip.content && (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs pointer-events-none"
            style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
          >
            <p className="font-semibold text-sm mb-1">{tooltip.content.title}</p>
            {tooltip.content.details.map((detail, i) => (
              <p key={i} className="text-xs text-gray-600">{detail}</p>
            ))}
          </div>
        )}

        {/* Selected node detail card */}
        {selectedNode && (
          <div className="absolute top-2 right-2 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-sm z-10">
            <h4 className="font-semibold text-sm mb-2">
              {graph.nodes.find((n) => n.id === selectedNode)?.name || selectedNode}
            </h4>
            {selectedAncestors && selectedAncestors.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-700 mb-1">Ancestors ({selectedAncestors.length})</p>
                <div className="flex flex-wrap gap-1">
                  {selectedAncestors.slice(0, 8).map((a) => (
                    <Badge key={a.id} variant="outline" className="text-xs cursor-pointer" onClick={() => handleNodeClick(a.sourceId)}>
                      {a.sourceName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {selectedDescendants && selectedDescendants.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">Descendants ({selectedDescendants.length})</p>
                <div className="flex flex-wrap gap-1">
                  {selectedDescendants.slice(0, 8).map((d) => (
                    <Badge key={d.id} variant="outline" className="text-xs cursor-pointer" onClick={() => handleNodeClick(d.targetId)}>
                      {d.targetName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CulturalLineageExplorer;
