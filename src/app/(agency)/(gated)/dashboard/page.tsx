import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { agencyContext, currentAgency } from "@/auth/context";
import { hasAnyClient } from "@/dashboard/queries";
import { DashboardSectionSkeleton } from "@/dashboard/ui/dashboard-section";
import {
  OVERDUE_INVOICES_HEADING_ID,
  OverdueInvoicesSection,
} from "@/dashboard/ui/overdue-invoices-section";
import {
  OPEN_PROJECTS_HEADING_ID,
  OpenProjectsSection,
} from "@/dashboard/ui/open-projects-section";
import {
  RECENT_DELIVERABLES_HEADING_ID,
  RecentDeliverablesSection,
} from "@/dashboard/ui/recent-deliverables-section";
import type { MembershipRole } from "@/db/schema";
import { isClerkConfigured } from "@/lib/env";
import { todayUtc } from "@/lib/dates";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = {
  title: "Dashboard",
};

const ROLE_LABEL: Readonly<Record<MembershipRole, string>> = {
  admin: "Admin",
  member: "Member",
};

/** The agency name and the acting role, or nothing when there is no session. */
async function welcome() {
  // With no Clerk publishable key the proxy is a pass through, so this page can
  // render with nobody signed in. Spec 0004 (AC-22) requires that to work.
  if (!isClerkConfigured()) {
    return undefined;
  }

  const [ctx, agency] = [await agencyContext(), await currentAgency()];

  return agency === undefined ? undefined : { ctx, agency };
}

function FirstRunEmptyState() {
  return (
    <EmptyState
      heading="Add your first client"
      description="Once you have a client, open projects, overdue invoices and recently added deliverables will summarise here."
      action={
        <Button asChild size="sm">
          <Link href="/clients/new">Add a client</Link>
        </Button>
      }
    />
  );
}

/**
 * Where signed in agency staff land (spec 0020).
 *
 * The header resolves before any section starts: which agency, and whether it
 * has a client at all, decide the page's shape (AC-9). The three sections
 * that follow are independent, each in its own `<Suspense>` boundary, so one
 * slow or failing read never blocks or blanks the other two (AC-10, AC-11).
 */
export default async function DashboardPage() {
  const session = await welcome();

  if (session === undefined) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Dashboard"
          description="Where your agency's week is summarised, once there is a week to summarise."
        />
        <FirstRunEmptyState />
      </div>
    );
  }

  const { ctx, agency } = session;
  const today = todayUtc();
  const now = new Date();
  const anyClient = await hasAnyClient(ctx);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={`${agency.name} · ${ROLE_LABEL[ctx.role]}`}
      />

      {anyClient ? (
        <div className="flex flex-col gap-6">
          <Suspense
            fallback={
              <DashboardSectionSkeleton
                headingId={OVERDUE_INVOICES_HEADING_ID}
                heading="Overdue invoices"
                label="Loading overdue invoices"
              />
            }
          >
            <OverdueInvoicesSection ctx={ctx} todayUtc={today} />
          </Suspense>

          <Suspense
            fallback={
              <DashboardSectionSkeleton
                headingId={OPEN_PROJECTS_HEADING_ID}
                heading="Open projects"
                label="Loading open projects"
              />
            }
          >
            <OpenProjectsSection ctx={ctx} todayUtc={today} />
          </Suspense>

          <Suspense
            fallback={
              <DashboardSectionSkeleton
                headingId={RECENT_DELIVERABLES_HEADING_ID}
                heading="Recent deliverables"
                label="Loading recent deliverables"
              />
            }
          >
            <RecentDeliverablesSection ctx={ctx} now={now} />
          </Suspense>
        </div>
      ) : (
        <FirstRunEmptyState />
      )}
    </div>
  );
}
