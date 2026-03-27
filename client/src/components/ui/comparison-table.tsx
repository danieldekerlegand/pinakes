import React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "./table";

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
