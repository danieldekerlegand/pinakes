import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  type CultureEvent,
  type LaneDefinition,
  LANE_ORDER,
  formatYear,
  getLaneDefinition,
  getEventRadius,
  groupEventsByLane,
  getUsedLanes,
  getTimeBounds,
  yearToX,
  xToYear,
  getAxisTicks,
  summarizeStateAtYear,
} from "@/components/culture-profile/culture-evolution-timeline-utils";

interface Props {
  events: CultureEvent[];
  profileStart: number;
  profileEnd: number;
  height?: number;
  onYearChange?: (year: number) => void;
}

const LEFT_PAD = 92;
const RIGHT_PAD = 12;
const TOP_PAD = 28;
const BOTTOM_PAD = 32;
const LANE_HEIGHT = 42;

export default function CultureEvolutionTimeline({
  events,
  profileStart,
  profileEnd,
  height,
  onYearChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const usedLanes: LaneDefinition[] = useMemo(
    () => (events.length > 0 ? getUsedLanes(events) : LANE_ORDER),
    [events]
  );

  const bounds = useMemo(
    () => getTimeBounds(profileStart, profileEnd, events),
    [profileStart, profileEnd, events]
  );

  const [scrubYear, setScrubYear] = useState<number>(profileStart);

  useEffect(() => {
    setScrubYear(profileStart);
  }, [profileStart]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const resize = () => setWidth(Math.max(320, el.clientWidth));
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chartHeight = height ?? TOP_PAD + usedLanes.length * LANE_HEIGHT + BOTTOM_PAD;
  const chartWidth = Math.max(0, width - LEFT_PAD - RIGHT_PAD);

  const grouped = useMemo(() => groupEventsByLane(events), [events]);
  const ticks = useMemo(() => getAxisTicks(bounds, 6), [bounds]);
  const stateAtScrub = useMemo(
    () => summarizeStateAtYear(events, scrubYear),
    [events, scrubYear]
  );

  const scrubX = yearToX(scrubYear, bounds, chartWidth);

  const handleScrubChange = useCallback(
    (year: number) => {
      const clamped = Math.max(bounds.start, Math.min(bounds.end, year));
      setScrubYear(clamped);
      onYearChange?.(clamped);
    },
    [bounds.start, bounds.end, onYearChange]
  );

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  return (
    <div className="space-y-3" data-testid="culture-evolution-timeline">
      <div
        ref={containerRef}
        className="relative w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden"
      >
        <svg
          width={width}
          height={chartHeight}
          className="block"
          role="img"
          aria-label="Culture evolution timeline"
        >
          {/* Swim lane rows */}
          {usedLanes.map((lane, i) => {
            const y = TOP_PAD + i * LANE_HEIGHT;
            return (
              <g key={lane.key}>
                <rect
                  x={0}
                  y={y}
                  width={width}
                  height={LANE_HEIGHT}
                  fill={i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.02)"}
                />
                <text
                  x={LEFT_PAD - 8}
                  y={y + LANE_HEIGHT / 2 + 4}
                  textAnchor="end"
                  className="fill-gray-600 dark:fill-gray-300"
                  style={{ fontSize: 11, fontWeight: 500 }}
                >
                  {lane.label}
                </text>
                <line
                  x1={LEFT_PAD}
                  x2={width - RIGHT_PAD}
                  y1={y + LANE_HEIGHT / 2}
                  y2={y + LANE_HEIGHT / 2}
                  stroke={lane.color}
                  strokeOpacity={0.25}
                  strokeDasharray="2 4"
                />
              </g>
            );
          })}

          {/* Active culture range band */}
          <rect
            x={LEFT_PAD + yearToX(profileStart, bounds, chartWidth)}
            y={TOP_PAD - 10}
            width={Math.max(
              2,
              yearToX(profileEnd, bounds, chartWidth) -
                yearToX(profileStart, bounds, chartWidth)
            )}
            height={usedLanes.length * LANE_HEIGHT + 20}
            fill="currentColor"
            className="text-indigo-500"
            opacity={0.05}
          />

          {/* X-axis ticks */}
          {ticks.map((tick) => {
            const x = LEFT_PAD + yearToX(tick, bounds, chartWidth);
            return (
              <g key={tick}>
                <line
                  x1={x}
                  x2={x}
                  y1={TOP_PAD - 4}
                  y2={chartHeight - BOTTOM_PAD + 4}
                  stroke="currentColor"
                  className="text-gray-200 dark:text-gray-700"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={chartHeight - BOTTOM_PAD + 18}
                  textAnchor="middle"
                  className="fill-gray-500 dark:fill-gray-400"
                  style={{ fontSize: 10 }}
                >
                  {formatYear(tick)}
                </text>
              </g>
            );
          })}

          {/* Event markers */}
          {usedLanes.map((lane, i) => {
            const laneY = TOP_PAD + i * LANE_HEIGHT + LANE_HEIGHT / 2;
            const laneEvents = grouped.get(lane.key) ?? [];
            return (
              <g key={`evt-${lane.key}`}>
                {laneEvents.map((event) => {
                  const cx = LEFT_PAD + yearToX(event.year, bounds, chartWidth);
                  const r = getEventRadius(event.magnitude);
                  const isHovered = hoveredEventId === event.id;
                  const isSelected = selectedEventId === event.id;
                  return (
                    <g
                      key={event.id}
                      transform={`translate(${cx}, ${laneY})`}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoveredEventId(event.id)}
                      onMouseLeave={() => setHoveredEventId(null)}
                      onClick={() =>
                        setSelectedEventId(isSelected ? null : event.id)
                      }
                      data-testid={`evolution-event-${event.id}`}
                    >
                      <circle
                        r={r + (isHovered || isSelected ? 3 : 0)}
                        fill={lane.color}
                        fillOpacity={isSelected ? 1 : 0.85}
                        stroke={isSelected ? "#1f2937" : "white"}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      {(isHovered || isSelected) && (
                        <text
                          y={-r - 6}
                          textAnchor="middle"
                          className="fill-gray-800 dark:fill-gray-100"
                          style={{ fontSize: 10, fontWeight: 600 }}
                        >
                          {event.title.length > 28
                            ? `${event.title.slice(0, 27)}\u2026`
                            : event.title}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Scrubber line */}
          <g transform={`translate(${LEFT_PAD + scrubX}, 0)`}>
            <line
              y1={TOP_PAD - 12}
              y2={chartHeight - BOTTOM_PAD + 6}
              stroke="#6366f1"
              strokeWidth={1.5}
            />
            <rect
              x={-24}
              y={2}
              width={48}
              height={18}
              rx={4}
              fill="#6366f1"
            />
            <text
              x={0}
              y={15}
              textAnchor="middle"
              fill="white"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {formatYear(scrubYear)}
            </text>
          </g>
        </svg>

        {/* Scrubber slider (HTML range input) */}
        <div className="px-3 pb-2">
          <input
            type="range"
            min={bounds.start}
            max={bounds.end}
            value={scrubYear}
            onChange={(e) => handleScrubChange(parseInt(e.target.value, 10))}
            className="w-full accent-indigo-500"
            aria-label="Scrub timeline year"
            data-testid="timeline-scrubber"
          />
        </div>
      </div>

      {/* State summary at scrub position */}
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50"
        data-testid="timeline-state-summary"
      >
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          State at {formatYear(scrubYear)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {usedLanes.map((lane) => {
            const event = stateAtScrub[lane.key];
            return (
              <div
                key={lane.key}
                className="flex items-start gap-2"
                data-testid={`state-${lane.key}`}
              >
                <div
                  className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ background: lane.color }}
                />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {lane.label}
                  </p>
                  <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                    {event ? event.title : "\u2014"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected event details */}
      {selectedEvent && (
        <div
          className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3"
          data-testid="timeline-event-detail"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ background: getLaneDefinition(selectedEvent.lane).color }}
                />
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {selectedEvent.title}
                </p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {formatYear(selectedEvent.year)} {"\u00b7"} {selectedEvent.eventType}{" "}
                {"\u00b7"} {selectedEvent.magnitude}
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-200 mt-2 leading-relaxed">
                {selectedEvent.description}
              </p>
            </div>
            <button
              className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-100"
              onClick={() => setSelectedEventId(null)}
              aria-label="Dismiss event"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { yearToX, xToYear };
