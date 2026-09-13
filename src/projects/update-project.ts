"use server";

/**
 * Editing a project (spec 0010, AC-7, AC-18).
 *
 * The client cannot be changed after creation: `updateProjectInput` has no
 * `clientId` field, so there is nothing here that could move a project to a
 * different client even by accident. Last write wins on purpose, as with
 * clients: no version check, so two edits seconds apart both succeed and the
 * later one's values persist.
 */
import { projects } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { PROJECT_REVALIDATE } from "./revalidate";
import { updateProjectInput } from "./schema";

export type UpdatedProject = {
  readonly id: string;
};

export const updateProject = withTenantAction({
  name: "updateProject",
  input: updateProjectInput,
  revalidate: PROJECT_REVALIDATE,
  handler: async ({ input, db }): Promise<UpdatedProject> => {
    const { id, ...patch } = input;
    const row = await db.update(projects, id, patch);

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { id: row.id };
  },
});
