/**
 * The only file in the project that talks to Clerk's `auth()`.
 *
 * Everything the tenant layer knows about who is asking comes through here, so
 * a test stubs one module instead of the whole SDK, and so there is exactly one
 * place to look when the session shape changes (spec 0003, build plan task 2).
 *
 * This module reads. It never decides anything: mapping a Clerk role onto an
 * application role, and turning a Clerk id into a local row, both belong to
 * `context.ts`.
 */
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { cache } from "react";

import { env } from "@/lib/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The cookie that names which contact row a portal user is acting as. */
export const CONTACT_COOKIE_NAME = "clienthq_contact";

/** The Clerk organization role that maps onto an agency admin. */
export const CLERK_ADMIN_ROLE = "org:admin";

/** The Clerk organization role that maps onto an agency member. */
export const CLERK_MEMBER_ROLE = "org:member";

/** The two Clerk role strings this product ever sends or reads. */
export type ClerkOrgRole = typeof CLERK_ADMIN_ROLE | typeof CLERK_MEMBER_ROLE;

/** The raw claims, normalised to `undefined` so nothing downstream sees null. */
export type SessionClaims = {
  readonly clerkUserId: string | undefined;
  readonly clerkOrgId: string | undefined;
  readonly clerkOrgRole: string | undefined;
};

async function readSessionClaims(): Promise<SessionClaims> {
  // Clerk reads its keys off the process environment itself. Touching `env()`
  // first means a missing key fails with this project's message, and keeps the
  // rule that every variable is declared in the Zod schema honest.
  env();

  const { userId, orgId, orgRole } = await auth();

  return {
    clerkUserId: userId ?? undefined,
    clerkOrgId: orgId ?? undefined,
    clerkOrgRole: orgRole ?? undefined,
  };
}

/**
 * The current session's claims, resolved once per request.
 *
 * Both resolvers in `context.ts` call this, so the cache is what keeps a
 * request to one `auth()` call.
 */
export const sessionClaims = cache(readSessionClaims);

/**
 * The contact id the `clienthq_contact` cookie names, if it names one.
 *
 * Treated as an untrusted hint and nothing more. It can only ever *choose*
 * among contact rows the signed in user already owns; `context.ts` re-verifies
 * it against the database on every request and discards a value that does not
 * match (spec 0003, AC-5). Nothing here trusts it, so nothing here has to
 * verify a signature: writing this cookie belongs to features 10 and 15, and
 * whatever envelope they choose, a forged value still selects nothing.
 */
async function readContactCookie(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(CONTACT_COOKIE_NAME)?.value;

  return value !== undefined && UUID.test(value) ? value : undefined;
}

export const contactCookie = cache(readContactCookie);
