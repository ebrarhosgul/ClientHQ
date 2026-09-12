"use server";

/**
 * Removing a contact (spec 0009, AC-8).
 *
 * A hard delete. A pending link fails afterwards because there is no row for
 * it; an accepted contact loses portal access on their next request, because
 * the contact resolver finds nothing. A contact that is already gone, which
 * includes another agency's id, is reported as success with the id the caller
 * passed, since the state they asked for is the state that holds.
 */
import { clientContacts } from "@/db/schema";
import { withTenantAction } from "@/db/tenant";

import { logContactEvent } from "./log";
import { contactIdInput } from "./schema";

export type RemovedContact = {
  readonly id: string;
};

export const removeContact = withTenantAction({
  name: "removeContact",
  input: contactIdInput,
  revalidate: { paths: [{ path: "/clients/[id]", type: "page" }] },
  handler: async ({ input, ctx, db }): Promise<RemovedContact> => {
    const deleted = await db.delete(clientContacts, input.contactId);

    logContactEvent({
      operation: "remove",
      outcome: deleted ? "removed" : "already_gone",
      orgId: ctx.orgId,
      contactId: input.contactId,
    });

    return { id: input.contactId };
  },
});
