import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from '../hooks/useVisualizationResize';
import { exportSVG, exportPNG } from '../../../lib/visualization/export-utils';
import { Download } from 'lucide-react';
import {
  defaultColorFn,
  defaultGroupTooltip,
  defaultRibbonTooltip,
} from './chord-diagram-utils';

export interface ChordDiagramData {
  names: string[];
  matrix: number[][];
}

export interface ChordDiagramProps {
  data: ChordDiagramData;
  /** Color function: given an index and name, return a CSS color string */
  colorFn?: (index: number, name: string) => string;
  /** Format the tooltip for a group (arc). Return null to hide tooltip. */
  formatGroupTooltip?: (name: string, value: number) => string;
  /** Format the tooltip for a ribbon (chord). Return null to hide tooltip. */
  formatRibbonTooltip?: (source: string, target: string, value: number) => string;
  /** Format the label text for a group */
  formatLabel?: (name: string, index: number) => string;
  /** Callback when a group arc is clicked */
  onGroupClick?: (name: string, index: number) => void;
  /** Callback when a ribbon is clicked */
  onRibbonClick?: (source: string, target: string, value: number) => void;
  /** Pad angle between arcs in radians (default: 0.05) */
  padAngle?: number;
  /** Label font size in px (default: 11) */
  labelFontSize?: number;
  /** Margin around the diagram for labels (default: 80) */
  margin?: number;
  /** Filename prefix for exports (default: 'chord-diagram') */
  exportFilename?: string;
  /** Whether to show export buttons (default: true) */
  showExportButtons?: boolean;
  /** Hint text shown at the bottom (default: 'Hover for details · Click group to filter') */
  hintText?: string | null;
}

export function ChordDiagram({
  data,
  colorFn,
  formatGroupTooltip,
  formatRibbonTooltip,
  formatLabel,
  onGroupClick,
  onRibbonClick,
  padAngle = 0.05,
  labelFontSize = 11,
  margin = 80,
  exportFilename = 'chord-diagram',
  showExportButtons = true,
  hintText = 'Hover for details · Click group to filter',
}: ChordDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  const color = useCallback(
    (i: number) => {
      if (colorFn) return colorFn(i, data.names[i] || String(i));
      return defaultColorFn(i);
    },
    [colorFn, data.names],
  );

  const groupTooltip = useCallback(
    (name: string, value: number) => {
      if (formatGroupTooltip) return formatGroupTooltip(name, value);
      return defaultGroupTooltip(name, value);
    },
    [formatGroupTooltip],
  );

  const ribbonTooltip = useCallback(
    (source: string, target: string, value: number) => {
      if (formatRibbonTooltip) return formatRibbonTooltip(source, target, value);
      return defaultRibbonTooltip(source, target, value);
    },
    [formatRibbonTooltip],
  );

  const labelText = useCallback(
    (name: string, index: number) => {
      if (formatLabel) return formatLabel(name, index);
      return name;
    },
    [formatLabel],
  );

  useEffect(() => {
    if (!svgRef.current || !data.names.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const radius = Math.min(width, height) / 2 - margin;
    if (radius <= 0) return;
    const innerRadius = radius - 20;
    const outerRadius = radius;

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const chord = d3.chord()
      .padAngle(padAngle)
      .sortSubgroups(d3.descending);

    const chords = chord(data.matrix);

    const arc = d3.arc<d3.ChordGroup>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    const ribbon = d3.ribbon<d3.Chord, d3.ChordSubgroup>()
      .radius(innerRadius);

    // Draw outer arcs (groups)
    const group = g.append('g')
      .selectAll('g')
      .data(chords.groups)
      .join('g')
      .style('cursor', onGroupClick ? 'pointer' : 'default');

    group.append('path')
      .attr('d', arc)
      .attr('fill', (d) => color(d.index))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    // Group labels
    group.append('text')
      .each(function (d) { (d as any).angle = (d.startAngle + d.endAngle) / 2; })
      .attr('dy', '0.35em')
      .attr('transform', function (d) {
        const angle = (d as any).angle;
        return `rotate(${(angle * 180 / Math.PI - 90)}) translate(${outerRadius + 10}) ${angle > Math.PI ? 'rotate(180)' : ''}`;
      })
      .attr('text-anchor', function (d) {
        return (d as any).angle > Math.PI ? 'end' : 'start';
      })
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', '#1e293b')
      .text(function (d) { return labelText(data.names[d.index], d.index); });

    group
      .on('click', function (_event: MouseEvent, d: d3.ChordGroup) {
        if (onGroupClick) onGroupClick(data.names[d.index], d.index);
      })
      .on('mouseover', function (event: MouseEvent, d: d3.ChordGroup) {
        setTooltip({
          content: groupTooltip(data.names[d.index], d.value),
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

    // Draw ribbons (chords)
    g.append('g')
      .selectAll('path')
      .data(chords)
      .join('path')
      .attr('d', ribbon as any)
      .attr('fill', (d) => color(d.source.index))
      .attr('fill-opacity', 0.6)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .style('cursor', onRibbonClick ? 'pointer' : 'default')
      .on('mouseover', function (event: MouseEvent, d: d3.Chord) {
        d3.select(this).attr('fill-opacity', 0.85);
        const src = data.names[d.source.index];
        const tgt = data.names[d.target.index];
        setTooltip({
          content: ribbonTooltip(src, tgt, d.source.value),
          x: event.pageX,
          y: event.pageY,
          visible: true,
        });
      })
      .on('mousemove', function (event: MouseEvent) {
        setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY }));
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill-opacity', 0.6);
        setTooltip((prev) => ({ ...prev, visible: false }));
      })
      .on('click', function (_event: MouseEvent, d: d3.Chord) {
        if (onRibbonClick) {
          onRibbonClick(data.names[d.source.index], data.names[d.target.index], d.source.value);
        }
      });
  }, [data, width, height, padAngle, margin, labelFontSize, color, groupTooltip, ribbonTooltip, labelText, onGroupClick, onRibbonClick]);

  const [exporting, setExporting] = useState(false);

  async function handleExport(format: 'svg' | 'png') {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    try {
      if (format === 'svg') exportSVG(svgRef.current, `${exportFilename}.svg`);
      else await exportPNG(svgRef.current, `${exportFilename}.png`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-50 rounded-lg">
      <svg ref={svgRef} width={width} height={height} className="w-full h-full" />
      {tooltip.visible && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border bg-white px-3 py-2 text-sm shadow-md whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
      {showExportButtons && (
        <div className="absolute top-3 left-3 flex gap-1">
          <button
            onClick={function () { handleExport('svg'); }}
            disabled={exporting}
            className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          >
            <Download className="h-3 w-3" /> SVG
          </button>
          <button
            onClick={function () { handleExport('png'); }}
            disabled={exporting}
            className="flex items-center gap-1 bg-white/90 hover:bg-white border rounded px-2 py-1 text-xs text-gray-700 shadow-sm"
          >
            <Download className="h-3 w-3" /> PNG
          </button>
        </div>
      )}
      {hintText && (
        <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
          {hintText}
        </div>
      )}
    </div>
  );
}
