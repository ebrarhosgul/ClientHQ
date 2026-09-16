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
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { organizations } from "../schema";
import type { StaffContext, TenantContext } from "./context";
import { pooledDb, type Executor, type TransactionExecutor } from "./executor";

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
 *
 * Takes either context kind (spec 0013): a client contact's invoice PDF needs
 * the agency's name too, and both context kinds carry the same `orgId`, which
 * is all this reads. The first tenant layer door a contact context can call.
 */
export async function agencyProfile(
  ctx: TenantContext,
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

/**
 * Which of these Clerk organization ids are soft deleted locally.
 *
 * Read by `/onboarding` before it decides whether a Clerk membership auto
 * activates (AC-6): Clerk can still list an organization whose local mirror
 * was soft deleted (AC-14), and `repairMirror()` deliberately never clears
 * `deleted_at` (see `provisioning.ts`), so activating one and landing on
 * `/dashboard` would resolve as missing and bounce straight back here. An id
 * with no local row at all (never provisioned, or not yet repaired) is not
 * included, since that is the ordinary first repair, not a deletion.
 */
export async function deletedOrganizationClerkIds(
  clerkOrgIds: readonly string[],
  executor?: Executor,
): Promise<ReadonlySet<string>> {
  if (clerkOrgIds.length === 0) {
    return new Set();
  }

  const db = executor ?? (await pooledDb());

  const rows = await db
    .select({ clerkOrgId: organizations.clerkOrgId })
    .from(organizations)
    .where(
      and(
        inArray(organizations.clerkOrgId, clerkOrgIds),
        isNotNull(organizations.deletedAt),
      ),
    );

  return new Set(rows.map((row) => row.clerkOrgId));
}

/**
 * Take the next number from the agency's gapless invoice sequence (spec 0012,
 * AC-5).
 *
 * One statement: `next_invoice_number` is incremented and the value after
 * the increment comes back, so the number assigned is that value minus one.
 * The update takes the organization row's lock, which is what serialises two
 * staff issuing two drafts at the same moment: the second waits, then reads
 * the counter the first one left. It only ever runs inside the issue
 * transaction, which is why it takes the transaction rather than the pooled
 * handle: a refusal later in that transaction rolls the increment back with
 * it, so the sequence stays gapless.
 *
 * `organizations` carries no `org_id`, so `tenantDb()` cannot reach it; like
 * `agencyProfile`, this is a named door that can only ever touch the caller's
 * own row.
 */
export async function nextInvoiceNumber(
  ctx: StaffContext,
  tx: TransactionExecutor,
): Promise<number> {
  const [row] = await tx
    .update(organizations)
    .set({
      nextInvoiceNumber: sql`${organizations.nextInvoiceNumber} + 1`,
    })
    .where(eq(organizations.id, ctx.orgId))
    .returning({ next: organizations.nextInvoiceNumber });

  if (row === undefined) {
    throw new Error("the acting organization has no row to number from");
  }

  return row.next - 1;
}
