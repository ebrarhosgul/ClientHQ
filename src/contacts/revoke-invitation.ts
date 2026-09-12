"use server";

/**
 * Revoking a pending or expired invitation (spec 0009, AC-7).
 *
 * Every invitation column goes back to null, so the contact reads as not
 * invited and the old link fails as invalid. Idempotent: a contact with
 * nothing pending is left alone and reported as success. An accepted contact
 * cannot be revoked, only removed.
 */
import { clientContacts } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { logContactEvent } from "./log";
import { contactIdInput } from "./schema";

export type RevokedInvitation = {
  readonly id: string;
};

export const revokeInvitation = withTenantAction({
  name: "revokeInvitation",
  input: contactIdInput,
  revalidate: { paths: [{ path: "/clients/[id]", type: "page" }] },
  handler: async ({ input, ctx, db }): Promise<RevokedInvitation> => {
    const existing = await db.findById(clientContacts, input.contactId);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (existing.userId !== null) {
      throw tenantActionError({
        code: "conflict",
        message:
          "This contact has already accepted. Remove them to take away their portal access.",
      });
    }

    if (existing.inviteTokenHash === null) {
      logContactEvent({
        operation: "revoke",
        outcome: "already_gone",
        orgId: ctx.orgId,
        contactId: existing.id,
      });

      return { id: existing.id };
    }

    const row = await db.update(clientContacts, existing.id, {
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedAt: null,
      invitedByUserId: null,
    });

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    logContactEvent({
      operation: "revoke",
      outcome: "revoked",
      orgId: ctx.orgId,
      contactId: existing.id,
    });

    return { id: existing.id };
  },
});
