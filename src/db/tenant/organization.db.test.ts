/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-14, AC-15; spec 0013 AC-2
 *
 * `agencyProfile`, against real SQL. The same shape as
 * `provisioning.db.test.ts`: everything runs inside a transaction that is
 * rolled back, and the suite is skipped when `DIRECT_URL` is not set.
 *
 * What is worth a database rather than a mock here is `deleted_at is null`:
 * the one predicate this reader carries, and the one that has to keep matching
 * `resolveStaffContext`'s own filter (AC-14) so a soft deleted agency's name
 * cannot be read back after resolution has already stopped returning it. Spec
 * 0013 widened the parameter from `StaffContext` to `TenantContext` so a
 * client contact's invoice PDF can read the agency name too; both context
 * kinds carry the same `orgId`, which is proven with a contact context below.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import * as schema from "../schema";
import { organizations } from "../schema";
import type { ContactContext, StaffContext } from "./context";
import type { TransactionExecutor } from "./executor";
import {
  agencyProfile,
  agencySettings,
  deletedOrganizationClerkIds,
} from "./organization";

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

function contactContext(orgId: string): ContactContext {
  return {
    kind: "contact",
    orgId,
    userId: "irrelevant-to-this-reader",
    clerkUserId: "irrelevant-to-this-reader",
    clientId: "irrelevant-to-this-reader",
    contactId: "irrelevant-to-this-reader",
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

  it("reads back the same row for a client contact's context (spec 0013, AC-2)", async () => {
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

      await expect(agencyProfile(contactContext(org.id), tx)).resolves.toEqual({
        id: org.id,
        name: "Northwind",
        slug: "northwind",
        defaultCurrency: "USD",
      });
    });
  });
});

describe.skipIf(!url)(
  "deletedOrganizationClerkIds against real PostgreSQL",
  () => {
    it(
      "names only the soft deleted org, not a live one or one with no local " +
        "row at all (AC-14)",
      async () => {
        await inRollback(async (tx) => {
          const liveClerkId = clerkId("org");
          const deletedClerkId = clerkId("org");
          const unprovisionedClerkId = clerkId("org");

          await tx.insert(organizations).values([
            {
              id: newId(),
              clerkOrgId: liveClerkId,
              name: "Live Agency",
              slug: "live-agency",
            },
            {
              id: newId(),
              clerkOrgId: deletedClerkId,
              name: "Doomed Agency",
              slug: "doomed-agency",
              deletedAt: new Date(),
            },
          ]);

          await expect(
            deletedOrganizationClerkIds(
              [liveClerkId, deletedClerkId, unprovisionedClerkId],
              tx,
            ),
          ).resolves.toEqual(new Set([deletedClerkId]));
        });
      },
    );

    it("returns nothing for an empty list without querying", async () => {
      await inRollback(async (tx) => {
        await expect(deletedOrganizationClerkIds([], tx)).resolves.toEqual(
          new Set(),
        );
      });
    });
  },
);

describe.skipIf(!url)("agencySettings against real PostgreSQL", () => {
  it("reads the business profile, with an unset column as undefined", async () => {
    // A random slug: the dev database may already hold the seeded agency's.
    const slug = clerkId("profile");

    await inRollback(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Profile Test Agency",
          slug,
          taxId: "US-9482019",
          addressLine1: "500 Howard Street",
          city: "San Francisco",
        })
        .returning();

      if (org === undefined) {
        throw new Error("insert did not return a row");
      }

      await expect(agencySettings(staffContext(org.id), tx)).resolves.toEqual({
        id: org.id,
        name: "Profile Test Agency",
        slug,
        defaultCurrency: "USD",
        description: undefined,
        taxId: "US-9482019",
        addressLine1: "500 Howard Street",
        addressLine2: undefined,
        city: "San Francisco",
        region: undefined,
        postalCode: undefined,
        country: undefined,
      });
    });
  });

  it("resolves as undefined for a soft deleted organization", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Doomed Agency",
          slug: clerkId("doomed"),
          deletedAt: new Date(),
        })
        .returning();

      if (org === undefined) {
        throw new Error("insert did not return a row");
      }

      await expect(
        agencySettings(staffContext(org.id), tx),
      ).resolves.toBeUndefined();
    });
  });
});
