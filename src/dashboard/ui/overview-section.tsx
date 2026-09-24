import Link from "next/link";

import type { StaffContext } from "@/db/tenant";
import { formatMoney } from "@/lib/money";
import { reportException } from "@/observability/sentry";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

import {
  activeClientsCount,
  type OpenProjectsSummary,
  type OverdueInvoicesSummary,
  type RecentDeliverablesSummary,
} from "../queries";
import { settle } from "../settle";
import { SummaryCard, SummaryCardsGrid } from "./summary-cards";

export const OVERVIEW_HEADING_ID = "dashboard-overview-heading";

export type OverviewSectionProps = {
  readonly ctx: StaffContext;
  /**
   * The same promises the matching detail sections below await: started once
   * in `page.tsx` and handed to both, so the two never disagree within one
   * page load and the query never runs twice (spec 0020 addendum, Feature
   * design).
   */
  readonly overdueInvoices: Promise<OverdueInvoicesSummary>;
  readonly openProjects: Promise<OpenProjectsSummary>;
  readonly recentDeliverables: Promise<RecentDeliverablesSummary>;
};

/**
 * The Overview row of four stat cards (spec 0020 addendum, AC-16 to AC-20,
 * AC-24). Its four reads share one boundary and one `ErrorState`: only
 * `activeClientsCount`'s own failure is reported here, since a failure in one
 * of the three shared reads is already reported by its owning detail section.
 */
export async function OverviewSection({
  ctx,
  overdueInvoices,
  openProjects,
  recentDeliverables,
}: OverviewSectionProps) {
  const [overdue, projects, deliverables, activeClients] = await Promise.all([
    settle(overdueInvoices),
    settle(openProjects),
    settle(recentDeliverables),
    settle(activeClientsCount(ctx)),
  ]);

  if (!overdue.ok || !projects.ok || !deliverables.ok || !activeClients.ok) {
    if (!activeClients.ok) {
      reportException(activeClients.error, {
        tags: { section: "overview" },
        fingerprint: ["dashboard_section_failed", "overview"],
      });
    }

    return (
      <section
        aria-labelledby={OVERVIEW_HEADING_ID}
        className="flex flex-col gap-4"
      >
        <h2
          id={OVERVIEW_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Overview
        </h2>
        <ErrorState
          heading="Overview could not be loaded"
          description="The rest of the dashboard is fine. Try again to load this section."
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard">Try again</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby={OVERVIEW_HEADING_ID}
      className="flex flex-col gap-4"
    >
      <h2
        id={OVERVIEW_HEADING_ID}
        className="text-base font-semibold tracking-tight"
      >
        Overview
      </h2>

      <SummaryCardsGrid>
        <SummaryCard
          label="Overdue"
          value={`${overdue.value.count} overdue`}
          href="/invoices?status=overdue"
          detail={
            overdue.value.totals.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {overdue.value.totals.map((total) => (
                  <span key={total.currency}>
                    {formatMoney(total.cents, total.currency)}
                  </span>
                ))}
              </div>
            ) : undefined
          }
        />
        <SummaryCard
          label="Open projects"
          value={`${projects.value.count} open`}
          href="/projects"
        />
        <SummaryCard
          label="Active clients"
          value={`${activeClients.value} active`}
          href="/clients"
        />
        <SummaryCard
          label="New deliverables"
          value={`${deliverables.value.addedLast7Days} added`}
          detail="in the last 7 days"
        />
      </SummaryCardsGrid>
    </section>
  );
}
