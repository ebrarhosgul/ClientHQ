import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { formatBytes } from "@/deliverables/format";
import { isClerkConfigured } from "@/lib/env";
import { trackPortalView } from "@/portal/analytics";
import { portalContext } from "@/portal/context";
import { getPortalProject, listProjectFiles } from "@/portal/queries";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";

export async function generateMetadata({
  params,
}: PageProps<"/portal/projects/[id]">): Promise<Metadata> {
  if (!isClerkConfigured()) {
    return { title: "Project · ClientHQ" };
  }

  const { id } = await params;
  const { ctx, clientName } = await portalContext();
  const project = await getPortalProject(ctx, id);

  return {
    title:
      project === undefined
        ? `Project · ${clientName} · ClientHQ`
        : `${project.name} · ${clientName} · ClientHQ`,
  };
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

/**
 * One project and the files shared on it (spec 0014, AC-7). An archived
 * project, a project of another client, a missing id and a malformed one all
 * render not found: `getPortalProject` refuses every one of them.
 *
 * With no Clerk publishable key there is no session to resolve a tenant
 * from, so no id can ever be this contact's, the same as a foreign one
 * (spec 0004, AC-22).
 */
export default async function PortalProjectPage({
  params,
}: PageProps<"/portal/projects/[id]">) {
  if (!isClerkConfigured()) {
    notFound();
  }

  const { id } = await params;
  const { ctx } = await portalContext();
  const project = await getPortalProject(ctx, id);

  if (project === undefined) {
    notFound();
  }

  trackPortalView(ctx, "/portal/projects/[id]");

  const files = await listProjectFiles(ctx, project.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ProjectStatusChip status={project.status} />
        {project.overdue ? <OverdueBadge /> : undefined}
      </div>

      <div className="grid gap-6 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-2">
        <Detail label="Due date" value={project.dueDate} />
        <Detail label="Description" value={project.description} />
      </div>

      <section
        aria-labelledby="project-files-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="project-files-heading"
          className="text-base font-semibold tracking-tight"
        >
          Files
        </h2>

        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No files shared on this project yet
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link
                  href={`/deliverables/${file.id}/download`}
                  className="link-accent"
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
        )}
      </section>
    </div>
  );
}
