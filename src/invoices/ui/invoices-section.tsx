import { Plus, Receipt } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { InvoiceStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import type { ClientInvoiceRow } from "../queries";
import { displayNumber } from "../status";
import { PastDueBadge } from "./past-due-badge";

export type InvoicesSectionProps = {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly archivedAt: Date | null;
  };
  /** `undefined` when the read failed: the section shows a reload prompt. */
  readonly invoices: readonly ClientInvoiceRow[] | undefined;
};

/**
 * The client page's Invoices section (spec 0012, AC-13): every invoice but
 * the voided ones, in the list's order, with a count in the heading, a New
 * invoice link (omitted when the client is archived, since the create picker
 * never lists one) and an empty state. The page reads the rows once; the
 * section runs no query of its own, and a failed read stays contained here,
 * exactly as the Projects section does.
 */
export function InvoicesSection({ client, invoices }: InvoicesSectionProps) {
  const archived = client.archivedAt !== null;

  if (invoices === undefined) {
    return (
      <section
        aria-labelledby="invoices-heading"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id="invoices-heading"
          className="text-base font-semibold tracking-tight"
        >
          Invoices
        </h2>
        <ErrorState
          heading="Invoices could not be loaded"
          description="The rest of this client is fine. Reload to try the invoices again."
          action={
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}`}>Reload</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="invoices-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="invoices-heading"
          className="text-base font-semibold tracking-tight"
        >
          Invoices{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({invoices.length})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/invoices?client=${client.id}&void=true`}>
              View all
            </Link>
          </Button>
          {archived ? undefined : (
            <Button asChild size="sm">
              <Link href={`/invoices/new?client=${client.id}`}>
                <Plus />
                New invoice
              </Link>
            </Button>
          )}
        </div>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          heading="No invoices"
          description={
            archived
              ? "This client is archived, so no invoices can be drafted until they are restored."
              : `${client.name} has not been invoiced yet.`
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {invoices.map((invoice) => (
            <InvoiceRowItem key={invoice.id} invoice={invoice} />
          ))}
        </ul>
      )}

      {archived && invoices.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          This client is archived. Restore them to draft a new invoice.
        </p>
      ) : undefined}
    </section>
  );
}

function InvoiceRowItem({ invoice }: { readonly invoice: ClientInvoiceRow }) {
  return (
    <li>
      <Link
        href={`/invoices/${invoice.id}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 transition-surface hover:bg-accent"
      >
        <span className="flex items-center gap-3">
          <span
            className={
              invoice.number === null
                ? "font-medium"
                : "font-mono font-medium tabular-nums"
            }
          >
            {displayNumber(invoice.number)}
          </span>
          <InvoiceStatusChip status={invoice.status} />
          {invoice.pastDue ? <PastDueBadge /> : undefined}
        </span>
        <span className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
          <span>
            {invoice.dueDate ? `Due ${invoice.dueDate}` : "No due date"}
          </span>
          <span className="font-medium text-foreground">
            {formatMoney(invoice.totalCents, invoice.currency)}
          </span>
        </span>
      </Link>
    </li>
  );
}
