/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-10
 *
 * A run that soft deletes an organization and scrubs a user necessarily
 * reads their real name, email and image URL to do it; this test proves none
 * of that ever reaches the run's report or a log line, by greping both for
 * the fixture's own distinctive name, email and image URL substrings.
 *
 * The organization pass and the user pass act on every local live row, seed
 * data included, so this runs inside one transaction that is always rolled
 * back, the same shape `src/auth/reconcile.db.test.ts` uses.
 */
import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { clerkReconcileSweep, type ClerkListGateway } from "@/auth/reconcile";
import * as schema from "@/db/schema";
import { memberships, organizations, users } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import { runDailySweeps } from "./runner";

loadEnvFiles();

// This organization and user pass act on every local live row in the shared
// database, real seeded rows included: real, remote round trips for however
// many exist, all inside one transaction that rolls back. Slow by nature.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const NOW = new Date("2026-06-15T03:00:00Z");
const ROLLBACK = new Error("rollback");

function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Everything in `run` happens inside one transaction that always rolls back:
 * the reconcile's soft delete and scrub steps act on every local live row,
 * seed data included, and only a transaction that never commits makes that
 * safe to exercise for real.
 */
async function inRollback(run: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await run(tx as unknown as Database);
      throw ROLLBACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLBACK) {
      throw thrown;
    }
  }
}

async function makeOrg(
  tx: Database,
): Promise<{ readonly orgId: string; readonly clerkOrgId: string }> {
  const orgId = newId();
  const unique = tag();
  const clerkOrgId = `org_${unique}`;

  await tx.insert(organizations).values({
    id: orgId,
    clerkOrgId,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
  });

  return { orgId, clerkOrgId };
}

const REAL_NAME = "Priya Northwind Almasi";
const REAL_EMAIL = "priya.almasi@northwind-agency.test";
const REAL_IMAGE_URL = "https://img.clerk.com/priya-almasi-headshot.png";

async function makeUser(
  tx: Database,
): Promise<{ readonly userId: string; readonly clerkUserId: string }> {
  const userId = newId();
  const clerkUserId = `user_${tag()}`;

  await tx.insert(users).values({
    id: userId,
    clerkUserId,
    email: REAL_EMAIL,
    name: REAL_NAME,
    imageUrl: REAL_IMAGE_URL,
  });

  return { userId, clerkUserId };
}

function emptyGateway(): ClerkListGateway {
  return {
    listOrganizations: async function* () {},
    listOrganizationMemberships: () => (async function* () {})(),
    listUsers: async function* () {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)(
  "a run that soft deletes and scrubs, against real PostgreSQL",
  () => {
    it("carries no email, name or image URL in its report or its log lines (AC-10)", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await inRollback(async (tx) => {
        const { orgId } = await makeOrg(tx);
        const { userId } = await makeUser(tx);
        await tx
          .insert(memberships)
          .values({ id: newId(), orgId, userId, role: "member" });

        // Nothing listed at all: the live organization and the live user
        // this test just created, real seed rows included, are all absent
        // from a listing that still completes, so both the soft delete and
        // the scrub actually run.
        const result = await runDailySweeps({
          db: tx,
          sweeps: [clerkReconcileSweep(emptyGateway())],
          now: NOW,
        });

        expect(result.sweeps[0]).toMatchObject({ name: "clerk_reconcile" });
        expect(
          result.sweeps[0]?.counts?.organizations_soft_deleted,
        ).toBeGreaterThanOrEqual(1);
        expect(result.sweeps[0]?.counts?.users_scrubbed).toBeGreaterThanOrEqual(
          1,
        );
        // Otherwise the assertions below would pass vacuously on an empty set.
        expect(warn.mock.calls.length).toBeGreaterThan(0);

        const haystacks = [
          JSON.stringify(result.sweeps),
          ...log.mock.calls.map((call) => String(call[0])),
          ...warn.mock.calls.map((call) => String(call[0])),
        ];

        for (const haystack of haystacks) {
          expect(haystack).not.toContain("@");
          expect(haystack).not.toContain(REAL_NAME);
          expect(haystack).not.toContain(REAL_EMAIL);
          expect(haystack).not.toContain(REAL_IMAGE_URL);
          expect(haystack.toLowerCase()).not.toContain("http");
        }
      });
    });
  },
);
