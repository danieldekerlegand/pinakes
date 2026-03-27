import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ComparisonColumn<T> {
  /** Unique key for the column */
  key: string;
  /** Display label for the column header */
  label: string;
  /** The data item this column represents */
  data: T;
}

export interface ComparisonRow<T> {
  /** Unique key for the row */
  key: string;
  /** Display label for the row */
  label: string;
  /** Extract the cell value from a data item */
  getValue: (item: T) => React.ReactNode;
  /** Optional custom renderer for a cell */
  renderCell?: (value: React.ReactNode, item: T, columnIndex: number) => React.ReactNode;
}

export interface ComparisonTableProps<T> {
  /** Columns representing items to compare side-by-side */
  columns: ComparisonColumn<T>[];
  /** Rows representing attributes to compare */
  rows: ComparisonRow<T>[];
  /** Whether to highlight cells that differ across columns */
  highlightDifferences?: boolean;
  /** Label for the attribute column header */
  attributeLabel?: string;
  /** Additional class name for the root element */
  className?: string;
  /** Optional caption for accessibility */
  caption?: string;
  /** Whether to use striped rows */
  striped?: boolean;
}

function cellValuesMatch(values: React.ReactNode[]): boolean {
  if (values.length <= 1) return true;
  const stringified = values.map((v) =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
  );
  return stringified.every((s) => s === stringified[0]);
}

function ComparisonTableInner<T>(
  {
    columns,
    rows,
    highlightDifferences = false,
    attributeLabel = "Attribute",
    className,
    caption,
    striped = false,
  }: ComparisonTableProps<T>,
  ref: React.ForwardedRef<HTMLTableElement>
) {
  if (columns.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground p-4 text-center", className)}>
        No items to compare. Add at least two items for side-by-side analysis.
      </div>
    );
  }

  return (
    <div className={cn("relative w-full overflow-auto", className)}>
      <table
        ref={ref}
        className="w-full caption-bottom text-sm"
        role="table"
        aria-label={caption || "Comparison table"}
      >
        {caption && (
          <caption className="mt-4 text-sm text-muted-foreground">{caption}</caption>
        )}
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors">
            <th
              className="h-12 px-4 text-left align-middle font-medium text-muted-foreground sticky left-0 bg-background z-10"
              scope="col"
            >
              {attributeLabel}
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="h-12 px-4 text-left align-middle font-medium text-muted-foreground"
                scope="col"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {rows.map((row, rowIndex) => {
            const cellValues = columns.map((col) => row.getValue(col.data));
            const allMatch = cellValuesMatch(cellValues);
            const showDiff = highlightDifferences && !allMatch;

            return (
              <tr
                key={row.key}
                className={cn(
                  "border-b transition-colors hover:bg-muted/50",
                  striped && rowIndex % 2 === 1 && "bg-muted/25"
                )}
              >
                <td className="p-4 align-middle font-medium sticky left-0 bg-background z-10">
                  {row.label}
                </td>
                {columns.map((col, colIndex) => {
                  const value = cellValues[colIndex];
                  const rendered = row.renderCell
                    ? row.renderCell(value, col.data, colIndex)
                    : value;

                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "p-4 align-middle",
                        showDiff && "bg-yellow-50 dark:bg-yellow-950/20"
                      )}
                    >
                      {rendered ?? <span className="text-muted-foreground italic">—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const ComparisonTable = React.forwardRef(ComparisonTableInner) as <T>(
  props: ComparisonTableProps<T> & { ref?: React.ForwardedRef<HTMLTableElement> }
) => React.ReactElement;
