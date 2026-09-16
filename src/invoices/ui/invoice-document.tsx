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

import {
  billingAddressLines,
  displayQuantity,
  presentInvoice,
} from "../presentation";
import type { InvoiceDetail } from "../queries";
import { displayNumber, isClientVisible } from "../status";
import { InvoiceTotals } from "./invoice-totals";

function Detail({
  label,
  value,
  mono,
  block,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly mono?: boolean;
  /** The value contains a block level element (e.g. `<address>`), so it cannot sit inside a `<p>`. */
  readonly block?: boolean;
}) {
  const Value = block ? "div" : "p";

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Value className={mono ? "font-mono text-sm tabular-nums" : "text-sm"}>
        {value ?? "—"}
      </Value>
    </div>
  );
}

/**
 * The frozen document after issue (spec 0012, AC-11; spec 0013, AC-4): number,
 * dates, client and its billing address, lines, totals and notes, exactly as
 * the client will see them and as the PDF reproduces them. Read only by
 * construction: nothing here is a control.
 *
 * `sent`, `overdue` and `paid` read every string from `presentInvoice`, the
 * same call the PDF renders from, plus a Download PDF link. `void` has no
 * PDF (`isClientVisible` is the one "has a PDF" rule, spec 0013), so it keeps
 * its own plain rendering of the same frozen rows.
 */
export function InvoiceDocument({
  invoice,
  agencyName,
  todayUtc,
}: {
  readonly invoice: InvoiceDetail;
  readonly agencyName: string;
  readonly todayUtc: string;
}) {
  const presentation =
    isClientVisible(invoice.status) && invoice.number !== null
      ? presentInvoice({
          invoice: {
            ...invoice,
            status: invoice.status,
            number: invoice.number,
          },
          client: invoice.client,
          lines: invoice.lines,
          agencyName,
          todayUtc,
          generatedAt: new Date(),
        })
      : undefined;

  const addressLines = billingAddressLines(invoice.client);

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          {addressLines.length > 0 ? (
            <Detail
              label="Bill to"
              block
              value={
                <address className="not-italic">
                  {addressLines.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              }
            />
          ) : undefined}
          <Detail
            label="Issued"
            value={presentation?.issued ?? invoice.issueDate}
            mono
          />
          <Detail
            label="Due"
            value={presentation?.due ?? invoice.dueDate}
            mono
          />
          {presentation ? (
            <Detail
              label="Status"
              value={[
                presentation.status.label,
                presentation.status.pastDue ? "Past due" : undefined,
                presentation.status.paidOn,
              ]
                .filter((part): part is string => part !== undefined)
                .join(" · ")}
            />
          ) : undefined}
        </div>

        {presentation ? (
          <Link
            href={`/invoices/${invoice.id}/pdf`}
            className="shrink-0 text-sm font-medium underline underline-offset-2"
          >
            Download PDF
            <span className="sr-only"> {presentation.number}</span>
          </Link>
        ) : undefined}
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
