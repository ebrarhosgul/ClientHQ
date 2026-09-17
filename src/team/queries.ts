/**
 * What `/team` shows, read live from Clerk (spec 0015, AC-1).
 *
 * The local mirror only knows people who have visited until feature 17's
 * webhook sync exists, so the page reads Clerk's own lists: every membership
 * for any staff, and the pending invitations only for an admin, since a
 * member never sees them. The organization is `ctx.clerkOrgId`, never
 * anything in the URL.
 */
import {
  organizationMembers,
  organizationPendingInvitations,
  type ClerkFailure,
  type OrganizationInvitation,
  type OrganizationMember,
} from "@/auth/clerk";
import type { StaffContext } from "@/db/tenant";

export type TeamView = {
  readonly members: readonly OrganizationMember[];
  /** Absent for a member: they do not see invitations at all. */
  readonly invitations: readonly OrganizationInvitation[] | undefined;
};

export type TeamLoad =
  | { readonly ok: true; readonly team: TeamView }
  | { readonly ok: false; readonly failure: ClerkFailure };

export async function loadTeam(ctx: StaffContext): Promise<TeamLoad> {
  const [members, invitations] = await Promise.all([
    organizationMembers(ctx.clerkOrgId),
    ctx.role === "admin"
      ? organizationPendingInvitations(ctx.clerkOrgId)
      : Promise.resolve(undefined),
  ]);

  if (!members.ok) {
    return { ok: false, failure: members.failure };
  }

  if (invitations !== undefined && !invitations.ok) {
    return { ok: false, failure: invitations.failure };
  }

  return {
    ok: true,
    team: { members: members.data, invitations: invitations?.data },
  };
}
