import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import type { StaffContext } from "@/db/tenant";
import { formatBillingDate } from "@/payments/billing-state";
import { reportException } from "@/observability/sentry";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { StatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import {
  recentDeliverablesSummary,
  type RecentDeliverablesSummary,
} from "../queries";
import { DashboardSection } from "./dashboard-section";

export const RECENT_DELIVERABLES_HEADING_ID = "dashboard-deliverables-heading";

export type RecentDeliverablesSectionProps = {
  readonly ctx: StaffContext;
  readonly now: Date;
};

/**
 * The recent deliverables section (spec 0020, AC-2, AC-7, AC-8, AC-11). Its
 * own try/catch: a failed read never blanks the other two sections. No "view
 * all" link (AC-7): there is no deliverables list to point at.
 */
export async function RecentDeliverablesSection({
  ctx,
  now,
}: RecentDeliverablesSectionProps) {
  let summary: RecentDeliverablesSummary | undefined;

  try {
    summary = await recentDeliverablesSummary(ctx, now);
  } catch (error) {
    unstable_rethrow(error);

    reportException(error, {
      tags: { section: "recent_deliverables" },
      fingerprint: ["dashboard_section_failed", "recent_deliverables"],
    });
  }

  if (summary === undefined) {
    return (
      <section
        aria-labelledby={RECENT_DELIVERABLES_HEADING_ID}
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id={RECENT_DELIVERABLES_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Recent deliverables
        </h2>
        <ErrorState
          heading="Recent deliverables could not be loaded"
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
      headingId={RECENT_DELIVERABLES_HEADING_ID}
      heading="Recent deliverables"
      countLine={
        <p>
          {summary.addedLast7Days === 0
            ? "None added in the last 7 days"
            : `${summary.addedLast7Days} added in the last 7 days`}
        </p>
      }
    >
      {summary.rows.length === 0 ? (
        <EmptyState
          heading="No deliverables yet"
          description="Files are uploaded from a project's own page. Ones added there will show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-0.5 rounded-md border border-border p-3"
            >
              <Link
                href={`/projects/${row.projectId}`}
                className="font-medium underline underline-offset-2"
              >
                {row.name}, {row.clientName}
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{row.projectName}</span>
                <StatusChip tint={row.visibleToClient ? "info" : "neutral"}>
                  {row.visibleToClient ? "Shared with client" : "Internal"}
                </StatusChip>
                <span>
                  Added by {row.uploadedByName} on{" "}
                  {formatBillingDate(row.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
