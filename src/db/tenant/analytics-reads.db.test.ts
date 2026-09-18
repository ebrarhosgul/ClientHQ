/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-13
 *
 * The two analytics reads, against real SQL: an agency's created_at,
 * mirrored subscription status and live team size, and a person's
 * created_at. `src/analytics/agency-group.test.ts` mocks this module to
 * prove its own shaping logic; this is the one thing that mock cannot
 * prove, that the query itself reads the right columns and counts the right
 * rows.
 *
 * Everything runs inside a transaction that is rolled back, the same shape
 * as `provisioning.db.test.ts`.
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnvFiles } from "@/lib/load-env-files";
import { newId } from "@/lib/id";

import * as schema from "../schema";
import { memberships, organizations, subscriptions, users } from "../schema";
import { agencyAnalyticsSnapshot, personCreatedAt } from "./analytics-reads";
import type { TransactionExecutor } from "./executor";
import { createAgencyRows } from "./provisioning";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

/** A Clerk id that no other run of this suite could have used. */
const clerkId = (prefix: string) =>
  `${prefix}_test_${Math.random().toString(36).slice(2, 12)}`;

async function inRollback(
  run: (tx: TransactionExecutor) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("analytics reads against real PostgreSQL", () => {
  describe("agencyAnalyticsSnapshot", () => {
    it("is undefined for an organization that does not exist", async () => {
      await inRollback(async (tx) => {
        expect(await agencyAnalyticsSnapshot(newId(), tx)).toBeUndefined();
      });
    });

    it("reads the organization's created_at, no subscription and a team of one", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Snapshot Agency" },
          {
            clerkUserId: clerkId("user"),
            email: "owner@snapshot.test",
            name: "Owner",
            imageUrl: undefined,
          },
          tx,
        );

        const [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, ids.orgId));

        const snapshot = await agencyAnalyticsSnapshot(ids.orgId, tx);

        expect(snapshot?.createdAt).toEqual(org?.createdAt);
        expect(snapshot?.subscriptionStatus).toBeUndefined();
        expect(snapshot?.teamSize).toBe(1);
      });
    });

    it("reads the mirrored subscription status once one exists", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Subscribed Agency" },
          {
            clerkUserId: clerkId("user"),
            email: "owner@subscribed.test",
            name: "Owner",
            imageUrl: undefined,
          },
          tx,
        );

        await tx.insert(subscriptions).values({
          id: newId(),
          orgId: ids.orgId,
          stripeCustomerId: clerkId("cus"),
          status: "trialing",
        });

        const snapshot = await agencyAnalyticsSnapshot(ids.orgId, tx);

        expect(snapshot?.subscriptionStatus).toBe("trialing");
      });
    });

    it("counts every membership toward team size", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Team Agency" },
          {
            clerkUserId: clerkId("user"),
            email: "owner@team.test",
            name: "Owner",
            imageUrl: undefined,
          },
          tx,
        );

        const [second] = await tx
          .insert(users)
          .values({
            id: newId(),
            clerkUserId: clerkId("user"),
            email: "second@team.test",
          })
          .returning({ id: users.id });

        await tx.insert(memberships).values({
          id: newId(),
          orgId: ids.orgId,
          userId: second?.id ?? "",
          role: "member",
        });

        const snapshot = await agencyAnalyticsSnapshot(ids.orgId, tx);

        expect(snapshot?.teamSize).toBe(2);
      });
    });
  });

  describe("personCreatedAt", () => {
    it("is undefined for a person this mirror has never held", async () => {
      await inRollback(async (tx) => {
        expect(await personCreatedAt(newId(), tx)).toBeUndefined();
      });
    });

    it("reads the user's created_at", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Person Agency" },
          {
            clerkUserId: clerkId("user"),
            email: "person@example.test",
            name: "Person",
            imageUrl: undefined,
          },
          tx,
        );

        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, ids.userId));

        expect(await personCreatedAt(ids.userId, tx)).toEqual(user?.createdAt);
      });
    });
  });
});
