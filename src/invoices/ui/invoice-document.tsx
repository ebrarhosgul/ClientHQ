import Link from "next/link";

import { formatMoney } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import type { InvoiceDetail } from "../queries";
import { displayNumber } from "../status";
import { InvoiceTotals } from "./invoice-totals";

/** `2.500` as stored reads as `2.5`; `1.000` as `1`. */
function displayQuantity(quantity: string): string {
  return quantity.includes(".")
    ? quantity.replace(/0+$/, "").replace(/\.$/, "")
    : quantity;
}

function Detail({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm tabular-nums" : "text-sm"}>
        {value ?? "—"}
      </p>
    </div>
  );
}

/**
 * The frozen document after issue (spec 0012, AC-11): number, dates, client,
 * lines, totals and notes, exactly as the client will see them and as the
 * PDF (feature 14) must reproduce them. Read only by construction: nothing
 * here is a control.
 */
export function InvoiceDocument({
  invoice,
}: {
  readonly invoice: InvoiceDetail;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Invoice" value={displayNumber(invoice.number)} mono />
        <Detail
          label="Client"
          value={
            <Link
              href={`/clients/${invoice.client.id}`}
              className="font-medium underline underline-offset-2"
            >
              {invoice.client.name}
            </Link>
          }
        />
        <Detail label="Issued" value={invoice.issueDate} mono />
        <Detail label="Due" value={invoice.dueDate} mono />
      </div>

      <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border">
        <Table>
          <caption className="sr-only">
            Line items of invoice {displayNumber(invoice.number)}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Description</TableHead>
              <TableHead scope="col" className="text-right">
                Qty
              </TableHead>
              <TableHead scope="col" className="text-right">
                Unit
              </TableHead>
              <TableHead scope="col" className="text-right">
                Amount
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lines.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  No lines were added before this draft was voided.
                </TableCell>
              </TableRow>
            ) : undefined}
            {invoice.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="max-w-md whitespace-normal">
                  {line.description}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {displayQuantity(line.quantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.unitAmountCents, invoice.currency)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(line.amountCents, invoice.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <InvoiceTotals
        subtotalCents={invoice.subtotalCents}
        taxRateBp={invoice.taxRateBp}
        taxCents={invoice.taxCents}
        totalCents={invoice.totalCents}
        currency={invoice.currency}
      />

      {invoice.notes ? (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      ) : undefined}
    </div>
  );
}
