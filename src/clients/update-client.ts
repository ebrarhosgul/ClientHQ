"use server";

/**
 * Editing a client (spec 0006, AC-6, AC-7, AC-14).
 *
 * A full replace of every editable field, the same shape `createClient` writes.
 * `tenantDb`'s `update` is what makes AC-11 hold here: zero rows match for
 * another agency's id, which comes back indistinguishable from a missing one.
 *
 * Last write wins on purpose (spec 0006, Consequences): no version check, so
 * two edits seconds apart both succeed and the later one's values persist,
 * satisfying AC-14 without a conflict error either person would see.
 */
import { clients } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { updateClientInput } from "./schema";

export type UpdatedClient = {
  readonly id: string;
};

export const updateClient = withTenantAction({
  name: "updateClient",
  input: updateClientInput,
  revalidate: {
    paths: ["/clients", { path: "/clients/[id]", type: "page" }],
  },
  handler: async ({ input, db }): Promise<UpdatedClient> => {
    const { id, ...patch } = input;
    const row = await db.update(clients, id, patch);

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { id: row.id };
  },
});
