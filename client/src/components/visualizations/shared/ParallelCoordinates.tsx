import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import * as d3 from 'd3';

export interface ParallelAxis {
  key: string;
  label: string;
  type: 'numeric' | 'ordinal';
  domain?: [number, number] | string[];
}

export interface ParallelDatum {
  id: string;
  label: string;
  category?: string;
  values: Record<string, number | string>;
}

interface BrushExtent {
  key: string;
  range: [number, number]; // pixel range on the axis
}

interface ParallelCoordinatesProps {
  axes: ParallelAxis[];
  data: ParallelDatum[];
  width: number;
  height: number;
  colorByCategory?: boolean;
  onLineHover?: (datum: ParallelDatum | null) => void;
  onLineClick?: (datum: ParallelDatum) => void;
  highlightedId?: string | null;
  categoryColors?: Record<string, string>;
}

const MARGIN = { top: 40, right: 30, bottom: 20, left: 30 };

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

export function ParallelCoordinates({
  axes,
  data,
  width,
  height,
  colorByCategory = true,
  onLineHover,
  onLineClick,
  highlightedId,
  categoryColors,
}: ParallelCoordinatesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [brushExtents, setBrushExtents] = useState<BrushExtent[]>([]);
  const [axisOrder, setAxisOrder] = useState<string[]>(() => axes.map(a => a.key));
  const [draggingAxis, setDraggingAxis] = useState<string | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  // Sync axis order when axes prop changes
  useEffect(() => {
    setAxisOrder(prev => {
      const newKeys = new Set(axes.map(a => a.key));
      const kept = prev.filter(k => newKeys.has(k));
      const added = axes.map(a => a.key).filter(k => !kept.includes(k));
      return [...kept, ...added];
    });
  }, [axes]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  // Build scales for each axis
  const scales = useMemo(() => {
    const map: Record<string, d3.ScaleLinear<number, number> | d3.ScalePoint<string>> = {};
    for (const axis of axes) {
      if (axis.type === 'numeric') {
        const vals = data.map(d => Number(d.values[axis.key]) || 0);
        const domain = axis.domain as [number, number] | undefined;
        map[axis.key] = d3.scaleLinear()
          .domain(domain ?? [Math.min(...vals, 0), Math.max(...vals, 1)])
          .range([innerHeight, 0]);
      } else {
        const domain = (axis.domain as string[] | undefined) ??
          Array.from(new Set(data.map(d => String(d.values[axis.key]))));
        map[axis.key] = d3.scalePoint<string>()
          .domain(domain)
          .range([innerHeight, 0])
          .padding(0.1);
      }
    }
    return map;
  }, [axes, data, innerHeight]);

  // X positions for each axis
  const xScale = useMemo(() => {
    return d3.scalePoint<string>()
      .domain(axisOrder)
      .range([0, innerWidth]);
  }, [axisOrder, innerWidth]);

  // Category color map
  const colorMap = useMemo(() => {
    if (categoryColors) return categoryColors;
    const categories = Array.from(new Set(data.map(d => d.category).filter(Boolean))) as string[];
    const map: Record<string, string> = {};
    categories.forEach((cat, i) => {
      map[cat] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [data, categoryColors]);

  // Filter data by brush extents
  const filteredIds = useMemo(() => {
    if (brushExtents.length === 0) return null;
    return new Set(
      data.filter(d => {
        return brushExtents.every(ext => {
          const scale = scales[ext.key];
          if (!scale) return true;
          const val = d.values[ext.key];
          const yPos = scale.constructor.name.includes('Point')
            ? (scale as d3.ScalePoint<string>)(String(val)) ?? 0
            : (scale as d3.ScaleLinear<number, number>)(Number(val) || 0);
          return yPos >= ext.range[0] && yPos <= ext.range[1];
        });
      }).map(d => d.id)
    );
  }, [brushExtents, data, scales]);

  // Build line path for a datum
  const linePath = useCallback((d: ParallelDatum): string => {
    const points = axisOrder.map(key => {
      const scale = scales[key];
      if (!scale) return null;
      const x = xScale(key) ?? 0;
      const val = d.values[key];
      const y = scale.constructor.name.includes('Point')
        ? (scale as d3.ScalePoint<string>)(String(val)) ?? 0
        : (scale as d3.ScaleLinear<number, number>)(Number(val) || 0);
      return [x, y] as [number, number];
    }).filter(Boolean) as [number, number][];
    return d3.line()(points) ?? '';
  }, [axisOrder, scales, xScale]);

  // Brush handling via D3
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || innerWidth <= 0 || innerHeight <= 0) return;

    const g = d3.select(svg).select<SVGGElement>('g.brush-layer');
    g.selectAll('.brush').remove();

    for (const key of axisOrder) {
      const x = xScale(key) ?? 0;
      const brush = d3.brushY()
        .extent([[-12, 0], [12, innerHeight]])
        .on('brush end', (event: d3.D3BrushEvent<unknown>) => {
          setBrushExtents(prev => {
            const next = prev.filter(e => e.key !== key);
            if (event.selection) {
              const [y0, y1] = event.selection as [number, number];
              next.push({ key, range: [y0, y1] });
            }
            return next;
          });
        });

      g.append('g')
        .attr('class', 'brush')
        .attr('transform', `translate(${x},0)`)
        .call(brush);
    }
  }, [axisOrder, xScale, innerHeight, innerWidth]);

  // Axis drag handlers
  const handleAxisDragStart = useCallback((key: string, startX: number) => {
    setDraggingAxis(key);
    setDragX(startX);
  }, []);

  const handleAxisDrag = useCallback((e: React.MouseEvent) => {
    if (!draggingAxis) return;
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    const x = e.clientX - svgRect.left - MARGIN.left;
    setDragX(x);

    // Reorder if dragged past another axis
    const positions = axisOrder.map(k => ({ key: k, x: xScale(k) ?? 0 }));
    const sorted = [...positions].sort((a, b) => a.x - b.x);
    const dragIdx = sorted.findIndex(p => p.key === draggingAxis);
    if (dragIdx < 0) return;

    let newOrder = sorted.map(p => p.key);
    // Check if we should swap
    if (dragIdx > 0 && x < sorted[dragIdx - 1].x) {
      [newOrder[dragIdx], newOrder[dragIdx - 1]] = [newOrder[dragIdx - 1], newOrder[dragIdx]];
      setAxisOrder(newOrder);
    } else if (dragIdx < sorted.length - 1 && x > sorted[dragIdx + 1].x) {
      [newOrder[dragIdx], newOrder[dragIdx + 1]] = [newOrder[dragIdx + 1], newOrder[dragIdx]];
      setAxisOrder(newOrder);
    }
  }, [draggingAxis, axisOrder, xScale]);

  const handleAxisDragEnd = useCallback(() => {
    setDraggingAxis(null);
    setDragX(null);
  }, []);

  if (width <= 0 || height <= 0 || axes.length === 0) return null;

  const axisLookup = Object.fromEntries(axes.map(a => [a.key, a]));

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      onMouseMove={draggingAxis ? handleAxisDrag : undefined}
      onMouseUp={draggingAxis ? handleAxisDragEnd : undefined}
      onMouseLeave={draggingAxis ? handleAxisDragEnd : undefined}
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {/* Lines */}
        <g className="lines">
          {data.map(d => {
            const isFiltered = filteredIds && !filteredIds.has(d.id);
            const isHighlighted = highlightedId === d.id;
            const color = colorByCategory && d.category
              ? colorMap[d.category] ?? '#94a3b8'
              : '#94a3b8';
            return (
              <path
                key={d.id}
                d={linePath(d)}
                fill="none"
                stroke={isHighlighted ? '#facc15' : color}
                strokeWidth={isHighlighted ? 2.5 : 1.2}
                strokeOpacity={isFiltered ? 0.05 : isHighlighted ? 1 : 0.5}
                style={{ cursor: 'pointer', transition: 'stroke-opacity 0.2s' }}
                onMouseEnter={() => onLineHover?.(d)}
                onMouseLeave={() => onLineHover?.(null)}
                onClick={() => onLineClick?.(d)}
              />
            );
          })}
        </g>

        {/* Brush layer */}
        <g className="brush-layer" />

        {/* Axes */}
        {axisOrder.map(key => {
          const axis = axisLookup[key];
          if (!axis) return null;
          const x = draggingAxis === key && dragX !== null ? dragX : (xScale(key) ?? 0);
          const scale = scales[key];
          if (!scale) return null;

          const ticks = axis.type === 'numeric'
            ? (scale as d3.ScaleLinear<number, number>).ticks(5).map(t => ({
                label: String(t),
                y: (scale as d3.ScaleLinear<number, number>)(t),
              }))
            : ((scale as d3.ScalePoint<string>).domain()).map(v => ({
                label: v,
                y: (scale as d3.ScalePoint<string>)(v) ?? 0,
              }));

          return (
            <g key={key} transform={`translate(${x},0)`} style={{ cursor: 'grab' }}>
              <line y1={0} y2={innerHeight} stroke="#94a3b8" strokeWidth={1} />
              {ticks.map((t, i) => (
                <g key={i} transform={`translate(0,${t.y})`}>
                  <line x1={-4} x2={0} stroke="#94a3b8" />
                  <text x={-6} dy="0.32em" textAnchor="end" fontSize={9} fill="#64748b">
                    {t.label}
                  </text>
                </g>
              ))}
              {/* Axis label (draggable) */}
              <text
                y={-14}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#334155"
                style={{ cursor: 'grab', userSelect: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAxisDragStart(key, x);
                }}
              >
                {axis.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
