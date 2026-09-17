/**
 * The pure decisions behind team management (spec 0015): who counts as the
 * last admin, whether an address is already on the team, and what a self
 * action means. No Clerk, no database, so every rule has a unit test that
 * runs in a millisecond.
 */
import type { OrganizationInvitation, OrganizationMember } from "@/auth/clerk";
import type { MembershipRole } from "@/db/schema";

export type { OrganizationInvitation, OrganizationMember };

/** How many admins the organization has right now. */
export function adminCount(members: readonly OrganizationMember[]): number {
  return members.filter((member) => member.role === "admin").length;
}

/**
 * Would demoting or removing this member leave the organization with no
 * admin (AC-5, AC-6)? Counted from the full list read in the same action, so
 * the answer is as fresh as Clerk's list was a moment ago.
 */
export function lastAdminBlocks(
  members: readonly OrganizationMember[],
  target: OrganizationMember,
): boolean {
  return target.role === "admin" && adminCount(members) === 1;
}

export type DuplicateKind = "already_member" | "already_invited";

/**
 * Is this address already a member, or already invited (AC-3)? The email is
 * compared lowercased on both sides; Clerk's lists are lowercased at the
 * boundary and the action's input is lowercased by Zod.
 */
export function duplicateEmail(
  email: string,
  members: readonly OrganizationMember[],
  invitations: readonly OrganizationInvitation[],
): DuplicateKind | undefined {
  const needle = email.trim().toLowerCase();

  if (members.some((member) => member.email === needle)) {
    return "already_member";
  }

  if (invitations.some((invitation) => invitation.email === needle)) {
    return "already_invited";
  }

  return undefined;
}

/** The membership the action was pointed at, or nothing (AC-5, AC-6). */
export function findMembership(
  members: readonly OrganizationMember[],
  membershipId: string,
): OrganizationMember | undefined {
  return members.find((member) => member.membershipId === membershipId);
}

/** The visible label for a role, wherever the page shows one. */
export function roleLabel(role: MembershipRole): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "member":
      return "Member";
  }
}

export const MEMBER_NOTE = "Only an admin can invite people or change roles.";

export const LAST_ADMIN_REASON =
  "You are the only admin. Make someone else an admin first.";

export const LAST_ADMIN_DEMOTE_MESSAGE =
  "The last admin cannot be made a member. Make someone else an admin first.";

export const LAST_ADMIN_REMOVE_MESSAGE =
  "The last admin cannot be removed. Make someone else an admin first.";
