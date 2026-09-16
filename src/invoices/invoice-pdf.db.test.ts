/**
 * @vitest-environment node
 *
 * covers: spec 0013 AC-1, AC-2, AC-7
 *
 * `getInvoiceDocument` against real PostgreSQL: the one "has a PDF" rule
 * (`isClientVisible`) and the tenant predicates, for staff and for client
 * contacts alike. Two clients under one agency, so a contact of the first can
 * be asked for the second's invoice, the case a cross agency test alone would
 * miss. Runs inside a transaction that is rolled back afterwards; skipped
 * when `DIRECT_URL` is unset, like the other database suites.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  invoiceLineItems,
  invoices,
  memberships,
  organizations,
  subscriptions,
  users,
} from "@/db/schema";
import type {
  ContactContext,
  StaffContext,
  TransactionExecutor,
} from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

const state = vi.hoisted(() => ({ tx: undefined as unknown }));

vi.mock("@/db/tenant/executor", () => ({ pooledDb: async () => state.tx }));

const { getInvoiceDocument } = await import("./queries");

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

type Fixture = {
  readonly orgA: string;
  readonly orgB: string;
  readonly staffA: string;
  readonly clerkStaffA: string;
  readonly staffB: string;
  readonly clientA1: string;
  readonly clientA2: string;
  readonly clientA2Archived: boolean;
  readonly clientB1: string;
  readonly contactUserA1: string;
  readonly contactA1: string;
  readonly contactUserA2: string;
  readonly contactA2: string;
  readonly draftA1: string;
  readonly sentA1: string;
  readonly paidA2: string;
  readonly voidA1: string;
  readonly sentB1: string;
};

/** Two clients under agency A: one with a billing address, one archived. */
async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId().slice(0, 8);
  const ids = {
    orgA: newId(),
    orgB: newId(),
    staffA: newId(),
    staffB: newId(),
    clientA1: newId(),
    clientA2: newId(),
    clientB1: newId(),
    contactUserA1: newId(),
    contactA1: newId(),
    contactUserA2: newId(),
    contactA2: newId(),
    draftA1: newId(),
    sentA1: newId(),
    paidA2: newId(),
    voidA1: newId(),
    sentB1: newId(),
  } as const;

  await tx.insert(organizations).values([
    {
      id: ids.orgA,
      clerkOrgId: `org_${tag}_a`,
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
      id: ids.staffA,
      clerkUserId: `user_${tag}_staff_a`,
      email: `staff-a-${tag}@example.com`,
    },
    {
      id: ids.staffB,
      clerkUserId: `user_${tag}_staff_b`,
      email: `staff-b-${tag}@example.com`,
    },
    {
      id: ids.contactUserA1,
      clerkUserId: `user_${tag}_contact_a1`,
      email: `contact-a1-${tag}@example.com`,
    },
    {
      id: ids.contactUserA2,
      clerkUserId: `user_${tag}_contact_a2`,
      email: `contact-a2-${tag}@example.com`,
    },
  ]);

  await tx.insert(memberships).values([
    { id: newId(), orgId: ids.orgA, userId: ids.staffA, role: "admin" },
    { id: newId(), orgId: ids.orgB, userId: ids.staffB, role: "admin" },
  ]);

  await tx.insert(subscriptions).values([
    {
      id: newId(),
      orgId: ids.orgA,
      stripeCustomerId: `cus_${tag}_a`,
      status: "active",
    },
    {
      id: newId(),
      orgId: ids.orgB,
      stripeCustomerId: `cus_${tag}_b`,
      status: "active",
    },
  ]);

  await tx.insert(clients).values([
    {
      id: ids.clientA1,
      orgId: ids.orgA,
      name: "A first client",
      billingAddressLine1: "1 Market St",
      billingCity: "San Francisco",
      billingRegion: "CA",
      billingPostalCode: "94105",
      billingCountry: "US",
    },
    {
      id: ids.clientA2,
      orgId: ids.orgA,
      name: "A second client",
      archivedAt: new Date(),
    },
    { id: ids.clientB1, orgId: ids.orgB, name: "B only client" },
  ]);

  await tx.insert(clientContacts).values([
    {
      id: ids.contactA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      userId: ids.contactUserA1,
      email: `c1-${tag}@example.com`,
      name: "Contact one",
      acceptedAt: new Date(),
    },
    {
      id: ids.contactA2,
      orgId: ids.orgA,
      clientId: ids.clientA2,
      userId: ids.contactUserA2,
      email: `c2-${tag}@example.com`,
      name: "Contact two",
      acceptedAt: new Date(),
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
    {
      id: ids.draftA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      status: "draft",
      ...money,
    },
    {
      id: ids.sentA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      status: "sent",
      number: 1,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      ...money,
    },
    {
      id: ids.paidA2,
      orgId: ids.orgA,
      clientId: ids.clientA2,
      status: "paid",
      number: 2,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      paidAt: new Date("2026-09-10"),
      ...money,
    },
    {
      id: ids.voidA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      status: "void",
      ...money,
    },
    {
      id: ids.sentB1,
      orgId: ids.orgB,
      clientId: ids.clientB1,
      status: "sent",
      number: 1,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      ...money,
    },
  ]);

  const line = {
    description: "Work",
    quantity: "1.000",
    unitAmountCents: 1000,
    amountCents: 1000,
    position: 1,
  } as const;

  await tx.insert(invoiceLineItems).values([
    { id: newId(), orgId: ids.orgA, invoiceId: ids.sentA1, ...line },
    { id: newId(), orgId: ids.orgA, invoiceId: ids.paidA2, ...line },
    { id: newId(), orgId: ids.orgB, invoiceId: ids.sentB1, ...line },
  ]);

  return { ...ids, clerkStaffA: `user_${tag}_staff_a`, clientA2Archived: true };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      const fixture = await seed(tx);
      state.tx = tx;
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
    clerkOrgId: org === "A" ? "clerk-org-a" : "clerk-org-b",
    userId: org === "A" ? fixture.staffA : fixture.staffB,
    clerkUserId: org === "A" ? fixture.clerkStaffA : "clerk-staff-b",
    role: "admin",
  };
}

