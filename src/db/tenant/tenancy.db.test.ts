/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-14
 *
 * The proof, against real SQL. Two organizations with overlapping data, and one
 * of them serving two clients, then every accessor method asked for something
 * it must not be able to reach.
 *
 * Everything runs inside a transaction that is rolled back, so the suite leaves
 * the database exactly as it found it and can be pointed at a development
 * project as safely as at CI's throwaway container.
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database. CI sets it and runs this file against the container it just
 * migrated.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";
import * as schema from "../schema";
import {
  clientContacts,
  clients,
  deliverables,
  invoiceEvents,
  invoiceLineItems,
  invoices,
  memberships,
  organizations,
  projects,
  subscriptions,
  users,
} from "../schema";
import { tenantDb, type StaffAccessor } from "./accessor";
import {
  resolveContactContext,
  resolveStaffContext,
  type ContactContext,
  type StaffContext,
} from "./context";
import type { TransactionExecutor } from "./executor";
import { isTenantResolutionError } from "./errors";
import type { TenantTable } from "./tables";

// `context.ts` reads Clerk and the cookie jar through this one module, which is
// exactly why it is one module. Each case sets what the session says.
const session = vi.hoisted(() => ({
  claims: {
    clerkUserId: undefined as string | undefined,
    clerkOrgId: undefined as string | undefined,
    clerkOrgRole: undefined as string | undefined,
  },
  cookie: undefined as string | undefined,
}));

vi.mock("./session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => session.claims,
  contactCookie: async () => session.cookie,
}));

loadEnvFiles();

// The two "every table" cases below are two dozen round trips each to a
// remote database; the default five seconds is for unit tests.
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

/** Every statement the layer emitted during one case. */
const emitted: string[] = [];

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, {
  schema,
  logger: {
    logQuery(query) {
      emitted.push(query);
    },
  },
});

type Fixture = {
  readonly orgA: string;
  readonly orgB: string;
  readonly staffUserA: string;
  readonly staffUserB: string;
  readonly contactUserA: string;
  readonly clientA1: string;
  readonly clientA2: string;
  readonly clientB1: string;
  readonly contactA1: string;
  readonly contactA2: string;
  readonly contactB1: string;
  readonly membershipA: string;
  readonly membershipB: string;
  readonly subscriptionA: string;
  readonly subscriptionB: string;
  readonly projectA1: string;
  readonly projectA2: string;
  readonly projectB1: string;
  readonly deliverableA1: string;
  readonly deliverableA2: string;
  readonly deliverableB1: string;
  readonly invoiceA1: string;
  readonly invoiceA2: string;
  readonly invoiceB1: string;
  readonly lineA1: string;
  readonly lineA2: string;
  readonly lineB1: string;
  readonly eventA1: string;
  readonly eventA2: string;
  readonly eventB1: string;
  readonly clerkOrgA: string;
  readonly clerkStaffA: string;
  readonly clerkContactA: string;
};

/**
 * Two agencies. Agency A serves two clients, so a contact of the first can be
 * asked for the second one's work: the case a cross organization test alone
 * would miss.
 */
