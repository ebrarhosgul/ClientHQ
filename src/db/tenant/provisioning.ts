/**
 * The mirror rows, written by name.
 *
 * Feature 6 is the first thing in the product that writes `organizations`,
 * `users` and `memberships`, and none of the three is tenant scoped, so
 * `tenantDb()` cannot express these writes: `organizations` *is* the tenant and
 * the other two carry no `org_id`. Rather than open the unscoped door for it,
 * this file offers named functions that touch exactly those three tables (plus,
 * for a user delete, the `client_contacts` row it unbinds) and nothing else,
 * inside the layer, so `withSystemAccess` stays limited to the three callers
 * spec 0003 fixed and neither ESLint exemption list grows (spec 0005, AC-17).
 *
 * Clerk is authoritative for every column written here. That is why every
 * upsert is an `onConflictDoUpdate` on its own unique key rather than an insert
 * that can fail: two concurrent repairs, or a repair racing the webhook, both
 * succeed and leave one row in each table (AC-13). Feature 17's webhook (spec
 * 0015) is the second writer these statements were always meant to share.
 *
 * `deleted_at` is deliberately absent from every upsert's `set` clause. Spec
 * 0005 makes it read only outside the delete functions here: staff resolution
 * treats a soft deleted organization as missing (AC-14), and reviving one is a
 * decision for the Clerk webhook that set it, not for a repair that is only
 * trying to fill in a name.
 */
import { and, eq, isNull, like, or, sql } from "drizzle-orm";

import { uniqueSlug, toSlug } from "@/auth/slug";
import { newId } from "@/lib/id";

import type { MembershipRole } from "../schema";
import { clientContacts, memberships, organizations, users } from "../schema";
import { pooledDb, type Executor } from "./executor";

/**
 * The local row for a Clerk user Clerk no longer has, or that this mirror has
 * already scrubbed. Thrown rather than silently ignored: every caller
 * (onboarding, invitation acceptance, the Clerk webhook) needs to know a
 * write it asked for did not happen, not receive someone else's stale ids.
 */
export class MirrorUserDeleted extends Error {
  constructor(readonly clerkUserId: string) {
    super(
      `The local user for Clerk id ${clerkUserId} is deleted; the mirror will not revive or rewrite it.`,
    );
    this.name = "MirrorUserDeleted";
  }
}

/** The organization columns Clerk owns. */
export type MirrorOrganization = {
  readonly clerkOrgId: string;
  readonly name: string;
};

/** The user columns Clerk owns. `email` arrives already lowercased. */
export type MirrorUser = {
  readonly clerkUserId: string;
  readonly email: string;
  readonly name: string | undefined;
  readonly imageUrl: string | undefined;
};

/** The local ids a caller needs once the mirror is in place. */
export type MirrorIds = {
  readonly orgId: string;
  readonly userId: string;
};

/**
 * A slug for this name that nothing else holds.
 *
 * One query fetches every slug that could collide, and `uniqueSlug()` picks
 * from what is left. A concurrent insert can still win the race between this
 * read and the write; the unique constraint catches that, the caller reports a
 * retry, and the next attempt reads the newly taken value and moves past it.
 */
async function freeSlug(executor: Executor, name: string): Promise<string> {
  const base = toSlug(name);

  const rows = await executor
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(
      or(
        eq(organizations.slug, base),
        // `base` is `[a-z0-9-]+` by construction, so it carries no LIKE
        // wildcard of its own and needs no escaping.
        like(organizations.slug, `${base}-%`),
      ),
    );

  return uniqueSlug(name, new Set(rows.map((row) => row.slug)));
}

/**
 * The slug agency creation offers Clerk, read before Clerk is called.
 *
 * The same helper against the same column as the write path, so under no
 * contention the two agree exactly. Under contention they can differ, which
 * AC-10 already allows: no slug appears in a URL, and the local column is what
 * this product reads.
 */
export async function suggestedSlug(name: string): Promise<string> {
  const db = await pooledDb();
  return freeSlug(db, name);
}

/**
 * The `users` half of the mirror on its own, upserted on `clerk_user_id`.
 *
 * Invitation acceptance (spec 0009, AC-10) needs a local user row for a person
 * who belongs to no agency, so the organization and membership halves do not
 * apply. Same statement the full mirror runs, so the two can never disagree
 * about what Clerk owns.
 *
 * `setWhere` keeps this from ever reviving or rewriting a scrubbed row
 * (spec 0015, AC-8): a conflict whose existing `deleted_at` is set skips the
 * update, `returning` comes back empty, and `MirrorUserDeleted` is thrown
 * rather than handing a caller ids for a person the product has erased.
 */
