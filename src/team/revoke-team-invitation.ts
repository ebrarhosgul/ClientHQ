"use server";

/**
 * Revoke a pending invitation (spec 0015, AC-4). The id is resolved against
 * the acting organization's own pending list first, so an id from another
 * agency, or one already accepted or revoked, is `not_found` and never sent
 * to Clerk. Any admin may revoke any invitation, not only the sender.
 */
import {
  organizationPendingInvitations,
  revokeOrganizationInvite,
} from "@/auth/clerk";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { throwUnavailable, unavailableOutcome } from "./clerk-failure";
import { logTeamEvent } from "./log";
import { invitationIdInput } from "./schema";

export const revokeTeamInvitation = withTenantAction({
  name: "revokeTeamInvitation",
  input: invitationIdInput,
  requireRole: "admin",
  revalidate: { paths: ["/team"] },
  handler: async ({ input, ctx }): Promise<undefined> => {
    const base = {
      operation: "revoke",
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      invitationId: input.invitationId,
    } as const;

    const pending = await organizationPendingInvitations(ctx.clerkOrgId);

    if (!pending.ok) {
      logTeamEvent({
        ...base,
        outcome: unavailableOutcome(pending.failure, "read"),
      });
      throwUnavailable(pending.failure, "read");
    }

    const known = pending.data.some(
      (invitation) => invitation.invitationId === input.invitationId,
    );

    if (!known) {
      logTeamEvent({ ...base, outcome: "not_found" });
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const revoked = await revokeOrganizationInvite({
      clerkOrgId: ctx.clerkOrgId,
      invitationId: input.invitationId,
      requestingClerkUserId: ctx.clerkUserId,
    });

    if (!revoked.ok) {
      if (revoked.failure === "not_found") {
        logTeamEvent({ ...base, outcome: "not_found" });
        throw tenantActionError({ code: "not_found", message: "" });
      }

      logTeamEvent({
        ...base,
        outcome: unavailableOutcome(revoked.failure, "write"),
      });
      throwUnavailable(revoked.failure, "write");
    }

    logTeamEvent({ ...base, outcome: "ok" });

    return undefined;
  },
});
