"use server";

/**
 * Remove a member, or leave the agency yourself (spec 0015, AC-6, AC-7,
 * AC-10). Same resolution and last admin rule as a role change. After Clerk
 * confirms, only the `memberships` mirror row is deleted; the shared `users`
 * row is never touched (see `./mirror.ts`).
 */
import { organizationMembers, removeOrganizationMember } from "@/auth/clerk";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { throwUnavailable, unavailableOutcome } from "./clerk-failure";
import { logTeamEvent } from "./log";
import { deleteMirrorMembership } from "./mirror";
import {
  LAST_ADMIN_REMOVE_MESSAGE,
  findMembership,
  lastAdminBlocks,
} from "./rules";
import { membershipIdInput } from "./schema";

export type RemovedMember = {
  /** The acting admin removed themselves. */
  readonly self: boolean;
};

export const removeTeamMember = withTenantAction({
  name: "removeTeamMember",
  input: membershipIdInput,
  requireRole: "admin",
  revalidate: { paths: ["/team"] },
  handler: async ({ input, ctx, db }): Promise<RemovedMember> => {
    const base = {
      operation: "remove",
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      membershipId: input.membershipId,
    } as const;

    const members = await organizationMembers(ctx.clerkOrgId);

    if (!members.ok) {
      logTeamEvent({
        ...base,
        outcome: unavailableOutcome(members.failure, "read"),
      });
      throwUnavailable(members.failure, "read");
    }

    const target = findMembership(members.data, input.membershipId);

    if (target === undefined) {
      logTeamEvent({ ...base, outcome: "not_found" });
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const self = target.clerkUserId === ctx.clerkUserId;
    const detail = { ...base, targetClerkUserId: target.clerkUserId };

    if (lastAdminBlocks(members.data, target)) {
      logTeamEvent({ ...detail, outcome: "last_admin" });

      throw tenantActionError({
        code: "conflict",
        message: LAST_ADMIN_REMOVE_MESSAGE,
      });
    }

    const removed = await removeOrganizationMember({
      clerkOrgId: ctx.clerkOrgId,
      clerkUserId: target.clerkUserId,
    });

    if (!removed.ok) {
      if (removed.failure === "not_found") {
        logTeamEvent({ ...detail, outcome: "not_found" });
        throw tenantActionError({ code: "not_found", message: "" });
      }

      logTeamEvent({
        ...detail,
        outcome: unavailableOutcome(removed.failure, "write"),
      });
      throwUnavailable(removed.failure, "write");
    }

    try {
      await deleteMirrorMembership(db, target.clerkUserId);
    } catch {
      logTeamEvent({ ...detail, outcome: "mirror_failed" }, "error");
      return { self };
    }

    logTeamEvent({ ...detail, outcome: "ok" });

    return { self };
  },
});
