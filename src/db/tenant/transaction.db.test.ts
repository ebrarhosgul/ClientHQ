/**
 * @vitest-environment node
 *
 * covers: spec 0012 AC-5, AC-14
 *
 * `tenantTransaction` against real PostgreSQL: a throw inside rolls every
 * write back, including the invoice counter; the accessor it hands over
 * carries the same tenant predicates as the pooled one; and
 * `nextInvoiceNumber` hands out consecutive numbers and never another
 * agency's. Skipped when `DIRECT_URL` is not set, like the other database
 * suites.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { clients, invoices, organizations } from "@/db/schema";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import type { StaffContext } from "./context";
import type { TransactionExecutor } from "./executor";

const state = vi.hoisted(() => ({ tx: undefined as unknown }));

vi.mock("./executor", () => ({ pooledDb: async () => state.tx }));

const { tenantTransaction } = await import("./transaction");
const { nextInvoiceNumber } = await import("./organization");

loadEnvFiles();

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

type Fixture = {
  readonly orgA: string;
  readonly orgB: string;
  readonly clientA: string;
  readonly clientB: string;
};

async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId();
  const ids = {
    orgA: newId(),
    orgB: newId(),
    clientA: newId(),
    clientB: newId(),
  };

  await tx.insert(organizations).values([
    { id: ids.orgA, clerkOrgId: `org_${tag}_a`, name: "A", slug: `a-${tag}` },
    {
      id: ids.orgB,
      clerkOrgId: `org_${tag}_b`,
      name: "B",
      slug: `b-${tag}`,
      nextInvoiceNumber: 41,
    },
  ]);
  await tx.insert(clients).values([
    { id: ids.clientA, orgId: ids.orgA, name: "Client A" },
    { id: ids.clientB, orgId: ids.orgB, name: "Client B" },
  ]);

  return ids;
}

function staffOf(fixture: Fixture, org: "A" | "B"): StaffContext {
  return {
    kind: "staff",
    orgId: org === "A" ? fixture.orgA : fixture.orgB,
    clerkOrgId: "org",
    userId: newId(),
    clerkUserId: "user",
    role: "admin",
  };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      state.tx = tx;
      const fixture = await seed(tx);
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

async function counterOf(tx: TransactionExecutor, orgId: string) {
  const [row] = await tx
    .select({ next: organizations.nextInvoiceNumber })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  return row?.next;
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("tenantTransaction against real PostgreSQL", () => {
  it("rolls back every write, the counter included, when the callback throws", async () => {
    await inRollback(async (tx, fixture) => {
      const ctx = staffOf(fixture, "A");

      await expect(
        tenantTransaction(ctx, async (scope) => {
          await scope.db.insert(invoices, {
            clientId: fixture.clientA,
            currency: "USD",
          });
          await scope.nextInvoiceNumber();
          throw new Error("refused");
        }),
      ).rejects.toThrow("refused");

      const rows = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.orgId, fixture.orgA));
      expect(rows).toHaveLength(0);
      expect(await counterOf(tx, fixture.orgA)).toBe(1);
    });
  });

  it("commits the writes and returns the callback's value otherwise", async () => {
    await inRollback(async (tx, fixture) => {
      const ctx = staffOf(fixture, "A");

      const number = await tenantTransaction(ctx, async (scope) => {
        await scope.db.insert(invoices, {
          clientId: fixture.clientA,
          currency: "USD",
        });

        return scope.nextInvoiceNumber();
      });

      expect(number).toBe(1);
      expect(await counterOf(tx, fixture.orgA)).toBe(2);
      expect(
        await tx
          .select()
          .from(invoices)
          .where(eq(invoices.orgId, fixture.orgA)),
      ).toHaveLength(1);
    });
  });

  it("hands over an accessor scoped to the same organization as the pooled one", async () => {
    await inRollback(async (tx, fixture) => {
      const [foreign] = await tx
        .insert(invoices)
        .values({
          id: newId(),
          orgId: fixture.orgB,
          clientId: fixture.clientB,
          currency: "USD",
        })
        .returning();

      await tenantTransaction(staffOf(fixture, "A"), async (scope) => {
        expect(await scope.db.findById(invoices, foreign.id)).toBeUndefined();
        expect(
          await scope.db.update(invoices, foreign.id, { notes: "leak" }),
        ).toBeUndefined();
      });

      const [after] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, foreign.id));
      expect(after.notes).toBeNull();
    });
  });

  it("numbers each agency from its own counter, consecutively", async () => {
    await inRollback(async (tx, fixture) => {
      expect(await nextInvoiceNumber(staffOf(fixture, "A"), tx)).toBe(1);
      expect(await nextInvoiceNumber(staffOf(fixture, "A"), tx)).toBe(2);
      expect(await nextInvoiceNumber(staffOf(fixture, "B"), tx)).toBe(41);
      expect(await counterOf(tx, fixture.orgA)).toBe(3);
      expect(await counterOf(tx, fixture.orgB)).toBe(42);
    });
  });
});
