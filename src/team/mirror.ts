/**
 * The write through to the local mirror after Clerk has confirmed a change
 * (spec 0015, AC-5, AC-6, AC-10).
 *
 * Only the one `memberships` row scoped to the acting organization is ever
 * touched: updated on a role change, hard deleted on a removal. The `users`
 * row is shared across every agency the person belongs to, and
 * `memberships.user_id` cascades on its deletion, so it is never written
 * here. A person who has never visited has no mirror row, and that is fine:
 * there is nothing to keep in step until spec 0005's repair path creates it.
 *
 * Reads go through `tenantDb(ctx)` like every other read, which scopes them
 * to `org_id`; the Clerk user id is matched in code because the relational
 * `where` applies to `memberships` alone and a team is small.
 */
import { memberships } from "@/db/schema";
import type { MembershipRole } from "@/db/schema";
import type { StaffAccessor } from "@/db/tenant";

async function mirrorMembershipId(
  db: StaffAccessor,
  clerkUserId: string,
): Promise<string | undefined> {
  const rows = await db.findMany(memberships, {
    with: { user: { columns: { clerkUserId: true } } },
  });

  return rows.find((row) => row.user.clerkUserId === clerkUserId)?.id;
}

/** Set the mirror's role for this Clerk user, when a row exists. */
export async function updateMirrorRole(
  db: StaffAccessor,
  clerkUserId: string,
  role: MembershipRole,
): Promise<void> {
  const id = await mirrorMembershipId(db, clerkUserId);

  if (id !== undefined) {
    await db.update(memberships, id, { role });
  }
}

/** Delete the mirror's membership row for this Clerk user, when one exists. */
export async function deleteMirrorMembership(
  db: StaffAccessor,
  clerkUserId: string,
): Promise<void> {
  const id = await mirrorMembershipId(db, clerkUserId);

  if (id !== undefined) {
    await db.delete(memberships, id);
  }
}
