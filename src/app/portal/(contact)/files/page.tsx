import type { Metadata } from "next";
import Link from "next/link";

import { formatBytes } from "@/deliverables/format";
import { isClerkConfigured } from "@/lib/env";
import { OVERVIEW_FILES_EMPTY } from "@/portal/copy";
import { portalContext } from "@/portal/context";
import {
  groupFilesByProject,
  listPortalFiles,
  type PortalFileRow,
  type PortalListResult,
} from "@/portal/queries";
import { parsePageParam } from "@/portal/schema";
import { PortalEmptyState } from "@/portal/ui/portal-empty-state";
import { PortalPagination } from "@/portal/ui/portal-pagination";
import { PageHeader } from "@/ui/patterns/page-header";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const NO_RESULTS: PortalListResult<PortalFileRow> = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

export async function generateMetadata(): Promise<Metadata> {
  if (!isClerkConfigured()) {
    return { title: "Files · ClientHQ" };
  }

  const { clientName } = await portalContext();

  return { title: `Files · ${clientName} · ClientHQ` };
}

/**
 * Every shared file across the client's non archived projects, 25 to a page,
 * grouped under a heading per project (spec 0014, AC-8).
 *
 * With no Clerk publishable key there is no session to resolve a contact
 * from, so this renders the same empty list a contact with no shared files
 * yet would see (spec 0004, AC-22).
 */
export default async function PortalFilesPage({
  searchParams,
}: PageProps<"/portal/files">) {
  const { page: rawPage } = await searchParams;

  const { rows, page, pageCount } = isClerkConfigured()
    ? await listPortalFiles(
        (await portalContext()).ctx,
        parsePageParam(firstParam(rawPage)),
      )
    : NO_RESULTS;
  const groups = groupFilesByProject(rows);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Files"
        description="Every file your agency has shared with you, newest first."
      />

      {rows.length === 0 ? (
        <PortalEmptyState
          heading={OVERVIEW_FILES_EMPTY.heading}
          description={OVERVIEW_FILES_EMPTY.description}
        />
      ) : (
        <>
          {groups.map((group) => (
            <section
              key={group.projectId}
              aria-labelledby={`files-project-${group.projectId}`}
              className="flex flex-col gap-3"
            >
              <h2
                id={`files-project-${group.projectId}`}
                className="text-base font-semibold tracking-tight"
              >
                <Link
                  href={`/portal/projects/${group.projectId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {group.projectName}
                </Link>
              </h2>

              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                {group.files.map((file) => (
                  <li
                    key={file.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <Link
                      href={`/deliverables/${file.id}/download`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {file.name}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {file.contentType}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatBytes(file.sizeBytes)}
                    </span>
                    <time
                      dateTime={file.createdAt.toISOString()}
                      className="text-sm text-muted-foreground"
                    >
                      Added {file.createdAt.toISOString().slice(0, 10)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <PortalPagination
            basePath="/portal/files"
            page={page}
            pageCount={pageCount}
          />
        </>
      )}
    </div>
  );
}
