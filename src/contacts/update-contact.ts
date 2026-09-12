"use server";

/**
 * Editing a contact's name and email (spec 0009, AC-2).
 *
 * Changing the email of a contact with a pending or expired invitation clears
 * that invitation in the same statement, so the old link dies with the old
 * address. Changing the email of an accepted contact is refused: the stored
 * address is the one a verified Clerk email bound to, and the honest fix is to
 * remove and add again. The name may change in any status.
 */
import { and, eq, ne } from "drizzle-orm";

import { clientContacts } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { updateContactInput } from "./schema";

export type UpdatedContact = {
  readonly id: string;
};

const CLEARED_INVITATION = {
  inviteTokenHash: null,
  inviteExpiresAt: null,
  invitedAt: null,
  invitedByUserId: null,
} as const;

export const updateContact = withTenantAction({
  name: "updateContact",
  input: updateContactInput,
  revalidate: { paths: [{ path: "/clients/[id]", type: "page" }] },
  handler: async ({ input, db }): Promise<UpdatedContact> => {
    const existing = await db.findById(clientContacts, input.contactId);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const emailChanged = existing.email !== input.email;

    if (emailChanged && existing.userId !== null) {
      throw tenantActionError({
        code: "conflict",
        message:
          "This contact has accepted their invitation, so their email cannot be changed. Remove them and add them again with the new address.",
        fieldErrors: {
          email: [
            "An accepted contact's email cannot be changed. Remove and add them again.",
          ],
        },
      });
    }

    if (emailChanged) {
      const duplicate = await db.findFirst(clientContacts, {
        where: and(
          eq(clientContacts.clientId, existing.clientId),
          eq(clientContacts.email, input.email),
          ne(clientContacts.id, existing.id),
        ),
      });

      if (duplicate !== undefined) {
        throw tenantActionError({
          code: "conflict",
          message:
            "Someone with that email is already a contact of this client.",
          fieldErrors: {
            email: [
              "Someone with that email is already a contact of this client.",
            ],
          },
        });
      }
    }

    const row = await db.update(clientContacts, existing.id, {
      name: input.name,
      email: input.email,
      ...(emailChanged ? CLEARED_INVITATION : {}),
    });

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { id: row.id };
  },
});
