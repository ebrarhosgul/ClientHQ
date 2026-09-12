/**
 * The read behind the Contacts section on `/clients/[id]` (spec 0009, AC-14).
 *
 * Scoped through `tenantDb(ctx)` like every other read (AC-13). The status is
 * derived here at read time from the row and the clock, never stored.
 */
import { asc, eq } from "drizzle-orm";

import { clientContacts } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

import { contactStatus, type ContactStatus } from "./status";

export type ContactRow = typeof clientContacts.$inferSelect;

/** One contact as the section shows it. */
export type ContactSummary = {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly email: string;
  readonly status: ContactStatus;
  readonly inviteExpiresAt: Date | null;
  readonly invitedAt: Date | null;
  /**
   * The inviter's name, falling back to their email, or `undefined` when the
   * inviting user's row is gone (the line then reads "Invited on ...").
   */
  readonly invitedByName: string | undefined;
  readonly acceptedAt: Date | null;
};

export async function listContacts(
  ctx: StaffContext,
  clientId: string,
  now: Date = new Date(),
): Promise<readonly ContactSummary[]> {
  const rows = await tenantDb(ctx).findMany(clientContacts, {
    where: eq(clientContacts.clientId, clientId),
    orderBy: [asc(clientContacts.name), asc(clientContacts.id)],
    with: { invitedBy: { columns: { name: true, email: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    email: row.email,
    status: contactStatus(row, now),
    inviteExpiresAt: row.inviteExpiresAt,
    invitedAt: row.invitedAt,
    invitedByName:
      row.invitedBy === null
        ? undefined
        : (row.invitedBy.name ?? row.invitedBy.email),
    acceptedAt: row.acceptedAt,
  }));
}
