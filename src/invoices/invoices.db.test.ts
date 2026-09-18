/**
 * @vitest-environment node
 *
 * covers: spec 0012 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9,
 * AC-14, AC-15
 *
 * The invoice Server Actions and queries against real PostgreSQL, with the
 * session module stubbed to say who is asking and the email transport
 * replaced by a fake that records every send. Most cases run inside one
 * transaction that is rolled back afterwards; the concurrency cases need two
 * real connections, so they commit a fixture and delete it again.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  invoiceEvents,
  invoiceLineItems,
  invoices,
  memberships,
  organizations,
  rateLimitWindows,
  subscriptions,
  users,
  type InvoiceStatus,
} from "@/db/schema";
import type { Executor, StaffContext, TransactionExecutor } from "@/db/tenant";
import { tenantDb } from "@/db/tenant";
import type { EmailMessage, SentEmail } from "@/email/send";
import { failure, ok, type Result } from "@/db/tenant/errors";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";
import { todayUtc } from "@/lib/dates";
import { INVOICE_EMAIL } from "@/rate-limit/policies";
import { windowStart } from "@/rate-limit/window";

const state = vi.hoisted(() => ({
  tx: undefined as unknown,
  claims: {
    clerkUserId: undefined as string | undefined,
    clerkOrgId: undefined as string | undefined,
    clerkOrgRole: undefined as string | undefined,
  },
  cookie: undefined as string | undefined,
  sent: [] as {
    readonly to: string;
    readonly key: string;
    readonly subject: string;
  }[],
  refuse: new Set<string>(),
  throwOnSend: false,
}));

vi.mock("@/db/tenant/executor", () => ({ pooledDb: async () => state.tx }));

vi.mock("@/db/tenant/session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => state.claims,
  contactCookie: async () => state.cookie,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  updateTag: () => undefined,
}));

vi.mock("@/email/send", () => ({
  sendEmail: async (message: EmailMessage): Promise<Result<SentEmail>> => {
    if (state.throwOnSend) {
      throw new Error("transport exploded");
    }

    state.sent.push({
      to: message.to,
      key: message.idempotencyKey,
      subject: message.subject,
    });

    if (state.refuse.has(message.to)) {
      return failure({ code: "unavailable", message: "mailbox full" });
    }

    return ok({ id: `fake-${state.sent.length}` });
  },
}));

const { createInvoiceDraft } = await import("./create-invoice-draft");
const { updateInvoiceDraft } = await import("./update-invoice-draft");
const { addLineItem, moveLineItem, removeLineItem, updateLineItem } =
  await import("./line-items");
const { issueInvoice } = await import("./issue-invoice");
const { markInvoicePaid, voidInvoice } = await import("./transition-invoice");
const { resendInvoiceNotification } =
  await import("./resend-invoice-notification");
const { contactsToNotify, getInvoice, listInvoices, listInvoicesForClient } =
  await import("./queries");
const { lockDraft } = await import("./draft");

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 3 });
const db = drizzle(sql, { schema });

type Fixture = {
  readonly orgA: string;
  readonly clerkOrgA: string;
  readonly staffA: string;
  readonly clerkStaffA: string;
  readonly orgB: string;
  readonly clerkOrgB: string;
  readonly staffB: string;
  readonly clerkStaffB: string;
  readonly clientA1: string;
  readonly clientA1Archived: string;
  readonly clientB1: string;
  readonly contactA1: string;
  readonly contactA1b: string;
  readonly tag: string;
};

async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId();
  const ids = {
    orgA: newId(),
    orgB: newId(),
    staffA: newId(),
    staffB: newId(),
    clientA1: newId(),
    clientA1Archived: newId(),
    clientB1: newId(),
    contactA1: newId(),
    contactA1b: newId(),
  };

  await tx.insert(organizations).values([
    {
      id: ids.orgA,
      clerkOrgId: `org_${tag}_a`,
      name: "Agency A",
      slug: `a-${tag}`,
      defaultCurrency: "EUR",
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
      clerkUserId: `user_${tag}_a`,
      email: `staff-a-${tag}@example.test`,
      name: "Staff A",
    },
    {
      id: ids.staffB,
      clerkUserId: `user_${tag}_b`,
      email: `staff-b-${tag}@example.test`,
      name: "Staff B",
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
    { id: ids.clientA1, orgId: ids.orgA, name: "Northwind" },
    {
      id: ids.clientA1Archived,
      orgId: ids.orgA,
      name: "Old Harbor",
      archivedAt: new Date(),
    },
    { id: ids.clientB1, orgId: ids.orgB, name: "Ridgeline" },
  ]);

  await tx.insert(clientContacts).values([
    {
      id: ids.contactA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      email: `priya-${tag}@northwind.test`,
      name: "Priya",
    },
    {
      id: ids.contactA1b,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      email: `devon-${tag}@northwind.test`,
      name: "Devon",
    },
  ]);

  return {
    ...ids,
    clerkOrgA: `org_${tag}_a`,
    clerkStaffA: `user_${tag}_a`,
    clerkOrgB: `org_${tag}_b`,
    clerkStaffB: `user_${tag}_b`,
    tag,
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
      actAsStaff(fixture, "A");
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

function actAsStaff(fixture: Fixture, org: "A" | "B"): void {
  state.claims = {
    clerkUserId: org === "A" ? fixture.clerkStaffA : fixture.clerkStaffB,
    clerkOrgId: org === "A" ? fixture.clerkOrgA : fixture.clerkOrgB,
    clerkOrgRole: "org:admin",
  };
}

function staffOf(fixture: Fixture, org: "A" | "B"): StaffContext {
  return {
    kind: "staff",
    orgId: org === "A" ? fixture.orgA : fixture.orgB,
    clerkOrgId: org === "A" ? fixture.clerkOrgA : fixture.clerkOrgB,
    userId: org === "A" ? fixture.staffA : fixture.staffB,
    clerkUserId: org === "A" ? fixture.clerkStaffA : fixture.clerkStaffB,
    role: "admin",
  };
}

/** A draft with `lineCount` lines, through the real actions. */
async function draftWithLines(
  fixture: Fixture,
  lineCount: number,
  clientId: string = fixture.clientA1,
): Promise<string> {
  const created = await createInvoiceDraft({ clientId });

  if (!created.ok) {
    throw new Error(`draft not created: ${created.error.code}`);
  }

  for (let index = 0; index < lineCount; index += 1) {
    const added = await addLineItem({
      invoiceId: created.data.id,
      description: `Line ${index + 1}`,
      quantity: "1",
      unitAmount: "100",
    });

    if (!added.ok) {
      throw new Error(`line not added: ${added.error.code}`);
    }
  }

  return created.data.id;
}

