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

// ─── Side-by-side comparison table (attributes as rows, items as columns) ───

export interface SideBySideComparisonColumn<T> {
  key: string;
  label: string;
  data: T;
}

export interface ComparisonRow<T> {
  key: string;
  label: string;
  getValue: (item: T) => React.ReactNode;
  renderCell?: (value: React.ReactNode, item: T, columnIndex: number) => React.ReactNode;
}

export interface SideBySideComparisonTableProps<T> {
  columns: SideBySideComparisonColumn<T>[];
  rows: ComparisonRow<T>[];
  highlightDifferences?: boolean;
  attributeLabel?: string;
  className?: string;
  caption?: string;
  striped?: boolean;
}

function cellValuesMatch(values: React.ReactNode[]): boolean {
  if (values.length <= 1) return true;
  const stringified = values.map((v) =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
  );
  return stringified.every((s) => s === stringified[0]);
}

function SideBySideComparisonTableInner<T>(
  {
    columns,
    rows,
    highlightDifferences = false,
    attributeLabel = "Attribute",
    className,
    caption,
    striped = false,
  }: SideBySideComparisonTableProps<T>,
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

export const SideBySideComparisonTable = React.forwardRef(SideBySideComparisonTableInner) as <T>(
  props: SideBySideComparisonTableProps<T> & { ref?: React.ForwardedRef<HTMLTableElement> }
) => React.ReactElement;

// ─── Simple data comparison table (items as rows, attributes as columns) ───

export interface ComparisonColumn<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  className?: string;
}

export interface ComparisonTableProps<T> {
  items: T[];
  columns: ComparisonColumn<T>[];
  getRowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectedKey?: string | null;
  emptyMessage?: string;
}

export function ComparisonTable<T>({
  items,
  columns,
  getRowKey,
  onRowClick,
  selectedKey,
  emptyMessage = "No data available",
}: ComparisonTableProps<T>) {
  if (items.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8 text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.className}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const key = getRowKey(item);
          return (
            <TableRow
              key={key}
              className={`${onRowClick ? "cursor-pointer" : ""} ${
                selectedKey === key ? "bg-blue-50" : ""
              }`}
              onClick={() => onRowClick?.(item)}
              data-state={selectedKey === key ? "selected" : undefined}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={col.className}>
                  {col.render(item)}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
