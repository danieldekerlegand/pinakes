import React, { useMemo, useState, useCallback, useRef } from 'react';
import { useVisualization } from '../../contexts/VisualizationContext';
import { useVisualizationResize } from './hooks/useVisualizationResize';
import { VisualizationTooltip } from './shared/VisualizationTooltip';
import type { TimelineEvent, TooltipData } from '../../lib/visualization/types';
import { Clock, ChevronDown, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface LanguageTimelineViewProps {
  timelineData: TimelineEvent[];
  onEventClick?: (id: string) => void;
}

// Stable color palette for families — hue-based so we can generate light/dark variants
const FAMILY_HUES = [
  210, // blue
  150, // green
  35,  // amber
  0,   // red
  270, // purple
  330, // pink
  175, // teal
  25,  // orange
  245, // indigo
  80,  // lime
  195, // cyan
  55,  // yellow
  290, // violet
  310, // fuchsia
  120, // emerald
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getFamilyHue(familyId: string): number {
  return FAMILY_HUES[hashString(familyId) % FAMILY_HUES.length];
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatSpeakers(count: number | undefined): string {
  if (!count) return '';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B speakers`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M speakers`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K speakers`;
  return `${count} speakers`;
}

// Group structure for the timeline
interface FamilyGroup {
  familyId: string;
  familyName: string;
  hue: number;
  events: TimelineEvent[];
}

const ROW_HEIGHT = 28;
const FAMILY_HEADER_HEIGHT = 32;
const FAMILY_GAP = 8;
const LABEL_WIDTH = 180;
const RIGHT_PAD = 24;
const HEADER_HEIGHT = 40;

export function LanguageTimelineView({ timelineData, onEventClick }: LanguageTimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useVisualizationResize(containerRef);
  const { isLanguageSelected, toggleLanguage } = useVisualization();

  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Zoom: [minYear, maxYear] visible range
  const fullExtent = useMemo(() => {
    if (timelineData.length === 0) return { min: -3000, max: 2025 };
    const min = Math.min(...timelineData.map((d) => d.startYear));
    const max = Math.max(...timelineData.map((d) => d.endYear ?? new Date().getFullYear()));
    return { min: min - 100, max: max + 50 };
  }, [timelineData]);

  const [viewRange, setViewRange] = useState<{ min: number; max: number }>(fullExtent);

  // Reset range when data changes
  useMemo(() => setViewRange(fullExtent), [fullExtent]);

  // Group events by family, sorted by family name
  const familyGroups: FamilyGroup[] = useMemo(() => {
    const groupMap = new Map<string, FamilyGroup>();
    for (const event of timelineData) {
      let group = groupMap.get(event.familyId);
      if (!group) {
        group = {
          familyId: event.familyId,
          familyName: event.familyName,
          hue: getFamilyHue(event.familyId),
          events: [],
        };
        groupMap.set(event.familyId, group);
      }
      group.events.push(event);
    }
    // Sort groups by family name, sort events within by startYear
    const groups = Array.from(groupMap.values())
      .sort((a, b) => a.familyName.localeCompare(b.familyName));
    for (const g of groups) {
      g.events.sort((a, b) => a.startYear - b.startYear);
    }
    return groups;
  }, [timelineData]);

  const toggleFamily = useCallback((familyId: string) => {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }, []);

  // Compute scale
  const timelineWidth = Math.max(100, width - LABEL_WIDTH - RIGHT_PAD);
  const yearSpan = viewRange.max - viewRange.min || 1;
  const pxPerYear = timelineWidth / yearSpan;
  const yearToX = (year: number) => (year - viewRange.min) * pxPerYear;

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setViewRange((prev) => {
      const mid = (prev.min + prev.max) / 2;
      const halfSpan = (prev.max - prev.min) / 4;
      return { min: Math.round(mid - halfSpan), max: Math.round(mid + halfSpan) };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewRange((prev) => {
      const mid = (prev.min + prev.max) / 2;
      const halfSpan = (prev.max - prev.min);
      return {
        min: Math.max(fullExtent.min, Math.round(mid - halfSpan)),
        max: Math.min(fullExtent.max, Math.round(mid + halfSpan)),
      };
    });
  }, [fullExtent]);

  const handleResetZoom = useCallback(() => {
    setViewRange(fullExtent);
  }, [fullExtent]);

  // Generate tick marks
  const ticks = useMemo(() => {
    const span = viewRange.max - viewRange.min;
    let step: number;
    if (span > 5000) step = 1000;
    else if (span > 2000) step = 500;
    else if (span > 1000) step = 250;
    else if (span > 500) step = 100;
    else if (span > 200) step = 50;
    else step = 25;

    const result: number[] = [];
    const first = Math.ceil(viewRange.min / step) * step;
    for (let y = first; y <= viewRange.max; y += step) {
      result.push(y);
    }
    return result;
  }, [viewRange]);

  // Tooltip
  const tooltipData: TooltipData | null = hoveredEvent ? {
    id: hoveredEvent.id,
    name: hoveredEvent.name,
    nativeName: hoveredEvent.nativeName,
    type: hoveredEvent.type,
    familyName: hoveredEvent.familyName,
    region: hoveredEvent.region,
    status: hoveredEvent.status,
    totalSpeakers: hoveredEvent.totalSpeakers,
    timeOrigin: formatYear(hoveredEvent.startYear),
    timeEnd: hoveredEvent.endYear ? formatYear(hoveredEvent.endYear) : 'Present',
  } : null;

  if (timelineData.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center p-8">
          <Clock className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No timeline data available</p>
          <p className="text-sm text-gray-400 mt-1">Languages need time origin data to appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col bg-white rounded-lg border border-gray-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/50 rounded-t-lg flex-shrink-0">
        <div className="text-xs text-gray-500">
          {timelineData.length} languages · {familyGroups.length} families · {formatYear(viewRange.min)} — {formatYear(viewRange.max)}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-gray-200 text-gray-500" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-gray-200 text-gray-500" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button onClick={handleResetZoom} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
            Reset
          </button>
        </div>
      </div>

      {/* Timeline header with ticks */}
      <div className="flex-shrink-0 border-b border-gray-200" style={{ height: HEADER_HEIGHT }}>
        <div className="flex" style={{ height: HEADER_HEIGHT }}>
          <div style={{ width: LABEL_WIDTH }} className="flex-shrink-0" />
          <div className="relative flex-1 overflow-hidden" style={{ marginRight: RIGHT_PAD }}>
            {ticks.map((year) => {
              const x = yearToX(year);
              if (x < 0 || x > timelineWidth) return null;
              return (
                <div
                  key={year}
                  className="absolute bottom-0 text-xs text-gray-400"
                  style={{ left: x, transform: 'translateX(-50%)' }}
                >
                  <span>{formatYear(year)}</span>
                  <div className="w-px h-2 bg-gray-300 mx-auto mt-0.5" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {familyGroups.map((group) => {
          const isCollapsed = collapsedFamilies.has(group.familyId);
          const bgLight = `hsla(${group.hue}, 70%, 97%, 1)`;
          const barColor = `hsl(${group.hue}, 65%, 55%)`;
          const barColorLight = `hsl(${group.hue}, 60%, 70%)`;
          const barColorSelected = `hsl(${group.hue}, 75%, 45%)`;
          const borderColor = `hsl(${group.hue}, 50%, 85%)`;

          return (
            <div key={group.familyId}>
              {/* Family header */}
              <div
                className="flex items-center gap-2 px-3 cursor-pointer select-none sticky top-0 z-10 border-b"
                style={{
                  height: FAMILY_HEADER_HEIGHT,
                  backgroundColor: bgLight,
                  borderColor,
                }}
                onClick={() => toggleFamily(group.familyId)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                )}
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: barColor }}
                />
                <span className="text-sm font-semibold text-gray-800 truncate">
                  {group.familyName}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {group.events.length} {group.events.length === 1 ? 'language' : 'languages'}
                </span>
              </div>

              {/* Language rows */}
              {!isCollapsed && group.events.map((event, idx) => {
                const selected = isLanguageSelected(event.id);
                const endYear = event.endYear ?? new Date().getFullYear();
                const x1 = yearToX(event.startYear);
                const x2 = yearToX(endYear);
                const barLeft = Math.max(0, x1);
                const barRight = Math.min(timelineWidth, x2);
                const barW = Math.max(3, barRight - barLeft);

                // Alternate row shade slightly
                const rowBg = idx % 2 === 0 ? 'transparent' : `hsla(${group.hue}, 30%, 97%, 0.5)`;

                return (
                  <div
                    key={event.id}
                    className="flex items-center group"
                    style={{ height: ROW_HEIGHT, backgroundColor: rowBg }}
                  >
                    {/* Label */}
                    <div
                      className="flex-shrink-0 px-3 truncate text-xs flex items-center gap-1.5"
                      style={{ width: LABEL_WIDTH }}
                      title={event.name}
                    >
                      <span className={`truncate ${selected ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                        {event.name}
                      </span>
                      {event.status === 'extinct' && (
                        <span className="text-[10px] text-red-400 flex-shrink-0">†</span>
                      )}
                      {event.status === 'endangered' && (
                        <span className="text-[10px] text-amber-400 flex-shrink-0">!</span>
                      )}
                    </div>

                    {/* Bar area */}
                    <div
                      className="relative flex-1 h-full flex items-center"
                      style={{ marginRight: RIGHT_PAD }}
                    >
                      {/* Gridlines */}
                      {ticks.map((year) => {
                        const x = yearToX(year);
                        if (x < 0 || x > timelineWidth) return null;
                        return (
                          <div
                            key={year}
                            className="absolute top-0 bottom-0 w-px bg-gray-100"
                            style={{ left: x }}
                          />
                        );
                      })}

                      {/* Bar */}
                      <div
                        className={`absolute rounded-sm cursor-pointer transition-all duration-100 ${
                          selected
                            ? 'ring-2 ring-offset-1 shadow-sm'
                            : 'hover:brightness-110 hover:shadow-sm'
                        }`}
                        style={{
                          left: barLeft,
                          width: barW,
                          height: ROW_HEIGHT - 10,
                          backgroundColor: selected ? barColorSelected : barColor,
                          opacity: selected ? 1 : 0.8,
                          outlineColor: selected ? barColorSelected : undefined,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLanguage(event.id);
                          onEventClick?.(event.id);
                        }}
                        onMouseEnter={(e) => {
                          setHoveredEvent(event);
                          setTooltipPos({ x: e.pageX, y: e.pageY - 10 });
                        }}
                        onMouseMove={(e) => {
                          setTooltipPos({ x: e.pageX, y: e.pageY - 10 });
                        }}
                        onMouseLeave={() => setHoveredEvent(null)}
                      >
                        {/* Show name on bar if wide enough */}
                        {barW > 60 && (
                          <div
                            className="absolute inset-0 flex items-center px-1.5 text-[10px] text-white font-medium truncate pointer-events-none"
                            style={{ lineHeight: `${ROW_HEIGHT - 10}px` }}
                          >
                            {event.name}
                          </div>
                        )}
                      </div>

                      {/* "Present" indicator for living languages */}
                      {!event.endYear && x2 >= timelineWidth - 5 && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                          style={{
                            left: Math.min(timelineWidth - 3, x2),
                            backgroundColor: barColor,
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Spacing between groups */}
              <div style={{ height: FAMILY_GAP }} />
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      <VisualizationTooltip
        data={tooltipData}
        x={tooltipPos.x}
        y={tooltipPos.y}
        visible={hoveredEvent !== null}
      />
    </div>
  );
}
