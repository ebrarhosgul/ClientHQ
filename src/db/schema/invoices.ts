import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./clients";
import { id, orgId, timestamps } from "./helpers";
import { users } from "./identity";

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "paid",
  "overdue",
  "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * An invoice is a record the agency keeps and the client reads. No money moves
 * through this platform.
 *
 * The database guarantees the arithmetic it can: `total = subtotal + tax`, and
 * `tax` follows from the stored rate. `subtotal` equals the sum of the line
 * items, which no CHECK can express across rows, so the application keeps that
 * one (spec 0002, Key invariants).
 *
 * Rounding is half away from zero, the same as PostgreSQL `round()` on
 * `numeric`. `src/lib/money.ts` rounds the same way; if the two ever disagree
 * the CHECK rejects the write, which is the safe direction.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: orgId("restrict"),
    /** RESTRICT, so a client with financial records cannot be erased. */
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    /**
     * Null while `draft`, assigned on issue from
     * `organizations.next_invoice_number`. The display form (`INV-0001`) is
     * derived, never stored.
     */
    number: integer("number"),
    status: text("status", { enum: INVOICE_STATUSES })
      .notNull()
      .default("draft"),
    /** Supplied by the application as a calendar day, not `current_date`. */
    issueDate: date("issue_date", { mode: "string" }),
    /** Null while draft, required on issue. */
    dueDate: date("due_date", { mode: "string" }),
    /** Copied from `organizations.default_currency` at draft creation, frozen. */
    currency: char("currency", { length: 3 }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    /** Basis points: 2000 means 20 percent. */
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Set by hand when staff mark it paid. Present exactly when `paid`. */
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    /**
     * Free text printed under the lines: payment terms, a thank you, a
     * purchase order reference. Trimmed and capped at 5,000 characters by the
     * application, blank stored as null; editable while `draft`, frozen on
     * issue (spec 0012).
     */
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("invoices_org_id_number_unique").on(t.orgId, t.number),
    index("invoices_org_id_client_id_idx").on(t.orgId, t.clientId),
    // For the overdue sweep: sent invoices whose due date has passed.
    index("invoices_org_id_status_due_date_idx").on(
      t.orgId,
      t.status,
      t.dueDate,
    ),
    check(
      "invoices_status_check",
      sql`${t.status} in ('draft', 'sent', 'paid', 'overdue', 'void')`,
    ),
    // The format is constrained, not the ISO 4217 list, which would go stale
    // inside a migration.
    check(
      "invoices_currency_check",
      sql`${t.currency} = upper(${t.currency}) and ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "invoices_money_non_negative_check",
      sql`${t.subtotalCents} >= 0 and ${t.taxCents} >= 0 and ${t.totalCents} >= 0`,
    ),
    check(
      "invoices_tax_rate_bp_check",
      sql`${t.taxRateBp} >= 0 and ${t.taxRateBp} <= 10000`,
    ),
    check(
      "invoices_total_check",
      sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`,
    ),
    // `subtotal_cents` is cast to numeric before the multiply. As two integers
    // the product overflows int4 at a subtotal of about $2,147 at 100 percent
    // tax, and the CHECK would then error rather than judge.
    check(
      "invoices_tax_check",
      sql`${t.taxCents} = round((${t.subtotalCents}::numeric * ${t.taxRateBp}) / 10000)`,
    ),
    check(
      "invoices_paid_at_check",
      sql`(${t.status} = 'paid') = (${t.paidAt} is not null)`,
    ),
  ],
);

/**
 * One line of an invoice. `amount_cents` always follows from the line's own
 * quantity and unit price, enforced by the database.
 */
export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: id(),
    orgId: orgId("restrict"),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    /**
     * `numeric(12,3)` read as a string. The mode is not optional: without it
     * the driver hands back a JavaScript number and the float this design
     * exists to avoid is back. Every consumer goes through `src/lib/money.ts`.
     */
    quantity: numeric("quantity", {
      precision: 12,
      scale: 3,
      mode: "string",
    }).notNull(),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Display order, 1 based and contiguous, renumbered on reorder. */
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("invoice_line_items_invoice_id_position_unique").on(
      t.invoiceId,
      t.position,
    ),
    index("invoice_line_items_org_id_invoice_id_idx").on(t.orgId, t.invoiceId),
    check(
      "invoice_line_items_money_non_negative_check",
      sql`${t.unitAmountCents} >= 0 and ${t.amountCents} >= 0`,
    ),
    check("invoice_line_items_quantity_positive_check", sql`${t.quantity} > 0`),
    check(
      "invoice_line_items_amount_check",
      sql`${t.amountCents} = round(${t.quantity} * ${t.unitAmountCents})`,
    ),
    check("invoice_line_items_position_check", sql`${t.position} >= 1`),
  ],
);

export const INVOICE_EVENT_KINDS = [
  "issued",
  "paid",
  "voided",
  "overdue",
  "notified",
  "notification_failed",
] as const;
export type InvoiceEventKind = (typeof INVOICE_EVENT_KINDS)[number];

/**
 * The permanent record of what happened to an invoice: every status move and
 * every notification attempt, one row each, never updated and never deleted
 * (spec 0012, AC-15). This is the audit log spec 0002 deferred, and the source
 * of the detail page's history.
 *
 * The four status kinds carry both `from_status` and `to_status`; the two
 * notification kinds carry neither. The CHECK below holds the two halves
 * together by kind, so a row can never claim a move it does not name.
 *
 * `overdue` is written by the nightly sweep (feature 18) with no actor; the
 * other three status kinds always name the staff member who pressed the
 * button. There is no `updated_at` because nothing here is ever updated.
 */
export const invoiceEvents = pgTable(
  "invoice_events",
  {
    id: id(),
    orgId: orgId("cascade"),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: INVOICE_EVENT_KINDS }).notNull(),
    fromStatus: text("from_status", { enum: INVOICE_STATUSES }),
    toStatus: text("to_status", { enum: INVOICE_STATUSES }),
    /** The acting staff member; null for the sweep, and cleared if they are deleted. */
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The void reason, the delivered and refused addresses of a notification
     * attempt, or the reason a send failed.
     */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("invoice_events_org_id_invoice_id_created_at_idx").on(
      t.orgId,
      t.invoiceId,
      t.createdAt,
    ),
    check(
      "invoice_events_kind_check",
      sql`${t.kind} in ('issued', 'paid', 'voided', 'overdue', 'notified', 'notification_failed')`,
    ),
    check(
      "invoice_events_from_status_check",
      sql`${t.fromStatus} is null or ${t.fromStatus} in ('draft', 'sent', 'paid', 'overdue', 'void')`,
    ),
    check(
      "invoice_events_to_status_check",
      sql`${t.toStatus} is null or ${t.toStatus} in ('draft', 'sent', 'paid', 'overdue', 'void')`,
    ),
    // Status kinds carry both statuses; notification kinds carry neither.
    check(
      "invoice_events_statuses_by_kind_check",
      sql`(${t.kind} in ('issued', 'paid', 'voided', 'overdue') and ${t.fromStatus} is not null and ${t.toStatus} is not null) or (${t.kind} in ('notified', 'notification_failed') and ${t.fromStatus} is null and ${t.toStatus} is null)`,
    ),
  ],
);
