import { FolderKanban } from "lucide-react";
import type { Metadata } from "next";

import { agencyContext } from "@/auth/context";
import { listClientOptions } from "@/clients/queries";
import { isClerkConfigured } from "@/lib/env";
import { ProjectForm } from "@/projects/ui/project-form";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";

export const metadata: Metadata = {
  title: "New project",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The blank create form (spec 0010, AC-1).
 *
 * `?client=` pre-selects a client when it names one of the agency's active
 * ones; the New project link from a client page's Projects section always
 * carries it (AC-13).
 */
export default async function NewProjectPage({
  searchParams,
}: PageProps<"/projects/new">) {
  const params = await searchParams;
  const preselectedClientId = firstParam(params.client);

  const clientOptions = isClerkConfigured()
    ? await listClientOptions(await agencyContext())
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New project"
        description="Only the client and a name are required."
      />
      {isClerkConfigured() ? (
        clientOptions.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            heading="Add a client first"
            description="A project always belongs to one of your agency's active clients."
          />
        ) : (
          <ProjectForm
            clientOptions={clientOptions}
            preselectedClientId={
              clientOptions.some((option) => option.id === preselectedClientId)
                ? preselectedClientId
                : undefined
            }
          />
        )
      ) : (
        <EmptyState
          icon={<FolderKanban />}
          heading="Sign in to create a project"
          description="A project belongs to a specific agency, so creating one needs a signed in session."
        />
      )}
    </div>
  );
}
