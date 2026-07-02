import React, { useEffect, useRef, useState } from 'react';
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
  /**
   * Fixed per-node sizing [rowHeight, depthWidth]. When set, the layout uses
   * `nodeSize()` so each leaf gets a guaranteed amount of vertical space (no
   * overlap regardless of tree size). Container scrolls / zooms to navigate.
   * If omitted, falls back to fit-to-viewport `size()`.
   */
  nodeSize?: [number, number];
  /** Stable id accessor (required when `collapsible` is true) */
  getId?: (d: T) => string;
  /**
   * Enable click-to-collapse on internal nodes. Leaves keep the consumer's
   * onClick. Internal nodes' click is overridden to toggle their children.
   */
  collapsible?: boolean;
  /**
   * When collapsible, depth at which nodes start collapsed on first render.
   * Default 1 — top-level groups visible, their children hidden until clicked.
   * Use 0 to collapse everything, Infinity to expand everything.
   */
  initialCollapsedDepth?: number;
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
    nodeSize,
    getId,
    collapsible = false,
    initialCollapsedDepth = 1,
  } = config;

  // Tracks ids of nodes whose children are hidden. Bumping `collapseVersion`
  // re-runs the layout effect.
  const collapsedIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [collapseVersion, setCollapseVersion] = useState(0);

  // Reset collapsed state when the data identity changes (rare; covers refetch)
  useEffect(() => {
    collapsedIdsRef.current = new Set();
    seededRef.current = false;
    setCollapseVersion((v) => v + 1);
  }, [data]);

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

    // When collapsible, wrap getChildren so that nodes in the collapsed set
    // appear as leaves to the layout. The synthetic root is never collapsed.
    const wrappedGetChildren =
      collapsible && getId
        ? (d: T): T[] | undefined => {
            // Synthetic root has no id — never collapse
            if ((d as { __syntheticRoot?: boolean }).__syntheticRoot) {
              return getChildren(d);
            }
            const id = getId(d);
            if (collapsedIdsRef.current.has(id)) return undefined;
            return getChildren(d);
          }
        : getChildren;

    const root = d3.hierarchy<T>(rootData, wrappedGetChildren);

    // First-time seed of collapsed set: collapse every node at or beyond
    // `initialCollapsedDepth`. Without this, a tree of 1500 nodes opens fully
    // expanded and overwhelms the user.
    if (collapsible && getId && !seededRef.current) {
      const seed = (node: d3.HierarchyNode<T>, depth: number) => {
        if (
          depth >= initialCollapsedDepth &&
          !(node.data as { __syntheticRoot?: boolean }).__syntheticRoot &&
          getChildren(node.data) &&
          (getChildren(node.data) as T[]).length > 0
        ) {
          collapsedIdsRef.current.add(getId(node.data));
        }
        node.children?.forEach((child) => seed(child, depth + 1));
      };
      seed(root, 0);
      seededRef.current = true;
      // Re-run with the seeded collapsed set applied. This is cheap because
      // the next pass starts the loop over with the wrapped getChildren.
      setCollapseVersion((v) => v + 1);
      return;
    }

    // Create and apply tree layout
    const treeLayout = d3.tree<T>().separation(separation);
    if (nodeSize) {
      treeLayout.nodeSize(nodeSize);
    } else {
      treeLayout.size([height - 100, width - 300]);
    }

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

    // Mark nodes that are collapsed-with-hidden-children so the consumer's
    // node rendering can style them differently (we add a small chevron).
    if (collapsible && getId) {
      nodeGroups
        .filter((d) => {
          const original = getChildren(d.data);
          return Array.isArray(original) && original.length > 0;
        })
        .each(function (d) {
          const isCollapsed = collapsedIdsRef.current.has(getId(d.data));
          const sel = d3.select(this);
          sel.select('.collapse-marker').remove();
          sel
            .append('text')
            .attr('class', 'collapse-marker')
            .attr('x', -22)
            .attr('y', 0)
            .attr('dy', '0.32em')
            .attr('text-anchor', 'middle')
            .attr('font-size', '11px')
            .attr('font-weight', 700)
            .attr('fill', '#64748b')
            .style('pointer-events', 'none')
            .text(isCollapsed ? '▸' : '▾');
        });

      // Override click on internal nodes (those with original children) to
      // toggle collapse. Uses the namespaced 'click.collapse' so the
      // consumer's 'click' handler still fires for leaves.
      nodeGroups
        .filter((d) => {
          const original = getChildren(d.data);
          return Array.isArray(original) && original.length > 0;
        })
        .on('click', function (event, d) {
          event.stopPropagation();
          const id = getId(d.data);
          if (collapsedIdsRef.current.has(id)) {
            collapsedIdsRef.current.delete(id);
          } else {
            collapsedIdsRef.current.add(id);
          }
          setCollapseVersion((v) => v + 1);
        });
    }

    // Auto-fit only when using fit-to-viewport sizing. With fixed nodeSize,
    // the tree may be larger than the container; we center horizontally and
    // let the user scroll/zoom from there.
    const bounds = g.node()?.getBBox();
    if (bounds) {
      if (nodeSize) {
        // Center the tree horizontally; align top with a small margin
        const translateX = width / 2 - bounds.x - bounds.width / 2;
        const translateY = 40 - bounds.y;
        svg.call(
          d3.zoom<SVGSVGElement, unknown>().transform as any,
          d3.zoomIdentity.translate(translateX, translateY).scale(1)
        );
      } else {
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
    }
  }, [data, width, height, renderNodes, renderLinks, config, getChildren, separation, autoFitScale, skipRoot, linkStroke, linkStrokeWidth, linkOffsetX, linkOffsetY, nodeSize, getId, collapsible, initialCollapsedDepth, collapseVersion]);

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
