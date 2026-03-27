import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { TimeNavigator, formatYear } from './TimeNavigator';

// ── Types ────────────────────────────────────────────────────────────────────

type TimelineDomain =
  | 'empire'
  | 'battle'
  | 'civilization'
  | 'migration'
  | 'trade-route'
  | 'art-tradition'
  | 'music-tradition'
  | 'archaeological-site';

interface CrossDomainTimelineEvent {
  id: string;
  name: string;
  domain: TimelineDomain;
  startYear: number;
  endYear: number | null;
  description?: string;
  associatedLanguageIds: string[];
  region?: string;
  metadata?: Record<string, unknown>;
}

interface TimelineApiResponse {
  events: CrossDomainTimelineEvent[];
  domains: TimelineDomain[];
  temporalRange: { min: number; max: number };
  count: number;
}

// ── Domain styling ───────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<TimelineDomain, string> = {
  empire: '#dc2626',
  battle: '#7c2d12',
  civilization: '#2563eb',
  migration: '#16a34a',
  'trade-route': '#f59e0b',
  'art-tradition': '#c026d3',
  'music-tradition': '#7c3aed',
  'archaeological-site': '#ea580c',
};

const DOMAIN_LABELS: Record<TimelineDomain, string> = {
  empire: 'Empires',
  battle: 'Battles',
  civilization: 'Civilizations',
  migration: 'Migrations',
  'trade-route': 'Trade Routes',
  'art-tradition': 'Art Traditions',
  'music-tradition': 'Music Traditions',
  'archaeological-site': 'Archaeological Sites',
};

const ALL_DOMAINS: TimelineDomain[] = [
  'empire',
  'battle',
  'civilization',
  'migration',
  'trade-route',
  'art-tradition',
  'music-tradition',
  'archaeological-site',
];

// ── Component ────────────────────────────────────────────────────────────────

