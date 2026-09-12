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
import { failure, ok, type Result } from "@/db/tenant";

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
