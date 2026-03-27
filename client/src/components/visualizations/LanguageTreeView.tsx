import React, { useState, useCallback, useMemo } from 'react';
import { useVisualization } from '../../contexts/VisualizationContext';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import { TreeVisualization } from './shared/TreeVisualization';
import type { TreeVisualizationConfig } from './shared/TreeVisualization';
import type { TreeNode, TooltipData } from '../../lib/visualization/types';
import { getLevelBorderColor } from '../../lib/visualization/d3-helpers';

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
  }>({
    data: null,
    x: 0,
    y: 0,
    visible: false,
  });

  const config = useMemo<TreeVisualizationConfig<TreeNode>>(
    () => ({
      getChildren: (d) => d.children,
      skipRoot: true,
      linkOffsetX: 150,
      linkOffsetY: 50,
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
      nodeGroup
        .append('text')
        .attr('dy', '.31em')
        .attr('x', (d) => (d.children ? -12 : 12))
        .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
        .text((d) => d.data.name)
        .attr('font-size', (d) => (d.data.type === 'family' ? '14px' : '12px'))
        .attr('font-weight', (d) => (d.data.type === 'family' ? 600 : 400))
        .attr('fill', '#374151');

      // Interactions
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
