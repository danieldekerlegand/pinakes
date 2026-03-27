import { useMemo } from "react";

export interface HeatmapCell {
  value: number;
  label: string;
  items: { text: string; colorIndex: number }[];
}

export interface HeatmapGridProps {
  rows: readonly string[];
  columns: readonly string[];
  data: Record<string, Record<string, HeatmapCell>>;
  colors: string[];
  highlightCells?: Set<string>;
  cornerLabel?: string;
}

function cellKey(row: string, col: string) {
  return `${row}|${col}`;
}

export function HeatmapGrid({
  rows,
  columns,
  data,
  colors,
  highlightCells,
  cornerLabel = "",
}: HeatmapGridProps) {
  const maxValue = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      for (const col of columns) {
        const cell = data[row]?.[col];
        if (cell && cell.value > max) max = cell.value;
      }
    }
    return max;
  }, [rows, columns, data]);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="border border-gray-300 px-1 py-1 bg-gray-50 text-left min-w-[80px]">
              {cornerLabel}
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="border border-gray-300 px-1 py-1 bg-gray-50 text-center"
                style={{ minWidth: "60px" }}
              >
                <span className="text-[10px] leading-tight block">{col}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="border border-gray-300 px-1 py-1 bg-gray-50 font-medium text-[10px]">
                {row}
              </td>
              {columns.map((col) => {
                const cell = data[row]?.[col];
                const isHighlighted =
                  highlightCells && cell && cell.items.length > 0 &&
                  highlightCells.has(cellKey(row, col));
                const intensity = cell && maxValue > 0 ? cell.value / maxValue : 0;

                return (
                  <td
                    key={col}
                    className={`border border-gray-300 px-1 py-1 text-center ${
                      isHighlighted ? "bg-yellow-50" : ""
                    }`}
                    style={
                      !isHighlighted && intensity > 0
                        ? { backgroundColor: `rgba(59, 130, 246, ${intensity * 0.1})` }
                        : undefined
                    }
                  >
                    {cell && cell.items.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {cell.items.map((item, i) => (
                          <span
                            key={`${item.text}-${item.colorIndex}-${i}`}
                            className={`inline-block rounded px-0.5 text-white text-[11px] font-mono ${
                              colors[item.colorIndex] || "bg-gray-500"
                            }`}
                            title={item.text}
                          >
                            {item.text}
                          </span>
                        ))}
                      </div>
                    )}
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
