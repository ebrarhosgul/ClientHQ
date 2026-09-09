/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-14, AC-15
 *
 * `agencyProfile`, against real SQL. The same shape as
 * `provisioning.db.test.ts`: everything runs inside a transaction that is
 * rolled back, and the suite is skipped when `DIRECT_URL` is not set.
 *
 * What is worth a database rather than a mock here is `deleted_at is null`:
 * the one predicate this reader carries, and the one that has to keep matching
 * `resolveStaffContext`'s own filter (AC-14) so a soft deleted agency's name
 * cannot be read back after resolution has already stopped returning it.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import * as schema from "../schema";
import { organizations } from "../schema";
import type { StaffContext } from "./context";
import type { TransactionExecutor } from "./executor";
import { agencyProfile } from "./organization";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

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

function staffContext(orgId: string): StaffContext {
  return {
    kind: "staff",
    orgId,
    clerkOrgId: clerkId("org"),
    userId: "irrelevant-to-this-reader",
    clerkUserId: "irrelevant-to-this-reader",
    role: "admin",
  };
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("agencyProfile against real PostgreSQL", () => {
  it("reads back the caller's own row (AC-15)", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Northwind",
          slug: "northwind",
        })
        .returning();

      if (org === undefined) {
        throw new Error("insert did not return a row");
      }

      await expect(agencyProfile(staffContext(org.id), tx)).resolves.toEqual({
        id: org.id,
        name: "Northwind",
        slug: "northwind",
        defaultCurrency: "USD",
      });
    });
  });

  it("resolves as undefined for a soft deleted organization (AC-14)", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Doomed Agency",
          slug: "doomed-agency",
          deletedAt: new Date(),
        })
        .returning();

      if (org === undefined) {
        throw new Error("insert did not return a row");
      }

      await expect(
        agencyProfile(staffContext(org.id), tx),
      ).resolves.toBeUndefined();
    });
  });

  it("resolves as undefined for an id no organization has", async () => {
    await inRollback(async (tx) => {
      await expect(
        agencyProfile(staffContext("00000000-0000-0000-0000-000000000000"), tx),
      ).resolves.toBeUndefined();
    });
  });
});
