import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import { reportException } from "@/observability/sentry";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import type { OpenProjectsSummary } from "../queries";
import { DashboardSection } from "./dashboard-section";

export const OPEN_PROJECTS_HEADING_ID = "dashboard-projects-heading";

export type OpenProjectsSectionProps = {
  /**
   * Started once in `page.tsx` and shared with `OverviewSection`'s open
   * projects card (spec 0020 addendum, Feature design), so the two can never
   * disagree within one page load and the query never runs twice.
   */
  readonly summary: Promise<OpenProjectsSummary>;
};

/**
 * The open projects section (spec 0020, AC-2, AC-6, AC-8, AC-11). Its own
 * try/catch: a failed read never blanks the other sections.
 */
export async function OpenProjectsSection({
  summary: summaryPromise,
}: OpenProjectsSectionProps) {
  let summary: OpenProjectsSummary | undefined;

  try {
    summary = await summaryPromise;
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
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
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
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
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
        <ul className="flex flex-col divide-y divide-border">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="-mx-2 flex flex-col gap-0.5 rounded-md px-2 py-3 transition-surface first:pt-0 last:pb-0 hover:bg-muted"
            >
              <Link href={`/projects/${row.id}`} className="link-accent">
                {row.name}, {row.clientName}
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
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
