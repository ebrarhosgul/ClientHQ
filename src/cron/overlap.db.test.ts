/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-12
 *
 * Two runs of the runner started against the same database at once (a manual
 * call landing while the schedule fires): each sweep is idempotent by
 * construction, so the pair leaves two `cron_runs` rows and the same end
 * state as one run would, with no thrown error from either. `revalidatePath`
 * is faked; the paths it is called with are not this file's concern.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clients,
  cronRuns,
  deliverables,
  invoiceEvents,
  invoices,
  organizations,
  projects,
  users,
} from "@/db/schema";
import type { Database } from "@/db/tenant";
import { addDaysUtc, todayUtc } from "@/lib/dates";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";
import { createFakeObjectStorage } from "@/storage/fake";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { abandonedUploadsSweep } =
  await import("@/deliverables/abandoned-sweep");
const { overdueInvoicesSweep } = await import("@/invoices/overdue-sweep");
const { runDailySweeps } = await import("./runner");

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 5 });
const db: Database = drizzle(sql, { schema });

const TODAY = todayUtc();
const YESTERDAY = addDaysUtc(TODAY, -1);
const TWENTY_FIVE_HOURS_AGO = new Date(Date.now() - 25 * 60 * 60 * 1000);

const createdOrgs: string[] = [];
const createdRuns: string[] = [];
const createdUsers: string[] = [];

/**
 * Drawn from `randomUUID()` rather than `newId()`'s time ordered bits: this
 * suite runs concurrently with every other `*.db.test.ts` file against one
 * shared database, and a millisecond timestamp prefix collides across files
 * under that load in a way a fully random one does not.
 */
function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
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

afterEach(async () => {
  if (createdRuns.length > 0) {
    await db.delete(cronRuns).where(inArray(cronRuns.id, createdRuns));
    createdRuns.length = 0;
  }

  if (createdOrgs.length > 0) {
    await db
      .delete(invoiceEvents)
      .where(inArray(invoiceEvents.orgId, createdOrgs));
    await db.delete(invoices).where(inArray(invoices.orgId, createdOrgs));
    await db
      .delete(deliverables)
      .where(inArray(deliverables.orgId, createdOrgs));
    await db.delete(projects).where(inArray(projects.orgId, createdOrgs));
    await db.delete(clients).where(inArray(clients.orgId, createdOrgs));
    await db
      .delete(organizations)
      .where(inArray(organizations.id, createdOrgs));
    createdOrgs.length = 0;
  }

  if (createdUsers.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUsers));
    createdUsers.length = 0;
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("two overlapping runs against real PostgreSQL", () => {
  it("leaves two run rows, one overdue event, and no thrown error from either run", async () => {
    const orgId = await makeOrg();
    const clientId = newId();
    await db.insert(clients).values({ id: clientId, orgId, name: "A client" });

    const invoiceId = newId();
    await db.insert(invoices).values({
      id: invoiceId,
      orgId,
      clientId,
      status: "sent",
      dueDate: YESTERDAY,
      currency: "USD",
    });

    const storage = createFakeObjectStorage();
    const sweeps = [
      overdueInvoicesSweep,
      abandonedUploadsSweep(storage),
    ] as const;

    const [first, second] = await Promise.all([
      runDailySweeps({ db, sweeps, now: new Date() }),
      runDailySweeps({ db, sweeps, now: new Date() }),
    ]);
    createdRuns.push(first.runId, second.runId);

    expect(first.runId).not.toBe(second.runId);
    expect(first.outcome).toBe("ok");
    expect(second.outcome).toBe("ok");

    const runRows = await db
      .select({ id: cronRuns.id })
      .from(cronRuns)
      .where(inArray(cronRuns.id, [first.runId, second.runId]));
    expect(runRows).toHaveLength(2);

    const [invoiceRow] = await db
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(invoiceRow.status).toBe("overdue");

    const events = await db
      .select()
      .from(invoiceEvents)
      .where(
        and(
          eq(invoiceEvents.invoiceId, invoiceId),
          eq(invoiceEvents.kind, "overdue"),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("does not fail either run when both try to remove the same abandoned upload", async () => {
    const orgId = await makeOrg();
    const projectClientId = newId();
    await db
      .insert(clients)
      .values({ id: projectClientId, orgId, name: "A client" });

    const userId = newId();
    await db.insert(users).values({
      id: userId,
      clerkUserId: `user_${tag()}`,
      email: `${tag()}@example.com`,
    });
    createdUsers.push(userId);

    const projectId = newId();
    await db.insert(projects).values({
      id: projectId,
      orgId,
      clientId: projectClientId,
      name: "A project",
    });

    const deliverableId = newId();
    await db.insert(deliverables).values({
      id: deliverableId,
      orgId,
      projectId,
      name: "a-file.pdf",
      r2Key: `deliverables/${deliverableId}`,
      contentType: "application/pdf",
      sizeBytes: 100,
      uploadedByUserId: userId,
      status: "pending",
      createdAt: TWENTY_FIVE_HOURS_AGO,
    });

    const storage = createFakeObjectStorage();
    const sweeps = [
      overdueInvoicesSweep,
      abandonedUploadsSweep(storage),
    ] as const;

    const [first, second] = await Promise.all([
      runDailySweeps({ db, sweeps, now: new Date() }),
      runDailySweeps({ db, sweeps, now: new Date() }),
    ]);
    createdRuns.push(first.runId, second.runId);

    expect(first.outcome).toBe("ok");
    expect(second.outcome).toBe("ok");

    const remaining = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    expect(remaining).toHaveLength(0);
  });
});
