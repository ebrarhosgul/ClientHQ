import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { agencyContext } from "@/auth/context";
import { listClientOptions, type ClientOption } from "@/clients/queries";
import { agencyProfile } from "@/db/tenant";
import {
  contactsToNotify,
  getInvoice,
  latestNotification,
  type InvoiceDetail,
} from "@/invoices/queries";
import { displayNumber, isPastDue, nextActions } from "@/invoices/status";
import { InvoiceActions } from "@/invoices/ui/invoice-actions";
import { InvoiceDocument } from "@/invoices/ui/invoice-document";
import { InvoiceEventsList } from "@/invoices/ui/invoice-events-list";
import { InvoiceHeaderForm } from "@/invoices/ui/invoice-header-form";
import { InvoiceTotals } from "@/invoices/ui/invoice-totals";
import { LineItemsEditor } from "@/invoices/ui/line-items-editor";
import { NotificationWarning } from "@/invoices/ui/notification-warning";
import { PastDueBadge } from "@/invoices/ui/past-due-badge";
import { todayUtc } from "@/lib/dates";
import { isClerkConfigured } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/ui/patterns/page-header";
import { InvoiceStatusChip } from "@/ui/patterns/status-chip";

/**
 * With no Clerk publishable key there is no session to resolve a tenant from,
 * so no id can ever be this agency's (spec 0004, AC-22): `undefined`, the same
 * as a foreign agency's id or one that never existed.
 */
async function findInvoice(id: string): Promise<InvoiceDetail | undefined> {
  return isClerkConfigured()
    ? getInvoice(await agencyContext(), id)
    : undefined;
}

export async function generateMetadata({
  params,
}: PageProps<"/invoices/[id]">): Promise<Metadata> {
  const { id } = await params;
  const invoice = await findInvoice(id);

  return {
    title:
      invoice === undefined
        ? "Invoice"
        : `${displayNumber(invoice.number)} · ${invoice.client.name}`,
  };
}

function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : undefined}
      </div>
      {children}
    </section>
  );
}

/**
 * The editor while draft and the frozen document afterwards (spec 0012,
 * AC-11), followed by the actions the status allows and the history.
 *
 * A foreign agency's id resolves exactly like a missing one: `getInvoice`
 * scopes through `tenantDb`, so there is no row to tell the two apart
 * (AC-14).
 */
export default async function InvoiceDetailPage({
  params,
}: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const invoice = await findInvoice(id);

  if (invoice === undefined) {
    notFound();
  }

  const ctx = await agencyContext();
  const today = todayUtc();
  const draft = invoice.status === "draft";
  const pastDue = isPastDue(invoice.status, invoice.dueDate, today);
  const [contacts, agency] = await Promise.all([
    contactsToNotify(ctx, invoice.client.id),
    agencyProfile(ctx),
  ]);
  const latest = latestNotification(invoice.events);

  // The header form lists the agency's active clients, plus the draft's own
  // client if it has since been archived, so the select never loses its
  // current value; the save then refuses it with a message (AC-2).
  const clientOptions: ClientOption[] = draft
    ? [...(await listClientOptions(ctx))]
    : [];

  if (
    draft &&
    !clientOptions.some((option) => option.id === invoice.client.id)
  ) {
    clientOptions.push({
      id: invoice.client.id,
      name: `${invoice.client.name} (archived)`,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          draft
            ? `Draft invoice for ${invoice.client.name}`
            : invoice.number === null
              ? "Voided draft"
              : displayNumber(invoice.number)
        }
        description={
          draft
            ? "Build the lines and set the details, then issue it to give it a number."
            : `${invoice.client.name} · ${formatMoney(invoice.totalCents, invoice.currency)} due ${invoice.dueDate ?? "—"}`
        }
        actions={
          <InvoiceActions
            invoiceId={invoice.id}
            status={invoice.status}
            issueDate={invoice.issueDate}
            lineCount={invoice.lines.length}
            contactCount={contacts.length}
            today={today}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <InvoiceStatusChip status={invoice.status} />
        {pastDue ? <PastDueBadge /> : undefined}
        {invoice.status === "paid" && invoice.paidAt ? (
          <span className="text-sm text-muted-foreground">
            Paid on {invoice.paidAt.toISOString().slice(0, 10)}
          </span>
        ) : undefined}
        <Link
          href="/invoices"
          className="ml-auto text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          All invoices
        </Link>
      </div>

      {latest?.kind === "notification_failed" ? (
        <NotificationWarning
          invoiceId={invoice.id}
          reason={latest.note ?? "the provider gave no reason"}
          canResend={nextActions(invoice.status).includes("resend")}
        />
      ) : undefined}

      {draft ? (
        <>
          <Section
            title="Details"
            description="Who it is for, when it is due, and the tax to apply. The currency is fixed at creation."
          >
            <InvoiceHeaderForm
              invoiceId={invoice.id}
              clientId={invoice.client.id}
              dueDate={invoice.dueDate}
              taxRateBp={invoice.taxRateBp}
              notes={invoice.notes}
              currency={invoice.currency}
              clientOptions={clientOptions}
            />
          </Section>

          <Section
            title="Lines"
            description="Each line is saved as you go and the totals follow."
          >
            <LineItemsEditor
              invoiceId={invoice.id}
              currency={invoice.currency}
              lines={invoice.lines}
            />
            <InvoiceTotals
              subtotalCents={invoice.subtotalCents}
              taxRateBp={invoice.taxRateBp}
              taxCents={invoice.taxCents}
              totalCents={invoice.totalCents}
              currency={invoice.currency}
            />
          </Section>
        </>
      ) : (
        <InvoiceDocument
          invoice={invoice}
          agencyName={agency?.name ?? ""}
          todayUtc={today}
        />
      )}

      <Section
        title="History"
        description="Every issue, payment, void and notification, newest first."
      >
        <InvoiceEventsList events={invoice.events} />
      </Section>
    </div>
  );
}
