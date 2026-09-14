import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { agencyContext } from "@/auth/context";
import { isClerkConfigured } from "@/lib/env";
import { getProject, type ProjectDetail } from "@/projects/queries";
import { ProjectForm } from "@/projects/ui/project-form";
import { PageHeader } from "@/ui/patterns/page-header";

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

export async function generateMetadata({
  params,
}: PageProps<"/projects/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  const project = await findProject(id);

  return { title: project ? `Edit ${project.name}` : "Project" };
}

/**
 * Pre-filled with the project's current values (spec 0010, AC-7). The client
 * shows as read only text: it can never be changed after creation.
 */
export default async function EditProjectPage({
  params,
}: PageProps<"/projects/[id]/edit">) {
  const { id } = await params;
  const project = await findProject(id);

  if (project === undefined) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Edit ${project.name}`} />
      <ProjectForm project={project} />
    </div>
  );
}