export async function ensureUserRow(
  user: MirrorUser,
  executor?: Executor,
): Promise<{ readonly userId: string }> {
  const db = executor ?? (await pooledDb());

  const [userRow] = await db
    .insert(users)
    .values({
      id: newId(),
      clerkUserId: user.clerkUserId,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
        updatedAt: new Date(),
      },
      setWhere: isNull(users.deletedAt),
    })
    .returning({ id: users.id });

  if (userRow === undefined) {
    throw new MirrorUserDeleted(user.clerkUserId);
  }

  return { userId: userRow.id };
}

/**
 * The organization half of the mirror on its own, upserted on `clerk_org_id`.
 *
 * Exported so the Clerk webhook (spec 0015) can run it as the first of its
 * three ordered writes, ahead of the user and membership rows it may also
 * need to create.
 *
 * `setWhere` keeps this from ever reviving or rewriting a soft deleted row,
 * the same invariant `ensureUserRow` enforces for users: `deleted_at` only
 * ever moves from null to set. `"deleted"` rather than a thrown error, because
 * unlike `MirrorUserDeleted` this can be reached from two different webhook
 * paths (an organization event and a membership event, AC-10) that answer
 * with the same refusal but do not share a catch block.
 */
export async function upsertOrganizationRow(
  org: MirrorOrganization,
  executor?: Executor,
): Promise<{ readonly orgId: string } | "deleted"> {
  const db = executor ?? (await pooledDb());
  const now = new Date();
  const slug = await freeSlug(db, org.name);

  const [orgRow] = await db
    .insert(organizations)
    .values({
      id: newId(),
      clerkOrgId: org.clerkOrgId,
      name: org.name,
      slug,
    })
    .onConflictDoUpdate({
      target: organizations.clerkOrgId,
      // The slug is not in this set on purpose. A row that already exists
      // already has a unique slug, and writing a freshly derived one would
      // reintroduce exactly the collision this repair may be healing.
      set: { name: org.name, updatedAt: now },
      setWhere: isNull(organizations.deletedAt),
    })
    .returning({ id: organizations.id });

  return orgRow === undefined ? "deleted" : { orgId: orgRow.id };
}

/**
 * The membership half of the mirror on its own, upserted on
 * `(org_id, user_id)`.
 *
 * Exported for the same reason `upsertOrganizationRow` is: the Clerk webhook
 * runs it last, after the organization and user rows it depends on exist.
 */
export async function upsertMembershipRow(
  orgId: string,
  userId: string,
  role: MembershipRole,
  executor?: Executor,
): Promise<MembershipUpsertResult> {
  const db = executor ?? (await pooledDb());

  // `xmax = 0` is PostgreSQL's tell for a row this statement inserted rather
  // than updated: a fresh row has no deleting transaction id. It is what
  // lets a caller fire `team_member.joined` for a real join and stay quiet
  // on a role change (spec 0019, AC-12).
  const [row] = await db
    .insert(memberships)
    .values({ id: newId(), orgId, userId, role })
    .onConflictDoUpdate({
      target: [memberships.orgId, memberships.userId],
      set: { role, updatedAt: new Date() },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });

  return { inserted: row?.inserted === true };
}

export type MembershipUpsertResult = {
  /** True when the row is new, false when an existing one was updated. */
  readonly inserted: boolean;
};

/** All three rows, upserted on their unique keys. Always inside a transaction. */
async function upsertMirror(
  executor: Executor,
  org: MirrorOrganization,
  user: MirrorUser,
  role: MembershipRole,
): Promise<MirrorIds> {
  const orgResult = await upsertOrganizationRow(org, executor);

  if (orgResult === "deleted") {
    // Unreachable in practice: onboarding and mirror repair only ever name an
    // organization Clerk just confirmed is live. Thrown rather than silently
    // producing a row for the wrong tenant.
    throw new Error(
      `Organization ${org.clerkOrgId} is soft deleted; provisioning refuses to write to it.`,
    );
  }

  const { userId } = await ensureUserRow(user, executor);
  await upsertMembershipRow(orgResult.orgId, userId, role, executor);

  return { orgId: orgResult.orgId, userId };
}

