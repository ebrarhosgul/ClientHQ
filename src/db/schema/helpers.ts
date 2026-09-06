import { timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./identity";

/**
 * Shared column shapes from spec 0002, "Shared conventions". Every table uses
 * these unless its own section of the spec says otherwise, so a convention
 * changes in one place.
 *
 * These are function declarations on purpose. `helpers.ts` and `identity.ts`
 * import each other (`orgId()` points at `organizations`, and `organizations`
 * uses `id()` and `timestamps()`), and a hoisted function declaration is safe
 * to call from inside that cycle where a `const` would still be uninitialised.
 */

/** `id uuid primary key`, filled by `newId()` in the application, never here. */
export function id() {
  return uuid("id").primaryKey();
}

/**
 * `created_at` and `updated_at`, both `timestamptz not null default now()`.
 * Drizzle refreshes `updated_at` on every write through the ORM; a write that
 * bypasses the ORM leaves it stale, which is accepted.
 */
export function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}

/** What deleting the parent organization does to rows in this table. */
export type OrgDeleteAction = "cascade" | "restrict";

/**
 * The tenant column: `org_id uuid not null references organizations(id)`.
 * Never nullable, no exceptions. This column is what the entire multi tenant
 * security model rests on, and its being `not null` everywhere is the one
 * precondition a future row level security policy needs.
 */
export function orgId(onDelete: OrgDeleteAction) {
  return uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete });
}
