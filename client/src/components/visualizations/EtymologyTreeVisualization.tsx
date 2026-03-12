import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import {
  createZoomBehavior,
  getFamilyColor,
} from '../../lib/visualization/d3-helpers';

export interface EtymologyNode {
  word: string;
  language: string;
  relation?: string;
  children: EtymologyNode[];
}

interface EtymologyTreeVisualizationProps {
  treeData: EtymologyNode;
  onNodeClick?: (word: string, language: string) => void;
}

// Color palette for language codes - uses consistent hashing
const LANGUAGE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#0ea5e9', '#d946ef', '#e11d48', '#a855f7', '#059669',
];

function getLanguageColor(language: string): string {
  let hash = 0;
  for (let i = 0; i < language.length; i++) {
    hash = language.charCodeAt(i) + ((hash << 5) - hash);
  }
  return LANGUAGE_COLORS[Math.abs(hash) % LANGUAGE_COLORS.length];
}

function formatRelation(relation: string): string {
  return relation.replace(/_/g, ' ');
}

export function EtymologyTreeVisualization({ treeData, onNodeClick }: EtymologyTreeVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    word: string;
    language: string;
    relation?: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ word: '', language: '', x: 0, y: 0, visible: false });

  useEffect(() => {
    if (!svgRef.current || !treeData || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('class', 'main-group');
    createZoomBehavior(svg, g, 0.1, 4);

    // Count total nodes to determine layout sizing
    function countNodes(node: EtymologyNode): number {
      let count = 1;
      node.children.forEach(function(child) {
        count += countNodes(child);
      });
      return count;
    }
    const totalNodes = countNodes(treeData);
    const nodeSpacing = Math.max(60, Math.min(100, height / totalNodes));

    // Create tree layout - horizontal tree (root on left)
    const treeLayout = d3.tree<EtymologyNode>()
      .size([Math.max(height - 80, totalNodes * nodeSpacing), Math.max(width - 300, 400)])
      .separation(function(a, b) { return a.parent === b.parent ? 1 : 1.5; });

    const root = d3.hierarchy<EtymologyNode>(treeData, function(d) { return d.children; });
    const treeNodes = treeLayout(root);

    // Collect unique languages for legend
    const languageSet = new Set<string>();
    treeNodes.descendants().forEach(function(d) {
      languageSet.add(d.data.language);
    });

    // Draw links with curved paths
    g.selectAll('.etym-link')
      .data(treeNodes.links())
      .join('path')
      .attr('class', 'etym-link')
      .attr('d', d3.linkHorizontal<any, any>()
        .x(function(d: any) { return d.y; })
        .y(function(d: any) { return d.x; })
      )
      .attr('fill', 'none')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6);

    // Draw relation labels on edges
    g.selectAll('.etym-edge-label')
      .data(treeNodes.links().filter(function(d) { return d.target.data.relation; }))
      .join('text')
      .attr('class', 'etym-edge-label')
      .attr('x', function(d) { return (d.source.y! + d.target.y!) / 2; })
      .attr('y', function(d) { return (d.source.x! + d.target.x!) / 2 - 8; })
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', '#64748b')
      .attr('font-style', 'italic')
      .text(function(d) { return formatRelation(d.target.data.relation!); });

    // Draw nodes
    const node = g.selectAll('.etym-node')
      .data(treeNodes.descendants())
      .join('g')
      .attr('class', 'etym-node')
      .attr('transform', function(d) { return 'translate(' + d.y + ',' + d.x + ')'; })
      .style('cursor', 'pointer');

    // Node circles colored by language
    node.append('circle')
      .attr('r', function(d) { return d.depth === 0 ? 10 : 7; })
      .attr('fill', function(d) { return getLanguageColor(d.data.language); })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('filter', function(d) { return d.depth === 0 ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' : 'none'; });

    // Word label
    node.append('text')
      .attr('dy', -14)
      .attr('text-anchor', 'middle')
      .attr('font-size', function(d) { return d.depth === 0 ? '14px' : '12px'; })
      .attr('font-weight', function(d) { return d.depth === 0 ? 700 : 500; })
      .attr('fill', '#1e293b')
      .text(function(d) { return d.data.word; });

    // Language label below
    node.append('text')
      .attr('dy', 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#64748b')
      .text(function(d) { return d.data.language; });

    // Interactions
    node
      .on('click', function(event: any, d: any) {
        event.stopPropagation();
        if (onNodeClick) {
          onNodeClick(d.data.word, d.data.language);
        }
      })
      .on('mouseover', function(event: any, d: any) {
        d3.select(this).select('circle')
          .transition().duration(150)
          .attr('r', d.depth === 0 ? 13 : 10);
        setTooltip({
          word: d.data.word,
          language: d.data.language,
          relation: d.data.relation,
          x: event.pageX,
          y: event.pageY - 10,
          visible: true,
        });
      })
      .on('mousemove', function(event: any) {
        setTooltip(function(prev) { return { ...prev, x: event.pageX, y: event.pageY - 10 }; });
      })
      .on('mouseout', function(event: any, d: any) {
        d3.select(this).select('circle')
          .transition().duration(150)
          .attr('r', d.depth === 0 ? 10 : 7);
        setTooltip(function(prev) { return { ...prev, visible: false }; });
      });

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
  }, [treeData, width, height, onNodeClick]);

  // Build legend from tree data
  const languages: Array<{ code: string; color: string }> = [];
  const seen = new Set<string>();
  function collectLanguages(node: EtymologyNode) {
    if (!seen.has(node.language)) {
      seen.add(node.language);
      languages.push({ code: node.language, color: getLanguageColor(node.language) });
    }
    node.children.forEach(function(child) { collectLanguages(child); });
  }
  collectLanguages(treeData);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
      />
      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          <div className="font-semibold">{tooltip.word}</div>
          <div className="text-muted-foreground">Language: {tooltip.language}</div>
          {tooltip.relation && (
            <div className="text-muted-foreground">
              Relation: {formatRelation(tooltip.relation)}
            </div>
          )}
          <div className="text-xs text-blue-600 mt-1">Click to trace this word</div>
        </div>
      )}
      {/* Legend */}
      <div className="absolute top-3 right-3 bg-white/90 rounded-lg border px-3 py-2 text-xs space-y-1 max-h-40 overflow-y-auto">
        <div className="font-medium text-gray-700 mb-1">Languages</div>
        {languages.map(function(lang) {
          return (
            <div key={lang.code} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lang.color }} />
              <span>{lang.code}</span>
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Scroll to zoom · Drag to pan · Click node to trace
      </div>
    </div>
  );
}
