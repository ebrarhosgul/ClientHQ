import type { Metadata } from "next";

import { agencyContext, currentAgency } from "@/auth/context";
import { AgencyWelcome } from "@/auth/ui/agency-welcome";
import { isClerkConfigured } from "@/lib/env";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";

export const metadata: Metadata = {
  title: "Dashboard",
};

/** The agency name and the acting role, or nothing when there is no session. */
async function welcome() {
  // With no Clerk publishable key the proxy is a pass through, so this page can
  // render with nobody signed in. Spec 0004 (AC-22) requires that to work.
  if (!isClerkConfigured()) {
    return undefined;
  }

  const [ctx, agency] = [await agencyContext(), await currentAgency()];

  return agency === undefined
    ? undefined
    : { name: agency.name, role: ctx.role, currency: agency.defaultCurrency };
}

/**
 * Where signed in agency staff land.
 *
 * The welcome panel is the end of the walking skeleton: a Clerk session
 * resolved a tenant context through spec 0003's layer, and this page read that
 * agency's own row back out of PostgreSQL. Everything under it still waits on
 * the features that fill it.
 */
export default async function DashboardPage() {
  const agency = await welcome();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Where your agency's week is summarised, once there is a week to summarise."
      />

      {agency ? (
        <AgencyWelcome
          name={agency.name}
          role={agency.role}
          currency={agency.currency}
        />
      ) : undefined}

      <EmptyState
        heading="Nothing to show yet"
        description="Open projects, overdue invoices and recent deliverables land here as those parts of the product are built. Start by adding a client."
      />
    </div>
  );
}
