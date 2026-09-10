/**
 * Does this `org_id` name a real agency?
 *
 * The webhook asks before it writes, because the alternative is a foreign key
 * violation inside the transaction, which would come back as a 500 and make
 * Stripe retry an event that can never succeed (spec 0007, AC-26).
 *
 * Two things it deliberately does not do:
 *
 * - It does not filter on `deleted_at`. A soft deleted agency still gets its
 *   mirror row written and a 200 (AC-16). Stripe is still billing someone, and
 *   a row that stops updating is worse than a row about a closed account.
 * - It does not go through the tenant accessor. `organizations` is the tenant
 *   root rather than a tenant scoped table, and a webhook has no session to
 *   scope to; that is the whole reason the route holds `withSystemAccess`.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { organizations } from "@/db/schema";
import type { Database } from "@/db/tenant";

/**
 * `org_id` reaches this code from a Stripe payload, so it is a string until
 * proven otherwise. Checking the shape first keeps a malformed value from
 * reaching PostgreSQL, where a bad uuid raises rather than returning no rows,
 * and a raise on this path would be a 500 that retries forever.
 */
const orgIdShape = z.uuid();

export async function organizationExists(
  db: Database,
  orgId: string,
): Promise<boolean> {
  if (!orgIdShape.safeParse(orgId).success) {
    return false;
  }

  const [found] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return found !== undefined;
}
