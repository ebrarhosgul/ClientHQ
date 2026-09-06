import { char, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id, timestamps } from "./helpers";

/**
 * The tenant root. Every tenant scoped table points at a row here through its
 * `org_id`. Not itself tenant scoped. Mirrors a Clerk organization.
 */
export const organizations = pgTable("organizations", {
  id: id(),
  /** The Clerk organization this row mirrors. */
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * The counter that serialises invoice numbering. Issuing an invoice runs
   * `update ... set next_invoice_number = next_invoice_number + 1 ... returning`
   * inside the issuing transaction; the row lock is what keeps two concurrent
   * issuers from taking the same number.
   */
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  /** Copied onto each new invoice draft, then frozen there. */
  defaultCurrency: char("default_currency", { length: 3 })
    .notNull()
    .default("USD"),
  /** Set by the Clerk `organization.deleted` webhook. Soft delete only. */
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  ...timestamps(),
});
