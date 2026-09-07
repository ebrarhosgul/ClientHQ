/**
 * The scoped accessor: the only way application code reaches a tenant table.
 *
 * Every statement it emits carries `org_id = <the resolved organization>`, and
 * a contact context additionally carries a predicate narrowing to that
 * contact's own client. There is no method that yields an unfiltered builder,
 * inside a transaction or out of one (spec 0003, AC-1 and AC-4).
 *
 * ## Two conversions at the Drizzle boundary
 *
 * Drizzle's query builders are typed against a *concrete* table. Inside a
 * function generic over `T extends TenantTable` the compiler cannot connect
 * `T`'s row shape to the builder's, so values going in and rows coming back
 * pass through `columnValues` and `asRow` below. Both are sound by
 * construction: the statement is built from `table` itself, so the row it
 * returns is a row of `table` and nothing else. They are the only two
 * conversions in the layer, and the accessor's public surface has none.
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { newId } from "@/lib/id";
import type { ContactContext, StaffContext, TenantContext } from "./context";
import { pooledDb, type Executor } from "./executor";
import { logRefusal } from "./log";
import {
  clientPredicate,
  isContactTableKey,
  orgPredicate,
  relationalKey,
  type ContactTable,
  type RowWith,
  type TenantTable,
  type WithOf,
} from "./tables";

/** What `orderBy` accepts, mirroring Drizzle's own relational query builder. */
export type OrderBy = SQL | AnyPgColumn | readonly (SQL | AnyPgColumn)[];

export type FindOptions<T extends TenantTable, W extends WithOf<T>> = {
  /** ANDed with the tenant predicate; it can only ever narrow further. */
  readonly where?: SQL;
  readonly orderBy?: OrderBy;
  readonly limit?: number;
  readonly offset?: number;
  /** Relations to load. Safe: every foreign key stays inside the organization. */
  readonly with?: W;
};

/**
 * What `insert` accepts: the table's own insert type minus the two columns the
 * layer owns. Supplying either is a type error, not a runtime check (AC-3).
 */
export type InsertValues<T extends TenantTable> = Omit<
  T["$inferInsert"],
  "id" | "orgId"
> & {
  readonly id?: never;
  readonly orgId?: never;
};

/**
 * What `update` accepts. `created_at` joins `id` and `org_id` on the way out,
 * so no write path can move a row into another organization or rewrite its
 * history.
 */
export type UpdatePatch<T extends TenantTable> = Partial<
  Omit<T["$inferInsert"], "id" | "orgId" | "createdAt">
> & {
  readonly id?: never;
  readonly orgId?: never;
  readonly createdAt?: never;
};

/** The read surface both audiences share, over whichever tables they may reach. */
export type TenantReader<TScope extends TenantTable> = {
  findMany<T extends TScope & TenantTable, W extends WithOf<T> = NoRelations>(
    table: T,
    opts?: FindOptions<T, W>,
  ): Promise<RowWith<T, W>[]>;

  findFirst<T extends TScope & TenantTable, W extends WithOf<T> = NoRelations>(
    table: T,
    opts?: FindOptions<T, W>,
  ): Promise<RowWith<T, W> | undefined>;

  /** `undefined` for an id that belongs to another tenant, exactly as for one that never existed. */
  findById<T extends TScope & TenantTable>(
    table: T,
    id: string,
  ): Promise<T["$inferSelect"] | undefined>;
};

/** The default `with`: no relations. */
type NoRelations = Record<never, never>;

/** Agency staff: every tenant table, read and write. */
export type StaffAccessor = TenantReader<TenantTable> & {
  insert<T extends TenantTable>(
    table: T,
    values: InsertValues<T>,
  ): Promise<T["$inferSelect"]>;

  /** `undefined` when zero rows matched, which includes another tenant's id. */
  update<T extends TenantTable>(
    table: T,
    id: string,
    patch: UpdatePatch<T>,
  ): Promise<T["$inferSelect"] | undefined>;

  /** `false` when zero rows matched. */
  delete<T extends TenantTable>(table: T, id: string): Promise<boolean>;
};

/**
 * A client contact: the six tables with a path to a client, reads only. Writes
 * are not merely refused, they are absent from the type.
 */
export type ContactAccessor = TenantReader<ContactTable>;

export type TenantAccessor = StaffAccessor | ContactAccessor;

/** See the note at the top of the file. */
function columnValues(values: object): Record<string, unknown> {
  return { ...values } as Record<string, unknown>;
}

/** See the note at the top of the file. */
function asRow<T extends TenantTable>(
  _table: T,
  row: Record<string, unknown>,
): T["$inferSelect"] {
  return row as T["$inferSelect"];
}

