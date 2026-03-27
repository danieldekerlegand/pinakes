import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { getFamilyColor } from '../../lib/visualization/d3-helpers';
import { exportSVG, exportPNG } from '../../lib/visualization/export-utils';
import { Download } from 'lucide-react';
import { VIS_TEXT_COLORS } from '../../lib/visualization/color-theme';
import type { ChordData } from '@shared/types';

interface ChordDiagramVisualizationProps {
  data: ChordData;
  onGroupClick?: (name: string) => void;
}

export function ChordDiagramVisualization({ data, onGroupClick }: ChordDiagramVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useVisualizationResize(containerRef);

  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  }>({ content: '', x: 0, y: 0, visible: false });

  useEffect(() => {
    if (!svgRef.current || !data.names.length || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const radius = Math.min(width, height) / 2 - 80;
    if (radius <= 0) return;
    const innerRadius = radius - 20;
    const outerRadius = radius;

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const chord = d3.chord()
      .padAngle(0.05)
      .sortSubgroups(d3.descending);

    const chords = chord(data.matrix);

    const arc = d3.arc<d3.ChordGroup>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    const ribbon = d3.ribbon<d3.Chord, d3.ChordSubgroup>()
      .radius(innerRadius);

    // Color based on family name
    const color = (i: number) => getFamilyColor(data.names[i] || String(i), 1);

    // Draw outer arcs (groups)
    const group = g.append('g')
      .selectAll('g')
      .data(chords.groups)
      .join('g')
      .style('cursor', 'pointer');

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
      .attr('font-size', '11px')
      .attr('fill', VIS_TEXT_COLORS.darkest)
      .text(function (d) { return data.names[d.index]; });

    group
      .on('click', function (_event: MouseEvent, d: d3.ChordGroup) {
        if (onGroupClick) onGroupClick(data.names[d.index]);
      })
      .on('mouseover', function (event: MouseEvent, d: d3.ChordGroup) {
        setTooltip({
          content: `${data.names[d.index]}\nTotal influence: ${d.value}`,
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
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d: d3.Chord) {
        d3.select(this).attr('fill-opacity', 0.85);
        const src = data.names[d.source.index];
        const tgt = data.names[d.target.index];
        setTooltip({
          content: `${src} ↔ ${tgt}\nInfluence: ${d.source.value}`,
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
      });
  }, [data, width, height, onGroupClick]);

  const [exporting, setExporting] = useState(false);

  async function handleExport(format: 'svg' | 'png') {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    try {
      if (format === 'svg') exportSVG(svgRef.current, 'chord-diagram.svg');
      else await exportPNG(svgRef.current, 'chord-diagram.png');
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
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded border">
        Hover for details · Click group to filter
      </div>
    </div>
  );
}
