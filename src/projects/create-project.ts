"use server";

/**
 * Creating a project (spec 0010, AC-1 through AC-3).
 *
 * Every project starts in `planning`: the input schema has no status field,
 * so there is nothing to smuggle in even by accident. The chosen client must
 * be one of this agency's active clients at the moment of creation; any other
 * reason it fails to resolve (archived, another agency's, made up) collapses
 * to the same `not_found` refusal, so a prober cannot tell them apart.
 */
import { clients, projects } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { PROJECT_REVALIDATE } from "./revalidate";
import { createProjectInput } from "./schema";

export type CreatedProject = {
  readonly id: string;
};

export const createProject = withTenantAction({
  name: "createProject",
  input: createProjectInput,
  revalidate: PROJECT_REVALIDATE,
  handler: async ({ input, db }): Promise<CreatedProject> => {
    const client = await db.findById(clients, input.clientId);

    if (client === undefined || client.archivedAt !== null) {
      throw tenantActionError({
        code: "not_found",
        message: "Choose an active client.",
      });
    }

    const row = await db.insert(projects, {
      clientId: input.clientId,
      name: input.name,
      description: input.description,
      dueDate: input.dueDate,
    });

    return { id: row.id };
  },
  track: {
    event: "project.created",
    properties: (input, created) => ({
      project_id: created.id,
      client_id: input.clientId,
    }),
  },
});