async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId().slice(0, 8);
  const ids = {
    orgA: newId(),
    orgB: newId(),
    staffUserA: newId(),
    staffUserB: newId(),
    contactUserA: newId(),
    clientA1: newId(),
    clientA2: newId(),
    clientB1: newId(),
    contactA1: newId(),
    contactA2: newId(),
    contactB1: newId(),
    membershipA: newId(),
    membershipB: newId(),
    subscriptionA: newId(),
    subscriptionB: newId(),
    projectA1: newId(),
    projectA2: newId(),
    projectB1: newId(),
    deliverableA1: newId(),
    deliverableA2: newId(),
    deliverableB1: newId(),
    invoiceA1: newId(),
    invoiceA2: newId(),
    invoiceB1: newId(),
    lineA1: newId(),
    lineA2: newId(),
    lineB1: newId(),
    eventA1: newId(),
    eventA2: newId(),
    eventB1: newId(),
    clerkOrgA: `org_${tag}_a`,
    clerkStaffA: `user_${tag}_staff_a`,
    clerkContactA: `user_${tag}_contact_a`,
  } as const;

  await tx.insert(organizations).values([
    {
      id: ids.orgA,
      clerkOrgId: ids.clerkOrgA,
      name: "Agency A",
      slug: `a-${tag}`,
    },
    {
      id: ids.orgB,
      clerkOrgId: `org_${tag}_b`,
      name: "Agency B",
      slug: `b-${tag}`,
    },
  ]);

  await tx.insert(users).values([
    {
      id: ids.staffUserA,
      clerkUserId: ids.clerkStaffA,
      email: `staff-a-${tag}@example.com`,
    },
    {
      id: ids.staffUserB,
      clerkUserId: `user_${tag}_staff_b`,
      email: `staff-b-${tag}@example.com`,
    },
    {
      id: ids.contactUserA,
      clerkUserId: ids.clerkContactA,
      email: `contact-a-${tag}@example.com`,
    },
  ]);

  await tx.insert(memberships).values([
    {
      id: ids.membershipA,
      orgId: ids.orgA,
      userId: ids.staffUserA,
      role: "admin",
    },
    {
      id: ids.membershipB,
      orgId: ids.orgB,
      userId: ids.staffUserB,
      role: "admin",
    },
  ]);

  await tx.insert(subscriptions).values([
    {
      id: ids.subscriptionA,
      orgId: ids.orgA,
      stripeCustomerId: `cus_${tag}_a`,
      status: "active",
    },
    {
      id: ids.subscriptionB,
      orgId: ids.orgB,
      stripeCustomerId: `cus_${tag}_b`,
      status: "active",
    },
  ]);

  await tx.insert(clients).values([
    { id: ids.clientA1, orgId: ids.orgA, name: "A first client" },
    { id: ids.clientA2, orgId: ids.orgA, name: "A second client" },
    { id: ids.clientB1, orgId: ids.orgB, name: "B only client" },
  ]);

  const accepted = new Date();

  await tx.insert(clientContacts).values([
    {
      id: ids.contactA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      userId: ids.contactUserA,
      email: `c1-${tag}@example.com`,
      name: "Contact one",
      acceptedAt: accepted,
    },
    {
      id: ids.contactA2,
      orgId: ids.orgA,
      clientId: ids.clientA2,
      email: `c2-${tag}@example.com`,
      name: "Contact two",
    },
    {
      id: ids.contactB1,
      orgId: ids.orgB,
      clientId: ids.clientB1,
      email: `c3-${tag}@example.com`,
      name: "Contact three",
    },
  ]);

  await tx.insert(projects).values([
    {
      id: ids.projectA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      name: "A1 project",
    },
    {
      id: ids.projectA2,
      orgId: ids.orgA,
      clientId: ids.clientA2,
      name: "A2 project",
    },
    {
      id: ids.projectB1,
      orgId: ids.orgB,
      clientId: ids.clientB1,
      name: "B1 project",
    },
  ]);

  await tx.insert(deliverables).values([
    {
      id: ids.deliverableA1,
      orgId: ids.orgA,
      projectId: ids.projectA1,
      name: "A1 file",
      r2Key: `a1-${tag}`,
      contentType: "application/pdf",
      sizeBytes: 10,
      uploadedByUserId: ids.staffUserA,
    },
    {
      id: ids.deliverableA2,
      orgId: ids.orgA,
      projectId: ids.projectA2,
      name: "A2 file",
      r2Key: `a2-${tag}`,
      contentType: "application/pdf",
      sizeBytes: 10,
      uploadedByUserId: ids.staffUserA,
    },
    {
      id: ids.deliverableB1,
      orgId: ids.orgB,
      projectId: ids.projectB1,
      name: "B1 file",
      r2Key: `b1-${tag}`,
      contentType: "application/pdf",
      sizeBytes: 10,
      uploadedByUserId: ids.staffUserB,
    },
  ]);

  const money = {
    currency: "USD",
    subtotalCents: 1000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 1000,
  } as const;

  await tx.insert(invoices).values([
    { id: ids.invoiceA1, orgId: ids.orgA, clientId: ids.clientA1, ...money },
    { id: ids.invoiceA2, orgId: ids.orgA, clientId: ids.clientA2, ...money },
    { id: ids.invoiceB1, orgId: ids.orgB, clientId: ids.clientB1, ...money },
  ]);

  const line = {
    description: "Work",
    quantity: "1.000",
    unitAmountCents: 1000,
    amountCents: 1000,
    position: 1,
  } as const;

  await tx.insert(invoiceLineItems).values([
    { id: ids.lineA1, orgId: ids.orgA, invoiceId: ids.invoiceA1, ...line },
    { id: ids.lineA2, orgId: ids.orgA, invoiceId: ids.invoiceA2, ...line },
    { id: ids.lineB1, orgId: ids.orgB, invoiceId: ids.invoiceB1, ...line },
  ]);

  const event = { kind: "notified", note: "no contacts to notify" } as const;

  await tx.insert(invoiceEvents).values([
    { id: ids.eventA1, orgId: ids.orgA, invoiceId: ids.invoiceA1, ...event },
    { id: ids.eventA2, orgId: ids.orgA, invoiceId: ids.invoiceA2, ...event },
    { id: ids.eventB1, orgId: ids.orgB, invoiceId: ids.invoiceB1, ...event },
  ]);

  return ids;
}

