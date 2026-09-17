/**
 * The Clerk backend API, narrowed to what the mirror needs.
 *
 * Two jobs, both about keeping Clerk's shape out of the rest of the product.
 * It converts Clerk's records into the small `MirrorOrganization` and
 * `MirrorUser` shapes `src/db/tenant/provisioning.ts` writes, and it lowercases
 * the email address here, at the boundary, because `users.email` carries a
 * CHECK that refuses anything else (spec 0005, AC-12).
 *
 * The other job is telling two failures apart (AC-21). A 404 is expected: it
 * means the organization was deleted or the person was removed from it, and the
 * answer is to send them to `/onboarding`, so it comes back as a `not_found`
 * result. Every other Clerk failure, a timeout, a rate limit, a bad secret key,
 * is thrown, because treating one of those as "the organization is gone" would
 * quietly log people out of agencies that are perfectly fine.
 */
import { clerkClient } from "@clerk/nextjs/server";

import type { MirrorOrganization, MirrorUser } from "@/db/tenant";
import {
  failure,
  ok,
  toClerkRole,
  toMembershipRole,
  type Result,
} from "@/db/tenant";
import type { MembershipRole } from "@/db/schema";

/** One Clerk organization this person belongs to, as `/onboarding` needs it. */
export type AgencyMembership = {
  readonly clerkOrgId: string;
  readonly name: string;
  readonly clerkOrgRole: string;
};

/**
 * A Clerk 404, told apart from every other way Clerk can fail.
 *
 * Structural rather than an `instanceof` against `ClerkAPIResponseError`,
 * because that class is exported from `@clerk/nextjs/errors`, which is a client
 * boundary module; importing it here would pull browser code into a server
 * file. The same shape check the action wrapper uses for driver errors.
 */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    (error as { readonly status: unknown }).status === 404
  );
}

/**
 * Clerk's page size for a person's memberships.
 *
 * Generous on purpose: the count decides which branch `/onboarding` takes and
 * whether agency creation is a create or an activate, so reading a truncated
 * list would take the wrong branch. Nobody in this product legitimately serves
 * a hundred agencies; if anyone ever does, they see the first hundred rather
 * than the create an agency form, which is the safe way to be wrong.
 */
const MEMBERSHIP_PAGE_SIZE = 100;

/** Every Clerk organization this person belongs to, newest first. */
export async function agencyMemberships(
  clerkUserId: string,
): Promise<readonly AgencyMembership[]> {
  const clerk = await clerkClient();

  const { data } = await clerk.users.getOrganizationMembershipList({
    userId: clerkUserId,
    limit: MEMBERSHIP_PAGE_SIZE,
  });

  return data.map((membership) => ({
    clerkOrgId: membership.organization.id,
    name: membership.organization.name,
    clerkOrgRole: membership.role,
  }));
}

/** The organization record the mirror needs. `not_found` when Clerk 404s. */
export async function clerkOrganization(
  clerkOrgId: string,
): Promise<Result<MirrorOrganization>> {
  const clerk = await clerkClient();

  try {
    const organization = await clerk.organizations.getOrganization({
      organizationId: clerkOrgId,
    });

    return ok({
      clerkOrgId: organization.id,
      name: organization.name,
    });
  } catch (error) {
    if (isNotFound(error)) {
      return failure({
        code: "not_found",
        message: "That agency no longer exists.",
      });
    }

    throw error;
  }
}

/** The user record the mirror needs. `not_found` when Clerk 404s. */
export async function clerkUser(
  clerkUserId: string,
): Promise<Result<MirrorUser>> {
  const clerk = await clerkClient();

  try {
    const user = await clerk.users.getUser(clerkUserId);

    // The primary address, falling back to the first one Clerk holds. The
    // column is not null and lowercase only, so both are enforced right here
    // rather than left to the constraint to catch.
    const primary =
      user.emailAddresses.find(
        (address) => address.id === user.primaryEmailAddressId,
      ) ?? user.emailAddresses[0];

    if (primary === undefined) {
      throw new Error(
        `Clerk user ${clerkUserId} has no email address, so no valid mirror row can be written.`,
      );
    }

    const fullName = [user.firstName, user.lastName]
      .filter((part): part is string => part !== null && part.trim() !== "")
      .join(" ");

    return ok({
      clerkUserId: user.id,
      email: primary.emailAddress.trim().toLowerCase(),
      name: fullName === "" ? undefined : fullName,
      imageUrl: user.imageUrl,
    });
  } catch (error) {
    if (isNotFound(error)) {
      return failure({
        code: "not_found",
        message: "That account no longer exists.",
      });
    }

    throw error;
  }
}

