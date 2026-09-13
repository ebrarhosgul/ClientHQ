import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";

import { agencyContext } from "@/auth/context";
import {
  listProjectsForClient,
  type ClientProjectRow,
} from "@/projects/queries";
import { todayUtc } from "@/projects/status";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { ProjectStatusChip } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";

import { OverdueBadge } from "./overdue-badge";

export type ProjectsSectionProps = {
  readonly client: {
    readonly id: string;
    readonly name: string;
  };
};

/**
 * The client page's Projects section (spec 0010, AC-13).
 *
 * `agencyContext()` is cached per request, so this costs the page one query
 * and nothing for the context it already resolved. A failed read is
 * contained here, exactly as `ContactsSection` contains its own: the rest of
 * the client record is still worth showing.
 */
export async function ProjectsSection({ client }: ProjectsSectionProps) {
  const projects = await loadProjects(client.id);

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
          <Button asChild size="sm">
            <Link href={`/projects/new?client=${client.id}`}>
              <Plus />
              New project
            </Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          heading="No active projects"
          description={`${client.name} has no open projects yet.`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}
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

async function loadProjects(
  clientId: string,
): Promise<readonly ClientProjectRow[] | undefined> {
  try {
    return await listProjectsForClient(
      await agencyContext(),
      clientId,
      todayUtc(),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "projects.section",
        operation: "listProjectsForClient",
        outcome: "failed",
        at: new Date().toISOString(),
      }),
    );
    // A resolution failure (no session, no mirror row) is the page's to
    // handle, not this section's: let it through to the layout.
    if (error instanceof Error && error.name === "TenantResolutionError") {
      throw error;
    }

    return undefined;
  }
}
