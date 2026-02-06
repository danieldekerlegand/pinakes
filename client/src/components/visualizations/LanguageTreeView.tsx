import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualization } from '../../contexts/VisualizationContext';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { TreeNode, TooltipData } from '../../lib/visualization/types';
import {
  getLevelColor,
  getLevelBorderColor,
  createTransition,
  createZoomBehavior,
} from '../../lib/visualization/d3-helpers';

interface LanguageTreeViewProps {
  treeData: TreeNode[];
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
}

export function LanguageTreeView({ treeData, onNodeClick }: LanguageTreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);
  const { isLanguageSelected, isHighlighted } = useVisualization();

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

  useEffect(() => {
    if (!svgRef.current || !treeData || treeData.length === 0 || width === 0 || height === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create main group for zoom/pan
    const g = svg.append('g').attr('class', 'main-group');

    // Set up zoom
    createZoomBehavior(svg, g, 0.1, 4);

    // Create tree layout
    const treeLayout = d3.tree<TreeNode>()
      .size([height - 100, width - 300])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

    // Create hierarchy
    const root = d3.hierarchy<TreeNode>(
      { id: 'root', name: 'Root', type: 'family', level: -1, children: treeData } as TreeNode,
      (d) => d.children
    );

    // Generate tree
    const treeNodes = treeLayout(root);

    // Draw links
    g.selectAll('.link')
      .data(treeNodes.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', d3.linkHorizontal<any, any>()
        .x((d) => d.y + 150)
        .y((d) => d.x + 50)
      )
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e0')
      .attr('stroke-width', 2);

    // Draw nodes
    const node = g.selectAll('.node')
      .data(treeNodes.descendants().filter((d) => d.depth > 0)) // Skip root
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.y! + 150},${d.x! + 50})`)
      .style('cursor', 'pointer');

    // Node circles
    node.append('circle')
      .attr('r', (d) => d.data.type === 'family' ? 8 : 6)
      .attr('fill', (d) => {
        const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
        const highlighted = isHighlighted(d.data.id);
        if (selected || highlighted) return '#3b82f6';
        return getLevelBorderColor(d.data.level);
      })
      .attr('stroke', (d) => {
        const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
        if (selected) return '#1d4ed8';
        return '#fff';
      })
      .attr('stroke-width', (d) => {
        const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
        return selected ? 3 : 2;
      });

    // Node labels
    node.append('text')
      .attr('dy', '.31em')
      .attr('x', (d) => (d.children ? -12 : 12))
      .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
      .text((d) => d.data.name)
      .attr('font-size', (d) => d.data.type === 'family' ? '14px' : '12px')
      .attr('font-weight', (d) => d.data.type === 'family' ? 600 : 400)
      .attr('fill', '#374151');

    // Add interactions
    node
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onNodeClick) {
          onNodeClick(d.data.id, d.data.type);
        }
      })
      .on('mouseover', function(event, d) {
        const tooltipData: TooltipData = {
          id: d.data.id,
          name: d.data.name,
          type: d.data.type,
          ...(d.data.type === 'language' && 'familyId' in d.data && {
            familyName: d.data.familyId,
          }),
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

    // Center the view
    const bounds = g.node()?.getBBox();
    if (bounds) {
      const fullWidth = bounds.width;
      const fullHeight = bounds.height;
      const midX = bounds.x + fullWidth / 2;
      const midY = bounds.y + fullHeight / 2;

      const scale = 0.9 / Math.max(fullWidth / width, fullHeight / height);
      const translateX = width / 2 - scale * midX;
      const translateY = height / 2 - scale * midY;

      svg.call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
      );
    }
  }, [treeData, width, height, isLanguageSelected, isHighlighted, onNodeClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom • Drag to pan • Click to select
      </div>
    </div>
  );
}
