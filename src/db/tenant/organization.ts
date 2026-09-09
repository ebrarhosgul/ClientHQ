/**
 * Reading the tenant's own row.
 *
 * `organizations` is the tenant rather than a tenant scoped table: it carries no
 * `org_id`, so `tenantDb()` refuses it at compile time and there is nothing for
 * the accessor's predicate to apply. That leaves two honest ways to read an
 * agency's own name, and this is the narrower one. `unsafeTenantQuery()` would
 * also work, but it exists for a query shape the accessor cannot express and
 * logs a line every time it is used; a named reader that can only ever return
 * one organization, the caller's own, does not need to be conspicuous.
 *
 * The context is a required argument for the same reason it is on `tenantDb()`:
 * the organization is right there in the call, resolved from the Clerk session,
 * never worked out by the query itself.
 */
import { and, eq, isNull } from "drizzle-orm";

import { organizations } from "../schema";
import type { StaffContext } from "./context";
import { pooledDb, type Executor } from "./executor";

/** An agency as its own staff see it. */
export type AgencyProfile = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly defaultCurrency: string;
};

/**
 * The acting agency's own row, or `undefined` when it is soft deleted.
 *
 * `deleted_at is null` matches staff resolution (AC-14), so a deleted agency
 * cannot be read back here after resolution has already stopped returning it.
 */
export async function agencyProfile(
  ctx: StaffContext,
  executor?: Executor,
): Promise<AgencyProfile | undefined> {
  const db = executor ?? (await pooledDb());

  const [row] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      defaultCurrency: organizations.defaultCurrency,
    })
    .from(organizations)
    .where(
      and(eq(organizations.id, ctx.orgId), isNull(organizations.deletedAt)),
    )
    .limit(1);

  return row;
}