/**
 * Every verified email address on this account, lowercased (spec 0009, AC-10).
 *
 * Verified means Clerk has confirmed it, by a code, a magic link or an OAuth
 * provider that vouches for it. An address merely typed in, or one whose
 * verification is still pending, is not in this list, and so cannot bind an
 * invitation. `not_found` when Clerk 404s, thrown for anything else, exactly
 * as `clerkUser()` does.
 */
export async function clerkVerifiedEmails(
  clerkUserId: string,
): Promise<Result<readonly string[]>> {
  const clerk = await clerkClient();

  try {
    const user = await clerk.users.getUser(clerkUserId);

    return ok(
      user.emailAddresses
        .filter((address) => address.verification?.status === "verified")
        .map((address) => address.emailAddress.trim().toLowerCase()),
    );
  } catch (error) {
    if (isNotFound(error)) {
      return failure({
        code: "not_found",
        message: "That account no longer exists.",
      });
    }

    throw error;
  }
}

/** Clerk rejects a payload it understands but will not accept, a taken slug included. */
function isUnprocessable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    (error as { readonly status: unknown }).status === 422
  );
}

/**
 * Create the Clerk organization, with the submitter as its `org:admin`.
 *
 * The locally free slug is offered (AC-10) but never depended on. Clerk keeps
 * its own slug namespace, so a value free in this database can still be taken
 * over there; when that happens the organization is created without one and
 * Clerk picks its own. Nothing in this product ever reads Clerk's slug, so the
 * two being different costs nothing, whereas failing here would leave a person
 * unable to create an agency because of a name they cannot see.
 */
export async function createClerkOrganization(input: {
  readonly name: string;
  readonly slug: string;
  readonly createdBy: string;
}): Promise<{ readonly clerkOrgId: string }> {
  const clerk = await clerkClient();

  const create = (slug: string | undefined) =>
    clerk.organizations.createOrganization({
      name: input.name,
      slug,
      createdBy: input.createdBy,
    });

  try {
    const organization = await create(input.slug);
    return { clerkOrgId: organization.id };
  } catch (error) {
    if (!isUnprocessable(error)) {
      throw error;
    }

    const organization = await create(undefined);
    return { clerkOrgId: organization.id };
  }
}

// ---------------------------------------------------------------------------
// Organization members and invitations (spec 0015)
// ---------------------------------------------------------------------------

/**
 * How a team management call can fail, told apart at the boundary so the
 * action can say the right thing (spec 0015, AC-11):
 *
 * - `not_found`: Clerk 404, the organization or the target is gone.
 * - `duplicate`: Clerk refused the invitation as already present (AC-3).
 * - `rate_limited`: Clerk 429, the busy message, try again in a minute.
 * - `unreachable`: anything else. Unlike the mirror calls above, these do
 *   not throw, because a team page has an honest error card to show and an
 *   action has an honest `unavailable` to return.
 */
export type ClerkFailure =
  "not_found" | "duplicate" | "rate_limited" | "unreachable";

export type ClerkResult<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly failure: ClerkFailure };

/** One membership of the acting organization, as `/team` shows it. */
export type OrganizationMember = {
  readonly membershipId: string;
  readonly clerkUserId: string;
  /** First and last name, or the email when Clerk holds no name. */
  readonly name: string;
  readonly email: string;
  readonly imageUrl: string | undefined;
  readonly role: MembershipRole;
  readonly joinedAt: Date;
};

/** One pending invitation of the acting organization. */
export type OrganizationInvitation = {
  readonly invitationId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly sentAt: Date;
};

/**
 * Clerk's page size for organization lists. The helpers below page until
 * Clerk's total count is reached, so the size only decides how many calls a
 * large team costs, never what the caller sees (AC-1).
 */
const ORGANIZATION_PAGE_SIZE = 100;

function clerkStatus(error: unknown): number | undefined {
  return error instanceof Error &&
    "status" in error &&
    typeof (error as { readonly status: unknown }).status === "number"
    ? (error as { readonly status: number }).status
    : undefined;
}

function toClerkFailure(error: unknown): ClerkFailure {
  switch (clerkStatus(error)) {
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "unreachable";
  }
}

async function clerkCall<TData>(
  call: () => Promise<TData>,
): Promise<ClerkResult<TData>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    return { ok: false, failure: toClerkFailure(error) };
  }
}

/** Every page of a Clerk list, concatenated, until the total is reached. */
async function allPages<TItem>(
  page: (offset: number) => Promise<{
    readonly data: readonly TItem[];
    readonly totalCount: number;
  }>,
): Promise<readonly TItem[]> {
  const collect = async (
    offset: number,
    sofar: readonly TItem[],
  ): Promise<readonly TItem[]> => {
    const { data, totalCount } = await page(offset);
    const next = [...sofar, ...data];

    // Stop on a short page too, in case the total moved under us.
    return data.length === 0 || next.length >= totalCount
      ? next
      : collect(offset + data.length, next);
  };

  return collect(0, []);
}

function displayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string,
): string {
  const name = [firstName, lastName]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(" ");

  return name === "" ? fallback : name;
}

/**
 * Every membership of an organization, newest first (AC-1).
 *
 * `publicUserData` is optional in Clerk's type, which only happens for a user
 * whose account was deleted under the membership. Such a row is skipped: it
 * has no name, no email and no user to act on.
 */
export async function organizationMembers(
  clerkOrgId: string,
): Promise<ClerkResult<readonly OrganizationMember[]>> {
  const clerk = await clerkClient();

  return clerkCall(async () => {
    const memberships = await allPages((offset) =>
      clerk.organizations.getOrganizationMembershipList({
        organizationId: clerkOrgId,
        orderBy: "-created_at",
        limit: ORGANIZATION_PAGE_SIZE,
        offset,
      }),
    );

    return memberships.flatMap((membership) => {
      const person = membership.publicUserData;

      if (!person) {
        return [];
      }

      const email = person.identifier.trim().toLowerCase();

      return [
        {
          membershipId: membership.id,
          clerkUserId: person.userId,
          name: displayName(person.firstName, person.lastName, email),
          email,
          imageUrl: person.hasImage ? person.imageUrl : undefined,
          role: toMembershipRole(membership.role),
          joinedAt: new Date(membership.createdAt),
        },
      ];
    });
  });
}

/** Every pending invitation of an organization, newest first (AC-1). */
export async function organizationPendingInvitations(
  clerkOrgId: string,
): Promise<ClerkResult<readonly OrganizationInvitation[]>> {
  const clerk = await clerkClient();

  return clerkCall(async () => {
    const invitations = await allPages((offset) =>
      clerk.organizations.getOrganizationInvitationList({
        organizationId: clerkOrgId,
        status: ["pending"],
        limit: ORGANIZATION_PAGE_SIZE,
        offset,
      }),
    );

    return [...invitations]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((invitation) => ({
        invitationId: invitation.id,
        email: invitation.emailAddress.trim().toLowerCase(),
        role: toMembershipRole(invitation.role),
        sentAt: new Date(invitation.createdAt),
      }));
  });
}

/**
 * Send a Clerk organization invitation (AC-2). Clerk sends the email; the
 * link lands on `redirectUrl` carrying a ticket the prebuilt sign up and sign
 * in components consume. Clerk's own duplicate refusal (a 400 or 422) comes
 * back as `duplicate`, the backstop behind the action's own check (AC-3).
 */
export async function createOrganizationInvite(input: {
  readonly clerkOrgId: string;
  readonly inviterClerkUserId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly redirectUrl: string;
}): Promise<ClerkResult<{ readonly invitationId: string }>> {
  const clerk = await clerkClient();

  try {
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: input.clerkOrgId,
      inviterUserId: input.inviterClerkUserId,
      emailAddress: input.email,
      role: toClerkRole(input.role),
      redirectUrl: input.redirectUrl,
    });

    return { ok: true, data: { invitationId: invitation.id } };
  } catch (error) {
    // The request is well formed by construction (parsed by Zod, the role
    // from the enum), so a 400 or 422 here can only be Clerk refusing the
    // address as already invited or already a member.
    const status = clerkStatus(error);

    return {
      ok: false,
      failure:
        status === 400 || status === 422 ? "duplicate" : toClerkFailure(error),
    };
  }
}

/** Revoke one pending invitation (AC-4). */
export async function revokeOrganizationInvite(input: {
  readonly clerkOrgId: string;
  readonly invitationId: string;
  readonly requestingClerkUserId: string;
}): Promise<ClerkResult<undefined>> {
  const clerk = await clerkClient();

  return clerkCall(async () => {
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: input.clerkOrgId,
      invitationId: input.invitationId,
      requestingUserId: input.requestingClerkUserId,
    });

    return undefined;
  });
}

/** Set one member's role in Clerk (AC-5). */
export async function setOrganizationMemberRole(input: {
  readonly clerkOrgId: string;
  readonly clerkUserId: string;
  readonly role: MembershipRole;
}): Promise<ClerkResult<undefined>> {
  const clerk = await clerkClient();

  return clerkCall(async () => {
    await clerk.organizations.updateOrganizationMembership({
      organizationId: input.clerkOrgId,
      userId: input.clerkUserId,
      role: toClerkRole(input.role),
    });

    return undefined;
  });
}

/** Remove one member from the organization in Clerk (AC-6). */
export async function removeOrganizationMember(input: {
  readonly clerkOrgId: string;
  readonly clerkUserId: string;
}): Promise<ClerkResult<undefined>> {
  const clerk = await clerkClient();

  return clerkCall(async () => {
    await clerk.organizations.deleteOrganizationMembership({
      organizationId: input.clerkOrgId,
      userId: input.clerkUserId,
    });

    return undefined;
  });
}