/** Run a case inside a transaction that is always rolled back. */
async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      emitted.length = 0;
      const fixture = await seed(tx);
      emitted.length = 0;
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

function staffOf(fixture: Fixture, org: "A" | "B"): StaffContext {
  return {
    kind: "staff",
    orgId: org === "A" ? fixture.orgA : fixture.orgB,
    clerkOrgId: org === "A" ? fixture.clerkOrgA : "org_other",
    userId: org === "A" ? fixture.staffUserA : fixture.staffUserB,
    clerkUserId: org === "A" ? fixture.clerkStaffA : "user_other",
    role: "admin",
  };
}

function contactOf(fixture: Fixture): ContactContext {
  return {
    kind: "contact",
    orgId: fixture.orgA,
    userId: fixture.contactUserA,
    clerkUserId: fixture.clerkContactA,
    clientId: fixture.clientA1,
    contactId: fixture.contactA1,
  };
}

/** The nine tenant scoped tables, with one A row and one B row each. */
function everyTable(fixture: Fixture): readonly {
  readonly name: string;
  readonly table: TenantTable;
  readonly mine: string;
  readonly theirs: string;
}[] {
  return [
    {
      name: "memberships",
      table: memberships,
      mine: fixture.membershipA,
      theirs: fixture.membershipB,
    },
    {
      name: "subscriptions",
      table: subscriptions,
      mine: fixture.subscriptionA,
      theirs: fixture.subscriptionB,
    },
    {
      name: "clients",
      table: clients,
      mine: fixture.clientA1,
      theirs: fixture.clientB1,
    },
    {
      name: "client_contacts",
      table: clientContacts,
      mine: fixture.contactA1,
      theirs: fixture.contactB1,
    },
    {
      name: "projects",
      table: projects,
      mine: fixture.projectA1,
      theirs: fixture.projectB1,
    },
    {
      name: "deliverables",
      table: deliverables,
      mine: fixture.deliverableA1,
      theirs: fixture.deliverableB1,
    },
    {
      name: "invoices",
      table: invoices,
      mine: fixture.invoiceA1,
      theirs: fixture.invoiceB1,
    },
    {
      name: "invoice_line_items",
      table: invoiceLineItems,
      mine: fixture.lineA1,
      theirs: fixture.lineB1,
    },
    {
      name: "invoice_events",
      table: invoiceEvents,
      mine: fixture.eventA1,
      theirs: fixture.eventB1,
    },
  ];
}

