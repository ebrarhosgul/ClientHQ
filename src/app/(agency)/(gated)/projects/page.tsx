import { FolderKanban, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { agencyContext } from "@/auth/context";
import { getClient, listClientOptions } from "@/clients/queries";
import { isClerkConfigured } from "@/lib/env";
import {
  listProjects,
  type ProjectListResult,
  type ProjectListRow,
} from "@/projects/queries";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import type { ProjectsClientOption } from "@/projects/ui/projects-filter-bar";
import { ProjectsFilterBar } from "@/projects/ui/projects-filter-bar";
import { ProjectsPagination } from "@/projects/ui/projects-pagination";
import { todayUtc } from "@/projects/status";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = {
  title: "Projects",
};

const COLUMNS: readonly Column<ProjectListRow>[] = [
  {
    key: "name",
    header: "Name",
    priority: "high",
    identifying: true,
    cell: (row) => row.name,
  },
  {
    key: "client",
    header: "Client",
    priority: "high",
    cell: (row) => row.clientName,
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cell: (row) => <ProjectStatusChip status={row.status} />,
  },
  {
    key: "dueDate",
    header: "Due",
    priority: "low",
    align: "end",
    cell: (row) =>
      row.dueDate ? (
        <span className="inline-flex items-center gap-2">
          {row.dueDate}
          {row.overdue ? <OverdueBadge /> : undefined}
        </span>
      ) : (
        "—"
      ),
  },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const NO_RESULTS: ProjectListResult = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

/**
 * Every agency's projects: open by default, in pages of 25, soonest due date
 * first (spec 0010, AC-4, AC-5).
 *
 * `status`, `client`, `archived` and `page` all live in the URL, so this
 * Server Component is the single source of truth for what shows.
 */
export default async function ProjectsPage({
  searchParams,
}: PageProps<"/projects">) {
  const params = await searchParams;

  const archived = firstParam(params.archived) === "true";
  const statusParam = firstParam(params.status);
  const clientParam = firstParam(params.client);
  const effectiveStatus = statusParam ?? (archived ? "all" : "open");

  const { rows, page, pageCount, total }: ProjectListResult =
    isClerkConfigured()
      ? await listProjects(await agencyContext(), {
          pageParam: firstParam(params.page),
          statusParam,
          clientParam,
          archived,
          todayUtc: todayUtc(),
        })
      : NO_RESULTS;

  const clientOptions: ProjectsClientOption[] = isClerkConfigured()
    ? [...(await listClientOptions(await agencyContext()))]
    : [];

  // A filter naming an archived client of this agency still works (AC-5): it
  // is appended as one extra, clearly labelled option, and clears itself out
  // of the select when it does not resolve at all.
  let resolvedClientId: string | undefined;

  if (isClerkConfigured() && clientParam !== undefined) {
    const filtered = await getClient(await agencyContext(), clientParam);

    if (filtered !== undefined) {
      resolvedClientId = filtered.id;

      if (filtered.archivedAt !== null) {
        clientOptions.push({
          id: filtered.id,
          name: filtered.name,
          archived: true,
        });
      }
    }
  }

  const hasFilter = Boolean(clientParam) || archived || Boolean(statusParam);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Every open project across all your clients, soonest due first."
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus />
              New project
            </Link>
          </Button>
        }
      />

      <ProjectsFilterBar
        status={effectiveStatus}
        clientId={resolvedClientId}
        archived={archived}
        clientOptions={clientOptions}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          heading={
            hasFilter ? "No projects match these filters" : "No projects yet"
          }
          description={
            hasFilter
              ? "Try a different filter, or clear them to see the full list."
              : "Create the first project under one of your clients to start tracking its work."
          }
          action={
            hasFilter ? undefined : (
              <Button asChild>
                <Link href="/projects/new">
                  <Plus />
                  New project
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption={`${archived ? "Archived" : "Active"} projects, ${total} total`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/projects/${row.id}`}
          />
          <ProjectsPagination
            page={page}
            pageCount={pageCount}
            status={statusParam}
            clientId={resolvedClientId}
            archived={archived}
          />
        </>
      )}
    </div>
  );
}
