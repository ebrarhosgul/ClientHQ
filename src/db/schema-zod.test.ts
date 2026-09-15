/**
 * @vitest-environment node
 *
 * covers: spec 0002 AC-5 (the insert schemas carry the same rules as the
 * database CHECK constraints, so bad input is refused with a readable message
 * rather than as a constraint violation), AC-11 (emails are lowercased at the
 * boundary, which is what lets `client_contacts(client_id, email)` mean one
 * contact per person per client)
 *
 * The pairing is the point. Every rule asserted here has a CHECK constraint
 * behind it; if the two ever disagreed the database would still refuse the
 * write, but the person would see a constraint name instead of a sentence. The
 * lowercasing is stronger than that: without it the CHECK would simply reject
 * a perfectly ordinary `Ada@example.com`.
 *
 * It sits here rather than beside `src/db/schema/zod.ts` for the same reason as
 * `schema.test.ts`: `drizzle.config.ts` treats every `.ts` file under
 * `src/db/schema/` as schema, so a test file there breaks
 * `pnpm db:migrate:check`.
 */
import { describe, expect, it } from "vitest";

import { newId } from "@/lib/id";

import {
  insertClientContactSchema,
  insertClientSchema,
  insertDeliverableSchema,
  insertInvoiceLineItemSchema,
  insertInvoiceSchema,
  insertMembershipSchema,
  insertOrganizationSchema,
  insertProcessedWebhookEventSchema,
  insertProjectSchema,
  insertUserSchema,
  selectInvoiceSchema,
} from "./schema/zod";

/** The columns with no default, which every insert has to carry. */
const organization = () => ({
  id: newId(),
  clerkOrgId: "org_2abc",
  name: "Studio North",
  slug: "studio-north",
});

const user = () => ({
  id: newId(),
  clerkUserId: "user_2abc",
  email: "ada@example.com",
});

const client = () => ({ id: newId(), orgId: newId(), name: "Northwind" });

const contact = () => ({
  id: newId(),
  orgId: newId(),
  clientId: newId(),
  email: "ada@example.com",
  name: "Ada Lovelace",
});

const invoice = () => ({
  id: newId(),
  orgId: newId(),
  clientId: newId(),
  currency: "USD",
});

const lineItem = () => ({
  id: newId(),
  orgId: newId(),
  invoiceId: newId(),
  description: "Discovery workshop",
  quantity: "2.5",
  unitAmountCents: 1000,
  amountCents: 2500,
  position: 1,
});

/** The first message, so a failing expectation says which rule refused. */
const problem = (result: {
  success: boolean;
  error?: { issues: readonly { message: string }[] };
}): string => (result.success ? "" : (result.error?.issues[0]?.message ?? ""));

