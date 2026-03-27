export interface ComparisonColumn {
  id: string;
  label: string;
  colorClass?: string;
}

export interface ComparisonRow {
  label: string;
  values: Record<string, string | number>;
  mono?: boolean;
}

export interface ComparisonTableProps {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  footer?: string;
}

export function ComparisonTable({ columns, rows, footer }: ComparisonTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4">Feature</th>
            {columns.map((col) => (
              <th
                key={col.id}
                className={`text-left py-2 px-2 ${col.colorClass || ""}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.label} className={idx < rows.length - 1 ? "border-b" : ""}>
              <td className="py-2 pr-4 font-medium">{row.label}</td>
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={`py-2 px-2 ${row.mono ? "font-mono text-xs" : ""}`}
                >
                  {row.values[col.id] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <div className="mt-3 pt-3 border-t text-xs text-gray-600">{footer}</div>
      )}
    </div>
  );
}
