/**
 * @vitest-environment node
 *
 * covers: security audit finding #3 (the team last-admin check is a
 * non-atomic check-then-act race, `docs/specs/0015-team-members-and-roles/`)
 *
 * `withTenantAction`'s `lockOrg` option against real PostgreSQL. The team
 * actions that opt into it (`changeTeamMemberRole`, `removeTeamMember`) read
 * Clerk's membership list, decide, then write back to Clerk, an external
 * system with no compare-and-swap of its own. Two concurrent calls for the
 * same organization can each read the same stale snapshot and both proceed,
 * which is exactly the race this lock closes.
 *
 * This runs the literal statement `action.ts` issues
 * (`pg_advisory_xact_lock(hashtextextended(...))`) across two genuinely
 * separate connections, so it proves the primitive itself serializes
 * concurrent transactions through the Supabase pooler, not merely that the
 * code calls some lock function. `transaction.db.test.ts` already proves
 * `tenantTransaction` rolls back correctly on real Postgres; this file is the
 * concurrency half that a single, always-rolled-back transaction cannot
 * exercise.
 *
 * The second connection is only started once the first has *confirmed* it
 * holds the lock (a real signal, not a fixed sleep), because opening a fresh
 * connection to Supabase pays a TLS handshake whose latency varies enough to
 * make a timeout-based race flaky in either direction. Skipped when
 * `DIRECT_URL` is not set, like the other database suites.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

loadEnvFiles();

const url = process.env.DIRECT_URL;

const connA = postgres(url ?? "", { prepare: false, max: 1 });
const connB = postgres(url ?? "", { prepare: false, max: 1 });

beforeAll(async () => {
  if (url === undefined) return;

  // Pay each connection's TLS handshake up front, outside the timed race.
  await connA`select 1`;
  await connB`select 1`;
});

afterAll(async () => {
  await connA.end();
  await connB.end();
});

/** The exact statement `src/db/tenant/action.ts` issues for `lockOrg`. */
async function acquireOrgLock(
  sql: postgres.TransactionSql,
  orgId: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`;
}

describe.skipIf(!url)(
  "the lockOrg advisory lock against real PostgreSQL",
  () => {
    it("blocks a second transaction for the same org until the first commits", async () => {
      const orgId = newId();
      const events: string[] = [];
      let firstReleased = false;
      let resolveAcquired: () => void;
      const acquired = new Promise<void>((resolve) => {
        resolveAcquired = resolve;
      });

      const first = connA.begin(async (tx) => {
        await acquireOrgLock(tx, orgId);
        events.push("first: lock acquired");
        resolveAcquired();

        // Simulate the slow external call (Clerk) the real handler makes
        // while holding this lock.
        await new Promise((resolve) => setTimeout(resolve, 300));

        firstReleased = true;
        events.push("first: about to commit");
      });

      // Only start the second transaction once the first has *confirmed* it
      // holds the lock, not after a guessed delay.
      await acquired;

      const second = connB.begin(async (tx) => {
        events.push("second: requesting lock");
        await acquireOrgLock(tx, orgId);

        // If the lock did not block, this assertion catches it immediately:
        // the second transaction must never observe the lock as available
        // before the first one released it.
        expect(firstReleased).toBe(true);
        events.push("second: lock acquired");
      });

      await Promise.all([first, second]);

      expect(events).toEqual([
        "first: lock acquired",
        "second: requesting lock",
        "first: about to commit",
        "second: lock acquired",
      ]);
    });

    it("never blocks two different organizations on each other", async () => {
      const orgA = newId();
      const orgB = newId();
      const events: string[] = [];
      let resolveAcquired: () => void;
      const acquired = new Promise<void>((resolve) => {
        resolveAcquired = resolve;
      });

      const first = connA.begin(async (tx) => {
        await acquireOrgLock(tx, orgA);
        events.push("A: lock acquired");
        resolveAcquired();
        await new Promise((resolve) => setTimeout(resolve, 300));
        events.push("A: about to commit");
      });

      await acquired;

      const second = connB.begin(async (tx) => {
        await acquireOrgLock(tx, orgB);
        // Reaching this line while A still holds its own lock proves the two
        // organizations' locks are independent.
        events.push("B: lock acquired while A still holds its own");
      });

      await Promise.all([first, second]);

      expect(events).toEqual([
        "A: lock acquired",
        "B: lock acquired while A still holds its own",
        "A: about to commit",
      ]);
    });
  },
);
