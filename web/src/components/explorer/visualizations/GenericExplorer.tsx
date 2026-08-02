import { useMemo, useState } from "react";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";
import type { CategoricalRow } from "@/lib/visualization/adapters/types";

type SortDirection = "asc" | "desc";

function formatCell(value: CategoricalRow["facets"][string]): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  const s = String(value);
  return s || "—";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || text === "—") return <>{text}</>;
  const re = new RegExp(`(${escapeRegex(query)})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) && part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-gray-900 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function compareValues(
  a: CategoricalRow["facets"][string],
  b: CategoricalRow["facets"][string]
): number {
  const aNull = a === null || a === undefined || (Array.isArray(a) && a.length === 0);
  const bNull = b === null || b === undefined || (Array.isArray(b) && b.length === 0);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export default function GenericExplorer({ projections, onSelect, searchQuery = "" }: VisualizationProps) {
  const rows = projections.categorical ?? [];
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row.facets)) keys.add(k);
    }
    return Array.from(keys);
  }, [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((ra, rb) => {
      if (sortKey === "__label__") {
        return ra.label.localeCompare(rb.label) * dir;
      }
      return compareValues(ra.facets[sortKey], rb.facets[sortKey]) * dir;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no rows to render.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            <SortableHeader
              label="Name"
              active={sortKey === "__label__"}
              direction={sortDir}
              onClick={() => toggleSort("__label__")}
            />
            {columns.map((col) => (
              <SortableHeader
                key={col}
                label={col}
                active={sortKey === col}
                direction={sortDir}
                onClick={() => toggleSort(col)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelect?.(row.id, row.payload)}
              className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
            >
              <td className="px-3 py-1.5 font-medium text-gray-900 whitespace-nowrap">
                <HighlightedText text={row.label} query={searchQuery} />
              </td>
              {columns.map((col) => {
                const formatted = formatCell(row.facets[col]);
                return (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-gray-600 max-w-[300px] truncate"
                    title={formatted}
                  >
                    <HighlightedText text={formatted} query={searchQuery} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}

function SortableHeader({ label, active, direction, onClick }: SortableHeaderProps) {
  return (
    <th
      onClick={onClick}
      className="px-3 py-2 text-left font-semibold text-gray-700 uppercase tracking-wider text-[10px] cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-blue-600">{direction === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
