/**
 * The mirror rows, written by name.
 *
 * Feature 6 is the first thing in the product that writes `organizations`,
 * `users` and `memberships`, and none of the three is tenant scoped, so
 * `tenantDb()` cannot express these writes: `organizations` *is* the tenant and
 * the other two carry no `org_id`. Rather than open the unscoped door for it,
 * this file offers exactly two named functions that touch exactly those three
 * tables and nothing else, inside the layer, so `withSystemAccess` stays limited
 * to the three callers spec 0003 fixed and neither ESLint exemption list grows
 * (spec 0005, AC-17).
 *
 * Clerk is authoritative for every column written here. That is why every
 * statement is an `onConflictDoUpdate` on its own unique key rather than an
 * insert that can fail: two concurrent repairs both succeed and leave one row in
 * each table (AC-13), and feature 17's webhook will need the same behaviour when
 * it becomes the second writer.
 *
 * `deleted_at` is deliberately absent from every `set` clause. Spec 0005 makes
 * it read only here: staff resolution treats a soft deleted organization as
 * missing (AC-14), and reviving one is a decision for the Clerk webhook that set
 * it, not for a repair that is only trying to fill in a name.
 */
import { eq, like, or } from "drizzle-orm";

import { uniqueSlug, toSlug } from "@/auth/slug";
import { newId } from "@/lib/id";

import type { MembershipRole } from "../schema";
import { memberships, organizations, users } from "../schema";
import { pooledDb, type Executor } from "./executor";

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
    })
    .returning({ id: users.id });

  if (userRow === undefined) {
    throw new Error("Provisioning wrote no user row.");
  }

  return { userId: userRow.id };
}

/** All three rows, upserted on their unique keys. Always inside a transaction. */
async function upsertMirror(
  executor: Executor,
  org: MirrorOrganization,
  user: MirrorUser,
  role: MembershipRole,
): Promise<MirrorIds> {
  const now = new Date();
  const slug = await freeSlug(executor, org.name);

  const [orgRow] = await executor
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
    })
    .returning({ id: organizations.id });

  const userRow = await ensureUserRow(user, executor);

  if (orgRow === undefined) {
    throw new Error("Provisioning wrote no organization row.");
  }

  await executor
    .insert(memberships)
    .values({
      id: newId(),
      orgId: orgRow.id,
      userId: userRow.userId,
      role,
    })
    .onConflictDoUpdate({
      target: [memberships.orgId, memberships.userId],
      set: { role, updatedAt: now },
    });

  return { orgId: orgRow.id, userId: userRow.userId };
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
