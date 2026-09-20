import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { id, orgId, timestamps } from "./helpers";

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
  /**
   * The agency's own business profile, shown read only on `/settings`. Every
   * column is nullable: the Clerk `organization.created` handler knows none of
   * them, and a new agency has filled none in yet. Nothing here is copied onto
   * an invoice; the PDF still prints the agency by name only.
   */
  description: text("description"),
  taxId: text("tax_id"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  country: text("country"),
  /** Set by the Clerk `organization.deleted` webhook. Soft delete only. */
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  ...timestamps(),
});

/**
 * Mirrors a Clerk user. Not tenant scoped: one person may serve several
 * agencies, and may be a client contact of another.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    /**
     * Indexed, deliberately not unique, so a stale mirror row can never make a
     * webhook write fail, and so `scrubUser()` placeholders cannot collide.
     * Stored lowercase; the Zod schema lowercases at the boundary and the CHECK
     * below refuses anything else.
     */
    email: text("email").notNull(),
    name: text("name"),
    imageUrl: text("image_url"),
    /** Soft delete. `scrubUser()` sets this and overwrites the fields above. */
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("users_email_idx").on(t.email),
    check("users_email_lowercase_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const MEMBERSHIP_ROLES = ["admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * A display mirror of Clerk organization membership, so member lists render
 * with a join. `role` can be stale until a webhook lands, so no permission
 * decision reads it: the Clerk session claim is authoritative.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: orgId("cascade"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("memberships_org_id_user_id_unique").on(t.orgId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
    check("memberships_role_check", sql`${t.role} in ('admin', 'member')`),
  ],
);

/**
 * One per agency, written only by the Stripe webhook handler. `status` holds
 * Stripe's value verbatim with no CHECK constraint on purpose: a constraint
 * would turn a newly invented Stripe status into a hard write failure, and the
 * subscription would silently stop updating. The access level derived from it
 * treats anything unrecognised as locked.
 */
export const subscriptions = pgTable("subscriptions", {
  id: id(),
  orgId: orgId("cascade").unique(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  /** Nullable: Checkout creates a customer before a subscription exists. */
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", {
    withTimezone: true,
    mode: "date",
  }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Set on the first move into `past_due`, cleared on any return to `active`. */
  pastDueSince: timestamp("past_due_since", {
    withTimezone: true,
    mode: "date",
  }),
  ...timestamps(),
});
