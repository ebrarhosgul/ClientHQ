/**
 * @vitest-environment node
 *
 * covers: spec 0020 AC-3 to AC-9, AC-12
 *
 * The four dashboard reads against real PostgreSQL: tenancy isolation (an
 * agency never sees another's invoices, projects, deliverables or clients),
 * the archive exclusions, and the SQL `where` clause in
 * `overdueInvoicesSummary` agreeing with `summariseOverdue`'s own predicate
 * over the same rows. Every case runs inside one transaction that is rolled
 * back afterwards; `pooledDb` is stubbed to hand every `tenantDb(ctx)` call
 * that same transaction, the same shape as `invoices.db.test.ts`.
 *
 * The pool is capped at one connection (`src/db/AGENTS.md`'s own gotcha), so
 * every fixture write in here goes through the transaction handle (`tx`),
 * never the top level `db`: a second query issued through `db` while the
 * transaction holds the only connection would wait on it forever.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clients,
  deliverables,
  invoices,
  organizations,
  projects,
  users,
} from "@/db/schema";
import type { StaffContext, TransactionExecutor } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

const state = vi.hoisted(() => ({ tx: undefined as unknown }));

vi.mock("@/db/tenant/executor", () => ({ pooledDb: async () => state.tx }));

const {
  hasAnyClient,
  openProjectsSummary,
  overdueInvoicesSummary,
  recentDeliverablesSummary,
} = await import("./queries");

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

const TODAY = "2026-09-24";
const NOW = new Date("2026-09-24T12:00:00.000Z");

function staffContext(orgId: string): StaffContext {
  return {
    kind: "staff",
    orgId,
    clerkOrgId: `org_${newId()}`,
    userId: "irrelevant-to-these-reads",
    clerkUserId: "irrelevant-to-these-reads",
    role: "admin",
  };
}

function r2Key(): string {
  return `dashboard-test/${newId()}`;
}

type Fixture = {
  readonly orgA: string;
  readonly orgB: string;
  /** No client at all: the fixture for the first run / `hasAnyClient` false case. */
  readonly orgC: string;
  readonly clientA: string;
  readonly clientB: string;
  readonly userA: string;
  readonly userB: string;
};

async function seedOrganization(
  tx: TransactionExecutor,
  name: string,
): Promise<string> {
  const orgId = newId();

  await tx.insert(organizations).values({
    id: orgId,
    clerkOrgId: `org_${newId()}`,
    name,
    slug: `${name.toLowerCase().replace(/\s+/gu, "-")}-${orgId.slice(0, 8)}`,
  });

  return orgId;
}

async function seedAgency(
  tx: TransactionExecutor,
  name: string,
): Promise<{
  readonly orgId: string;
  readonly clientId: string;
  readonly userId: string;
}> {
  const orgId = await seedOrganization(tx, name);
  const clientId = newId();
  const userId = newId();

  await tx.insert(users).values({
    id: userId,
    clerkUserId: `user_${newId()}`,
    email: `${userId}@example.com`,
    name: "Uploader",
  });
  await tx.insert(clients).values({ id: clientId, orgId, name: "Acme Ltd" });

  return { orgId, clientId, userId };
}

async function seedFixture(tx: TransactionExecutor): Promise<Fixture> {
  const a = await seedAgency(tx, "Org A");
  const b = await seedAgency(tx, "Org B");
  const orgC = await seedOrganization(tx, "Org C");

  return {
    orgA: a.orgId,
    orgB: b.orgId,
    orgC,
    clientA: a.clientId,
    clientB: b.clientId,
    userA: a.userId,
    userB: b.userId,
  };
}

beforeEach(() => {
  state.tx = undefined;
});

afterAll(async () => {
  await sql.end();
});

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      state.tx = tx;
      const fixture = await seedFixture(tx);
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

