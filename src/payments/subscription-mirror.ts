/**
 * The one place that writes a `subscriptions` row: the row lock, the customer
 * id guard, and the upsert (spec 0007, AC-27).
 *
 * Shared by the webhook and the nightly Stripe reconcile (spec 0017, AC-7) so
 * the two writers cannot drift: whichever one runs, the lock, the guard, the
 * mirrored fields and the `past_due_since` rule are exactly the same code.
 */
import { eq, sql } from "drizzle-orm";

import { subscriptions } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";

import {
  orgIdFromMetadata,
  primaryItem,
  type RetrievedSubscription,
} from "./events";

/**
 * Whose row is this, absent a Checkout Session to ask?
 *
 * The row already holding this customer id, else the `org_id` this app wrote
 * into the subscription's metadata when it started Checkout (spec 0007,
 * AC-22). The webhook tries a Checkout Session's `client_reference_id` first
 * and falls back to this; the nightly reconcile has no session at all and
 * starts here (spec 0017, AC-7).
 */
export async function resolveOrgId(
  db: Database,
  subscription: RetrievedSubscription,
): Promise<string | undefined> {
  const [existing] = await db
    .select({ orgId: subscriptions.orgId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, subscription.customer))
    .limit(1);

  return existing?.orgId ?? orgIdFromMetadata(subscription);
}

export type SubscriptionMirrorOutcome = "applied" | "customer_id_conflict";

/**
 * Lock the agency's row, refuse a customer id change, then upsert the
 * mirrored fields, all inside the caller's open transaction.
 *
 * `past_due_since` is the only value this feature derives rather than
 * mirrors, and it is derived on the **database** clock. Feature 9 measures a
 * grace window from it, and a window measured from a serverless instance's
 * own clock could drift. The `coalesce` is what keeps a repeated `past_due`
 * state from silently extending that window: first move in sets it, later
 * ones leave it, and anything other than `past_due` clears it.
 *
 * One agency, at most one Stripe customer: a stored id is never quietly
 * replaced by a different one, because that would move a paying agency onto
 * someone else's customer and lose the first (spec 0007, AC-27). The caller
 * decides what a conflict means for it: the webhook throws to unwind its
 * transaction and answers 200; the reconcile counts it and moves on.
 */
export async function applySubscriptionState(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  orgId: string,
  subscription: RetrievedSubscription,
): Promise<SubscriptionMirrorOutcome> {
  const [existing] = await tx
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .for("update")
    .limit(1);

  if (
    existing !== undefined &&
    existing.stripeCustomerId !== subscription.customer
  ) {
    return "customer_id_conflict";
  }

  const item = primaryItem(subscription);
  const pastDue = subscription.status === "past_due";

  const mirrored = {
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    stripePriceId: item.price.id,
    status: subscription.status,
    currentPeriodEnd: item.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  } as const;

  await tx
    .insert(subscriptions)
    .values({
      id: newId(),
      orgId,
      ...mirrored,
      pastDueSince: pastDue ? sql`now()` : null,
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: {
        ...mirrored,
        pastDueSince: pastDue
          ? sql`coalesce(${subscriptions.pastDueSince}, now())`
          : null,
        // `$onUpdate` only fires for `.update()`, and the database clock is
        // the same one `past_due_since` just used.
        updatedAt: sql`now()`,
      },
    });

  return "applied";
}