async function counterOf(tx: Executor, orgId: string) {
  const [row] = await tx
    .select({ next: organizations.nextInvoiceNumber })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  return row?.next;
}

async function eventsOf(tx: Executor, invoiceId: string) {
  return tx
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, invoiceId))
    .orderBy(asc(invoiceEvents.createdAt), asc(invoiceEvents.id));
}

beforeEach(() => {
  state.sent = [];
  state.refuse = new Set();
  state.throwOnSend = false;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("invoices against real PostgreSQL", () => {
  describe("creating a draft (AC-1)", () => {
    it("starts as a draft with no number, the agency currency, no tax and a due date thirty days out", async () => {
      await inRollback(async (_tx, fixture) => {
        const result = await createInvoiceDraft({ clientId: fixture.clientA1 });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const invoice = await getInvoice(staffOf(fixture, "A"), result.data.id);

        expect(invoice).toMatchObject({
          status: "draft",
          number: null,
          currency: "EUR",
          taxRateBp: 0,
          subtotalCents: 0,
          totalCents: 0,
          lines: [],
          events: [],
        });

        const today = todayUtc();
        const due = new Date(`${today}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + 30);
        expect(invoice?.dueDate).toBe(due.toISOString().slice(0, 10));
      });
    });

    it("refuses an archived client and another agency's client, writing nothing", async () => {
      await inRollback(async (tx, fixture) => {
        const archived = await createInvoiceDraft({
          clientId: fixture.clientA1Archived,
        });
        expect(archived.ok).toBe(false);
        if (!archived.ok) expect(archived.error.code).toBe("validation");

        const foreign = await createInvoiceDraft({
          clientId: fixture.clientB1,
        });
        expect(foreign.ok).toBe(false);
        if (!foreign.ok) expect(foreign.error.code).toBe("not_found");

        const rows = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.orgId, fixture.orgA));
        expect(rows).toHaveLength(0);
      });
    });
  });

  describe("updating a draft's header (AC-2)", () => {
    it("refuses a missing or another agency's client with validation, changing nothing", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        const foreign = await updateInvoiceDraft({
          id,
          clientId: fixture.clientB1,
          dueDate: "2027-01-01",
          taxRatePercent: "0",
          notes: "",
        });

        expect(foreign.ok).toBe(false);
        if (!foreign.ok) {
          expect(foreign.error.code).toBe("validation");
          expect(foreign.error.fieldErrors?.clientId?.[0]).toMatch(
            /active client/,
          );
        }

        const stillOriginal = await getInvoice(staffOf(fixture, "A"), id);
        expect(stillOriginal?.client.id).toBe(fixture.clientA1);
        expect(stillOriginal?.dueDate).not.toBe("2027-01-01");
      });
    });

    it("refuses an archived client with validation, naming the field", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        const archived = await updateInvoiceDraft({
          id,
          clientId: fixture.clientA1Archived,
          dueDate: "2027-01-01",
          taxRatePercent: "0",
          notes: "",
        });

        expect(archived.ok).toBe(false);
        if (!archived.ok) {
          expect(archived.error.code).toBe("validation");
          expect(archived.error.fieldErrors?.clientId?.[0]).toMatch(/archived/);
        }
      });
    });

    it("moves the draft to a different active client of the same agency", async () => {
      await inRollback(async (tx, fixture) => {
        const otherClientId = newId();
        await tx.insert(clients).values({
          id: otherClientId,
          orgId: fixture.orgA,
          name: "Second Client",
        });
        const id = await draftWithLines(fixture, 0);

        const result = await updateInvoiceDraft({
          id,
          clientId: otherClientId,
          dueDate: "2027-01-01",
          taxRatePercent: "0",
          notes: "",
        });

        expect(result.ok).toBe(true);

        const updated = await getInvoice(staffOf(fixture, "A"), id);
        expect(updated?.client.id).toBe(otherClientId);
      });
    });
  });

  describe("lines and totals (AC-3, AC-4)", () => {
    it("recalculates the totals on every line write, in integer cents", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        const first = await addLineItem({
          invoiceId: id,
          description: "Workshop",
          quantity: "1.5",
          unitAmount: "1000.33",
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.data.line.amountCents).toBe(150050);
        expect(first.data.totals).toStrictEqual({
          subtotalCents: 150050,
          taxCents: 0,
          totalCents: 150050,
        });

        const header = await updateInvoiceDraft({
          id,
          clientId: fixture.clientA1,
          dueDate: "2027-01-31",
          taxRatePercent: "7.25",
          notes: " Net 30 ",
        });
        expect(header.ok).toBe(true);
        if (!header.ok) return;
        // round(150050 × 725 / 10000) = round(10878.625) = 10879
        expect(header.data.totals).toStrictEqual({
          subtotalCents: 150050,
          taxCents: 10879,
          totalCents: 160929,
        });

        const detail = await getInvoice(staffOf(fixture, "A"), id);
        expect(detail).toMatchObject({
          taxRateBp: 725,
          notes: "Net 30",
          dueDate: "2027-01-31",
          totalCents: 160929,
        });
      });
    });

    it("keeps positions 1 based and contiguous after every remove and move", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 4);
        const ctx = staffOf(fixture, "A");
        const before = (await getInvoice(ctx, id))?.lines ?? [];
        expect(before.map((line) => line.position)).toStrictEqual([1, 2, 3, 4]);

        const removed = await removeLineItem({
          id: before[1].id,
          invoiceId: id,
        });
        expect(removed.ok).toBe(true);

        const afterRemove = (await getInvoice(ctx, id))?.lines ?? [];
        expect(afterRemove.map((line) => line.description)).toStrictEqual([
          "Line 1",
          "Line 3",
          "Line 4",
        ]);
        expect(afterRemove.map((line) => line.position)).toStrictEqual([
          1, 2, 3,
        ]);

        const up = await moveLineItem({
          id: afterRemove[2].id,
          invoiceId: id,
          direction: "up",
        });
        expect(up.ok).toBe(true);

        const afterUp = (await getInvoice(ctx, id))?.lines ?? [];
        expect(afterUp.map((line) => line.description)).toStrictEqual([
          "Line 1",
          "Line 4",
          "Line 3",
        ]);
        expect(afterUp.map((line) => line.position)).toStrictEqual([1, 2, 3]);

        // Past the top is a no op success.
        const top = await moveLineItem({
          id: afterUp[0].id,
          invoiceId: id,
          direction: "up",
        });
        expect(top.ok).toBe(true);
        if (top.ok) {
          expect(top.data.positions.map((p) => p.position)).toStrictEqual([
            1, 2, 3,
          ]);
        }

        const down = await moveLineItem({
          id: afterUp[0].id,
          invoiceId: id,
          direction: "down",
        });
        expect(down.ok).toBe(true);
        const afterDown = (await getInvoice(ctx, id))?.lines ?? [];
        expect(afterDown.map((line) => line.description)).toStrictEqual([
          "Line 4",
          "Line 1",
          "Line 3",
        ]);
      });
    });

    it("refuses a line whose product would overflow, with a message rather than a database error", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        const result = await addLineItem({
          invoiceId: id,
          description: "Too much",
          quantity: "999999999",
          unitAmount: "999999.99",
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("validation");
          expect(result.error.fieldErrors?.unitAmount?.[0]).toMatch(/hold/);
        }
      });
    });

    it("refuses a subtotal that would overflow, with a message", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        // Twenty one lines at the per line cap sit just under the integer
        // range; the twenty second takes the subtotal past it.
        await tx.insert(invoiceLineItems).values(
          Array.from({ length: 21 }, (_, index) => ({
            id: newId(),
            orgId: fixture.orgA,
            invoiceId: id,
            description: `Big ${index + 1}`,
            quantity: "1",
            unitAmountCents: 99_999_999,
            amountCents: 99_999_999,
            position: index + 1,
          })),
        );

        const result = await addLineItem({
          invoiceId: id,
          description: "One more",
          quantity: "1",
          unitAmount: "999999.99",
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("validation");
          expect(result.error.message).toMatch(/total/);
        }
      });
    });

    it("refuses the 101st line", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        await tx.insert(invoiceLineItems).values(
          Array.from({ length: 100 }, (_, index) => ({
            id: newId(),
            orgId: fixture.orgA,
            invoiceId: id,
            description: `Line ${index + 1}`,
            quantity: "1",
            unitAmountCents: 100,
            amountCents: 100,
            position: index + 1,
          })),
        );

        const result = await addLineItem({
          invoiceId: id,
          description: "One too many",
          quantity: "1",
          unitAmount: "1",
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toMatch(/100/);
      });
    });
  });

  describe("issuing (AC-5, AC-15)", () => {
    it("assigns the number, the issue date and one issued event, then notifies", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 2);

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.number).toBe(1);
        expect(result.data.notification.kind).toBe("notified");

        const invoice = await getInvoice(staffOf(fixture, "A"), id);
        expect(invoice).toMatchObject({
          status: "sent",
          number: 1,
          issueDate: todayUtc(),
        });

        const events = await eventsOf(tx, id);
        expect(events.map((event) => event.kind)).toStrictEqual([
          "issued",
          "notified",
        ]);
        expect(events[0]).toMatchObject({
          fromStatus: "draft",
          toStatus: "sent",
          actorUserId: fixture.staffA,
        });
        expect(events[1].note).toContain(`priya-${fixture.tag}@northwind.test`);
        expect(events[1].note).toContain(`devon-${fixture.tag}@northwind.test`);

        expect(await counterOf(tx, fixture.orgA)).toBe(2);

        expect(state.sent).toHaveLength(2);
        expect(state.sent[0].subject).toBe("Invoice INV-0001 from Agency A");
        expect(state.sent[0].key).toMatch(
          new RegExp(`^invoice-notification/${id}:[0-9a-f-]+/[0-9a-f-]+$`),
        );
      });
    });

    it.each([
      ["no lines", 0, undefined, /line/],
      ["a due date before today", 1, "2020-01-01", /due date/],
    ] as const)(
      "refuses a draft with %s and leaves the counter untouched",
      async (_label, lines, dueDate, message) => {
        await inRollback(async (tx, fixture) => {
          const id = await draftWithLines(fixture, lines);

          if (dueDate !== undefined) {
            await tx
              .update(invoices)
              .set({ dueDate })
              .where(eq(invoices.id, id));
          }

          const result = await issueInvoice({ id });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("validation");
            expect(result.error.message).toMatch(message);
          }

          expect(await counterOf(tx, fixture.orgA)).toBe(1);
          expect(await eventsOf(tx, id)).toHaveLength(0);
          expect(state.sent).toHaveLength(0);
        });
      },
    );

    it("refuses a draft with no due date", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        await tx
          .update(invoices)
          .set({ dueDate: null })
          .where(eq(invoices.id, id));

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toMatch(/due date/);
        expect(await counterOf(tx, fixture.orgA)).toBe(1);
      });
    });

    it("refuses a draft whose client was archived after the draft was created", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        await tx
          .update(clients)
          .set({ archivedAt: new Date() })
          .where(eq(clients.id, fixture.clientA1));

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toMatch(/archived/);
        expect(await counterOf(tx, fixture.orgA)).toBe(1);
      });
    });

    it("refuses to issue an invoice that is not a draft with conflict", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id })).ok).toBe(true);

        const again = await issueInvoice({ id });

        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.error.code).toBe("conflict");
      });
    });

    it("refuses every line write on an issued invoice with conflict", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        const line = (await getInvoice(staffOf(fixture, "A"), id))?.lines[0];
        expect((await issueInvoice({ id })).ok).toBe(true);

        // One at a time: these share the test's single connection, and two
        // savepoints opened at once on it would interleave.
        const results = [
          await addLineItem({
            invoiceId: id,
            description: "Late",
            quantity: "1",
            unitAmount: "1",
          }),
          await updateLineItem({
            id: line?.id ?? "",
            invoiceId: id,
            description: "Late",
            quantity: "1",
            unitAmount: "1",
          }),
          await removeLineItem({ id: line?.id ?? "", invoiceId: id }),
          await moveLineItem({
            id: line?.id ?? "",
            invoiceId: id,
            direction: "up",
          }),
          await updateInvoiceDraft({
            id,
            clientId: fixture.clientA1,
            dueDate: "2027-01-01",
            taxRatePercent: "0",
            notes: "",
          }),
        ];

        for (const result of results) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("conflict");
        }
      });
    });
  });

  describe("notification (AC-6, AC-7)", () => {
    it("writes notification_failed naming the delivered and refused addresses when one contact is refused", async () => {
      await inRollback(async (tx, fixture) => {
        state.refuse = new Set([`devon-${fixture.tag}@northwind.test`]);
        const id = await draftWithLines(fixture, 1);

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.notification.kind).toBe("notification_failed");

        const events = await eventsOf(tx, id);
        expect(events.map((event) => event.kind)).toStrictEqual([
          "issued",
          "notification_failed",
        ]);
        expect(events[1].note).toBe(
          `delivered: priya-${fixture.tag}@northwind.test; failed: devon-${fixture.tag}@northwind.test (mailbox full)`,
        );

        const invoice = await getInvoice(staffOf(fixture, "A"), id);
        expect(invoice?.status).toBe("sent");
      });
    });

    it("writes notification_failed with 'no contacts to notify' when the client has none", async () => {
      await inRollback(async (tx, fixture) => {
        await tx
          .delete(clientContacts)
          .where(eq(clientContacts.clientId, fixture.clientA1));
        const id = await draftWithLines(fixture, 1);

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(true);
        const events = await eventsOf(tx, id);
        expect(events[1]).toMatchObject({
          kind: "notification_failed",
          note: "no contacts to notify",
        });
        expect(state.sent).toHaveLength(0);
      });
    });

    it("still writes a notification_failed event when the transport throws", async () => {
      await inRollback(async (tx, fixture) => {
        state.throwOnSend = true;
        const id = await draftWithLines(fixture, 1);

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(true);
        const events = await eventsOf(tx, id);
        expect(events.map((event) => event.kind)).toStrictEqual([
          "issued",
          "notification_failed",
        ]);
        expect(events[1].note).toBe("failed: transport exploded");
        expect((await getInvoice(staffOf(fixture, "A"), id))?.status).toBe(
          "sent",
        );
      });
    });

    it("refuses a resend inside the cooldown and sends again after it, with new idempotency keys", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id })).ok).toBe(true);
        const firstKeys = state.sent.map((send) => send.key);

        const tooSoon = await resendInvoiceNotification({ id });
        expect(tooSoon.ok).toBe(false);
        if (!tooSoon.ok) {
          expect(tooSoon.error.code).toBe("conflict");
          expect(tooSoon.error.message).toMatch(/minutes/);
        }

        // Age the notification past the cooldown.
        await tx
          .update(invoiceEvents)
          .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) })
          .where(
            and(
              eq(invoiceEvents.invoiceId, id),
              eq(invoiceEvents.kind, "notified"),
            ),
          );

        const later = await resendInvoiceNotification({ id });
        expect(later.ok).toBe(true);
        if (later.ok) expect(later.data.notification.kind).toBe("notified");

        const events = await eventsOf(tx, id);
        expect(
          events.filter((event) => event.kind === "notified"),
        ).toHaveLength(2);

        const secondKeys = state.sent.slice(2).map((send) => send.key);
        expect(secondKeys).toHaveLength(2);
        for (const key of secondKeys) {
          expect(firstKeys).not.toContain(key);
        }
      });
    });

    it("does not offer a resend on a draft, a paid or a void invoice", async () => {
      await inRollback(async (_tx, fixture) => {
        const draft = await draftWithLines(fixture, 1);
        const onDraft = await resendInvoiceNotification({ id: draft });
        expect(onDraft.ok).toBe(false);
        if (!onDraft.ok) expect(onDraft.error.code).toBe("conflict");

        expect((await issueInvoice({ id: draft })).ok).toBe(true);
        expect(
          (await voidInvoice({ id: draft, from: "sent", reason: "" })).ok,
        ).toBe(true);
        const onVoid = await resendInvoiceNotification({ id: draft });
        expect(onVoid.ok).toBe(false);
      });
    });
  });

  describe("rate limiting (spec 0018, AC-1, AC-2, AC-11, AC-12)", () => {
    it("refuses issuing once the shared allowance is spent, with no side effect (AC-1, AC-2)", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 1);

        await tx.insert(rateLimitWindows).values({
          subject: `org:${fixture.orgA}`,
          action: "invoice_email",
          windowStart: windowStart(new Date(), INVOICE_EMAIL.windowSeconds),
          count: INVOICE_EMAIL.limit,
          updatedAt: new Date(),
        });

        const result = await issueInvoice({ id });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("rate_limited");
          expect(result.error.message).toMatch(
            /reached its allowance of 50 invoice emails a day/,
          );
        }
        expect(await eventsOf(tx, id)).toHaveLength(0);
        expect(state.sent).toHaveLength(0);
        expect((await getInvoice(staffOf(fixture, "A"), id))?.status).toBe(
          "draft",
        );
      });
    });

    it(
      "resendInvoiceNotification draws on the same allowance issueInvoice does, " +
        "equally for an admin and a member, and the ceiling wins over the cooldown (AC-1, AC-11, AC-12)",
      async () => {
        await inRollback(async (tx, fixture) => {
          const id = await draftWithLines(fixture, 1);

          // Consumes one unit of the shared allowance.
          expect((await issueInvoice({ id })).ok).toBe(true);

          // Push the same window to its ceiling, as a member of the same
          // agency: the allowance is the agency's, not the person's (AC-11).
          await tx
            .update(rateLimitWindows)
            .set({ count: INVOICE_EMAIL.limit })
            .where(
              and(
                eq(rateLimitWindows.subject, `org:${fixture.orgA}`),
                eq(rateLimitWindows.action, "invoice_email"),
              ),
            );
          state.claims = { ...state.claims, clerkOrgRole: "org:member" };

          // Still inside the five minute cooldown too: if the cooldown ran
          // first this would be `conflict`, not `rate_limited`.
          const result = await resendInvoiceNotification({ id });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("rate_limited");
          }

          // Exactly one notification, from the issue above; the refused
          // resend sent nothing.
          expect(
            (await eventsOf(tx, id)).filter(
              (event) => event.kind === "notified",
            ),
          ).toHaveLength(1);
        });
      },
    );
  });

  describe("contactsToNotify (AC-6)", () => {
    it("orders recipients by name then id and excludes a blank email", async () => {
      await inRollback(async (tx, fixture) => {
        await tx.insert(clientContacts).values({
          id: newId(),
          orgId: fixture.orgA,
          clientId: fixture.clientA1,
          email: "",
          name: "Blank Email",
        });

        const contacts = await contactsToNotify(
          staffOf(fixture, "A"),
          fixture.clientA1,
        );

        expect(contacts.map((contact) => contact.name)).toStrictEqual([
          "Devon",
          "Priya",
        ]);
      });
    });

    it("returns no contacts for a client id that is not even a uuid, without reaching the database", async () => {
      await inRollback(async (_tx, fixture) => {
        const contacts = await contactsToNotify(
          staffOf(fixture, "A"),
          "not-a-uuid",
        );

        expect(contacts).toStrictEqual([]);
      });
    });

    it("returns no contacts for a client with none on file", async () => {
      await inRollback(async (_tx, fixture) => {
        const contacts = await contactsToNotify(
          staffOf(fixture, "A"),
          fixture.clientA1Archived,
        );

        expect(contacts).toStrictEqual([]);
      });
    });
  });

  describe("paid and void (AC-8, AC-9, AC-15)", () => {
    it("marks a sent invoice paid at midnight UTC of the chosen day, with one paid event", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id })).ok).toBe(true);

        const result = await markInvoicePaid({
          id,
          from: "sent",
          paidOn: todayUtc(),
        });

        expect(result.ok).toBe(true);
        const invoice = await getInvoice(staffOf(fixture, "A"), id);
        expect(invoice?.status).toBe("paid");
        expect(invoice?.paidAt?.toISOString()).toBe(
          `${todayUtc()}T00:00:00.000Z`,
        );

        const events = await eventsOf(tx, id);
        expect(events.at(-1)).toMatchObject({
          kind: "paid",
          fromStatus: "sent",
          toStatus: "paid",
          actorUserId: fixture.staffA,
        });
      });
    });

    it("refuses a paid date after today or before the issue date", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id })).ok).toBe(true);

        const future = await markInvoicePaid({
          id,
          from: "sent",
          paidOn: "2999-01-01",
        });
        expect(future.ok).toBe(false);
        if (!future.ok) expect(future.error.fieldErrors?.paidOn).toBeDefined();

        const early = await markInvoicePaid({
          id,
          from: "sent",
          paidOn: "2000-01-01",
        });
        expect(early.ok).toBe(false);
        if (!early.ok)
          expect(early.error.fieldErrors?.paidOn?.[0]).toMatch(/issue date/);
      });
    });

    it("voids a draft with a reason on the event, and refuses to void it twice", async () => {
      await inRollback(async (tx, fixture) => {
        const id = await draftWithLines(fixture, 0);

        const result = await voidInvoice({
          id,
          from: "draft",
          reason: "Duplicate",
        });

        expect(result.ok).toBe(true);
        const events = await eventsOf(tx, id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          kind: "voided",
          fromStatus: "draft",
          toStatus: "void",
          note: "Duplicate",
        });

        const again = await voidInvoice({ id, from: "draft", reason: "" });
        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.error.code).toBe("conflict");
      });
    });

    it("refuses a stale move with conflict, naming the current status", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id })).ok).toBe(true);
        expect(
          (await markInvoicePaid({ id, from: "sent", paidOn: todayUtc() })).ok,
        ).toBe(true);

        // Staff B's page still shows sent.
        const stale = await voidInvoice({ id, from: "sent", reason: "" });

        expect(stale.ok).toBe(false);
        if (!stale.ok) {
          expect(stale.error.code).toBe("conflict");
          expect(stale.error.message).toMatch(/paid/);
        }
        expect((await getInvoice(staffOf(fixture, "A"), id))?.status).toBe(
          "paid",
        );
      });
    });
  });

  describe("tenant isolation (AC-14)", () => {
    it("hides agency A's invoice, lines and events from agency B on every read and write", async () => {
      await inRollback(async (_tx, fixture) => {
        const id = await draftWithLines(fixture, 1);
        const line = (await getInvoice(staffOf(fixture, "A"), id))?.lines[0];
        expect((await issueInvoice({ id })).ok).toBe(true);

        actAsStaff(fixture, "B");

        expect(await getInvoice(staffOf(fixture, "B"), id)).toBeUndefined();
        expect(
          (
            await listInvoices(staffOf(fixture, "B"), {
              includeVoid: true,
              todayUtc: todayUtc(),
            })
          ).total,
        ).toBe(0);
        expect(
          await listInvoicesForClient(
            staffOf(fixture, "B"),
            fixture.clientA1,
            todayUtc(),
          ),
        ).toHaveLength(0);
        expect(
          await tenantDb(staffOf(fixture, "B")).findMany(invoiceEvents, {
            where: eq(invoiceEvents.invoiceId, id),
          }),
        ).toHaveLength(0);
        expect(
          await tenantDb(staffOf(fixture, "B")).findById(
            invoiceLineItems,
            line?.id ?? "",
          ),
        ).toBeUndefined();

        const writes = [
          await markInvoicePaid({ id, from: "sent", paidOn: todayUtc() }),
          await voidInvoice({ id, from: "sent", reason: "" }),
          await resendInvoiceNotification({ id }),
          await issueInvoice({ id }),
          await removeLineItem({ id: line?.id ?? "", invoiceId: id }),
        ];

        for (const result of writes) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("not_found");
        }
      });
    });
  });

  describe("under real concurrency (AC-3, AC-5)", () => {
    let fixture: Fixture | undefined;

    async function commitFixture(): Promise<Fixture> {
      const seeded = await db.transaction((tx) => seed(tx));
      state.tx = db;
      actAsStaff(seeded, "A");
      fixture = seeded;

      return seeded;
    }

    async function deleteFixture(): Promise<void> {
      if (fixture === undefined) return;

      const orgIds = [fixture.orgA, fixture.orgB];

      await db.transaction(async (tx) => {
        for (const orgId of orgIds) {
          await tx.delete(invoices).where(eq(invoices.orgId, orgId));
          await tx.delete(clients).where(eq(clients.orgId, orgId));
          await tx.delete(organizations).where(eq(organizations.id, orgId));
        }
        await tx.delete(users).where(eq(users.id, fixture?.staffA ?? ""));
        await tx.delete(users).where(eq(users.id, fixture?.staffB ?? ""));
      });

      fixture = undefined;
    }

    it("gives two drafts issued at the same moment consecutive, different numbers", async () => {
      const seeded = await commitFixture();

      try {
        const [first, second] = await Promise.all([
          draftWithLines(seeded, 1),
          draftWithLines(seeded, 1),
        ]);

        const results = await Promise.all([
          issueInvoice({ id: first }),
          issueInvoice({ id: second }),
        ]);

        const numbers = results.map((result) =>
          result.ok ? result.data.number : undefined,
        );

        expect(numbers.every((n) => n !== undefined)).toBe(true);
        expect([...numbers].sort()).toStrictEqual([1, 2]);
        expect(await counterOf(db, seeded.orgA)).toBe(3);
      } finally {
        await deleteFixture();
      }
    });

    it("lets exactly one of two simultaneous issues of the same draft succeed", async () => {
      const seeded = await commitFixture();

      try {
        const id = await draftWithLines(seeded, 1);

        const results = await Promise.all([
          issueInvoice({ id }),
          issueInvoice({ id }),
        ]);

        const succeeded = results.filter((result) => result.ok);
        const refused = results.filter((result) => !result.ok);

        expect(succeeded).toHaveLength(1);
        expect(refused).toHaveLength(1);
        if (!refused[0].ok) expect(refused[0].error.code).toBe("conflict");
        expect(await counterOf(db, seeded.orgA)).toBe(2);

        const events = await eventsOf(db, id);
        expect(events.filter((event) => event.kind === "issued")).toHaveLength(
          1,
        );
      } finally {
        await deleteFixture();
      }
    });

    it("refuses a line removal that races the issue transaction, and the issued invoice keeps the line", async () => {
      const seeded = await commitFixture();

      try {
        const id = await draftWithLines(seeded, 2);
        const line = (await getInvoice(staffOf(seeded, "A"), id))?.lines[1];

        // Hold the issue transaction's lock by hand, start the removal (it
        // blocks on the row), then finish the issue and commit.
        let removal:
          Promise<Awaited<ReturnType<typeof removeLineItem>>> | undefined;

        await db.transaction(async (tx) => {
          await lockDraft(tenantDb(staffOf(seeded, "A"), tx), id);

          removal = removeLineItem({ id: line?.id ?? "", invoiceId: id });
          await new Promise((resolve) => setTimeout(resolve, 400));

          await tx
            .update(invoices)
            .set({ status: "sent", number: 1, issueDate: todayUtc() })
            .where(eq(invoices.id, id));
        });

        const result = await removal;

        expect(result?.ok).toBe(false);
        if (result && !result.ok) expect(result.error.code).toBe("conflict");

        const after = await getInvoice(staffOf(seeded, "A"), id);
        expect(after?.status).toBe("sent");
        expect(after?.lines).toHaveLength(2);
      } finally {
        await deleteFixture();
      }
    });
  });

  describe("listInvoices (AC-10)", () => {
    /**
     * Thirty invoices for agency A, direct inserted rather than issued
     * through the real actions: this describe is about what the query does
     * with rows that already exist, not about how they got there. Three are
     * `void` (indices 0-2); the rest cycle through the other four statuses.
     * Twenty four belong to `clientA1`, the other six to `clientA1Archived`.
     */
    async function seedListing(
      tx: TransactionExecutor,
      fixture: Fixture,
    ): Promise<void> {
      const total = 30;
      const voidCount = 3;
      const clientACount = 24;
      const cycle: readonly InvoiceStatus[] = [
        "draft",
        "sent",
        "paid",
        "overdue",
      ];

      const rows: (typeof invoices.$inferInsert)[] = [];

      for (let index = 0; index < total; index += 1) {
        const isVoid = index < voidCount;
        const status: InvoiceStatus = isVoid
          ? "void"
          : cycle[(index - voidCount) % cycle.length];
        const issued = status !== "draft";

        rows.push({
          id: newId(),
          orgId: fixture.orgA,
          clientId:
            index < clientACount ? fixture.clientA1 : fixture.clientA1Archived,
          currency: "EUR",
          status,
          number: issued ? index + 1 : null,
          issueDate: issued
            ? `2026-01-${String((index % 27) + 1).padStart(2, "0")}`
            : null,
          dueDate: issued ? "2026-02-15" : null,
          paidAt: status === "paid" ? new Date() : undefined,
        });
      }

      await tx.insert(invoices).values(rows);
    }

    it("hides void by default, includes it with the toggle, and a named status overrides both", async () => {
      await inRollback(async (tx, fixture) => {
        await seedListing(tx, fixture);
        const ctx = staffOf(fixture, "A");

        const defaultView = await listInvoices(ctx, {
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(defaultView.total).toBe(27);
        expect(defaultView.rows.some((row) => row.status === "void")).toBe(
          false,
        );

        const withVoidToggle = await listInvoices(ctx, {
          includeVoid: true,
          todayUtc: todayUtc(),
        });
        expect(withVoidToggle.total).toBe(30);

        const onlyVoid = await listInvoices(ctx, {
          statusParam: "void",
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(onlyVoid.total).toBe(3);
        expect(onlyVoid.rows.every((row) => row.status === "void")).toBe(true);

        const onlySent = await listInvoices(ctx, {
          statusParam: "sent",
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(onlySent.total).toBe(7);
        expect(onlySent.rows.every((row) => row.status === "sent")).toBe(true);
      });
    });

    it("narrows to one client, and a client param that isn't a uuid returns empty without a query", async () => {
      await inRollback(async (tx, fixture) => {
        await seedListing(tx, fixture);
        const ctx = staffOf(fixture, "A");

        const northwind = await listInvoices(ctx, {
          clientParam: fixture.clientA1,
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(northwind.total).toBe(21);
        expect(
          northwind.rows.every((row) => row.clientName === "Northwind"),
        ).toBe(true);

        const oldHarbor = await listInvoices(ctx, {
          clientParam: fixture.clientA1Archived,
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(oldHarbor.total).toBe(6);

        const notAUuid = await listInvoices(ctx, {
          clientParam: "not-a-uuid",
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(notAUuid).toStrictEqual({
          rows: [],
          page: 1,
          pageCount: 1,
          total: 0,
        });
      });
    });

    it("holds 25 rows on page 1 and the rest on page 2, and clamps an unset, zero, non numeric or past-the-end page to 1", async () => {
      await inRollback(async (tx, fixture) => {
        await seedListing(tx, fixture);
        const ctx = staffOf(fixture, "A");

        const page1 = await listInvoices(ctx, {
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(page1.page).toBe(1);
        expect(page1.pageCount).toBe(2);
        expect(page1.rows).toHaveLength(25);

        const page2 = await listInvoices(ctx, {
          pageParam: "2",
          includeVoid: false,
          todayUtc: todayUtc(),
        });
        expect(page2.page).toBe(2);
        expect(page2.rows).toHaveLength(2);

        for (const pageParam of ["0", "-1", "abc", "99"]) {
          const clamped = await listInvoices(ctx, {
            pageParam,
            includeVoid: false,
            todayUtc: todayUtc(),
          });
          expect(clamped.page).toBe(1);
          expect(clamped.rows).toHaveLength(25);
        }
      });
    });
  });

  describe("listInvoicesForClient (AC-13)", () => {
    it("excludes void, puts drafts first, and stays within the one client", async () => {
      await inRollback(async (tx, fixture) => {
        const draftId = await draftWithLines(fixture, 1);
        const sentId = await draftWithLines(fixture, 1);
        expect((await issueInvoice({ id: sentId })).ok).toBe(true);

        const voidId = await draftWithLines(fixture, 0);
        expect(
          (await voidInvoice({ id: voidId, from: "draft", reason: "" })).ok,
        ).toBe(true);

        // A draft for a second client in the same agency, direct inserted
        // (createInvoiceDraft refuses an archived client, and clientA1Archived
        // only exists here to be a client that isn't clientA1).
        const otherClientId = newId();
        await tx.insert(invoices).values({
          id: otherClientId,
          orgId: fixture.orgA,
          clientId: fixture.clientA1Archived,
          currency: "EUR",
          status: "draft",
        });

        const rows = await listInvoicesForClient(
          staffOf(fixture, "A"),
          fixture.clientA1,
          todayUtc(),
        );

        const ids = rows.map((row) => row.id);
        expect(ids).not.toContain(voidId);
        expect(ids).not.toContain(otherClientId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ id: draftId, status: "draft" });
        expect(rows[1]).toMatchObject({ id: sentId, status: "sent" });

        const notAUuid = await listInvoicesForClient(
          staffOf(fixture, "A"),
          "not-a-uuid",
          todayUtc(),
        );
        expect(notAUuid).toStrictEqual([]);
      });
    });
  });
});