describe.skipIf(!url)("hasAnyClient against real PostgreSQL", () => {
  it("is true once the agency has a client (AC-9)", async () => {
    await inRollback(async (_tx, { orgA }) => {
      await expect(hasAnyClient(staffContext(orgA))).resolves.toBe(true);
    });
  });

  it("is false for an agency with none, and never sees another agency's client", async () => {
    await inRollback(async (_tx, { orgC }) => {
      await expect(hasAnyClient(staffContext(orgC))).resolves.toBe(false);
    });
  });
});

describe.skipIf(!url)("overdueInvoicesSummary against real PostgreSQL", () => {
  it("agrees with the SQL where clause: overdue, and sent past due, never draft/paid/void (AC-3, AC-12)", async () => {
    await inRollback(async (tx, { orgA, orgB, clientA, clientB }) => {
      await tx.insert(invoices).values([
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          number: 1,
          status: "overdue",
          issueDate: "2026-08-01",
          dueDate: "2026-09-01",
          currency: "USD",
          subtotalCents: 1_000,
          totalCents: 1_000,
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          number: 2,
          status: "sent",
          issueDate: "2026-08-01",
          dueDate: "2026-09-20",
          currency: "USD",
          subtotalCents: 2_000,
          totalCents: 2_000,
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          number: 3,
          status: "sent",
          issueDate: "2026-09-20",
          dueDate: "2026-10-01",
          currency: "USD",
          subtotalCents: 4_000,
          totalCents: 4_000,
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          status: "draft",
          issueDate: null,
          dueDate: null,
          currency: "USD",
          subtotalCents: 9_000,
          totalCents: 9_000,
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          number: 4,
          status: "paid",
          issueDate: "2026-08-01",
          dueDate: "2026-08-15",
          currency: "USD",
          subtotalCents: 5_000,
          totalCents: 5_000,
          paidAt: new Date("2026-08-10T00:00:00Z"),
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          number: 5,
          status: "void",
          issueDate: "2026-08-01",
          dueDate: "2026-08-15",
          currency: "USD",
          subtotalCents: 5_000,
          totalCents: 5_000,
        },
        // Another agency's overdue invoice must never appear in A's summary.
        {
          id: newId(),
          orgId: orgB,
          clientId: clientB,
          number: 1,
          status: "overdue",
          issueDate: "2026-08-01",
          dueDate: "2026-09-01",
          currency: "USD",
          subtotalCents: 999_999,
          totalCents: 999_999,
        },
      ]);

      const summary = await overdueInvoicesSummary(staffContext(orgA), TODAY);

      expect(summary.count).toBe(2);
      expect(summary.totals).toEqual([{ currency: "USD", cents: 3_000 }]);
      expect(summary.rows.map((row) => row.number)).toEqual([1, 2]);
      expect(summary.rows[0]?.daysOverdue).toBe(23);
    });
  });
});

describe.skipIf(!url)("openProjectsSummary against real PostgreSQL", () => {
  it("excludes archived and delivered, and never another agency's project (AC-6, AC-12)", async () => {
    await inRollback(async (tx, { orgA, orgB, clientA, clientB }) => {
      await tx.insert(projects).values([
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          name: "Soonest",
          status: "planning",
          dueDate: "2026-10-01",
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          name: "Later",
          status: "in_progress",
          dueDate: "2026-11-01",
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          name: "No due date",
          status: "in_review",
          dueDate: null,
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          name: "Delivered",
          status: "delivered",
          dueDate: "2026-09-01",
        },
        {
          id: newId(),
          orgId: orgA,
          clientId: clientA,
          name: "Archived",
          status: "in_progress",
          dueDate: "2026-09-01",
          archivedAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: newId(),
          orgId: orgB,
          clientId: clientB,
          name: "Other agency",
          status: "planning",
          dueDate: "2026-09-25",
        },
      ]);

      const summary = await openProjectsSummary(staffContext(orgA), TODAY);

      expect(summary.count).toBe(3);
      expect(summary.rows.map((row) => row.name)).toEqual([
        "Soonest",
        "Later",
        "No due date",
      ]);
    });
  });
});

