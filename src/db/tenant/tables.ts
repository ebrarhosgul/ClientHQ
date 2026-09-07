/**
 * Which tables the accessor may touch, and how each one narrows.
 *
 * Coverage is derived from the schema rather than listed: a table is tenant
 * scoped exactly when it carries an `org_id` column, so a table added in a
 * later slice is protected without anyone remembering to protect it, and one
 * without `org_id` cannot be passed at all (spec 0003, AC-1).
 */
import {
  and,
  eq,
  getTableColumns,
  inArray,
  is,
  type BuildQueryResult,
  type DBQueryConfig,
  type ExtractTablesWithRelations,
  type SQL,
} from "drizzle-orm";
import { PgTable, QueryBuilder, type AnyPgColumn } from "drizzle-orm/pg-core";

import * as schema from "../schema";
import { clientContacts, clients } from "../schema/clients";
import { invoiceLineItems, invoices } from "../schema/invoices";
import { deliverables, projects } from "../schema/projects";
import type { ContactContext } from "./context";

/**
 * Any Drizzle table carrying the two columns the layer needs: `org_id` to scope
 * on and `id` to address a row by. `organizations`, `users` and
 * `processed_webhook_events` do not satisfy this, so passing one is a compile
 * error rather than an unscoped query.
 */
export type TenantTable = PgTable & {
  readonly id: AnyPgColumn;
  readonly orgId: AnyPgColumn;
};

type Schema = typeof schema;
type Tables = ExtractTablesWithRelations<Schema>;

/** The schema export names of the tenant scoped tables. */
export type TenantTableKey = {
  [K in keyof Schema]: Schema[K] extends TenantTable ? K : never;
}[keyof Schema] &
  keyof Tables;

/**
 * The relational query key for one table.
 *
 * Drizzle keys `db.query` by the schema module's own export names, which is
 * exactly what the runtime map below reads, so the two cannot drift.
 */
export type KeyFor<T extends TenantTable> = {
  [K in TenantTableKey]: Schema[K] extends T ? K : never;
}[TenantTableKey];

/** The relations of one table, as Drizzle's own `with` config types them. */
export type WithOf<T extends TenantTable> = NonNullable<
  DBQueryConfig<"many", true, Tables, Tables[KeyFor<T>]>["with"]
>;

/** A row of `T`, plus whatever relations `W` asked for. */
export type RowWith<
  T extends TenantTable,
  W extends WithOf<T>,
> = BuildQueryResult<Tables, Tables[KeyFor<T>], { with: W }>;

function hasOrgId(value: unknown): value is PgTable & TenantTable {
  return is(value, PgTable) && "orgId" in getTableColumns(value);
}

/**
 * Table object to relational query key, derived at load from the schema
 * module's own export keys. Nothing here is hand maintained, so a new tenant
 * table joins the map by existing.
 */
const KEY_BY_TABLE: ReadonlyMap<PgTable, string> = new Map(
  Object.entries(schema).flatMap(([key, value]) =>
    hasOrgId(value) ? [[value, key] as const] : [],
  ),
);

/** Every tenant scoped table, for the tests that walk all of them. */
export const TENANT_TABLE_KEYS: readonly TenantTableKey[] = Object.freeze(
  [...KEY_BY_TABLE.values()].sort() as TenantTableKey[],
);

/**
 * The relational query key for a table.
 *
 * The type constraint already guarantees a hit; the throw is there so a schema
 * refactor that breaks the assumption fails loudly instead of quietly running
 * an unscoped query.
 */
export function relationalKey<T extends TenantTable>(table: T): KeyFor<T> {
  const key = KEY_BY_TABLE.get(table);

  if (key === undefined) {
    throw new Error(
      `${String(table)} is not exported from src/db/schema, so the tenant layer cannot scope it.`,
    );
  }

  return key as KeyFor<T>;
}

/** `org_id = <the resolved organization>`, on every statement, always. */
export function orgPredicate<T extends TenantTable>(
  table: T,
  orgId: string,
): SQL {
  return eq(table.orgId, orgId);
}

/** Builds the sub selects the two indirect client predicates need. */
const qb = new QueryBuilder();

/**
 * How a contact context narrows each table to its own client.
 *
 * Three shapes and no fourth (spec 0003, "Feature design"). `memberships` and
 * `subscriptions` have no entry, which is what makes them unreachable from a
 * contact context at compile time.
 */
const CLIENT_PREDICATES = {
  clients: (ctx: ContactContext) => eq(clients.id, ctx.clientId),
  clientContacts: (ctx: ContactContext) =>
    eq(clientContacts.clientId, ctx.clientId),
  projects: (ctx: ContactContext) => eq(projects.clientId, ctx.clientId),
  invoices: (ctx: ContactContext) => eq(invoices.clientId, ctx.clientId),
  deliverables: (ctx: ContactContext) =>
    inArray(
      deliverables.projectId,
      qb
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.clientId, ctx.clientId),
            eq(projects.orgId, ctx.orgId),
          ),
        ),
    ),
  invoiceLineItems: (ctx: ContactContext) =>
    inArray(
      invoiceLineItems.invoiceId,
      qb
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.clientId, ctx.clientId),
            eq(invoices.orgId, ctx.orgId),
          ),
        ),
    ),
} as const satisfies Partial<
  Record<TenantTableKey, (ctx: ContactContext) => SQL>
>;

/** The schema export names a contact context can address. */
export type ContactTableKey = keyof typeof CLIENT_PREDICATES;

/**
 * The six tables with a path to a client. A contact accessor is generic over
 * this union, so `memberships` and `subscriptions` do not compile.
 */
export type ContactTable = Schema[ContactTableKey];

/** The client predicate for one table, under one contact context. */
export function clientPredicate(
  key: ContactTableKey,
  ctx: ContactContext,
): SQL {
  return CLIENT_PREDICATES[key](ctx);
}

/** Whether a contact context can reach this table at all. */
export function isContactTableKey(key: string): key is ContactTableKey {
  return key in CLIENT_PREDICATES;
}
