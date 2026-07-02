import { useMemo, useState } from "react";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";

const MARGIN = { top: 24, right: 24, bottom: 32, left: 140 };
const ROW_HEIGHT = 18;
const MIN_BAR_WIDTH = 4;
const GROUP_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ca8a04",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#ea580c",
  "#65a30d",
  "#4f46e5",
  "#c026d3",
  "#0d9488",
];

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export default function GenericTimeline({ projections, onSelect }: VisualizationProps) {
  const items = projections.temporal ?? [];
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { rows, minYear, maxYear, groupOrder, colorForGroup } = useMemo(() => {
    if (items.length === 0) {
      return {
        rows: [],
        minYear: 0,
        maxYear: 0,
        groupOrder: [] as string[],
        colorForGroup: (_: string) => GROUP_COLORS[0],
      };
    }
    const ys = items.flatMap((i) => [i.startYear, i.endYear ?? i.startYear]);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const key = item.group ?? "Other";
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    const order = Array.from(groups.keys()).sort();
    const colorByGroup = new Map<string, string>();
    order.forEach((g, i) => colorByGroup.set(g, GROUP_COLORS[i % GROUP_COLORS.length]));
    const rowList: Array<{ group: string; rowIndex: number; item: (typeof items)[number] }> = [];
    let rowIndex = 0;
    for (const group of order) {
      for (const item of groups.get(group) ?? []) {
        rowList.push({ group, rowIndex, item });
        rowIndex += 1;
      }
    }
    return {
      rows: rowList,
      minYear: min,
      maxYear: max,
      groupOrder: order,
      colorForGroup: (g: string) => colorByGroup.get(g) ?? GROUP_COLORS[0],
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no temporal data to render.
      </div>
    );
  }

  const width = 1000;
  const height = MARGIN.top + MARGIN.bottom + rows.length * ROW_HEIGHT;
  const span = maxYear - minYear || 1;
  const yearToX = (year: number) =>
    MARGIN.left + ((year - minYear) / span) * (width - MARGIN.left - MARGIN.right);

  const tickCount = 8;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(minYear + (i / tickCount) * span)
  );

  return (
    <div className="relative h-full w-full overflow-auto bg-white">
      {groupOrder.length > 1 && (
        <div className="sticky top-0 z-10 flex flex-wrap gap-2 px-3 py-1.5 bg-white/95 backdrop-blur border-b border-gray-200 text-[10px]">
          {groupOrder.map((g) => (
            <span key={g} className="inline-flex items-center gap-1 text-gray-700">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: colorForGroup(g) }}
                aria-hidden="true"
              />
              {g}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} className="block">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={yearToX(tick)}
              x2={yearToX(tick)}
              y1={MARGIN.top - 4}
              y2={height - MARGIN.bottom + 4}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text
              x={yearToX(tick)}
              y={height - MARGIN.bottom + 18}
              textAnchor="middle"
              className="fill-gray-500 text-[10px]"
            >
              {formatYear(tick)}
            </text>
          </g>
        ))}

        {rows.map(({ item, rowIndex, group }) => {
          const x1 = yearToX(item.startYear);
          const end = item.endYear ?? item.startYear;
          const x2 = Math.max(x1 + MIN_BAR_WIDTH, yearToX(end));
          const y = MARGIN.top + rowIndex * ROW_HEIGHT;
          const active = hoverId === item.id;
          const fill = colorForGroup(group);
          return (
            <g
              key={item.id}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelect?.(item.id, item.payload)}
              className="cursor-pointer"
            >
              <rect
                x={x1}
                y={y + 2}
                width={x2 - x1}
                height={ROW_HEIGHT - 4}
                rx={3}
                fill={fill}
                fillOpacity={active ? 1 : 0.75}
              />
              <text
                x={x1 - 6}
                y={y + ROW_HEIGHT / 2 + 3}
                textAnchor="end"
                className="fill-gray-700 text-[10px]"
              >
                {item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label}
              </text>
            </g>
          );
        })}

        {/* Group dividers */}
        {(() => {
          let cursor = 0;
          return groupOrder.map((g) => {
            const count = rows.filter((r) => r.group === g).length;
            const y = MARGIN.top + cursor * ROW_HEIGHT;
            cursor += count;
            return (
              <text
                key={g}
                x={6}
                y={y + 12}
                className="fill-gray-400 text-[9px] uppercase tracking-wider"
              >
                {g}
              </text>
            );
          });
        })()}
      </svg>
    </div>
  );
}