describe.skipIf(!url)(
  "recentDeliverablesSummary against real PostgreSQL",
  () => {
    it("excludes pending and deliverables on archived projects, and never another agency's deliverable (AC-7, AC-12)", async () => {
      await inRollback(
        async (tx, { orgA, orgB, clientA, clientB, userA, userB }) => {
          const [active] = await tx
            .insert(projects)
            .values({
              id: newId(),
              orgId: orgA,
              clientId: clientA,
              name: "Active",
              status: "in_progress",
            })
            .returning();
          const [archived] = await tx
            .insert(projects)
            .values({
              id: newId(),
              orgId: orgA,
              clientId: clientA,
              name: "Archived",
              status: "in_progress",
              archivedAt: new Date("2026-09-01T00:00:00Z"),
            })
            .returning();
          const [otherAgency] = await tx
            .insert(projects)
            .values({
              id: newId(),
              orgId: orgB,
              clientId: clientB,
              name: "Other agency",
              status: "in_progress",
            })
            .returning();

          if (
            active === undefined ||
            archived === undefined ||
            otherAgency === undefined
          ) {
            throw new Error("insert did not return a row");
          }

          await tx.insert(deliverables).values([
            {
              id: newId(),
              orgId: orgA,
              projectId: active.id,
              name: "recent-ready.pdf",
              r2Key: r2Key(),
              contentType: "application/pdf",
              sizeBytes: 100,
              uploadedByUserId: userA,
              visibleToClient: true,
              status: "ready",
              createdAt: new Date("2026-09-23T00:00:00Z"),
            },
            {
              id: newId(),
              orgId: orgA,
              projectId: active.id,
              name: "old-ready.pdf",
              r2Key: r2Key(),
              contentType: "application/pdf",
              sizeBytes: 100,
              uploadedByUserId: userA,
              visibleToClient: false,
              status: "ready",
              createdAt: new Date("2026-09-01T00:00:00Z"),
            },
            {
              id: newId(),
              orgId: orgA,
              projectId: active.id,
              name: "pending.pdf",
              r2Key: r2Key(),
              contentType: "application/pdf",
              sizeBytes: 100,
              uploadedByUserId: userA,
              visibleToClient: false,
              status: "pending",
              createdAt: new Date("2026-09-23T00:00:00Z"),
            },
            {
              id: newId(),
              orgId: orgA,
              projectId: archived.id,
              name: "on-archived-project.pdf",
              r2Key: r2Key(),
              contentType: "application/pdf",
              sizeBytes: 100,
              uploadedByUserId: userA,
              visibleToClient: false,
              status: "ready",
              createdAt: new Date("2026-09-23T00:00:00Z"),
            },
            // Another agency's deliverable must never appear in A's summary,
            // in its rows or in its 7 day count.
            {
              id: newId(),
              orgId: orgB,
              projectId: otherAgency.id,
              name: "other-agency-ready.pdf",
              r2Key: r2Key(),
              contentType: "application/pdf",
              sizeBytes: 100,
              uploadedByUserId: userB,
              visibleToClient: false,
              status: "ready",
              createdAt: new Date("2026-09-23T00:00:00Z"),
            },
          ]);

          const summary = await recentDeliverablesSummary(
            staffContext(orgA),
            NOW,
          );

          expect(summary.rows.map((row) => row.name)).toEqual([
            "recent-ready.pdf",
            "old-ready.pdf",
          ]);
          // Exactly one falls inside the last 7 days from NOW (2026-09-17..24).
          expect(summary.addedLast7Days).toBe(1);
          expect(summary.rows[0]?.visibleToClient).toBe(true);
        },
      );
    });

    it("returns zero rows with no second query when the agency has no active project", async () => {
      await inRollback(async (_tx, { orgA }) => {
        const summary = await recentDeliverablesSummary(
          staffContext(orgA),
          NOW,
        );

        expect(summary).toEqual({ addedLast7Days: 0, rows: [] });
      });
    });
  },
);
