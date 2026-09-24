import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import type { StaffContext } from "@/db/tenant";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import { reportException } from "@/observability/sentry";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import { openProjectsSummary, type OpenProjectsSummary } from "../queries";
import { DashboardSection } from "./dashboard-section";

export const OPEN_PROJECTS_HEADING_ID = "dashboard-projects-heading";

export type OpenProjectsSectionProps = {
  readonly ctx: StaffContext;
  readonly todayUtc: string;
};

/**
 * The open projects section (spec 0020, AC-2, AC-6, AC-8, AC-11). Its own
 * try/catch: a failed read never blanks the other two sections.
 */
export async function OpenProjectsSection({
  ctx,
  todayUtc,
}: OpenProjectsSectionProps) {
  let summary: OpenProjectsSummary | undefined;

  try {
    summary = await openProjectsSummary(ctx, todayUtc);
  } catch (error) {
    unstable_rethrow(error);

    reportException(error, {
      tags: { section: "open_projects" },
      fingerprint: ["dashboard_section_failed", "open_projects"],
    });
  }

  if (summary === undefined) {
    return (
      <section
        aria-labelledby={OPEN_PROJECTS_HEADING_ID}
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id={OPEN_PROJECTS_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Open projects
        </h2>
        <ErrorState
          heading="Open projects could not be loaded"
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
      headingId={OPEN_PROJECTS_HEADING_ID}
      heading="Open projects"
      countLine={
        <p>
          {summary.count} open project{summary.count === 1 ? "" : "s"}
        </p>
      }
      viewAll={
        summary.count > 0
          ? { href: "/projects", label: "View all open projects" }
          : undefined
      }
    >
      {summary.rows.length === 0 ? (
        <EmptyState
          heading="No open projects"
          description="Projects that are planned, in progress or in review will show up here."
          action={
            <Button asChild size="sm">
              <Link href="/projects/new">New project</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-0.5 rounded-md border border-border p-3"
            >
              <Link
                href={`/projects/${row.id}`}
                className="font-medium underline underline-offset-2"
              >
                {row.name}, {row.clientName}
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ProjectStatusChip status={row.status} />
                <span>{row.dueDate ?? "No due date"}</span>
                {row.overdue ? <OverdueBadge /> : undefined}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
