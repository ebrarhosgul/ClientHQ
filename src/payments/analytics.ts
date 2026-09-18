/**
 * What the subscription mirror tells product analytics (spec 0019, AC-11,
 * AC-13), shared by the webhook and the nightly reconcile so both report a
 * transition the same way, whichever of them saw it first.
 *
 * Called only after the mirror's transaction committed (key invariant 4):
 * an event about a row that then rolled back would be a lie. Everything here
 * is fire and forget through the analytics client, which never throws.
 */
import { analytics, subscriptionStatusProperty } from "@/analytics";
import { identifyAgency } from "@/analytics/agency-group";
import type { Database } from "@/db/tenant";

import type { RetrievedSubscription } from "./events";
import type { SubscriptionMirrorResult } from "./subscription-mirror";

/** Report a committed mirror write: the funnel event, then the group. */
export async function reportSubscriptionMirror(
  db: Database,
  orgId: string,
  subscription: RetrievedSubscription,
  result: SubscriptionMirrorResult,
): Promise<void> {
  if (result.outcome !== "applied" || result.transition === "none") {
    return;
  }

  const status = subscriptionStatusProperty(subscription.status);

  if (result.transition === "started") {
    analytics().track("subscription.started", {
      distinctId: { kind: "org", orgId },
      orgId,
      properties: {
        subscribed_at: (result.subscribedAt ?? new Date()).toISOString(),
        subscription_status: status,
      },
    });
  } else {
    analytics().track("subscription.changed", {
      distinctId: { kind: "org", orgId },
      orgId,
      properties: { status, subscription_status: status },
    });
  }

  await identifyAgency(
    orgId,
    { subscription, subscribedAt: result.subscribedAt },
    db,
  );
}
