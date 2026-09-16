import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { agencyContext, currentAgency } from "@/auth/context";
import { listClientOptions } from "@/clients/queries";
import { NewInvoiceForm } from "@/invoices/ui/new-invoice-form";
import { isClerkConfigured } from "@/lib/env";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = {
  title: "New invoice",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The client picker that creates a draft in one step (spec 0012, AC-1).
 *
 * `?client=` pre selects a client when it names one of the agency's active
 * ones; the New invoice link from a client page's Invoices section always
 * carries it (AC-13). An archived or foreign id simply does not pre select.
 */
export default async function NewInvoicePage({
  searchParams,
}: PageProps<"/invoices/new">) {
  const params = await searchParams;
  const preselectedClientId = firstParam(params.client);

  const [clientOptions, agency] = isClerkConfigured()
    ? await Promise.all([
        listClientOptions(await agencyContext()),
        currentAgency(),
      ])
    : [[], undefined];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New invoice"
        description="Choose the client. The draft opens straight away for its lines, tax and notes."
      />
      {isClerkConfigured() ? (
        clientOptions.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            heading="Add a client first"
            description="An invoice always belongs to one of your agency's active clients."
            action={
              <Button asChild>
                <Link href="/clients/new">New client</Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <NewInvoiceForm
              clientOptions={clientOptions}
              preselectedClientId={
                clientOptions.some(
                  (option) => option.id === preselectedClientId,
                )
                  ? preselectedClientId
                  : undefined
              }
              defaultCurrency={agency?.defaultCurrency ?? "USD"}
            />
          </div>
        )
      ) : (
        <EmptyState
          icon={<Receipt />}
          heading="Sign in to create an invoice"
          description="An invoice belongs to a specific agency, so creating one needs a signed in session."
        />
      )}
    </div>
  );
}
