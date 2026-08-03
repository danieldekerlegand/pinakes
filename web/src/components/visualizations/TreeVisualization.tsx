import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import { createZoomBehavior } from '../../lib/visualization/d3-helpers';
import { cn } from '../../lib/utils';
import type { TooltipData } from '../../lib/visualization/types';

export interface TreeNodeData {
  id: string;
  name: string;
  children?: TreeNodeData[];
  [key: string]: any;
}

export interface TreeVisualizationConfig {
  orientation: 'horizontal' | 'vertical';
  nodeRadius?: number | ((node: d3.HierarchyPointNode<TreeNodeData>) => number);
  nodeColor?: string | ((node: d3.HierarchyPointNode<TreeNodeData>) => string);
  linkColor?: string;
  linkWidth?: number;
  labelSize?: number | ((node: d3.HierarchyPointNode<TreeNodeData>) => number);
  labelColor?: string;
  separation?: (a: d3.HierarchyPointNode<TreeNodeData>, b: d3.HierarchyPointNode<TreeNodeData>) => number;
  padding?: { top: number; right: number; bottom: number; left: number };
  minZoom?: number;
  maxZoom?: number;
  expandDepth?: number;
  animationDuration?: number;
}

export interface TreeVisualizationProps {
  data: TreeNodeData | TreeNodeData[];
  config?: Partial<TreeVisualizationConfig>;
  className?: string;
  onNodeClick?: (node: TreeNodeData) => void;
  tooltipContent?: (node: TreeNodeData) => TooltipData;
  selectedNodeIds?: Set<string>;
  highlightedNodeIds?: Set<string>;
  searchQuery?: string;
}

const DEFAULT_CONFIG: TreeVisualizationConfig = {
  orientation: 'horizontal',
  nodeRadius: 6,
  nodeColor: '#3b82f6',
  linkColor: '#cbd5e0',
  linkWidth: 1.5,
  labelSize: 12,
  labelColor: '#374151',
  padding: { top: 40, right: 120, bottom: 40, left: 120 },
  minZoom: 0.1,
  maxZoom: 4,
  animationDuration: 300,
};

function getNodeRadius(
  node: d3.HierarchyPointNode<TreeNodeData>,
  config: TreeVisualizationConfig,
): number {
  if (typeof config.nodeRadius === 'function') return config.nodeRadius(node);
  return config.nodeRadius ?? 6;
}

function getNodeColor(
  node: d3.HierarchyPointNode<TreeNodeData>,
  config: TreeVisualizationConfig,
  selected: boolean,
  highlighted: boolean,
): string {
  if (selected) return '#2563eb';
  if (highlighted) return '#f59e0b';
  if (typeof config.nodeColor === 'function') return config.nodeColor(node);
  return config.nodeColor ?? '#3b82f6';
}

function getLabelSize(
  node: d3.HierarchyPointNode<TreeNodeData>,
  config: TreeVisualizationConfig,
): number {
  if (typeof config.labelSize === 'function') return config.labelSize(node);
  return config.labelSize ?? 12;
}