export function CrossDomainTimeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height: containerHeight } = useVisualizationResize(containerRef);

  const [enabledDomains, setEnabledDomains] = useState<Set<TimelineDomain>>(
    new Set(ALL_DOMAINS),
  );
  const [currentYear, setCurrentYear] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredEvent, setHoveredEvent] = useState<{
    event: CrossDomainTimelineEvent;
    x: number;
    y: number;
  } | null>(null);

  const domainsParam = useMemo(
    () => Array.from(enabledDomains).sort().join(','),
    [enabledDomains],
  );

  const { data, isLoading } = useQuery<TimelineApiResponse>({
    queryKey: ['/api/cross-domain/timeline', { domains: domainsParam }],
    staleTime: 60_000,
  });

  const toggleDomain = useCallback((domain: TimelineDomain) => {
    setEnabledDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }, []);

  // Height for SVG area (container minus controls)
  const svgHeight = Math.max(containerHeight - 140, 200);

  // ── D3 rendering ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!svgRef.current || !data || data.events.length === 0 || width === 0 || svgHeight === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 30, right: 30, bottom: 50, left: 160 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = svgHeight - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Group events by domain (swim lanes)
    const activeDomains = ALL_DOMAINS.filter((d) => enabledDomains.has(d));
    const domainEvents = new Map<TimelineDomain, CrossDomainTimelineEvent[]>();
    for (const d of activeDomains) {
      domainEvents.set(d, data.events.filter((e) => e.domain === d));
    }
    // Only show domains that have events
    const visibleDomains = activeDomains.filter(
      (d) => (domainEvents.get(d)?.length ?? 0) > 0,
    );

    if (visibleDomains.length === 0) return;

    // X scale: time
    const xScale = d3
      .scaleLinear()
      .domain([data.temporalRange.min, data.temporalRange.max])
      .range([0, innerWidth]);

    // Y scale: swim lanes
    const yScale = d3
      .scaleBand<string>()
      .domain(visibleDomains)
      .range([0, innerHeight])
      .padding(0.15);

    const laneHeight = yScale.bandwidth();

    // Gridlines
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.08)
      .call(
        d3
          .axisBottom(xScale)
          .tickSize(innerHeight)
          .tickFormat(() => ''),
      );

    // Swim lane backgrounds
    for (const domain of visibleDomains) {
      const y = yScale(domain)!;
      g.append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', innerWidth)
        .attr('height', laneHeight)
        .attr('fill', DOMAIN_COLORS[domain])
        .attr('opacity', 0.04)
        .attr('rx', 4);
    }

    // Current year indicator
    if (currentYear >= data.temporalRange.min && currentYear <= data.temporalRange.max) {
      const cx = xScale(currentYear);
      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.7);

      g.append('text')
        .attr('x', cx)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ef4444')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .text(formatYear(currentYear));
    }

    // Draw events per lane
    for (const domain of visibleDomains) {
      const events = domainEvents.get(domain) ?? [];
      const laneY = yScale(domain)!;
      const color = DOMAIN_COLORS[domain];

      // For point events (battles), draw circles. For span events, draw bars.
      const spanEvents = events.filter((e) => e.endYear != null && e.endYear !== e.startYear);
      const pointEvents = events.filter((e) => e.endYear == null || e.endYear === e.startYear);

      // Span events: horizontal bars stacked within lane
      if (spanEvents.length > 0) {
        // Simple row packing to avoid overlap
        const rows = packRows(spanEvents, xScale, 4);
        const rowHeight = Math.min(laneHeight / Math.max(rows.length, 1), 20);

        for (let ri = 0; ri < rows.length; ri++) {
          for (const evt of rows[ri]) {
            const x1 = xScale(evt.startYear);
            const x2 = xScale(evt.endYear!);
            const barWidth = Math.max(x2 - x1, 2);
            const ry = laneY + ri * rowHeight;

            g.append('rect')
              .attr('x', x1)
              .attr('y', ry)
              .attr('width', barWidth)
              .attr('height', Math.max(rowHeight - 2, 3))
              .attr('fill', color)
              .attr('opacity', 0.75)
              .attr('rx', 2)
              .style('cursor', 'pointer')
              .on('mouseover', function (event: MouseEvent) {
                d3.select(this).attr('opacity', 1).attr('stroke', '#000').attr('stroke-width', 1);
                setHoveredEvent({ event: evt, x: event.pageX, y: event.pageY - 10 });
              })
              .on('mousemove', function (event: MouseEvent) {
                setHoveredEvent((prev) =>
                  prev ? { ...prev, x: event.pageX, y: event.pageY - 10 } : null,
                );
              })
              .on('mouseout', function () {
                d3.select(this).attr('opacity', 0.75).attr('stroke', 'none');
                setHoveredEvent(null);
              });

            // Label if wide enough
            if (barWidth > 40) {
              g.append('text')
                .attr('x', x1 + 4)
                .attr('y', ry + (rowHeight - 2) / 2 + 3)
                .attr('fill', '#fff')
                .attr('font-size', '10px')
                .attr('pointer-events', 'none')
                .text(evt.name.length > barWidth / 6 ? evt.name.slice(0, Math.floor(barWidth / 6)) + '…' : evt.name);
            }
          }
        }
      }

      // Point events: circles
      if (pointEvents.length > 0) {
        const midY = laneY + laneHeight / 2;
        for (const evt of pointEvents) {
          const cx = xScale(evt.startYear);
          g.append('circle')
            .attr('cx', cx)
            .attr('cy', midY)
            .attr('r', 4)
            .attr('fill', color)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseover', function (event: MouseEvent) {
              d3.select(this).attr('r', 6).attr('stroke', '#000');
              setHoveredEvent({ event: evt, x: event.pageX, y: event.pageY - 10 });
            })
            .on('mousemove', function (event: MouseEvent) {
              setHoveredEvent((prev) =>
                prev ? { ...prev, x: event.pageX, y: event.pageY - 10 } : null,
              );
            })
            .on('mouseout', function () {
              d3.select(this).attr('r', 4).attr('stroke', '#fff');
              setHoveredEvent(null);
            });
        }
      }
    }

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(xScale).tickFormat((d) => {
          const yr = d as number;
          return yr < 0 ? `${Math.abs(yr)} BCE` : `${yr} CE`;
        }),
      )
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end')
      .attr('font-size', '10px');

    // Y axis (domain labels)
    g.append('g').call(
      d3.axisLeft(yScale).tickFormat((d) => DOMAIN_LABELS[d as TimelineDomain] ?? d),
    );
  }, [data, width, svgHeight, enabledDomains, currentYear]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading timeline data…</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-lg border">
      {/* Domain filter toggles */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-gray-50">
        <span className="text-xs font-medium text-gray-500 mr-1">Domains:</span>
        {ALL_DOMAINS.map((domain) => {
          const active = enabledDomains.has(domain);
          return (
            <button
              key={domain}
              onClick={() => toggleDomain(domain)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                active
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
              }`}
              style={active ? { backgroundColor: DOMAIN_COLORS[domain] } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: DOMAIN_COLORS[domain] }}
              />
              {DOMAIN_LABELS[domain]}
            </button>
          );
        })}
      </div>

      {/* Timeline SVG */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        <svg ref={svgRef} width={width} height={svgHeight} />

        {/* Tooltip */}
        {hoveredEvent && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: `${hoveredEvent.x}px`,
              top: `${hoveredEvent.y}px`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: DOMAIN_COLORS[hoveredEvent.event.domain] }}
                />
                <h4 className="font-semibold text-sm">{hoveredEvent.event.name}</h4>
              </div>
              <p className="text-xs text-gray-500 mb-1">
                {DOMAIN_LABELS[hoveredEvent.event.domain]}
              </p>
              <p className="text-xs text-gray-700">
                {formatYear(hoveredEvent.event.startYear)}
                {hoveredEvent.event.endYear != null && hoveredEvent.event.endYear !== hoveredEvent.event.startYear
                  ? ` – ${formatYear(hoveredEvent.event.endYear)}`
                  : ''}
              </p>
              {hoveredEvent.event.description && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  {hoveredEvent.event.description}
                </p>
              )}
              {hoveredEvent.event.associatedLanguageIds.length > 0 && (
                <p className="text-xs text-blue-600 mt-1">
                  Languages: {hoveredEvent.event.associatedLanguageIds.slice(0, 5).join(', ')}
                  {hoveredEvent.event.associatedLanguageIds.length > 5
                    ? ` +${hoveredEvent.event.associatedLanguageIds.length - 5}`
                    : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Time navigator */}
      {data && (
        <TimeNavigator
          minYear={data.temporalRange.min}
          maxYear={data.temporalRange.max}
          currentYear={currentYear}
          onYearChange={setCurrentYear}
          isPlaying={isPlaying}
          onPlayingChange={setIsPlaying}
          compact
          className="border-t rounded-none"
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pack span events into rows to avoid horizontal overlap.
 * Returns an array of rows, each containing non-overlapping events.
 */
function packRows(
  events: CrossDomainTimelineEvent[],
  xScale: d3.ScaleLinear<number, number>,
  gap: number,
): CrossDomainTimelineEvent[][] {
  const sorted = [...events].sort((a, b) => a.startYear - b.startYear);
  const rows: CrossDomainTimelineEvent[][] = [];

  for (const evt of sorted) {
    const x1 = xScale(evt.startYear);
    const x2 = xScale(evt.endYear!);

    let placed = false;
    for (const row of rows) {
      const last = row[row.length - 1];
      const lastX2 = xScale(last.endYear!);
      if (x1 >= lastX2 + gap) {
        row.push(evt);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([evt]);
    }
  }

  return rows;
}

export default CrossDomainTimeline;
