import { Plus, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { agencyContext } from "@/auth/context";
import { getClient, listClientOptions } from "@/clients/queries";
import {
  isInvoiceStatus,
  listInvoices,
  type InvoiceListResult,
  type InvoiceListRow,
} from "@/invoices/queries";
import { displayNumber } from "@/invoices/status";
import type { InvoicesClientOption } from "@/invoices/ui/invoices-filter-bar";
import { InvoicesFilterBar } from "@/invoices/ui/invoices-filter-bar";
import { InvoicesPagination } from "@/invoices/ui/invoices-pagination";
import { PastDueBadge } from "@/invoices/ui/past-due-badge";
import { todayUtc } from "@/lib/dates";
import { isClerkConfigured } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { InvoiceStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = {
  title: "Invoices",
};

const COLUMNS: readonly Column<InvoiceListRow>[] = [
  {
    key: "number",
    header: "Invoice",
    priority: "high",
    identifying: true,
    cell: (row) => (
      <span className={row.number === null ? undefined : "font-mono"}>
        {displayNumber(row.number)}
      </span>
    ),
  },
  {
    key: "client",
    header: "Client",
    priority: "high",
    cell: (row) => row.clientName,
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cell: (row) => (
      <span className="inline-flex items-center gap-2">
        <InvoiceStatusChip status={row.status} />
        {row.pastDue ? <PastDueBadge /> : undefined}
      </span>
    ),
  },
  {
    key: "total",
    header: "Total",
    priority: "high",
    align: "end",
    cell: (row) => formatMoney(row.totalCents, row.currency),
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
    priority: "low",
    align: "end",
    cell: (row) => row.dueDate ?? "—",
  },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const NO_RESULTS: InvoiceListResult = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

/**
 * Every agency's invoices: every status but void by default, drafts first,
 * then newest issued, in pages of 25 (spec 0012, AC-10).
 *
 * `status`, `client`, `void` and `page` all live in the URL, so this Server
 * Component is the single source of truth for what shows.
 */
export default async function InvoicesPage({
  searchParams,
}: PageProps<"/invoices">) {
  const params = await searchParams;

  const includeVoid = firstParam(params.void) === "true";
  const rawStatus = firstParam(params.status);
  const statusParam =
    rawStatus !== undefined && isInvoiceStatus(rawStatus)
      ? rawStatus
      : undefined;
  const clientParam = firstParam(params.client);

  const { rows, page, pageCount, total }: InvoiceListResult =
    isClerkConfigured()
      ? await listInvoices(await agencyContext(), {
          pageParam: firstParam(params.page),
          statusParam,
          clientParam,
          includeVoid,
          todayUtc: todayUtc(),
        })
      : NO_RESULTS;

  const clientOptions: InvoicesClientOption[] = isClerkConfigured()
    ? [...(await listClientOptions(await agencyContext()))]
    : [];

  // A filter naming an archived client of this agency still works: it is
  // appended as one extra, clearly labelled option. A filter that does not
  // resolve at all stays in the URL (the list is empty and says so) but
  // clears itself out of the select, which has nothing to show for it.
  let resolvedClientId: string | undefined;

  if (isClerkConfigured() && clientParam) {
    const filtered = await getClient(await agencyContext(), clientParam);

    if (filtered !== undefined) {
      resolvedClientId = filtered.id;

      if (filtered.archivedAt !== null) {
        clientOptions.push({
          id: filtered.id,
          name: filtered.name,
          archived: true,
        });
      }
    }
  }

  const hasFilter =
    Boolean(clientParam) || includeVoid || statusParam !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Every invoice across all your clients. Drafts first, then the most recently issued."
        actions={
          <Button asChild>
            <Link href="/invoices/new">
              <Plus />
              New invoice
            </Link>
          </Button>
        }
      />

      <InvoicesFilterBar
        status={statusParam}
        clientId={resolvedClientId}
        includeVoid={includeVoid}
        clientOptions={clientOptions}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          heading={
            hasFilter ? "No invoices match these filters" : "No invoices yet"
          }
          description={
            hasFilter
              ? "Try a different filter, or clear them to see the full list."
              : "Draft the first invoice for one of your clients. It gets its number the moment you issue it."
          }
          action={
            hasFilter ? (
              <Button asChild variant="outline">
                <Link href="/invoices">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/invoices/new">
                  <Plus />
                  New invoice
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption={`Invoices, ${total} total`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/invoices/${row.id}`}
          />
          <InvoicesPagination
            page={page}
            pageCount={pageCount}
            status={statusParam}
            clientId={resolvedClientId}
            includeVoid={includeVoid}
          />
        </>
      )}
    </div>
  );
}