describe("emails are lowercased and trimmed at the boundary (AC-11)", () => {
  it("lowercases a user's email, so users_email_lowercase_check can hold", () => {
    const result = insertUserSchema.safeParse({
      ...user(),
      email: "  Ada@Example.COM  ",
    });
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("lowercases a contact's email, so Ada@x.com and ada@x.com are one contact", () => {
    const result = insertClientContactSchema.safeParse({
      ...contact(),
      email: "Ada@X.com",
    });
    expect(result.success && result.data.email).toBe("ada@x.com");
  });

  it("lowercases a client's company email too", () => {
    const result = insertClientSchema.safeParse({
      ...client(),
      companyEmail: "Hello@Northwind.example",
    });
    expect(result.success && result.data.companyEmail).toBe(
      "hello@northwind.example",
    );
  });

  it.each(["not-an-email", "ada@", "@example.com", "ada example.com", ""])(
    "refuses %o as an email",
    (email) => {
      expect(insertUserSchema.safeParse({ ...user(), email }).success).toBe(
        false,
      );
    },
  );

  it("leaves a client with no company email alone, because the column is nullable", () => {
    expect(insertClientSchema.safeParse(client()).success).toBe(true);
    expect(
      insertClientSchema.safeParse({ ...client(), companyEmail: null }).success,
    ).toBe(true);
  });
});

describe("currency matches invoices_currency_check (AC-5)", () => {
  it("uppercases a lowercase code, so the CHECK sees what it expects", () => {
    const result = insertInvoiceSchema.safeParse({
      ...invoice(),
      currency: " usd ",
    });
    expect(result.success && result.data.currency).toBe("USD");
  });

  it.each(["US", "USDD", "US1", "US$", ""])("refuses %o", (currency) => {
    const result = insertInvoiceSchema.safeParse({ ...invoice(), currency });
    expect(result.success).toBe(false);
    expect(problem(result)).toBe("Currency must be a three letter code");
  });

  it("takes any well formed code, not only a list that would go stale", () => {
    for (const currency of ["USD", "EUR", "GBP", "JPY", "XYZ"]) {
      expect(
        insertInvoiceSchema.safeParse({ ...invoice(), currency }).success,
        currency,
      ).toBe(true);
    }
  });
});

describe("invoice money matches its CHECK constraints (AC-5)", () => {
  it.each([0, 1, 5000, 10000])(
    "takes a tax rate of %d basis points",
    (taxRateBp) => {
      expect(
        insertInvoiceSchema.safeParse({ ...invoice(), taxRateBp }).success,
      ).toBe(true);
    },
  );

  it.each([10001, -1, 1.5])("refuses a tax rate of %d", (taxRateBp) => {
    expect(
      insertInvoiceSchema.safeParse({ ...invoice(), taxRateBp }).success,
    ).toBe(false);
  });

  it.each(["subtotalCents", "taxCents", "totalCents"])(
    "refuses a negative %s, matching invoices_money_non_negative_check",
    (field) => {
      expect(
        insertInvoiceSchema.safeParse({ ...invoice(), [field]: -1 }).success,
      ).toBe(false);
    },
  );

  it.each(["subtotalCents", "taxCents", "totalCents"])(
    "refuses a fractional %s, because the column holds whole cents",
    (field) => {
      expect(
        insertInvoiceSchema.safeParse({ ...invoice(), [field]: 12.5 }).success,
      ).toBe(false);
    },
  );

  it("lets the money columns fall back to their database defaults on a fresh draft", () => {
    const result = insertInvoiceSchema.safeParse(invoice());
    expect(result.success).toBe(true);
    expect(result.success && "subtotalCents" in result.data).toBe(false);
  });

  it("allows a null invoice number, because a draft has not been issued yet", () => {
    expect(
      insertInvoiceSchema.safeParse({ ...invoice(), number: null }).success,
    ).toBe(true);
    expect(insertInvoiceSchema.safeParse(invoice()).success).toBe(true);
  });

  it.each([0, -1])(
    "refuses invoice number %d, since numbering starts at 1",
    (number) => {
      expect(
        insertInvoiceSchema.safeParse({ ...invoice(), number }).success,
      ).toBe(false);
    },
  );
});

describe("line item quantity matches numeric(12,3) (AC-3, AC-5)", () => {
  it.each(["1", "2.5", "0.001", "999999999.999", " 2.5 "])(
    "takes %o",
    (quantity) => {
      expect(
        insertInvoiceLineItemSchema.safeParse({ ...lineItem(), quantity })
          .success,
      ).toBe(true);
    },
  );

  it.each([
    ["1e3", "scientific notation is not a plain decimal"],
    ["-1", "a negative quantity would fail the positive CHECK"],
    ["1.0001", "four decimals do not fit numeric(12,3)"],
    ["1234567890", "ten whole digits do not fit numeric(12,3)"],
    ["", "empty is not a number"],
    [".", "a bare point is not a number"],
    ["1,5", "a comma is not a decimal point here"],
    ["Infinity", "not a number at all"],
  ])("refuses %o, because %s", (quantity) => {
    const result = insertInvoiceLineItemSchema.safeParse({
      ...lineItem(),
      quantity,
    });
    expect(result.success).toBe(false);
    expect(problem(result)).toContain("Quantity must be a plain decimal");
  });

  it("refuses a negative unit amount, matching invoice_line_items_money_non_negative_check", () => {
    expect(
      insertInvoiceLineItemSchema.safeParse({
        ...lineItem(),
        unitAmountCents: -5,
      }).success,
    ).toBe(false);
  });

  it.each([0, -1])(
    "refuses position %d, matching invoice_line_items_position_check",
    (position) => {
      expect(
        insertInvoiceLineItemSchema.safeParse({ ...lineItem(), position })
          .success,
      ).toBe(false);
    },
  );

  it("takes position 1, the first line", () => {
    expect(
      insertInvoiceLineItemSchema.safeParse({ ...lineItem(), position: 1 })
        .success,
    ).toBe(true);
  });
});

describe("the value sets are refused by name, not just by the database", () => {
  it.each(["owner", "ADMIN", "", "guest"])(
    "refuses membership role %o",
    (role) => {
      expect(
        insertMembershipSchema.safeParse({
          id: newId(),
          orgId: newId(),
          userId: newId(),
          role,
        }).success,
      ).toBe(false);
    },
  );

  it.each(["stripe", "clerk"])("takes webhook source %o", (source) => {
    expect(
      insertProcessedWebhookEventSchema.safeParse({
        id: newId(),
        source,
        eventId: "evt_1",
        eventType: "invoice.paid",
      }).success,
    ).toBe(true);
  });

  it.each(["github", "STRIPE", "resend"])(
    "refuses webhook source %o",
    (source) => {
      expect(
        insertProcessedWebhookEventSchema.safeParse({
          id: newId(),
          source,
          eventId: "evt_1",
          eventType: "invoice.paid",
        }).success,
      ).toBe(false);
    },
  );

  it("refuses a project status outside the four the spec names", () => {
    const base = {
      id: newId(),
      orgId: newId(),
      clientId: newId(),
      name: "Brand refresh",
    };
    expect(
      insertProjectSchema.safeParse({ ...base, status: "in_progress" }).success,
    ).toBe(true);
    expect(
      insertProjectSchema.safeParse({ ...base, status: "cancelled" }).success,
    ).toBe(false);
  });

  it("refuses a negative deliverable size", () => {
    const base = {
      id: newId(),
      orgId: newId(),
      projectId: newId(),
      name: "Logo pack.zip",
      r2Key: "key",
      contentType: "application/zip",
      uploadedByUserId: newId(),
    };
    expect(
      insertDeliverableSchema.safeParse({ ...base, sizeBytes: 0 }).success,
    ).toBe(true);
    expect(
      insertDeliverableSchema.safeParse({ ...base, sizeBytes: -1 }).success,
    ).toBe(false);
  });
});

describe("every id crossing the boundary is a uuid", () => {
  it("refuses an id that is not a uuid, so a Clerk id string can never land in an id column", () => {
    expect(
      insertUserSchema.safeParse({ ...user(), id: "user_2abc" }).success,
    ).toBe(false);
  });

  it("refuses an org_id that is not a uuid", () => {
    expect(
      insertClientSchema.safeParse({ ...client(), orgId: "org_2abc" }).success,
    ).toBe(false);
  });

  it("takes an id that newId() made", () => {
    expect(insertUserSchema.safeParse(user()).success).toBe(true);
  });
});

describe("the organization insert schema", () => {
  /**
   * `next_invoice_number` defaults to 1 and `default_currency` to 'USD' in the
   * database, so the Clerk `organization.created` handler has nothing to say
   * about either. Every other schema in `zod.ts` that overrides a defaulted
   * column marks the override `.optional()` for exactly this reason; see the
   * four on `insertInvoiceSchema`. These two were missed, which makes this
   * insert schema unusable for the one write it exists to describe.
   */
  it("takes an organization with only the columns a Clerk webhook knows, leaving the counter and currency to their database defaults", () => {
    const result = insertOrganizationSchema.safeParse(organization());
    expect(result.success, problem(result)).toBe(true);
  });

  it("refuses an invoice counter below 1", () => {
    expect(
      insertOrganizationSchema.safeParse({
        ...organization(),
        nextInvoiceNumber: 0,
        defaultCurrency: "USD",
      }).success,
    ).toBe(false);
  });

  it("uppercases the default currency", () => {
    const result = insertOrganizationSchema.safeParse({
      ...organization(),
      nextInvoiceNumber: 1,
      defaultCurrency: "eur",
    });
    expect(result.success && result.data.defaultCurrency).toBe("EUR");
  });

  it("refuses a default currency that is not three letters", () => {
    expect(
      insertOrganizationSchema.safeParse({
        ...organization(),
        nextInvoiceNumber: 1,
        defaultCurrency: "EURO",
      }).success,
    ).toBe(false);
  });
});

describe("the select schemas describe a row as it comes back", () => {
  it("accepts a full invoice row, quantity and all", () => {
    const row = {
      id: newId(),
      orgId: newId(),
      clientId: newId(),
      number: 1,
      status: "sent",
      issueDate: "2026-08-20",
      dueDate: "2026-09-19",
      currency: "USD",
      subtotalCents: 4001,
      taxRateBp: 2000,
      taxCents: 800,
      totalCents: 4801,
      paidAt: null,
      notes: null,
      createdAt: new Date("2026-08-20T09:00:00Z"),
      updatedAt: new Date("2026-08-20T09:00:00Z"),
    };
    const result = selectInvoiceSchema.safeParse(row);
    expect(result.success, problem(result)).toBe(true);
  });

  it("refuses a row whose status is not one of the five", () => {
    expect(
      selectInvoiceSchema.safeParse({
        id: newId(),
        orgId: newId(),
        clientId: newId(),
        number: 1,
        status: "cancelled",
        issueDate: null,
        dueDate: null,
        currency: "USD",
        subtotalCents: 0,
        taxRateBp: 0,
        taxCents: 0,
        totalCents: 0,
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).success,
    ).toBe(false);
  });
});
