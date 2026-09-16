/**
 * @vitest-environment node
 *
 * covers: spec 0012 AC-15, AC-18
 *
 * The `invoice_events` CHECKs against real PostgreSQL: a status kind must
 * carry both statuses and a notification kind must carry neither, so a row can
 * never claim a move it does not name. Every case runs inside a transaction
 * that is rolled back afterwards.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import * as schema from "./schema";
import { clients, invoiceEvents, invoices, organizations } from "./schema";
import type { TransactionExecutor } from "./tenant";

loadEnvFiles();

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

type Fixture = { readonly orgId: string; readonly invoiceId: string };

async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId();
  const orgId = newId();
  const clientId = newId();
  const invoiceId = newId();

  await tx.insert(organizations).values({
    id: orgId,
    clerkOrgId: `org_${tag}`,
    name: "Agency",
    slug: `agency-${tag}`,
  });
  await tx.insert(clients).values({ id: clientId, orgId, name: "Client" });
  await tx
    .insert(invoices)
    .values({ id: invoiceId, orgId, clientId, currency: "USD" });

  return { orgId, invoiceId };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
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

/**
 * A CHECK violation. Drizzle wraps the driver's error, so the SQLSTATE sits on
 * `cause`; the wrapper itself is checked too in case that ever changes.
 */
function isCheckViolation(error: unknown): boolean {
  const codeOf = (value: unknown): unknown =>
    value instanceof Error && "code" in value
      ? (value as { code: unknown }).code
      : undefined;

  return (
    codeOf(error) === "23514" ||
    (error instanceof Error && codeOf(error.cause) === "23514")
  );
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("invoice_events against real PostgreSQL", () => {
  it("accepts a status kind with both statuses and a notification kind with neither", async () => {
    await inRollback(async (tx, { orgId, invoiceId }) => {
      await expect(
        tx.insert(invoiceEvents).values([
          {
            id: newId(),
            orgId,
            invoiceId,
            kind: "issued",
            fromStatus: "draft",
            toStatus: "sent",
          },
          {
            id: newId(),
            orgId,
            invoiceId,
            kind: "notified",
            note: "delivered: a@example.test",
          },
        ]),
      ).resolves.toBeDefined();
    });
  });

  it("refuses a notified row that carries statuses", async () => {
    await inRollback(async (tx, { orgId, invoiceId }) => {
      await expect(
        tx.insert(invoiceEvents).values({
          id: newId(),
          orgId,
          invoiceId,
          kind: "notified",
          fromStatus: "draft",
          toStatus: "sent",
        }),
      ).rejects.toSatisfy(isCheckViolation);
    });
  });

  it("refuses an issued row without statuses", async () => {
    await inRollback(async (tx, { orgId, invoiceId }) => {
      await expect(
        tx.insert(invoiceEvents).values({
          id: newId(),
          orgId,
          invoiceId,
          kind: "issued",
        }),
      ).rejects.toSatisfy(isCheckViolation);
    });
  });

  it("refuses a status row with only one of the two statuses", async () => {
    await inRollback(async (tx, { orgId, invoiceId }) => {
      await expect(
        tx.insert(invoiceEvents).values({
          id: newId(),
          orgId,
          invoiceId,
          kind: "paid",
          toStatus: "paid",
        }),
      ).rejects.toSatisfy(isCheckViolation);
    });
  });

  it("refuses a kind the schema does not name", async () => {
    await inRollback(async (tx, { orgId, invoiceId }) => {
      await expect(
        tx.insert(invoiceEvents).values({
          id: newId(),
          orgId,
          invoiceId,
          // The enum is a TypeScript type; the CHECK is what holds at runtime.
          kind: "reminded" as never,
        }),
      ).rejects.toSatisfy(isCheckViolation);
    });
  });
});
