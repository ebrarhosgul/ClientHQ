import type { Metadata } from "next";

import { formatInvoiceNumber } from "@/invoices/status";
import { isClerkConfigured } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { INVOICES_LIST_EMPTY } from "@/portal/copy";
import { trackPortalView } from "@/portal/analytics";
import { portalContext } from "@/portal/context";
import {
  listPortalInvoices,
  type PortalInvoiceRow,
  type PortalListResult,
} from "@/portal/queries";
import { parsePageParam } from "@/portal/schema";
import { PortalEmptyState } from "@/portal/ui/portal-empty-state";
import { PortalPagination } from "@/portal/ui/portal-pagination";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { PageHeader } from "@/ui/patterns/page-header";
import { InvoiceStatusChip } from "@/ui/patterns/status-chip";

const COLUMNS: readonly Column<PortalInvoiceRow>[] = [
  {
    key: "number",
    header: "Invoice",
    priority: "high",
    identifying: true,
    cell: (row) => (
      <span className="font-mono">{formatInvoiceNumber(row.number)}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cell: (row) => <InvoiceStatusChip status={row.status} />,
  },
  {
    key: "issueDate",
    header: "Issued",
    priority: "low",
    align: "end",
    cell: (row) => row.issueDate ?? "—",
  },
  {
    key: "dueDate",
    header: "Due",
    priority: "high",
    align: "end",
    cell: (row) => row.dueDate ?? "—",
  },
  {
    key: "total",
    header: "Total",
    priority: "high",
    align: "end",
    cell: (row) => formatMoney(row.totalCents, row.currency),
  },
];

const NO_RESULTS: PortalListResult<PortalInvoiceRow> = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

export async function generateMetadata(): Promise<Metadata> {
  if (!isClerkConfigured()) {
    return { title: "Invoices · ClientHQ" };
  }

  const { clientName } = await portalContext();

  return { title: `Invoices · ${clientName} · ClientHQ` };
}

/**
 * Every invoice status the contact may see, unpaid before paid, 25 to a page
 * (spec 0014, AC-9).
 *
 * With no Clerk publishable key there is no session to resolve a contact
 * from, so this renders the same empty list a contact with no invoices yet
 * would see (spec 0004, AC-22).
 */
export default async function PortalInvoicesPage({
  searchParams,
}: PageProps<"/portal/invoices">) {
  const { page: rawPage } = await searchParams;

  const portal = isClerkConfigured() ? await portalContext() : undefined;

  if (portal !== undefined) {
    trackPortalView(portal.ctx, "/portal/invoices");
  }

  const { rows, page, pageCount, total } =
    portal !== undefined
      ? await listPortalInvoices(portal.ctx, {
          pageParam: parsePageParam(
            Array.isArray(rawPage) ? rawPage[0] : rawPage,
          ),
        })
      : NO_RESULTS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Every invoice your agency has issued to you, unpaid ones first."
      />

      {rows.length === 0 ? (
        <PortalEmptyState
          heading={INVOICES_LIST_EMPTY.heading}
          description={INVOICES_LIST_EMPTY.description}
        />
      ) : (
        <>
          <DataTable
            caption={`Invoices, ${total} total`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/portal/invoices/${row.id}`}
          />
          <PortalPagination
            basePath="/portal/invoices"
            page={page}
            pageCount={pageCount}
          />
        </>
      )}
    </div>
  );
}
