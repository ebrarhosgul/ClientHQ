import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";

import type { ClientProjectRow } from "@/projects/queries";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import { OverdueBadge } from "./overdue-badge";

export type ProjectsSectionProps = {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly archivedAt: Date | null;
  };
  /** `undefined` when the read failed: the section shows a reload prompt. */
  readonly projects: readonly ClientProjectRow[] | undefined;
};

/**
 * The client page's Projects section (spec 0010, AC-13).
 *
 * The page reads the rows once and shares them here and with the archive
 * client confirm's count (AC-14), so the section runs no query of its own. A
 * failed read still stays contained to this section, exactly as
 * `ContactsSection` contains its own: the rest of the client record is still
 * worth showing.
 *
 * An archived client gets no New project link: the create picker never lists
 * one (AC-3), so the link could only land on a form that cannot pick this
 * client. The section says why instead, as the contacts section does.
 */
export function ProjectsSection({ client, projects }: ProjectsSectionProps) {
  const archived = client.archivedAt !== null;

  if (projects === undefined) {
    return (
      <section
        aria-labelledby="projects-heading"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id="projects-heading"
          className="text-base font-semibold tracking-tight"
        >
          Projects
        </h2>
        <ErrorState
          heading="Projects could not be loaded"
          description="The rest of this client is fine. Reload to try the projects again."
          action={
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}`}>Reload</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="projects-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="projects-heading"
          className="text-base font-semibold tracking-tight"
        >
          Projects
        </h2>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/projects?client=${client.id}&archived=true&status=all`}
            >
              View archived
            </Link>
          </Button>
          {archived ? undefined : (
            <Button asChild size="sm">
              <Link href={`/projects/new?client=${client.id}`}>
                <Plus />
                New project
              </Link>
            </Button>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          heading="No active projects"
          description={
            archived
              ? "This client is archived, so no projects can be added until they are restored."
              : `${client.name} has no open projects yet.`
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      {archived && projects.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          This client is archived. Restore them to add projects.
        </p>
      ) : undefined}
    </section>
  );
}

function ProjectRow({ project }: { readonly project: ClientProjectRow }) {
  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 transition-surface hover:bg-accent"
      >
        <span className="font-medium">{project.name}</span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <ProjectStatusChip status={project.status} />
          <span>{project.dueDate ?? "No due date"}</span>
          {project.overdue ? <OverdueBadge /> : undefined}
        </span>
      </Link>
    </li>
  );
}
