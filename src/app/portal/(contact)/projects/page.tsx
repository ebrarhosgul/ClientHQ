import type { Metadata } from "next";

import { isClerkConfigured } from "@/lib/env";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import { OVERVIEW_PROJECTS_EMPTY } from "@/portal/copy";
import { trackPortalView } from "@/portal/analytics";
import { portalContext } from "@/portal/context";
import {
  listPortalProjects,
  type PortalListResult,
  type PortalProjectRow,
} from "@/portal/queries";
import { parsePageParam } from "@/portal/schema";
import { PortalEmptyState } from "@/portal/ui/portal-empty-state";
import { PortalPagination } from "@/portal/ui/portal-pagination";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { PageHeader } from "@/ui/patterns/page-header";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const COLUMNS: readonly Column<PortalProjectRow>[] = [
  {
    key: "name",
    header: "Project",
    priority: "high",
    identifying: true,
    cell: (row) => row.name,
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cell: (row) => (
      <span className="inline-flex items-center gap-2">
        <ProjectStatusChip status={row.status} />
        {row.overdue ? <OverdueBadge /> : undefined}
      </span>
    ),
  },
  {
    key: "dueDate",
    header: "Due",
    priority: "high",
    align: "end",
    cell: (row) => row.dueDate ?? "—",
  },
];

const NO_RESULTS: PortalListResult<PortalProjectRow> = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

export async function generateMetadata(): Promise<Metadata> {
  if (!isClerkConfigured()) {
    return { title: "Projects · ClientHQ" };
  }

  const { clientName } = await portalContext();

  return { title: `Projects · ${clientName} · ClientHQ` };
}

/**
 * Every non archived project of the contact's client, in every status
 * (spec 0014, AC-6).
 *
 * With no Clerk publishable key there is no session to resolve a contact
 * from, so this renders the same empty list a contact with no projects yet
 * would see (spec 0004, AC-22).
 */
export default async function PortalProjectsPage({
  searchParams,
}: PageProps<"/portal/projects">) {
  const { page: rawPage } = await searchParams;

  const portal = isClerkConfigured() ? await portalContext() : undefined;

  if (portal !== undefined) {
    trackPortalView(portal.ctx, "/portal/projects");
  }

  const { rows, page, pageCount, total } =
    portal !== undefined
      ? await listPortalProjects(
          portal.ctx,
          parsePageParam(firstParam(rawPage)),
        )
      : NO_RESULTS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Every project your agency is running for you, in every stage."
      />

      {rows.length === 0 ? (
        <PortalEmptyState
          heading={OVERVIEW_PROJECTS_EMPTY.heading}
          description={OVERVIEW_PROJECTS_EMPTY.description}
        />
      ) : (
        <>
          <DataTable
            caption={`Projects, ${total} total`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/portal/projects/${row.id}`}
          />
          <PortalPagination
            basePath="/portal/projects"
            page={page}
            pageCount={pageCount}
          />
        </>
      )}
    </div>
  );
}
