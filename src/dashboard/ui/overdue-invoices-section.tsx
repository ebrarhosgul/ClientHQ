import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import type { StaffContext } from "@/db/tenant";
import { formatInvoiceNumber } from "@/invoices/status";
import { formatMoney } from "@/lib/money";
import { reportException } from "@/observability/sentry";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

import {
  overdueInvoicesSummary,
  type OverdueInvoicesSummary,
} from "../queries";
import { DashboardSection } from "./dashboard-section";

export const OVERDUE_INVOICES_HEADING_ID = "dashboard-overdue-heading";

export type OverdueInvoicesSectionProps = {
  readonly ctx: StaffContext;
  readonly todayUtc: string;
};

/**
 * The overdue invoices section (spec 0020, AC-2 to AC-5, AC-8, AC-11). Its own
 * try/catch: a failed read never blanks the other two sections.
 */
export async function OverdueInvoicesSection({
  ctx,
  todayUtc,
}: OverdueInvoicesSectionProps) {
  let summary: OverdueInvoicesSummary | undefined;

  try {
    summary = await overdueInvoicesSummary(ctx, todayUtc);
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
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
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
          <p>
            {summary.count} overdue invoice{summary.count === 1 ? "" : "s"}
          </p>
          {summary.totals.map((total) => (
            <p key={total.currency}>
              {formatMoney(total.cents, total.currency)} overdue
            </p>
          ))}
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
        <ul className="flex flex-col gap-2">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-0.5 rounded-md border border-border p-3"
            >
              <Link
                href={`/invoices/${row.id}`}
                className="font-medium underline underline-offset-2"
              >
                {formatInvoiceNumber(row.number)}, {row.clientName}
              </Link>
              <span className="text-xs text-muted-foreground">
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
