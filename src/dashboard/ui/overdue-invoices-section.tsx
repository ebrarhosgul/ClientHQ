import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import { formatInvoiceNumber } from "@/invoices/status";
import { formatMoney } from "@/lib/money";
import { reportException } from "@/observability/sentry";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

import type { OverdueInvoicesSummary } from "../queries";
import { DashboardSection } from "./dashboard-section";

export const OVERDUE_INVOICES_HEADING_ID = "dashboard-overdue-heading";

export type OverdueInvoicesSectionProps = {
  /**
   * Started once in `page.tsx` and shared with `OverviewSection`'s overdue
   * card (spec 0020 addendum, Feature design), so the two can never disagree
   * within one page load and the query never runs twice.
   */
  readonly summary: Promise<OverdueInvoicesSummary>;
};

/**
 * The overdue invoices section (spec 0020, AC-2 to AC-5, AC-8, AC-11). Its own
 * try/catch: a failed read never blanks the other sections.
 */
export async function OverdueInvoicesSection({
  summary: summaryPromise,
}: OverdueInvoicesSectionProps) {
  let summary: OverdueInvoicesSummary | undefined;

  try {
    summary = await summaryPromise;
  } catch (error) {
    unstable_rethrow(error);

    reportException(error, {
      tags: { section: "overdue_invoices" },
      fingerprint: ["dashboard_section_failed", "overdue_invoices"],
    });
  }

  if (summary === undefined) {
    return (
      <section
        aria-labelledby={OVERDUE_INVOICES_HEADING_ID}
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id={OVERDUE_INVOICES_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Overdue invoices
        </h2>
        <ErrorState
          heading="Overdue invoices could not be loaded"
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
    <DashboardSection
      headingId={OVERDUE_INVOICES_HEADING_ID}
      heading="Overdue invoices"
      countLine={
        <>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {summary.count} overdue invoice{summary.count === 1 ? "" : "s"}
          </p>
          {summary.totals.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {summary.totals.map((total) => (
                <p
                  key={total.currency}
                  className="text-sm font-medium tabular-nums text-muted-foreground"
                >
                  {formatMoney(total.cents, total.currency)} overdue
                </p>
              ))}
            </div>
          ) : undefined}
        </>
      }
      viewAll={
        summary.count > 0
          ? {
              href: "/invoices?status=overdue",
              label: "View all overdue invoices",
            }
          : undefined
      }
    >
      {summary.rows.length === 0 ? (
        <EmptyState
          heading="Nothing overdue"
          description="Invoices that are overdue, or sent and past their due date, will show up here."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="-mx-2 flex flex-col gap-0.5 rounded-md px-2 py-3 transition-surface first:pt-0 last:pb-0 hover:bg-muted"
            >
              <Link href={`/invoices/${row.id}`} className="link-accent">
                {formatInvoiceNumber(row.number)}, {row.clientName}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatMoney(row.totalCents, row.currency)} · Due {row.dueDate}{" "}
                · {row.daysOverdue} day{row.daysOverdue === 1 ? "" : "s"}{" "}
                overdue
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
