import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getInvoiceDocument } from "@/invoices/queries";
import { displayNumber, isPastDue } from "@/invoices/status";
import { InvoiceDocument } from "@/invoices/ui/invoice-document";
import { PastDueBadge } from "@/invoices/ui/past-due-badge";
import { todayUtc } from "@/lib/dates";
import { portalContext } from "@/portal/context";
import { portalId } from "@/portal/schema";
import { InvoiceStatusChip } from "@/ui/patterns/status-chip";

export async function generateMetadata({
  params,
}: PageProps<"/portal/invoices/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { ctx, clientName } = await portalContext();
  const parsed = portalId.safeParse(id);
  const invoice = parsed.success
    ? await getInvoiceDocument(ctx, parsed.data)
    : undefined;

  return {
    title:
      invoice === undefined
        ? `Invoice · ${clientName} · ClientHQ`
        : `${displayNumber(invoice.number)} · ${clientName} · ClientHQ`,
  };
}

/**
 * One invoice, frozen (spec 0014, AC-10): the same `InvoiceDocument` the
 * agency's own page renders, so the two screens and the PDF cannot disagree
 * on a string. A draft, a void, another client's invoice, a missing id and a
 * malformed one all render not found: `getInvoiceDocument` already refuses
 * every one of them, through the contact accessor and `isClientVisible`
 * together.
 */
export default async function PortalInvoicePage({
  params,
}: PageProps<"/portal/invoices/[id]">) {
  const { id } = await params;
  const parsed = portalId.safeParse(id);

  if (!parsed.success) {
    notFound();
  }

  const { ctx, agencyName } = await portalContext();
  const invoice = await getInvoiceDocument(ctx, parsed.data);

  if (invoice === undefined) {
    notFound();
  }

  const today = todayUtc();
  const pastDue = isPastDue(invoice.status, invoice.dueDate, today);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <InvoiceStatusChip status={invoice.status} />
        {pastDue ? <PastDueBadge /> : undefined}
        {invoice.status === "paid" && invoice.paidAt ? (
          <span className="text-sm text-muted-foreground">
            Paid on {invoice.paidAt.toISOString().slice(0, 10)}
          </span>
        ) : undefined}
      </div>

      <InvoiceDocument
        invoice={invoice}
        agencyName={agencyName}
        todayUtc={today}
        pdfHref={`/portal/invoices/${parsed.data}/pdf`}
      />
    </div>
  );
}
