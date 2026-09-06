import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/db/schema";
import { users } from "@/db/schema";

/**
 * Erasing a person without breaking the rows that point at them.
 *
 * A deleted user is soft deleted: `deleted_at` is set and the personal fields
 * are overwritten in place, so `deliverables.uploaded_by_user_id` (which
 * RESTRICTs deletes) and memberships still resolve. Spec 0002, Value sourcing.
 */

/** The Drizzle handle, or a transaction. Callers pass it in explicitly. */
export type ScrubHandle = PgDatabase<PgQueryResultHKT, typeof schema>;

export type ScrubbedUserFields = {
  readonly email: string;
  readonly name: string;
  readonly imageUrl: undefined;
  readonly deletedAt: Date;
};

/**
 * The replacement values, as a pure function so they can be tested without a
 * database. `.invalid` is reserved by RFC 2606 and can never route anywhere,
 * and `users.email` is not unique, so the placeholder cannot collide.
 */
export function scrubbedUserFields(
  userId: string,
  now: Date = new Date(),
): ScrubbedUserFields {
  return {
    email: `deleted+${userId}@invalid`,
    name: "Deleted user",
    imageUrl: undefined,
    deletedAt: now,
  };
}

export type ScrubUserResult =
  | { readonly ok: true; readonly user: typeof users.$inferSelect }
  | { readonly ok: false; readonly reason: "not_found" };

/**
 * Soft delete and scrub one user. Returns the row as it now stands, or
 * `not_found` when no user has that id.
 */
export async function scrubUser(
  handle: ScrubHandle,
  userId: string,
  now: Date = new Date(),
): Promise<ScrubUserResult> {
  const fields = scrubbedUserFields(userId, now);

  const [user] = await handle
    .update(users)
    .set({
      email: fields.email,
      name: fields.name,
      // Drizzle writes SQL NULL for `null`; the project avoids `null` in its
      // own types, so this is the one place it appears.
      imageUrl: null,
      deletedAt: fields.deletedAt,
    })
    .where(eq(users.id, userId))
    .returning();

  return user === undefined
    ? { ok: false, reason: "not_found" }
    : { ok: true, user };
}