/** The relational query builder for one table, narrowed to what we call. */
type RelationalQueries = {
  readonly findMany: (
    config: Record<string, unknown>,
  ) => Promise<Record<string, unknown>[]>;
  readonly findFirst: (
    config: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | undefined>;
};

function relationalQueries(executor: Executor, key: string): RelationalQueries {
  const queries: Record<string, RelationalQueries> =
    executor.query as unknown as Record<string, RelationalQueries>;

  return queries[key];
}

/** `and()` is only undefined when handed nothing; the tenant predicate is never nothing. */
function required(predicate: SQL | undefined): SQL {
  if (predicate === undefined) {
    throw new Error("the tenant predicate went missing");
  }

  return predicate;
}

/**
 * Build an accessor bound to one context and one executor.
 *
 * The executor is a parameter rather than a lookup so a transactional accessor
 * is the same code with a different handle, and therefore carries predicates
 * identical to the ordinary one (AC-14).
 */
function buildAccessor(
  ctx: TenantContext,
  executor: Executor | undefined,
): StaffAccessor {
  const run = async (): Promise<Executor> => executor ?? (await pooledDb());

  /** Tenant predicate, plus the client predicate for a contact, plus the caller's. */
  function scope<T extends TenantTable>(
    table: T,
    key: string,
    extra?: SQL,
  ): SQL {
    const org = orgPredicate(table, ctx.orgId);

    if (ctx.kind === "staff") {
      return required(and(org, extra));
    }

    if (!isContactTableKey(key)) {
      // Unreachable through the typed surface: `ContactAccessor` cannot name
      // this table. Kept so a future refactor fails loudly rather than quietly
      // handing a contact the whole organization.
      throw new Error(`${key} has no client path, so a contact cannot read it`);
    }

    return required(and(org, clientPredicate(key, ctx), extra));
  }

  function findConfig<T extends TenantTable, W extends WithOf<T>>(
    table: T,
    key: string,
    opts: FindOptions<T, W> | undefined,
  ): Record<string, unknown> {
    return {
      where: scope(table, key, opts?.where),
      orderBy: opts?.orderBy,
      limit: opts?.limit,
      offset: opts?.offset,
      with: opts?.with,
    };
  }

  async function findMany<T extends TenantTable, W extends WithOf<T>>(
    table: T,
    opts?: FindOptions<T, W>,
  ): Promise<RowWith<T, W>[]> {
    const key = relationalKey(table);
    const rows = await relationalQueries(await run(), key).findMany(
      findConfig(table, key, opts),
    );

    return rows as RowWith<T, W>[];
  }

  async function findFirst<T extends TenantTable, W extends WithOf<T>>(
    table: T,
    opts?: FindOptions<T, W>,
  ): Promise<RowWith<T, W> | undefined> {
    const key = relationalKey(table);
    const row = await relationalQueries(await run(), key).findFirst(
      findConfig(table, key, opts),
    );

    return row as RowWith<T, W> | undefined;
  }

  async function findById<T extends TenantTable>(
    table: T,
    id: string,
  ): Promise<T["$inferSelect"] | undefined> {
    return findFirst(table, { where: eq(table.id, id) });
  }

  async function insert<T extends TenantTable>(
    table: T,
    values: InsertValues<T>,
  ): Promise<T["$inferSelect"]> {
    const executable: PgTable = table;
    const [row] = await (
      await run()
    )
      .insert(executable)
      .values({ ...columnValues(values), id: newId(), orgId: ctx.orgId })
      .returning();

    return asRow(table, row);
  }

  async function update<T extends TenantTable>(
    table: T,
    id: string,
    patch: UpdatePatch<T>,
  ): Promise<T["$inferSelect"] | undefined> {
    const key = relationalKey(table);
    const executable: PgTable = table;
    const [row] = await (
      await run()
    )
      .update(executable)
      .set(columnValues(patch))
      .where(scope(table, key, eq(table.id, id)))
      .returning();

    if (row === undefined) {
      logRefusal({
        operation: `update:${key}`,
        reason: "not_found",
        userId: ctx.userId,
        orgId: ctx.orgId,
      });

      return undefined;
    }

    return asRow(table, row);
  }

  async function remove<T extends TenantTable>(
    table: T,
    id: string,
  ): Promise<boolean> {
    const key = relationalKey(table);
    const executable: PgTable = table;
    const rows = await (
      await run()
    )
      .delete(executable)
      .where(scope(table, key, eq(table.id, id)))
      .returning();

    if (rows.length === 0) {
      logRefusal({
        operation: `delete:${key}`,
        reason: "not_found",
        userId: ctx.userId,
        orgId: ctx.orgId,
      });

      return false;
    }

    return true;
  }

  return { findMany, findFirst, findById, insert, update, delete: remove };
}

/**
 * The scoped accessor for a context.
 *
 * A staff context gets every tenant table with writes; a contact context gets
 * the six tables with a client path, reads only. The overloads mean code that
 * has already narrowed `ctx` gets the right surface with no cast.
 */
export function tenantDb(ctx: StaffContext, executor?: Executor): StaffAccessor;
export function tenantDb(
  ctx: ContactContext,
  executor?: Executor,
): ContactAccessor;
export function tenantDb(
  ctx: TenantContext,
  executor?: Executor,
): TenantAccessor;
export function tenantDb(
  ctx: TenantContext,
  executor?: Executor,
): TenantAccessor {
  return buildAccessor(ctx, executor);
}