function contactOf(fixture: Fixture, which: "A1" | "A2"): ContactContext {
  return {
    kind: "contact",
    orgId: fixture.orgA,
    userId: which === "A1" ? fixture.contactUserA1 : fixture.contactUserA2,
    clerkUserId: which === "A1" ? "clerk-contact-a1" : "clerk-contact-a2",
    clientId: which === "A1" ? fixture.clientA1 : fixture.clientA2,
    contactId: which === "A1" ? fixture.contactA1 : fixture.contactA2,
  };
}

describe.skipIf(!url)("getInvoiceDocument against real PostgreSQL", () => {
  afterAll(async () => {
    await sql.end();
  });

  it("returns the invoice, its client's billing address and its lines for staff of the owning agency (AC-1)", async () => {
    await inRollback(async (tx, fixture) => {
      const document = await getInvoiceDocument(
        staffOf(fixture, "A"),
        fixture.sentA1,
      );

      expect(document?.status).toBe("sent");
      expect(document?.number).toBe(1);
      expect(document?.client).toMatchObject({
        name: "A first client",
        billingAddressLine1: "1 Market St",
        billingCity: "San Francisco",
      });
      expect(document?.lines).toHaveLength(1);
      void tx;
    });
  });

  it("is undefined for a draft or a void invoice, even to its own agency's staff (AC-1)", async () => {
    await inRollback(async (_tx, fixture) => {
      expect(
        await getInvoiceDocument(staffOf(fixture, "A"), fixture.draftA1),
      ).toBeUndefined();
      expect(
        await getInvoiceDocument(staffOf(fixture, "A"), fixture.voidA1),
      ).toBeUndefined();
    });
  });

  it("is undefined for another agency's staff (AC-1, AC-7)", async () => {
    await inRollback(async (_tx, fixture) => {
      expect(
        await getInvoiceDocument(staffOf(fixture, "B"), fixture.sentA1),
      ).toBeUndefined();
    });
  });

  it("is undefined for a non uuid (AC-1)", async () => {
    await inRollback(async (_tx, fixture) => {
      expect(
        await getInvoiceDocument(staffOf(fixture, "A"), "not-a-uuid"),
      ).toBeUndefined();
    });
  });

  it("returns the invoice for the invoiced client's own contact (AC-2)", async () => {
    await inRollback(async (_tx, fixture) => {
      const document = await getInvoiceDocument(
        contactOf(fixture, "A1"),
        fixture.sentA1,
      );

      expect(document?.status).toBe("sent");
    });
  });

  it("is undefined for a contact of a different client of the same agency (AC-2, AC-7)", async () => {
    await inRollback(async (_tx, fixture) => {
      expect(
        await getInvoiceDocument(contactOf(fixture, "A1"), fixture.paidA2),
      ).toBeUndefined();
    });
  });

  it("is undefined for a contact reading a draft (AC-2)", async () => {
    await inRollback(async (_tx, fixture) => {
      expect(
        await getInvoiceDocument(contactOf(fixture, "A1"), fixture.draftA1),
      ).toBeUndefined();
    });
  });

  it("still returns a paid invoice to a contact whose client has since been archived (AC-2)", async () => {
    await inRollback(async (_tx, fixture) => {
      const document = await getInvoiceDocument(
        contactOf(fixture, "A2"),
        fixture.paidA2,
      );

      expect(document?.status).toBe("paid");
      expect(document?.client.name).toBe("A second client");
    });
  });
});
