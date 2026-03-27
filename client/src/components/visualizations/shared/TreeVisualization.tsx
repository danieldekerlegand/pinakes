import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { createZoomBehavior } from '../../../lib/visualization/d3-helpers';
import { exportSVG, exportPNG } from '../../../lib/visualization/export-utils';
import { Download } from 'lucide-react';

export interface TreeNodeData {
  id: string;
  label: string;
  parentId?: string | null;
  children?: TreeNodeData[];
  metadata?: Record<string, unknown>;
}

export interface TreeVisualizationProps {
  data: TreeNodeData;
  orientation?: 'horizontal' | 'vertical' | 'radial';
  nodeColor?: (node: TreeNodeData) => string;
  nodeRadius?: (node: TreeNodeData, depth: number) => number;
  nodeLabel?: (node: TreeNodeData) => string;
  nodeSubLabel?: (node: TreeNodeData) => string | undefined;
  onNodeClick?: (node: TreeNodeData) => void;
  renderTooltip?: (node: TreeNodeData) => React.ReactNode;
  legendItems?: Array<{ label: string; color: string }>;
  exportFilename?: string;
}

export function TreeVisualization({
  data,
  orientation = 'horizontal',
  nodeColor,
  nodeRadius,
  nodeLabel,
  nodeSubLabel,
  onNodeClick,
  renderTooltip,
  legendItems,
  exportFilename = 'tree',
}: TreeVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    node: TreeNodeData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ node: null, x: 0, y: 0, visible: false });

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!svgRef.current || !data || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');
    createZoomBehavior(svg, g, 0.1, 4);

    // Count nodes for layout sizing
    function countNodes(node: TreeNodeData): number {
      let count = 1;
      if (node.children) {
        node.children.forEach(function (child) {
          count += countNodes(child);
        });
      }
      return count;
    }
    const totalNodes = countNodes(data);
    const nodeSpacing = Math.max(50, Math.min(80, Math.max(width, height) / totalNodes));

    const isHorizontal = orientation === 'horizontal';
    const primaryDim = isHorizontal
      ? Math.max(height - 80, totalNodes * nodeSpacing)
      : Math.max(width - 80, totalNodes * nodeSpacing);
    const secondaryDim = isHorizontal
      ? Math.max(width - 300, 400)
      : Math.max(height - 200, 400);

    let treeLayout: d3.TreeLayout<TreeNodeData>;

    if (orientation === 'radial') {
      treeLayout = d3.tree<TreeNodeData>()
        .size([2 * Math.PI, Math.min(width, height) / 2 - 80])
        .separation(function (a, b) { return (a.parent === b.parent ? 1 : 2) / a.depth; });
    } else {
      treeLayout = d3.tree<TreeNodeData>()
        .size([primaryDim, secondaryDim])
        .separation(function (a, b) { return a.parent === b.parent ? 1 : 1.5; });
    }

    const root = d3.hierarchy<TreeNodeData>(data, function (d) { return d.children; });
    const treeNodes = treeLayout(root);

    if (orientation === 'radial') {
      // Radial layout
      g.selectAll('.tree-link')
        .data(treeNodes.links())
        .join('path')
        .attr('class', 'tree-link')
        .attr('d', d3.linkRadial<any, any>()
          .angle(function (d: any) { return d.x; })
          .radius(function (d: any) { return d.y; })
        )
        .attr('fill', 'none')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6);

      const node = g.selectAll('.tree-node')
        .data(treeNodes.descendants())
        .join('g')
        .attr('class', 'tree-node')
        .attr('transform', function (d) {
          return `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`;
        })
        .style('cursor', 'pointer');

      appendNodeElements(node, treeNodes);
    } else if (isHorizontal) {
      // Horizontal layout (root on left)
      g.selectAll('.tree-link')
        .data(treeNodes.links())
        .join('path')
        .attr('class', 'tree-link')
        .attr('d', d3.linkHorizontal<any, any>()
          .x(function (d: any) { return d.y; })
          .y(function (d: any) { return d.x; })
        )
        .attr('fill', 'none')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6);

      const node = g.selectAll('.tree-node')
        .data(treeNodes.descendants())
        .join('g')
        .attr('class', 'tree-node')
        .attr('transform', function (d) { return 'translate(' + d.y + ',' + d.x + ')'; })
        .style('cursor', 'pointer');

      appendNodeElements(node, treeNodes);
    } else {
      // Vertical layout (root on top)
      g.selectAll('.tree-link')
        .data(treeNodes.links())
        .join('path')
        .attr('class', 'tree-link')
        .attr('d', d3.linkVertical<any, any>()
          .x(function (d: any) { return d.x; })
          .y(function (d: any) { return d.y; })
        )
        .attr('fill', 'none')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6);

      const node = g.selectAll('.tree-node')
        .data(treeNodes.descendants())
        .join('g')
        .attr('class', 'tree-node')
        .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; })
        .style('cursor', 'pointer');

      appendNodeElements(node, treeNodes);
    }

    function appendNodeElements(
      node: d3.Selection<SVGGElement | d3.BaseType, d3.HierarchyPointNode<TreeNodeData>, SVGGElement, unknown>,
      _treeNodes: d3.HierarchyPointNode<TreeNodeData>,
    ) {
      // Node circles
      node.append('circle')
        .attr('r', function (d: any) {
          if (nodeRadius) return nodeRadius(d.data, d.depth);
          return d.depth === 0 ? 10 : 7;
        })
        .attr('fill', function (d: any) {
          if (nodeColor) return nodeColor(d.data);
          return '#3b82f6';
        })
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      // Primary label
      node.append('text')
        .attr('dy', -14)
        .attr('text-anchor', 'middle')
        .attr('font-size', function (d: any) { return d.depth === 0 ? '13px' : '11px'; })
        .attr('font-weight', function (d: any) { return d.depth === 0 ? 700 : 500; })
        .attr('fill', '#1e293b')
        .text(function (d: any) {
          if (nodeLabel) return nodeLabel(d.data);
          return d.data.label;
        });

      // Sub-label
      if (nodeSubLabel) {
        node.filter(function (d: any) { return Boolean(nodeSubLabel(d.data)); })
          .append('text')
          .attr('dy', 22)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#64748b')
          .text(function (d: any) { return nodeSubLabel(d.data) || ''; });
      }

      // Interactions
      node
        .on('click', function (event: any, d: any) {
          event.stopPropagation();
          if (onNodeClick) onNodeClick(d.data);
        })
        .on('mouseover', function (event: any, d: any) {
          d3.select(this).select('circle')
            .transition().duration(150)
            .attr('r', function () {
              const base = nodeRadius ? nodeRadius(d.data, d.depth) : (d.depth === 0 ? 10 : 7);
              return base + 3;
            });
          setTooltip({
            node: d.data,
            x: event.pageX,
            y: event.pageY - 10,
            visible: true,
          });
        })
        .on('mousemove', function (event: any) {
          setTooltip(function (prev) { return { ...prev, x: event.pageX, y: event.pageY - 10 }; });
        })
        .on('mouseout', function (_event: any, d: any) {
          d3.select(this).select('circle')
            .transition().duration(150)
            .attr('r', function () {
              if (nodeRadius) return nodeRadius(d.data, d.depth);
              return d.depth === 0 ? 10 : 7;
            });
          setTooltip(function (prev) { return { ...prev, visible: false }; });
        });
    }

    // Auto-fit the tree into view
    const bounds = g.node()?.getBBox();
    if (bounds) {
      const fullWidth = bounds.width;
      const fullHeight = bounds.height;
      const midX = bounds.x + fullWidth / 2;
      const midY = bounds.y + fullHeight / 2;

      const scale = 0.85 / Math.max(fullWidth / width, fullHeight / height);
      const clampedScale = Math.min(Math.max(scale, 0.3), 2);
      const translateX = width / 2 - clampedScale * midX;
      const translateY = height / 2 - clampedScale * midY;

      svg.call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity.translate(translateX, translateY).scale(clampedScale)
      );
    }
  }, [data, width, height, orientation, nodeColor, nodeRadius, nodeLabel, nodeSubLabel, onNodeClick]);

  async function handleExport(format: 'svg' | 'png') {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    try {
      const filename = exportFilename + '.' + format;
      if (format === 'svg') {
        exportSVG(svgRef.current, filename);
      } else {
        await exportPNG(svgRef.current, filename);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {/* Tooltip */}
      {tooltip.visible && tooltip.node && renderTooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {renderTooltip(tooltip.node)}
        </div>
      )}
      {/* Export buttons */}
      <div className="absolute top-3 left-3 flex gap-1">
        <button
          onClick={function () { handleExport('svg'); }}
          disabled={exporting}
          className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          title="Export as SVG"
        >
          <Download className="h-3 w-3" />
          SVG
        </button>
        <button
          onClick={function () { handleExport('png'); }}
          disabled={exporting}
          className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          title="Export as PNG"
        >
          <Download className="h-3 w-3" />
          PNG
        </button>
      </div>
      {/* Legend */}
      {legendItems && legendItems.length > 0 && (
        <div className="absolute top-3 right-3 bg-white/90 rounded-lg border px-3 py-2 text-xs space-y-1 max-h-40 overflow-y-auto">
          <div className="font-medium text-gray-700 mb-1">Legend</div>
          {legendItems.map(function (item) {
            return (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom · Drag to pan · Click node to select
      </div>
    </div>
  );
}