function matchesSearch(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

export function TreeVisualization({
  data,
  config: userConfig,
  className,
  onNodeClick,
  tooltipContent,
  selectedNodeIds,
  highlightedNodeIds,
  searchQuery,
}: TreeVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const config = useMemo(() => ({ ...DEFAULT_CONFIG, ...userConfig }), [userConfig]);

  const [tooltip, setTooltip] = useState<{
    data: TooltipData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ data: null, x: 0, y: 0, visible: false });

  const rootData = useMemo<TreeNodeData>(() => {
    if (Array.isArray(data)) {
      return { id: '__root__', name: 'Root', children: data };
    }
    return data;
  }, [data]);

  const handleMouseOver = useCallback(
    (event: MouseEvent, d: d3.HierarchyPointNode<TreeNodeData>) => {
      if (d.data.id === '__root__') return;
      const tooltipData: TooltipData = tooltipContent
        ? tooltipContent(d.data)
        : { id: d.data.id, name: d.data.name, type: 'family' };

      setTooltip({
        data: tooltipData,
        x: event.pageX,
        y: event.pageY - 10,
        visible: true,
      });
    },
    [tooltipContent],
  );

  const handleMouseMove = useCallback((event: MouseEvent) => {
    setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
  }, []);

  const handleMouseOut = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const pad = config.padding!;
    const g = svg.append('g').attr('class', 'tree-main');

    createZoomBehavior(svg, g, config.minZoom!, config.maxZoom!);

    const isHorizontal = config.orientation === 'horizontal';
    const treeWidth = (isHorizontal ? width : height) - (isHorizontal ? pad.left + pad.right : pad.top + pad.bottom);
    const treeHeight = (isHorizontal ? height : width) - (isHorizontal ? pad.top + pad.bottom : pad.left + pad.right);

    const treeLayout = d3
      .tree<TreeNodeData>()
      .size([treeHeight, treeWidth]);

    if (config.separation) {
      treeLayout.separation(config.separation);
    }

    const hierarchy = d3.hierarchy<TreeNodeData>(rootData, (d) => d.children);
    const treeNodes = treeLayout(hierarchy);

    // Draw links
    const linkGenerator = isHorizontal
      ? d3.linkHorizontal<any, any>().x((d) => d.y + pad.left).y((d) => d.x + pad.top)
      : d3.linkVertical<any, any>().x((d) => d.x + pad.left).y((d) => d.y + pad.top);

    g.selectAll('.tree-link')
      .data(treeNodes.links().filter((l) => l.source.data.id !== '__root__' || !Array.isArray(data)))
      .join('path')
      .attr('class', 'tree-link')
      .attr('d', linkGenerator)
      .attr('fill', 'none')
      .attr('stroke', config.linkColor!)
      .attr('stroke-width', config.linkWidth!);

    // If data was an array, also draw links from virtual root but make them subtler
    if (Array.isArray(data)) {
      g.selectAll('.tree-root-link')
        .data(treeNodes.links().filter((l) => l.source.data.id === '__root__'))
        .join('path')
        .attr('class', 'tree-root-link')
        .attr('d', linkGenerator)
        .attr('fill', 'none')
        .attr('stroke', config.linkColor!)
        .attr('stroke-width', config.linkWidth! * 0.5)
        .attr('stroke-dasharray', '4,4');
    }

    // Draw nodes (skip virtual root)
    const descendants = treeNodes.descendants().filter((d) => d.data.id !== '__root__');

    const node = g
      .selectAll('.tree-node')
      .data(descendants)
      .join('g')
      .attr('class', 'tree-node')
      .attr('transform', (d) =>
        isHorizontal
          ? `translate(${d.y + pad.left},${d.x + pad.top})`
          : `translate(${d.x + pad.left},${d.y + pad.top})`,
      )
      .style('cursor', onNodeClick ? 'pointer' : 'default');

    // Node circles
    node
      .append('circle')
      .attr('r', (d) => getNodeRadius(d, config))
      .attr('fill', (d) => {
        const isSelected = selectedNodeIds?.has(d.data.id) ?? false;
        const isHighlighted = highlightedNodeIds?.has(d.data.id) ?? false;
        const isSearchMatch = searchQuery ? matchesSearch(d.data.name, searchQuery) : false;
        return getNodeColor(d, config, isSelected, isHighlighted || isSearchMatch);
      })
      .attr('stroke', (d) => {
        const isSelected = selectedNodeIds?.has(d.data.id) ?? false;
        return isSelected ? '#1d4ed8' : '#fff';
      })
      .attr('stroke-width', (d) => {
        const isSelected = selectedNodeIds?.has(d.data.id) ?? false;
        return isSelected ? 3 : 1.5;
      });

    // Labels
    node
      .append('text')
      .attr('dy', '.31em')
      .attr('x', (d) => {
        if (isHorizontal) return d.children ? -10 : 10;
        return 0;
      })
      .attr('y', (d) => {
        if (!isHorizontal) return d.children ? -14 : 14;
        return 0;
      })
      .attr('text-anchor', (d) => {
        if (isHorizontal) return d.children ? 'end' : 'start';
        return 'middle';
      })
      .text((d) => d.data.name)
      .attr('font-size', (d) => `${getLabelSize(d, config)}px`)
      .attr('fill', (d) => {
        if (searchQuery && matchesSearch(d.data.name, searchQuery)) return '#f59e0b';
        return config.labelColor!;
      })
      .attr('font-weight', (d) => {
        if (searchQuery && matchesSearch(d.data.name, searchQuery)) return 700;
        return d.children ? 600 : 400;
      });

    // Interactions
    node
      .on('click', function (event, d) {
        event.stopPropagation();
        onNodeClick?.(d.data);
      })
      .on('mouseover', function (event, d) {
        handleMouseOver(event as unknown as MouseEvent, d);
      })
      .on('mousemove', function (event) {
        handleMouseMove(event as unknown as MouseEvent);
      })
      .on('mouseout', handleMouseOut);

    // Auto-fit view
    const bounds = g.node()?.getBBox();
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const midX = bounds.x + bounds.width / 2;
      const midY = bounds.y + bounds.height / 2;
      const scale = 0.85 / Math.max(bounds.width / width, bounds.height / height);
      const translateX = width / 2 - scale * midX;
      const translateY = height / 2 - scale * midY;

      svg.call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale),
      );
    }
  }, [
    rootData,
    data,
    width,
    height,
    config,
    selectedNodeIds,
    highlightedNodeIds,
    searchQuery,
    onNodeClick,
    handleMouseOver,
    handleMouseMove,
    handleMouseOut,
  ]);

  return (
    <div ref={containerRef} className={cn('w-full h-full relative bg-gray-50 dark:bg-gray-900 rounded-lg', className)}>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-2 py-1 rounded border dark:border-gray-700">
        Scroll to zoom · Drag to pan{onNodeClick ? ' · Click to select' : ''}
      </div>
    </div>
  );
}
