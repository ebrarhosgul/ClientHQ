import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { id, orgId, timestamps } from "./helpers";
import { users } from "./identity";

/**
 * The agency's customer company. Archived with `archived_at`, never deleted
 * once it has projects or invoices: those foreign keys RESTRICT.
 */
export const clients = pgTable(
  "clients",
  {
    id: id(),
    orgId: orgId("cascade"),
    name: text("name").notNull(),
    /**
     * Stored lowercase and CHECK constrained when present, mirroring
     * `client_contacts.email`. Nullable, unlike that column: a client can have
     * no company email at all (spec 0006).
     */
    companyEmail: text("company_email"),
    phone: text("phone"),
    industry: text("industry"),
    notes: text("notes"),
    billingAddressLine1: text("billing_address_line1"),
    billingAddressLine2: text("billing_address_line2"),
    billingCity: text("billing_city"),
    billingRegion: text("billing_region"),
    billingPostalCode: text("billing_postal_code"),
    billingCountry: text("billing_country"),
    /** Replaces spec 0001's `status` column. */
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("clients_org_id_archived_at_idx").on(t.orgId, t.archivedAt),
    index("clients_org_id_name_idx").on(t.orgId, t.name),
    check(
      "clients_company_email_lowercase_check",
      sql`${t.companyEmail} is null or ${t.companyEmail} = lower(${t.companyEmail})`,
    ),
  ],
);

/**
 * A named person at a client, and the portal login link once they accept an
 * invitation. `user_id` stays null until then.
 */
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: id(),
    orgId: orgId("cascade"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Null until the invitation is accepted. Cleared if the user is deleted. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Stored lowercase and CHECK constrained, so `Ada@x.com` and `ada@x.com`
     * are one contact rather than two. The Zod schema lowercases at the
     * boundary.
     */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** Only the hash is stored, never the token. */
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true, mode: "date" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    unique("client_contacts_client_id_email_unique").on(t.clientId, t.email),
    // Non unique on purpose: one person may be a contact of several clients.
    index("client_contacts_user_id_idx").on(t.userId),
    index("client_contacts_org_id_client_id_idx").on(t.orgId, t.clientId),
    check(
      "client_contacts_email_lowercase_check",
      sql`${t.email} = lower(${t.email})`,
    ),
  ],
);
