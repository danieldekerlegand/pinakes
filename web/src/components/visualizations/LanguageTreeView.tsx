import React, { useState, useCallback, useMemo } from 'react';
import { useVisualization } from '../../contexts/VisualizationContext';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import { TreeVisualization } from './shared/TreeVisualization';
import type { TreeVisualizationConfig } from './shared/TreeVisualization';
import type { TreeNode, TooltipData } from '../../lib/visualization/types';
import { getLevelBorderColor } from '../../lib/visualization/d3-helpers';
import { INTERACTION_COLORS, VIS_TEXT_COLORS } from '../../lib/visualization/color-theme';

interface LanguageTreeViewProps {
  treeData: TreeNode[];
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
}

export function LanguageTreeView({ treeData, onNodeClick }: LanguageTreeViewProps) {
  const { isLanguageSelected, isHighlighted } = useVisualization();

  const [tooltip, setTooltip] = useState<{
    data: TooltipData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ data: null, x: 0, y: 0, visible: false });

  const config = useMemo<TreeVisualizationConfig<TreeNode>>(
    () => ({
      getChildren: (d) => d.children,
      getId: (d) => d.id,
      skipRoot: true,
      linkOffsetX: 150,
      linkOffsetY: 50,
      // Fixed per-row spacing prevents label overlap regardless of tree size.
      // 22px is enough vertical for the 12-14px label font; 220px horizontal
      // gives room for "Proto-Indo-European"-length names plus a pill icon.
      nodeSize: [22, 220],
      collapsible: true,
      // Show all top-level families on first render; their children are
      // hidden until the user clicks. Keeps the initial view scannable.
      initialCollapsedDepth: 1,
    }),
    []
  );

  const renderNodes = useCallback(
    (
      nodeGroup: d3.Selection<SVGGElement, d3.HierarchyPointNode<TreeNode>, SVGGElement, unknown>,
    ) => {
      // Node circles
      nodeGroup
        .append('circle')
        .attr('r', (d) => (d.data.type === 'family' ? 8 : 6))
        .attr('fill', (d) => {
          const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
          const highlighted = isHighlighted(d.data.id);
          if (selected || highlighted) return INTERACTION_COLORS.selected;
          return getLevelBorderColor(d.data.level);
        })
        .attr('stroke', (d) => {
          const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
          if (selected) return INTERACTION_COLORS.selectedBorder;
          return '#fff';
        })
        .attr('stroke-width', (d) => {
          const selected = d.data.type === 'language' && isLanguageSelected(d.data.id);
          return selected ? 3 : 2;
        });

      // Node labels
      nodeGroup
        .append('text')
        .attr('dy', '.31em')
        .attr('x', (d) => (d.children ? -12 : 12))
        .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
        .text((d) => d.data.name)
        .attr('font-size', (d) => (d.data.type === 'family' ? '14px' : '12px'))
        .attr('font-weight', (d) => (d.data.type === 'family' ? 600 : 400))
        .attr('fill', VIS_TEXT_COLORS.dark);

      // Interactions — TreeVisualization will override 'click' on internal
      // nodes to toggle collapse. This handler stays effective for leaves
      // (languages); on internal family nodes, the click toggles children.
      nodeGroup
        .on('click', function (event, d) {
          event.stopPropagation();
          if (onNodeClick) {
            onNodeClick(d.data.id, d.data.type);
          }
        })
        .on('mouseover', function (event, d) {
          const tooltipData: TooltipData = {
            id: d.data.id,
            name: d.data.name,
            type: d.data.type,
            ...(d.data.type === 'language' &&
              'familyId' in d.data && {
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
        .on('mousemove', function (event) {
          setTooltip((prev) => ({
            ...prev,
            x: event.pageX,
            y: event.pageY - 10,
          }));
        })
        .on('mouseout', function () {
          setTooltip((prev) => ({ ...prev, visible: false }));
        });
    },
    [isLanguageSelected, isHighlighted, onNodeClick]
  );

  return (
    <TreeVisualization<TreeNode>
      data={treeData}
      config={config}
      renderNodes={renderNodes}
      helpText="Click a family to expand • Scroll to zoom • Drag to pan"
    >
      <VisualizationTooltip
        data={tooltip.data}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
      />
    </TreeVisualization>
  );
}
