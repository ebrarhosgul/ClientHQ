import { Building2, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { agencyContext } from "@/auth/context";
import { listClients, type ClientRow } from "@/clients/queries";
import { ClientsFilterBar } from "@/clients/ui/clients-filter-bar";
import { ClientsPagination } from "@/clients/ui/clients-pagination";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = {
  title: "Clients",
};

const COLUMNS: readonly Column<ClientRow>[] = [
  {
    key: "name",
    header: "Name",
    priority: "high",
    identifying: true,
    cell: (row) => row.name,
  },
  {
    key: "email",
    header: "Company email",
    priority: "high",
    cell: (row) => row.companyEmail ?? "—",
  },
  {
    key: "phone",
    header: "Phone",
    priority: "low",
    cell: (row) => row.phone ?? "—",
  },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every agency's client list: active by default, in pages of 25, ordered by
 * name (spec 0006, AC-4, AC-5).
 *
 * `page`, `q` and `archived` all live in the URL, so this Server Component is
 * the single source of truth for what shows; nothing here is client state.
 */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const ctx = await agencyContext();
  const params = await searchParams;

  const archived = firstParam(params.archived) === "true";
  const search = firstParam(params.q);

  const { rows, page, pageCount, total } = await listClients(ctx, {
    pageParam: firstParam(params.page),
    search,
    archived,
  });

  const hasFilter = Boolean(search) || archived;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="Every company your agency works for."
        actions={
          <Button asChild>
            <Link href="/clients/new">
              <Plus />
              New client
            </Link>
          </Button>
        }
      />

      <ClientsFilterBar archived={archived} search={search} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          heading={
            search
              ? "No clients match your search"
              : archived
                ? "No archived clients"
                : "No clients yet"
          }
          description={
            search
              ? "Try a different name, or clear the search to see the full list."
              : archived
                ? "Clients you archive show up here, and you can restore any of them."
                : "Add the first company you work for and its projects, deliverables and invoices hang off it."
          }
          action={
            hasFilter ? undefined : (
              <Button asChild>
                <Link href="/clients/new">
                  <Plus />
                  New client
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption={`${archived ? "Archived" : "Active"} clients, ${total} total`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/clients/${row.id}`}
          />
          <ClientsPagination
            page={page}
            pageCount={pageCount}
            archived={archived}
            search={search}
          />
        </>
      )}
    </div>
  );
}
