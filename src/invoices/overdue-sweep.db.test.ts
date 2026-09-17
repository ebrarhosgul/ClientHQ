/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-4, AC-12
 *
 * The overdue sweep against real PostgreSQL: the compare and set, the one
 * event per moved invoice in the same transaction, the untouched cases, and
 * that a second run the same day writes nothing. `revalidatePath` is faked;
 * the paths it is called with are not this file's concern.
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  invoiceEvents,
  invoices,
  clients,
  organizations,
  type InvoiceStatus,
} from "@/db/schema";
import type { Database } from "@/db/tenant";
import { addDaysUtc, todayUtc } from "@/lib/dates";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { overdueInvoicesSweep } = await import("./overdue-sweep");

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const TODAY = todayUtc();
const YESTERDAY = addDaysUtc(TODAY, -1);
const TOMORROW = addDaysUtc(TODAY, 1);

const createdOrgs: string[] = [];

function tag(): string {
  return newId().replace(/-/g, "").slice(0, 12);
}

async function makeOrg(): Promise<string> {
  const id = newId();
  const unique = tag();

  await db.insert(organizations).values({
    id,
    clerkOrgId: `org_${unique}`,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
  });

  createdOrgs.push(id);

  return id;
}

async function makeClient(orgId: string): Promise<string> {
  const id = newId();

  await db.insert(clients).values({ id, orgId, name: "A client" });

  return id;
}

async function makeInvoice(patch: {
  readonly orgId: string;
  readonly clientId: string;
  readonly status: InvoiceStatus;
  readonly dueDate: string | null;
}): Promise<string> {
  const id = newId();

  await db.insert(invoices).values({
    id,
    orgId: patch.orgId,
    clientId: patch.clientId,
    status: patch.status,
    dueDate: patch.dueDate,
    currency: "USD",
    // The `invoices_paid_at_check` CHECK requires exactly one of `status =
    // 'paid'` and `paid_at is not null`.
    paidAt: patch.status === "paid" ? new Date() : undefined,
  });

  return id;
}

async function statusOf(id: string): Promise<InvoiceStatus> {
  const [row] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, id));

  return row.status;
}

async function eventsFor(invoiceId: string) {
  return db
    .select()
    .from(invoiceEvents)
    .where(
      and(
        eq(invoiceEvents.invoiceId, invoiceId),
        eq(invoiceEvents.kind, "overdue"),
      ),
    );
}

/**
 * Runs after every test, not just at the end: the sweep queries across every
 * organization with no scoping, so a fixture left behind by an earlier test
 * (invoices in `sent` with a past due date) would get swept by a later
 * test's own call and throw its counts off.
 *
 * `invoices.org_id` and `invoice_events.org_id` are RESTRICT, not CASCADE
 * (spec 0002), so the child rows come out before the organization.
 */
afterEach(async () => {
  if (createdOrgs.length === 0) {
    return;
  }

  await db
    .delete(invoiceEvents)
    .where(inArray(invoiceEvents.orgId, createdOrgs));
  await db.delete(invoices).where(inArray(invoices.orgId, createdOrgs));
  await db.delete(clients).where(inArray(clients.orgId, createdOrgs));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgs));

  createdOrgs.length = 0;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("overdue_invoices against real PostgreSQL", () => {
  it("moves a sent invoice past its due date, with one null-actor event, and leaves the others alone", async () => {
    const orgId = await makeOrg();
    const clientId = await makeClient(orgId);

    const pastDue = await makeInvoice({
      orgId,
      clientId,
      status: "sent",
      dueDate: YESTERDAY,
    });
    const dueToday = await makeInvoice({
      orgId,
      clientId,
      status: "sent",
      dueDate: TODAY,
    });
    const draft = await makeInvoice({
      orgId,
      clientId,
      status: "draft",
      dueDate: YESTERDAY,
    });
    const paid = await makeInvoice({
      orgId,
      clientId,
      status: "paid",
      dueDate: YESTERDAY,
    });
    const voided = await makeInvoice({
      orgId,
      clientId,
      status: "void",
      dueDate: YESTERDAY,
    });

    const report = await overdueInvoicesSweep.run({
      db,
      todayUtc: TODAY,
      now: new Date(),
    });

    expect(report.outcome).toBe("ok");
    expect(report.counts?.moved).toBe(1);

    expect(await statusOf(pastDue)).toBe("overdue");
    expect(await statusOf(dueToday)).toBe("sent");
    expect(await statusOf(draft)).toBe("draft");
    expect(await statusOf(paid)).toBe("paid");
    expect(await statusOf(voided)).toBe("void");

    const events = await eventsFor(pastDue);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "overdue",
      fromStatus: "sent",
      toStatus: "overdue",
      actorUserId: null,
    });

    expect(await eventsFor(dueToday)).toHaveLength(0);
  });

  it("writes nothing on a second run the same day (AC-12)", async () => {
    const orgId = await makeOrg();
    const clientId = await makeClient(orgId);
    const pastDue = await makeInvoice({
      orgId,
      clientId,
      status: "sent",
      dueDate: YESTERDAY,
    });

    const first = await overdueInvoicesSweep.run({
      db,
      todayUtc: TODAY,
      now: new Date(),
    });
    expect(first.counts?.moved).toBe(1);

    const second = await overdueInvoicesSweep.run({
      db,
      todayUtc: TODAY,
      now: new Date(),
    });

    expect(second.outcome).toBe("ok");
    expect(second.counts?.moved).toBe(0);
    expect(await statusOf(pastDue)).toBe("overdue");
    expect(await eventsFor(pastDue)).toHaveLength(1);
  });

  it("leaves a future due date sent invoice untouched even a day before it moves", async () => {
    const orgId = await makeOrg();
    const clientId = await makeClient(orgId);
    const future = await makeInvoice({
      orgId,
      clientId,
      status: "sent",
      dueDate: TOMORROW,
    });

    const report = await overdueInvoicesSweep.run({
      db,
      todayUtc: TODAY,
      now: new Date(),
    });

    expect(report.counts?.moved).toBe(0);
    expect(await statusOf(future)).toBe("sent");
  });
});
