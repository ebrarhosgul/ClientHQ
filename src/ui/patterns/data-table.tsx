import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

/**
 * The shared list table. Spec 0004, AC-10 and invariant 12.
 *
 * Two things here are load bearing and neither is obvious:
 *
 * **Column priority is two tiers, not a ranking.** A column is `"high"` or
 * `"low"`, and below `md` the low ones are gone: `hidden` removes them from the
 * layout *and* from the accessibility tree, so a screen reader on a phone is
 * not read six columns that nobody can see. A ranked list would invite a third
 * tier and then a fourth, and no breakpoint to put them at.
 *
 * **A whole row is never a link.** A `<tr>` cannot wrap an `<a>`, and a row
 * link containing action buttons is a nested interactive control, which is both
 * invalid and unusable from a keyboard. Instead the identifying cell holds the
 * one real link, stretched with an `::after` to cover the row, and the actions
 * cell is given its own stacking context above it. The result: one tab stop for
 * the row, then one for each action, each separately labelled, and the whole
 * row still clickable with a pointer.
 */
export type ColumnPriority = "high" | "low";

export type Column<TRow> = {
  /** Stable key, used for React and for the header cell. */
  readonly key: string;
  readonly header: ReactNode;
  /**
   * `high` survives every breakpoint. `low` is removed below `md`, from the
   * layout and from the accessibility tree together.
   */
  readonly priority: ColumnPriority;
  /** Right align money and counts; they are read by their last digit. */
  readonly align?: "start" | "end";
  /** `true` on the one column carrying the row's link. Exactly one, or none. */
  readonly identifying?: boolean;
  readonly cell: (row: TRow) => ReactNode;
  readonly headerClassName?: string;
  readonly cellClassName?: string;
};

export type DataTableProps<TRow> = {
  /** Names the table for a screen reader. Required: an unnamed table is a maze. */
  readonly caption: string;
  readonly columns: readonly Column<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow) => string;
  /** Where the identifying cell's link goes. Omit for a table with no detail page. */
  readonly rowHref?: (row: TRow) => string;
  /** The row's inline actions. Each must carry its own accessible name. */
  readonly rowActions?: (row: TRow) => ReactNode;
  readonly rowActionsLabel?: string;
  readonly className?: string;
};

const PRIORITY_CLASS: Readonly<Record<ColumnPriority, string>> = {
  high: "",
  // `hidden` is `display: none`, which takes the cell out of the accessibility
  // tree as well as the layout. `sr-only` or an opacity would not.
  low: "hidden md:table-cell",
};

export function DataTable<TRow>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowActions,
  rowActionsLabel = "Actions",
  className,
}: DataTableProps<TRow>) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-x-auto rounded-lg border border-border",
        className,
      )}
    >
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                className={cn(
                  PRIORITY_CLASS[column.priority],
                  column.align === "end" && "text-right",
                  column.headerClassName,
                )}
              >
                {column.header}
              </TableHead>
            ))}
            {rowActions ? (
              <TableHead scope="col" className="w-px text-right">
                <span className="sr-only">{rowActionsLabel}</span>
              </TableHead>
            ) : undefined}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)} className="relative">
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    PRIORITY_CLASS[column.priority],
                    column.align === "end" && "text-right tabular-nums",
                    column.cellClassName,
                  )}
                >
                  {column.identifying && rowHref ? (
                    <Link
                      href={rowHref(row)}
                      // The stretched link: one tab stop for the row, and the
                      // whole row clickable, without wrapping the `<tr>`.
                      className="font-medium after:absolute after:inset-0 after:content-['']"
                    >
                      {column.cell(row)}
                    </Link>
                  ) : (
                    column.cell(row)
                  )}
                </TableCell>
              ))}

              {rowActions ? (
                // `relative` plus a z index lifts the actions above the
                // stretched link, so each button is still clickable and still
                // its own tab stop.
                <TableCell className="relative z-10 w-px text-right">
                  <div className="flex items-center justify-end gap-1">
                    {rowActions(row)}
                  </div>
                </TableCell>
              ) : undefined}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
