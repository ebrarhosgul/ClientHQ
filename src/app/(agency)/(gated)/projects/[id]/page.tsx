import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { agencyContext } from "@/auth/context";
import { listDeliverables, type DeliverableRow } from "@/deliverables/queries";
import { DeliverablesSection } from "@/deliverables/ui/deliverables-section";
import { isClerkConfigured } from "@/lib/env";
import { getProject, type ProjectDetail } from "@/projects/queries";
import { isOverdue, todayUtc } from "@/projects/status";
import { ArchiveProjectButton } from "@/projects/ui/archive-project-button";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import { ProjectStatusActions } from "@/projects/ui/project-status-actions";
import { RestoreProjectButton } from "@/projects/ui/restore-project-button";
import { isStorageConfigured } from "@/storage";
import { Badge } from "@/ui/primitives/badge";
import { PageHeader } from "@/ui/patterns/page-header";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

/**
 * With no Clerk publishable key there is no session to resolve a tenant from,
 * so no id can ever be this agency's (spec 0004, AC-22): `undefined`, the same
 * as a foreign agency's id or one that never existed.
 */
async function findProject(id: string): Promise<ProjectDetail | undefined> {
  return isClerkConfigured()
    ? getProject(await agencyContext(), id)
    : undefined;
}

/**
 * The project's `ready` deliverables, read once for the section (spec 0011,
 * AC-10). A failed read is contained to the section, exactly as the client
 * page's Projects section contains its own.
 */
async function loadDeliverables(
  projectId: string,
): Promise<readonly DeliverableRow[] | undefined> {
  try {
    return await listDeliverables(await agencyContext(), projectId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "deliverables.section",
        operation: "listDeliverables",
        outcome: "failed",
        at: new Date().toISOString(),
      }),
    );

    // A resolution failure (no session, no mirror row) is the layout's to
    // handle, not this page's: let it through.
    if (error instanceof Error && error.name === "TenantResolutionError") {
      throw error;
    }

    return undefined;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await params;
  const project = await findProject(id);

  return { title: project?.name ?? "Project" };
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
 * Every field on file for one project, its client, its status, the moves
 * valid from here, and whether it is archived (spec 0010, AC-6).
 *
 * A foreign agency's id resolves exactly like a missing one: `getProject`
 * scopes through `tenantDb`, so there is no row to tell the two apart
 * (AC-15).
 */
export default async function ProjectDetailPage({
  params,
}: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const project = await findProject(id);

  if (project === undefined) {
    notFound();
  }

  const ctx = await agencyContext();
  const deliverables = await loadDeliverables(project.id);
  const archived = project.archivedAt !== null;
  const overdue = isOverdue(
    project.dueDate,
    project.status,
    project.archivedAt,
    todayUtc(),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={archived ? "Archived" : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {ctx.role === "admin" ? (
              archived ? (
                <RestoreProjectButton projectId={project.id} />
              ) : (
                <ArchiveProjectButton
                  projectId={project.id}
                  projectName={project.name}
                />
              )
            ) : undefined}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {archived ? <Badge variant="secondary">Archived</Badge> : undefined}
        <ProjectStatusChip status={project.status} />
        {overdue ? <OverdueBadge /> : undefined}
      </div>

      {/* Always mounted, so a conflict message outlives the refresh that
          archives or moves the project; the component itself renders no
          buttons while archived (AC-9, AC-10). */}
      <ProjectStatusActions
        projectId={project.id}
        status={project.status}
        archived={archived}
      />

      <div className="grid gap-6 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-2">
        <Detail
          label="Client"
          value={
            <Link
              href={`/clients/${project.clientId}`}
              className="font-medium underline underline-offset-2"
            >
              {project.clientName}
            </Link>
          }
        />
        <Detail label="Due date" value={project.dueDate} />
        <Detail label="Description" value={project.description} />
      </div>

      <DeliverablesSection
        projectId={project.id}
        archived={archived}
        storageConfigured={isStorageConfigured()}
        deliverables={deliverables}
      />
    </div>
  );
}
