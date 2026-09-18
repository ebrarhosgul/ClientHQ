"use server";

/**
 * Change a member's role (spec 0015, AC-5, AC-7, AC-10).
 *
 * The target is resolved from the full membership list read in this call,
 * which is also where the admin count comes from, so the last admin rule and
 * the cross tenant check rest on the same fresh read. Clerk is written first;
 * the mirror row follows, and a mirror failure after a Clerk success is
 * logged at error level and still returns `ok`, because the change is real.
 */
import { identifyPerson } from "@/analytics/agency-group";
import { organizationMembers, setOrganizationMemberRole } from "@/auth/clerk";
import type { MembershipRole } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { throwUnavailable, unavailableOutcome } from "./clerk-failure";
import { logTeamEvent } from "./log";
import { updateMirrorRole } from "./mirror";
import {
  LAST_ADMIN_DEMOTE_MESSAGE,
  findMembership,
  lastAdminBlocks,
} from "./rules";
import { changeRoleInput } from "./schema";

export type ChangedRole = {
  readonly role: MembershipRole;
  /** The acting admin changed their own role. */
  readonly self: boolean;
};

export const changeTeamMemberRole = withTenantAction({
  name: "changeTeamMemberRole",
  input: changeRoleInput,
  requireRole: "admin",
  revalidate: { paths: ["/team"] },
  handler: async ({ input, ctx, db }): Promise<ChangedRole> => {
    const base = {
      operation: "change_role",
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      membershipId: input.membershipId,
      role: input.role,
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

    if (target.role === input.role) {
      logTeamEvent({ ...detail, outcome: "ok" });
      return { role: input.role, self };
    }

    if (input.role === "member" && lastAdminBlocks(members.data, target)) {
      logTeamEvent({ ...detail, outcome: "last_admin" });

      throw tenantActionError({
        code: "conflict",
        message: LAST_ADMIN_DEMOTE_MESSAGE,
      });
    }

    const written = await setOrganizationMemberRole({
      clerkOrgId: ctx.clerkOrgId,
      clerkUserId: target.clerkUserId,
      role: input.role,
    });

    if (!written.ok) {
      if (written.failure === "not_found") {
        logTeamEvent({ ...detail, outcome: "not_found" });
        throw tenantActionError({ code: "not_found", message: "" });
      }

      logTeamEvent({
        ...detail,
        outcome: unavailableOutcome(written.failure, "write"),
      });
      throwUnavailable(written.failure, "write");
    }

    let mirrored: { readonly userId: string } | undefined;

    try {
      mirrored = await updateMirrorRole(db, target.clerkUserId, input.role);
    } catch {
      logTeamEvent({ ...detail, outcome: "mirror_failed" }, "error");
      return { role: input.role, self };
    }

    logTeamEvent({ ...detail, outcome: "ok" });

    // The person's role property follows the mirror (spec 0019, AC-13).
    if (mirrored !== undefined) {
      await identifyPerson({
        clerkUserId: target.clerkUserId,
        userId: mirrored.userId,
        role: input.role,
      });
    }

    return { role: input.role, self };
  },
});
