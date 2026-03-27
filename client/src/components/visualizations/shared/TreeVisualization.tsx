import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { createZoomBehavior } from '../../../lib/visualization/d3-helpers';

export interface TreeVisualizationConfig<T> {
  /** Extract children from a node */
  getChildren: (d: T) => T[] | undefined;
  /** Separation between sibling vs cousin nodes */
  separation?: (a: d3.HierarchyPointNode<T>, b: d3.HierarchyPointNode<T>) => number;
  /** Scale factor for auto-fit (default 0.9) */
  autoFitScale?: number;
  /** Whether to skip the synthetic root node when rendering (default true) */
  skipRoot?: boolean;
  /** Link stroke color (default '#cbd5e0') */
  linkStroke?: string;
  /** Link stroke width (default 2) */
  linkStrokeWidth?: number;
  /** Offset applied to link x coordinates (default 0) */
  linkOffsetX?: number;
  /** Offset applied to link y coordinates (default 0) */
  linkOffsetY?: number;
}

export interface TreeVisualizationProps<T> {
  /** Tree data - a single root or array of roots (wrapped with synthetic root) */
  data: T | T[];
  /** Configuration for tree layout and rendering */
  config: TreeVisualizationConfig<T>;
  /** Called after D3 renders nodes - receives the node group selection and node data */
  renderNodes: (
    nodeGroup: d3.Selection<SVGGElement, d3.HierarchyPointNode<T>, SVGGElement, unknown>,
    nodes: d3.HierarchyPointNode<T>[]
  ) => void;
  /** Optional custom link rendering. If not provided, uses default horizontal links */
  renderLinks?: (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    links: d3.HierarchyPointLink<T>[]
  ) => void;
  /** Help text shown at bottom-left */
  helpText?: string;
  /** Additional overlay content (tooltips, legends, export buttons) */
  children?: React.ReactNode;
  /** Container class name */
  className?: string;
}

export function TreeVisualization<T>({
  data,
  config,
  renderNodes,
  renderLinks,
  helpText = 'Scroll to zoom • Drag to pan • Click to select',
  children,
  className = 'w-full h-full relative bg-gray-50 rounded-lg',
}: TreeVisualizationProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const {
    getChildren,
    separation = (a, b) => (a.parent === b.parent ? 1 : 1.5),
    autoFitScale = 0.9,
    skipRoot = true,
    linkStroke = '#cbd5e0',
    linkStrokeWidth = 2,
    linkOffsetX = 0,
    linkOffsetY = 0,
  } = config;

  useEffect(() => {
    if (!svgRef.current || !data || width === 0 || height === 0) return;

    // Check for empty array data
    if (Array.isArray(data) && data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');
    createZoomBehavior(svg, g, 0.1, 4);

    // Build hierarchy: wrap arrays in a synthetic root
    const rootData = Array.isArray(data)
      ? ({ __syntheticRoot: true, children: data } as unknown as T)
      : data;

    const root = d3.hierarchy<T>(rootData, getChildren);

    // Create and apply tree layout
    const treeLayout = d3.tree<T>()
      .size([height - 100, width - 300])
      .separation(separation);

    const treeNodes = treeLayout(root);

    // Filter nodes: optionally skip synthetic root
    const visibleNodes = skipRoot
      ? treeNodes.descendants().filter((d) => d.depth > 0)
      : treeNodes.descendants();

    // Render links
    if (renderLinks) {
      renderLinks(g, treeNodes.links());
    } else {
      g.selectAll('.link')
        .data(treeNodes.links())
        .join('path')
        .attr('class', 'link')
        .attr(
          'd',
          d3
            .linkHorizontal<any, any>()
            .x((d) => d.y + linkOffsetX)
            .y((d) => d.x + linkOffsetY)
        )
        .attr('fill', 'none')
        .attr('stroke', linkStroke)
        .attr('stroke-width', linkStrokeWidth);
    }

    // Create node groups
    const nodeGroups = g
      .selectAll<SVGGElement, d3.HierarchyPointNode<T>>('.node')
      .data(visibleNodes)
      .join('g')
      .attr('class', 'node')
      .attr(
        'transform',
        (d) => `translate(${d.y! + linkOffsetX},${d.x! + linkOffsetY})`
      )
      .style('cursor', 'pointer');

    // Delegate node rendering to consumer
    renderNodes(nodeGroups, visibleNodes);

    // Auto-fit the tree into view
    const bounds = g.node()?.getBBox();
    if (bounds) {
      const fullWidth = bounds.width;
      const fullHeight = bounds.height;
      const midX = bounds.x + fullWidth / 2;
      const midY = bounds.y + fullHeight / 2;

      const scale = autoFitScale / Math.max(fullWidth / width, fullHeight / height);
      const clampedScale = Math.min(Math.max(scale, 0.3), 2);
      const translateX = width / 2 - clampedScale * midX;
      const translateY = height / 2 - clampedScale * midY;

      svg.call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity.translate(translateX, translateY).scale(clampedScale)
      );
    }
  }, [data, width, height, renderNodes, renderLinks, config, getChildren, separation, autoFitScale, skipRoot, linkStroke, linkStrokeWidth, linkOffsetX, linkOffsetY]);

  return (
    <div ref={containerRef} className={className}>
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {children}
      {helpText && (
        <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
          {helpText}
        </div>
      )}
    </div>
  );
}