/**
 * An organization gone from Clerk: `deleted_at` moves from null to set and
 * never back (spec 0015, AC-6). `coalesce` makes a second delivery for an
 * already soft deleted row a no change rather than resetting the clock.
 *
 * The write is the lock (AC-12): no separate `for update` select runs first.
 */
export async function softDeleteOrganization(
  clerkOrgId: string,
  executor?: Executor,
): Promise<{ readonly orgId: string } | "not_found"> {
  const db = executor ?? (await pooledDb());

  const [orgRow] = await db
    .update(organizations)
    .set({ deletedAt: sql`coalesce(${organizations.deletedAt}, now())` })
    .where(eq(organizations.clerkOrgId, clerkOrgId))
    .returning({ id: organizations.id });

  return orgRow === undefined ? "not_found" : { orgId: orgRow.id };
}

/**
 * At least one of `orgId` or `userId` is always given; the union below makes
 * the empty case a type error rather than a documented expectation.
 */
type DeleteMembershipRowsInput =
  | { readonly orgId: string; readonly userId?: never }
  | { readonly orgId?: never; readonly userId: string }
  | { readonly orgId: string; readonly userId: string };

/**
 * Every membership row an organization delete or a user delete removes, or
 * (both fields given) the single `(org_id, user_id)` row a membership delete
 * removes (spec 0015, AC-11).
 *
 * Required alongside `softDeleteOrganization` and `scrubUser` for the same
 * reason: a soft delete is an `UPDATE`, so the `memberships` foreign key
 * cascade never fires on its own (AC-6, AC-9).
 */
export async function deleteMembershipRows(
  input: DeleteMembershipRowsInput,
  executor?: Executor,
): Promise<void> {
  const db = executor ?? (await pooledDb());

  const conditions = [
    input.orgId !== undefined ? eq(memberships.orgId, input.orgId) : undefined,
    input.userId !== undefined
      ? eq(memberships.userId, input.userId)
      : undefined,
  ].filter((condition) => condition !== undefined);

  // The type above already rules this out; kept as a runtime backstop since
  // an unqualified DELETE here would remove every tenant's membership rows.
  if (conditions.length === 0) {
    throw new Error(
      "deleteMembershipRows requires orgId, userId, or both, never neither.",
    );
  }

  await db.delete(memberships).where(and(...conditions));
}

/**
 * Every `client_contacts` row a deleted user held, handed back to "not
 * invited": `user_id` and `accepted_at` both null (spec 0015, AC-9). Every
 * other column, `email` and `name` included, is left exactly as it was, so
 * a re invitation of the same address starts from what the agency already
 * knew about that person.
 */
export async function unbindContactsOfUser(
  input: { readonly userId: string },
  executor?: Executor,
): Promise<void> {
  const db = executor ?? (await pooledDb());

  await db
    .update(clientContacts)
    .set({ userId: null, acceptedAt: null })
    .where(eq(clientContacts.userId, input.userId));
}

/**
 * Run inside the caller's transaction when there is one, otherwise open one.
 *
 * All three writes commit together or not at all, so a partial mirror is never
 * visible (AC-11). The parameter exists for the same reason it does on the
 * accessor: the tenancy tests run inside a transaction they roll back.
 */
async function inTransaction<T>(
  executor: Executor | undefined,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  if (executor !== undefined) {
    return fn(executor);
  }

  const db = await pooledDb();
  return db.transaction((tx) => fn(tx));
}

/**
 * The three rows behind a newly created agency.
 *
 * The creator is always `admin`, because agency creation asks Clerk to make
 * them `org:admin` (AC-9). Called only after Clerk has the organization, since
 * `clerk_org_id` is not null and there is no valid local row to write first.
 */
export function createAgencyRows(
  org: MirrorOrganization,
  user: MirrorUser,
  executor?: Executor,
): Promise<MirrorIds> {
  return inTransaction(executor, (tx) => upsertMirror(tx, org, user, "admin"));
}

/**
 * The same three rows, put back when staff resolution finds them missing.
 *
 * The role comes from the session's own organization role claim rather than a
 * third call to Clerk, which is what `toMembershipRole()` already exists for
 * (AC-12). Idempotent: two concurrent repairs for the same person both succeed.
 */
export function ensureMirrorRows(
  org: MirrorOrganization,
  user: MirrorUser,
  role: MembershipRole,
  executor?: Executor,
): Promise<MirrorIds> {
  return inTransaction(executor, (tx) => upsertMirror(tx, org, user, role));
}
