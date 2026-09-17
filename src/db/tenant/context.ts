/**
 * Who is asking, worked out once per request.
 *
 * Two audiences share these tables. Agency staff are resolved from the Clerk
 * session; a client contact is resolved from their own `client_contacts` row.
 * Nothing here reads an organization or a client from a URL, a form field or a
 * header, which is the whole point (spec 0003, AC-5).
 *
 * Resolution never writes. Creating a missing mirror row is feature 6's job,
 * which is why `no_mirror_row` is thrown rather than repaired.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { cache } from "react";

import type { MembershipRole } from "../schema";
import { clientContacts, organizations, users } from "../schema";
import { tenantResolutionError, type ResolutionErrorKind } from "./errors";
import { pooledDb, type Executor } from "./executor";
import { logRefusal } from "./log";
import {
  CLERK_ADMIN_ROLE,
  CLERK_MEMBER_ROLE,
  contactCookie,
  sessionClaims,
  type ClerkOrgRole,
} from "./session";

/** An agency user acting inside one Clerk organization. */
export type StaffContext = {
  readonly kind: "staff";
  readonly orgId: string;
  readonly clerkOrgId: string;
  readonly userId: string;
  readonly clerkUserId: string;
  /** From the Clerk claim. `memberships.role` is a display mirror only. */
  readonly role: MembershipRole;
};

/** A client contact reading their own company's work through the portal. */
export type ContactContext = {
  readonly kind: "contact";
  readonly orgId: string;
  readonly userId: string;
  readonly clerkUserId: string;
  readonly clientId: string;
  readonly contactId: string;
};

export type TenantContext = StaffContext | ContactContext;

/** Throw a resolution failure, logging exactly one line first (AC-15). */
function refuse(
  kind: ResolutionErrorKind,
  operation: string,
  known?: { readonly userId?: string; readonly orgId?: string },
): never {
  logRefusal({ operation, reason: kind, ...known });
  throw tenantResolutionError(kind);
}

/**
 * The Clerk organization role, mapped in exactly one place: the admin role
 * becomes `admin`, and every other value, including one this build has never
 * heard of, becomes `member`. Widening a role is a decision; narrowing is safe.
 */
export function toMembershipRole(
  clerkOrgRole: string | undefined,
): MembershipRole {
  return clerkOrgRole === CLERK_ADMIN_ROLE ? "admin" : "member";
}

/**
 * The other direction, for the calls that write a role to Clerk (spec 0015,
 * AC-2, AC-5). Exhaustive over the enum, so a third local role cannot be
 * added without deciding what Clerk should be told.
 */
export function toClerkRole(role: MembershipRole): ClerkOrgRole {
  switch (role) {
    case "admin":
      return CLERK_ADMIN_ROLE;
    case "member":
      return CLERK_MEMBER_ROLE;
  }
}

/**
 * Resolve the staff context, uncached.
 *
 * The executor is a parameter for the same reason the accessor takes one: a
 * caller that already has a transaction open (and the tenancy tests, which run
 * inside one and roll it back) resolves against that handle rather than a
 * second connection. Ordinary code calls `staffContext()` below instead.
 */
