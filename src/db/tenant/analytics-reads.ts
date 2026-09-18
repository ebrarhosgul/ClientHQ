/**
 * The two reads product analytics needs and nothing else (spec 0019, AC-13):
 * an agency's group properties and a person's `created_at`.
 *
 * Both take explicit ids and an executor, in the shape of `provisioning.ts`,
 * because their callers are the paths with no tenant context to resolve:
 * the two webhooks, the nightly reconcile and agency creation. A tracked
 * action counts through the scoped accessor's `count` instead.
 *
 * Ids, a status, dates and a count. Never a name, never an email.
 */
import { count, eq } from "drizzle-orm";

import { memberships, organizations, subscriptions, users } from "../schema";
import { pooledDb, type Executor } from "./executor";

export type AgencyAnalyticsSnapshot = {
  readonly createdAt: Date;
  /** The mirrored Stripe status, or undefined when the agency has no row. */
  readonly subscriptionStatus: string | undefined;
  readonly teamSize: number;
};

/** Undefined for an organization that does not exist. */
export async function agencyAnalyticsSnapshot(
  orgId: string,
  executor?: Executor,
): Promise<AgencyAnalyticsSnapshot | undefined> {
  const db = executor ?? (await pooledDb());

  const [org] = await db
    .select({ createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (org === undefined) {
    return undefined;
  }

  const [subscription] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  const [team] = await db
    .select({ size: count() })
    .from(memberships)
    .where(eq(memberships.orgId, orgId));

  return {
    createdAt: org.createdAt,
    subscriptionStatus: subscription?.status,
    teamSize: team?.size ?? 0,
  };
}

/** Undefined for a person this mirror has never held. */
export async function personCreatedAt(
  userId: string,
  executor?: Executor,
): Promise<Date | undefined> {
  const db = executor ?? (await pooledDb());

  const [row] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.createdAt;
}
