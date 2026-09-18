import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { clientContacts, clients } from "./clients";
import { cronRuns } from "./cron";
import { memberships, organizations, subscriptions, users } from "./identity";
import { invoiceEvents, invoiceLineItems, invoices } from "./invoices";
import { deliverables, projects } from "./projects";
import { rateLimitWindows } from "./rate-limit";
import { processedWebhookEvents } from "./webhooks";

/**
 * Zod schemas derived from the tables, one insert and one select schema each.
 *
 * These are the shape of a row at the database boundary. Where the database
 * has a CHECK constraint, the insert schema carries the same rule, so bad input
 * is refused with a readable message before it becomes a constraint violation.
 * Emails are lowercased here, which is what lets the `email = lower(email)`
 * CHECK hold without every caller remembering to do it.
 *
 * Server Action and route handler inputs get their own, narrower schemas in
 * their features; these describe rows, not forms.
 */

/** Lowercased and trimmed, matching the CHECK on `users` and `client_contacts`. */
const lowercaseEmail = z.string().trim().toLowerCase().pipe(z.email());

/** Three uppercase letters, matching `invoices_currency_check`. */
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three letter code");

/** Whole cents, never negative. */
const cents = z.int().nonnegative();

/** Basis points, 0 to 10000. */
const basisPoints = z.int().min(0).max(10000);

/** What `numeric(12,3)` can hold, as the string it travels as. */
const quantity = z
  .string()
  .trim()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    "Quantity must be a plain decimal with at most 9 whole digits and 3 decimals",
  );

// Both of these have a database default (1 and 'USD'), so the Clerk
// `organization.created` handler has nothing to say about either. Overriding a
// defaulted column replaces the optional schema drizzle-zod would have made, so
// each override has to say `.optional()` again, the same as on the invoice
// money columns below.
export const insertOrganizationSchema = createInsertSchema(organizations, {
  defaultCurrency: currencyCode.optional(),
  nextInvoiceNumber: z.int().positive().optional(),
});
export const selectOrganizationSchema = createSelectSchema(organizations);

export const insertUserSchema = createInsertSchema(users, {
  email: lowercaseEmail,
});
export const selectUserSchema = createSelectSchema(users);

export const insertMembershipSchema = createInsertSchema(memberships);
export const selectMembershipSchema = createSelectSchema(memberships);

export const insertSubscriptionSchema = createInsertSchema(subscriptions);
export const selectSubscriptionSchema = createSelectSchema(subscriptions);

export const insertClientSchema = createInsertSchema(clients, {
  companyEmail: lowercaseEmail.nullable().optional(),
});
export const selectClientSchema = createSelectSchema(clients);

export const insertClientContactSchema = createInsertSchema(clientContacts, {
  email: lowercaseEmail,
});
export const selectClientContactSchema = createSelectSchema(clientContacts);

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);

export const insertDeliverableSchema = createInsertSchema(deliverables, {
  sizeBytes: z.int().nonnegative(),
});
export const selectDeliverableSchema = createSelectSchema(deliverables);

export const insertInvoiceSchema = createInsertSchema(invoices, {
  currency: currencyCode,
  number: z.int().positive().nullable().optional(),
  subtotalCents: cents.optional(),
  taxRateBp: basisPoints.optional(),
  taxCents: cents.optional(),
  totalCents: cents.optional(),
});
export const selectInvoiceSchema = createSelectSchema(invoices);

export const insertInvoiceLineItemSchema = createInsertSchema(
  invoiceLineItems,
  {
    quantity,
    unitAmountCents: cents,
    amountCents: cents,
    position: z.int().positive(),
  },
);
export const selectInvoiceLineItemSchema = createSelectSchema(invoiceLineItems);

export const insertInvoiceEventSchema = createInsertSchema(invoiceEvents);
export const selectInvoiceEventSchema = createSelectSchema(invoiceEvents);

export const insertProcessedWebhookEventSchema = createInsertSchema(
  processedWebhookEvents,
);
export const selectProcessedWebhookEventSchema = createSelectSchema(
  processedWebhookEvents,
);

export const insertCronRunSchema = createInsertSchema(cronRuns);
export const selectCronRunSchema = createSelectSchema(cronRuns);

export const insertRateLimitWindowSchema = createInsertSchema(rateLimitWindows);
export const selectRateLimitWindowSchema = createSelectSchema(rateLimitWindows);
