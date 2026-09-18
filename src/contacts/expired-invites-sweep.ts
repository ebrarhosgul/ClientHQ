/**
 * `expired_invites`, the third nightly sweep (spec 0017, AC-6).
 *
 * A month past its own expiry, an invitation token is a stale credential
 * nobody is going to redeem. Clearing both columns in one statement is what
 * lets `sendInvitation` invite the same contact again as if it had never
 * happened; nothing else on the row changes.
 */
import { and, isNotNull, lt } from "drizzle-orm";

import { clientContacts } from "@/db/schema";

import type { Sweep, SweepInput, SweepReport } from "@/cron/sweep";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function run({ db, now }: SweepInput): Promise<SweepReport> {
  const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS);

  const cleared = await db
    .update(clientContacts)
    .set({ inviteTokenHash: null, inviteExpiresAt: null })
    .where(
      and(
        isNotNull(clientContacts.inviteTokenHash),
        lt(clientContacts.inviteExpiresAt, cutoff),
      ),
    )
    .returning({ id: clientContacts.id });

  return { outcome: "ok", counts: { cleared: cleared.length } };
}

export const expiredInvitesSweep: Sweep = {
  name: "expired_invites",
  run,
};