export async function resolveStaffContext(
  executor?: Executor,
): Promise<StaffContext> {
  const claims = await sessionClaims();

  if (claims.clerkUserId === undefined) {
    refuse("no_session", "tenantContext.staff");
  }

  if (claims.clerkOrgId === undefined) {
    refuse("no_active_org", "tenantContext.staff");
  }

  const db = executor ?? (await pooledDb());

  // One statement, both mirror rows. The two tables are unrelated, so this is
  // a deliberate cross join filtered on both Clerk ids: either both rows exist
  // and one row comes back, or none does.
  //
  // `deleted_at is null` amends this query for spec 0005, AC-14: a soft deleted
  // organization is treated as absent rather than as a live tenant, so a
  // `organization.deleted` webhook takes effect on the next request instead of
  // leaving a tenant that resolves but should not.
  const [row] = await db
    .select({ orgId: organizations.id, userId: users.id })
    .from(organizations)
    .innerJoin(users, eq(users.clerkUserId, claims.clerkUserId))
    .where(
      and(
        eq(organizations.clerkOrgId, claims.clerkOrgId),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);

  if (row === undefined) {
    refuse("no_mirror_row", "tenantContext.staff");
  }

  return {
    kind: "staff",
    orgId: row.orgId,
    clerkOrgId: claims.clerkOrgId,
    userId: row.userId,
    clerkUserId: claims.clerkUserId,
    role: toMembershipRole(claims.clerkOrgRole),
  };
}

/** Resolve the contact context, uncached. See `resolveStaffContext`. */
export async function resolveContactContext(
  executor?: Executor,
): Promise<ContactContext> {
  const claims = await sessionClaims();

  if (claims.clerkUserId === undefined) {
    refuse("no_session", "tenantContext.contact");
  }

  const db = executor ?? (await pooledDb());

  // A left join, so a signed in person with a mirror row but no contact row is
  // told `no_contact`, while one with no mirror row at all is told
  // `no_mirror_row`. Feature 6 routes those two cases differently.
  //
  // A second left join to `organizations`, added by spec 0015 (AC-7): a
  // `client_contacts` row cannot be dropped from the `where` the way
  // `resolveStaffContext` drops a deleted organization, because that would
  // turn a deleted agency's contact into "no mirror row" for someone who
  // still has one; folding `deletedAt` into the `owned` filter below instead
  // treats a deleted agency's contact the same as having no contact at all.
  //
  // Ordered most recently accepted first, with a null `accepted_at` last and
  // `created_at` breaking a tie, so the fallback row is deterministic.
  const rows = await db
    .select({
      userId: users.id,
      contactId: clientContacts.id,
      orgId: clientContacts.orgId,
      clientId: clientContacts.clientId,
      orgDeletedAt: organizations.deletedAt,
    })
    .from(users)
    .leftJoin(
      clientContacts,
      and(
        eq(clientContacts.userId, users.id),
        isNotNull(clientContacts.acceptedAt),
      ),
    )
    .leftJoin(organizations, eq(organizations.id, clientContacts.orgId))
    .where(eq(users.clerkUserId, claims.clerkUserId))
    .orderBy(
      sql`${clientContacts.acceptedAt} desc nulls last`,
      desc(clientContacts.createdAt),
    );

  const [first] = rows;

  if (first === undefined) {
    refuse("no_mirror_row", "tenantContext.contact");
  }

  const owned = rows.filter(
    (
      row,
    ): row is typeof row & {
      contactId: string;
      orgId: string;
      clientId: string;
    } => row.contactId !== null && row.orgDeletedAt === null,
  );

  const [fallback] = owned;

  if (fallback === undefined) {
    refuse("no_contact", "tenantContext.contact", { userId: first.userId });
  }

  // The cookie only ever *chooses* among rows this user already owns. A value
  // naming someone else's row simply is not in `owned`, so it is discarded and
  // the fallback wins. It can never supply an organization or a client.
  const wanted = await contactCookie();
  const chosen = owned.find((row) => row.contactId === wanted) ?? fallback;

  return {
    kind: "contact",
    orgId: chosen.orgId,
    userId: first.userId,
    clerkUserId: claims.clerkUserId,
    clientId: chosen.clientId,
    contactId: chosen.contactId,
  };
}

/**
 * The staff context, resolved once per request.
 *
 * Throws `no_active_org` for a signed in person with no Clerk organization
 * selected, which is what feature 6 routes to the create or choose an agency
 * screen.
 */
export const staffContext = cache(() => resolveStaffContext());

/** The contact context, resolved once per request. */
export const contactContext = cache(() => resolveContactContext());

async function resolveTenantContext(): Promise<TenantContext> {
  const claims = await sessionClaims();

  if (claims.clerkUserId === undefined) {
    refuse("no_session", "tenantContext");
  }

  // An active Clerk organization means the person is acting as agency staff.
  // Without one, the only other thing they can be is a client contact.
  return claims.clerkOrgId === undefined ? contactContext() : staffContext();
}

/**
 * Who is asking, resolved once per request through React `cache()`.
 *
 * Several accessor calls in one Server Component render or one Server Action
 * share a single resolution (AC-7). Route handlers are deliberately outside
 * this path: webhooks and cron use `withSystemAccess` instead.
 */
export const tenantContext = cache(resolveTenantContext);