beforeAll(() => {
  session.claims = {
    clerkUserId: undefined,
    clerkOrgId: undefined,
    clerkOrgRole: undefined,
  };
  session.cookie = undefined;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)(
  "the tenant scoping layer against real PostgreSQL",
  () => {
    describe("every statement is scoped", () => {
      it("carries an org_id predicate on all nine tables, read and write", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(staffOf(fixture, "A"), tx);

          for (const { table, mine } of everyTable(fixture)) {
            await db.findMany(table, { limit: 1 });
            await db.findById(table, mine);
          }

          // A throwaway client, so the delete has no RESTRICTed children.
          const fresh = await db.insert(clients, { name: "New" });
          await db.update(clients, fixture.clientA1, { name: "Renamed" });
          await db.delete(clients, fresh.id);

          expect(emitted.length).toBeGreaterThan(0);

          const unscoped = emitted.filter((query) => !query.includes("org_id"));
          expect(unscoped).toEqual([]);
        });
      });
    });

    describe("one organization cannot reach another's rows", () => {
      it("returns nothing for a foreign id, on every table", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(staffOf(fixture, "A"), tx);

          for (const { name, table, mine, theirs } of everyTable(fixture)) {
            await expect(db.findById(table, mine), name).resolves.toBeDefined();
            await expect(
              db.findById(table, theirs),
              name,
            ).resolves.toBeUndefined();
            await expect(
              db.findFirst(table, { limit: 1 }),
              name,
            ).resolves.toBeDefined();
          }
        });
      });

      it("lists none of the other organization's rows", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(staffOf(fixture, "A"), tx);

          for (const { name, table, theirs } of everyTable(fixture)) {
            const rows = await db.findMany(table);
            const ids = rows.map((row) => (row as { id: string }).id);

            expect(ids, name).not.toContain(theirs);
            expect(ids.length, name).toBeGreaterThan(0);
          }
        });
      });

      it("changes nothing when a write targets a foreign row", async () => {
        await inRollback(async (tx, fixture) => {
          const db: StaffAccessor = tenantDb(staffOf(fixture, "A"), tx);

          await expect(
            db.update(clients, fixture.clientB1, { name: "Taken over" }),
          ).resolves.toBeUndefined();
          await expect(db.delete(clients, fixture.clientB1)).resolves.toBe(
            false,
          );
          await expect(
            db.update(invoices, fixture.invoiceB1, { status: "paid" }),
          ).resolves.toBeUndefined();
          await expect(db.delete(projects, fixture.projectB1)).resolves.toBe(
            false,
          );

          // And the rows are still there, untouched, as organization B sees them.
          const theirs = tenantDb(staffOf(fixture, "B"), tx);
          const client = await theirs.findById(clients, fixture.clientB1);

          expect(client?.name).toBe("B only client");
        });
      });

      it("cannot use a compare and set condition to reach another organization's row (spec 0010, AC-9)", async () => {
        await inRollback(async (tx, fixture) => {
          const db: StaffAccessor = tenantDb(staffOf(fixture, "A"), tx);

          await expect(
            db.update(
              projects,
              fixture.projectB1,
              { status: "in_progress" },
              { where: eq(projects.status, "planning") },
            ),
          ).resolves.toBeUndefined();

          const theirs = tenantDb(staffOf(fixture, "B"), tx);
          const stillTheirs = await theirs.findById(
            projects,
            fixture.projectB1,
          );

          expect(stillTheirs?.status).toBe("planning");
        });
      });

      it("does not distinguish a foreign id from one that never existed", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(staffOf(fixture, "A"), tx);

          const foreign = await db.findById(clients, fixture.clientB1);
          const invented = await db.findById(clients, newId());

          expect(foreign).toBe(invented);
        });
      });
    });

    describe("a compare and set update (spec 0010, AC-9)", () => {
      it("lands when the condition still holds, and misses without writing when it does not", async () => {
        await inRollback(async (tx, fixture) => {
          const db: StaffAccessor = tenantDb(staffOf(fixture, "A"), tx);

          const miss = await db.update(
            projects,
            fixture.projectA1,
            { status: "in_progress" },
            { where: eq(projects.status, "in_review") },
          );

          expect(miss).toBeUndefined();

          const unchanged = await db.findById(projects, fixture.projectA1);
          expect(unchanged?.status).toBe("planning");

          const hit = await db.update(
            projects,
            fixture.projectA1,
            { status: "in_progress" },
            { where: eq(projects.status, "planning") },
          );

          expect(hit?.status).toBe("in_progress");
        });
      });
    });

    describe("insert owns id and org_id", () => {
      it("sets both from the context, never from the caller", async () => {
        await inRollback(async (tx, fixture) => {
          const ctx = staffOf(fixture, "A");
          const row = await tenantDb(ctx, tx).insert(clients, {
            name: "Fresh",
          });

          expect(row.orgId).toBe(ctx.orgId);
          expect(row.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          );
        });
      });
    });

    describe("a client contact sees one client and no more", () => {
      it("reads its own client's rows and none of the sibling client's", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(contactOf(fixture), tx);

          await expect(
            db.findById(clients, fixture.clientA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(clients, fixture.clientA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(projects, fixture.projectA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(projects, fixture.projectA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(deliverables, fixture.deliverableA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(deliverables, fixture.deliverableA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(invoices, fixture.invoiceA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(invoices, fixture.invoiceA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(invoiceLineItems, fixture.lineA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(invoiceLineItems, fixture.lineA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(invoiceEvents, fixture.eventA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(invoiceEvents, fixture.eventA2),
          ).resolves.toBeUndefined();

          await expect(
            db.findById(clientContacts, fixture.contactA1),
          ).resolves.toBeDefined();
          await expect(
            db.findById(clientContacts, fixture.contactA2),
          ).resolves.toBeUndefined();
        });
      });

      it("reaches nothing at all in the other organization", async () => {
        await inRollback(async (tx, fixture) => {
          const db = tenantDb(contactOf(fixture), tx);

          await expect(
            db.findById(clients, fixture.clientB1),
          ).resolves.toBeUndefined();
          await expect(
            db.findById(projects, fixture.projectB1),
          ).resolves.toBeUndefined();
          await expect(
            db.findById(deliverables, fixture.deliverableB1),
          ).resolves.toBeUndefined();
          await expect(
            db.findById(invoices, fixture.invoiceB1),
          ).resolves.toBeUndefined();
          await expect(
            db.findById(invoiceLineItems, fixture.lineB1),
          ).resolves.toBeUndefined();
          await expect(
            db.findById(invoiceEvents, fixture.eventB1),
          ).resolves.toBeUndefined();
        });
      });
    });

    describe("tenant context comes from the session and the row, never the request", () => {
      it("resolves agency staff from the Clerk claims", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkStaffA,
            clerkOrgId: fixture.clerkOrgA,
            clerkOrgRole: "org:admin",
          };

          const ctx = await resolveStaffContext(tx);

          expect(ctx).toMatchObject({
            kind: "staff",
            orgId: fixture.orgA,
            userId: fixture.staffUserA,
            role: "admin",
          });
        });
      });

      it("maps an unrecognised Clerk role down to member", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkStaffA,
            clerkOrgId: fixture.clerkOrgA,
            clerkOrgRole: "org:billing_wizard",
          };

          const ctx = await resolveStaffContext(tx);

          expect(ctx.role).toBe("member");
        });
      });

      it("refuses with no_active_org when no organization is selected", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkStaffA,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };

          await expect(resolveStaffContext(tx)).rejects.toSatisfy(
            (thrown: unknown) =>
              isTenantResolutionError(thrown) &&
              thrown.kind === "no_active_org",
          );
        });
      });

      it("refuses with no_mirror_row when the Clerk ids have no local rows", async () => {
        await inRollback(async (tx) => {
          session.claims = {
            clerkUserId: "user_never_mirrored",
            clerkOrgId: "org_never_mirrored",
            clerkOrgRole: "org:admin",
          };

          await expect(resolveStaffContext(tx)).rejects.toSatisfy(
            (thrown: unknown) =>
              isTenantResolutionError(thrown) &&
              thrown.kind === "no_mirror_row",
          );
        });
      });

      it("resolves a contact from their own row, with no cookie at all", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkContactA,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };
          session.cookie = undefined;

          const ctx = await resolveContactContext(tx);

          expect(ctx).toMatchObject({
            kind: "contact",
            orgId: fixture.orgA,
            clientId: fixture.clientA1,
            contactId: fixture.contactA1,
            userId: fixture.contactUserA,
          });
        });
      });

      it("discards a cookie naming a contact row this user does not own", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkContactA,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };
          // Another organization's contact row, handed over in the cookie.
          session.cookie = fixture.contactB1;

          const ctx = await resolveContactContext(tx);

          expect(ctx.contactId).toBe(fixture.contactA1);
          expect(ctx.clientId).toBe(fixture.clientA1);
          expect(ctx.orgId).toBe(fixture.orgA);
        });
      });

      it("refuses with no_contact when the signed in user owns no contact row", async () => {
        await inRollback(async (tx, fixture) => {
          session.claims = {
            clerkUserId: fixture.clerkStaffA,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };

          await expect(resolveContactContext(tx)).rejects.toSatisfy(
            (thrown: unknown) =>
              isTenantResolutionError(thrown) && thrown.kind === "no_contact",
          );
        });
      });

      it("refuses with no_session when nobody is signed in", async () => {
        await inRollback(async (tx) => {
          session.claims = {
            clerkUserId: undefined,
            clerkOrgId: undefined,
            clerkOrgRole: undefined,
          };

          await expect(resolveStaffContext(tx)).rejects.toSatisfy(
            (thrown: unknown) =>
              isTenantResolutionError(thrown) && thrown.kind === "no_session",
          );
        });
      });
    });

    describe("a transactional accessor is the same accessor", () => {
      it("scopes identically and rolls every write back on a throw", async () => {
        await inRollback(async (tx, fixture) => {
          const ctx = staffOf(fixture, "A");
          const inner = new Error("handler blew up");
          let insertedId: string | undefined;

          // A savepoint inside the outer rollback transaction: the same shape a
          // declared transaction has in `withTenantAction`.
          await expect(
            tx.transaction(async (inTx) => {
              const db = tenantDb(ctx, inTx);
              const row = await db.insert(clients, { name: "Half written" });
              insertedId = row.id;

              await db.update(clients, fixture.clientA1, {
                name: "Also changed",
              });

              throw inner;
            }),
          ).rejects.toBe(inner);

          const after = tenantDb(ctx, tx);

          expect(insertedId).toBeDefined();
          await expect(db2(after, insertedId)).resolves.toBeUndefined();

          const untouched = await after.findById(clients, fixture.clientA1);
          expect(untouched?.name).toBe("A first client");
        });
      });
    });
  },
);

/** Small helper so the assertion above reads as one line. */
async function db2(
  accessor: StaffAccessor,
  id: string | undefined,
): Promise<unknown> {
  return id === undefined ? undefined : accessor.findById(clients, id);
}
