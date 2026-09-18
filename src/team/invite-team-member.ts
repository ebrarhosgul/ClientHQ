"use server";

/**
 * Invite someone to the agency (spec 0015, AC-2, AC-3).
 *
 * Clerk holds the invitation and sends the email; this action decides who
 * may send one (an admin, by the session claim), checks the address against
 * the current members and pending invitations so the admin gets a specific
 * message, and hands Clerk the redirect to the project's own `/sign-up`,
 * where the prebuilt component consumes the ticket.
 */
import { createOrganizationInvite } from "@/auth/clerk";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import { env } from "@/lib/env";

import { throwUnavailable, unavailableOutcome } from "./clerk-failure";
import { logTeamEvent } from "./log";
import { loadTeam } from "./queries";
import { duplicateEmail, type DuplicateKind } from "./rules";
import { inviteInput } from "./schema";

export type SentTeamInvitation = {
  readonly invitationId: string;
};

const DUPLICATE_MESSAGES: Record<DuplicateKind, string> = {
  already_member: "This person is already a member of your agency.",
  already_invited:
    "This address already has an invitation. Revoke it first to send a new one.",
};

export const inviteTeamMember = withTenantAction({
  name: "inviteTeamMember",
  input: inviteInput,
  requireRole: "admin",
  revalidate: { paths: ["/team"] },
  handler: async ({ input, ctx }): Promise<SentTeamInvitation> => {
    const base = {
      operation: "invite",
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      role: input.role,
    } as const;

    const loaded = await loadTeam(ctx);

    if (!loaded.ok) {
      logTeamEvent({
        ...base,
        outcome: unavailableOutcome(loaded.failure, "read"),
      });
      throwUnavailable(loaded.failure, "read");
    }

    const duplicate = duplicateEmail(
      input.email,
      loaded.team.members,
      loaded.team.invitations ?? [],
    );

    if (duplicate !== undefined) {
      logTeamEvent({ ...base, outcome: duplicate });

      throw tenantActionError({
        code: "conflict",
        message: DUPLICATE_MESSAGES[duplicate],
        fieldErrors: { email: [DUPLICATE_MESSAGES[duplicate]] },
      });
    }

    const sent = await createOrganizationInvite({
      clerkOrgId: ctx.clerkOrgId,
      inviterClerkUserId: ctx.clerkUserId,
      email: input.email,
      role: input.role,
      redirectUrl: `${env().NEXT_PUBLIC_APP_URL}/sign-up`,
    });

    if (!sent.ok) {
      if (sent.failure === "duplicate") {
        // The race the pre check cannot see: someone invited or accepted
        // between the read and the write. Same answer as already invited.
        logTeamEvent({ ...base, outcome: "already_invited" });

        throw tenantActionError({
          code: "conflict",
          message: DUPLICATE_MESSAGES.already_invited,
          fieldErrors: { email: [DUPLICATE_MESSAGES.already_invited] },
        });
      }

      logTeamEvent({
        ...base,
        outcome: unavailableOutcome(sent.failure, "write"),
      });
      throwUnavailable(sent.failure, "write");
    }

    logTeamEvent({
      ...base,
      outcome: "ok",
      invitationId: sent.data.invitationId,
    });

    return { invitationId: sent.data.invitationId };
  },
  track: {
    event: "team_member.invited",
    properties: (input) => ({ role: input.role }),
  },
});
