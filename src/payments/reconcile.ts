/**
 * `stripe_reconcile`, the fourth nightly sweep (spec 0017, AC-7).
 *
 * A missed webhook is the risk this exists to close: Stripe retries a failed
 * delivery for a while and then gives up, and from that point the local row
 * is wrong until something else looks. This lists every subscription the
 * Stripe account holds, all statuses, into memory, and writes nothing until
 * that listing is complete, because the newest per agency rule below needs
 * the whole set to be correct, not whatever page happened to load first.
 *
 * Every write goes through `applySubscriptionState`, the same lock and the
 * same customer id guard the webhook uses (`src/payments/subscription-mirror.ts`),
 * so the two writers cannot drift.
 */
import { subscriptions } from "@/db/schema";

import type { Sweep, SweepInput, SweepReport } from "@/cron/sweep";

import type { RetrievedSubscription } from "./events";
import { organizationExists } from "./organizations";
import { applySubscriptionState, resolveOrgId } from "./subscription-mirror";

export type StripeListGateway = {
  /** All statuses, already paginated to the end. Throws on any page failure. */
  readonly listSubscriptions: () => AsyncIterable<RetrievedSubscription>;
};

type Resolved = {
  readonly orgId: string;
  readonly subscription: RetrievedSubscription;
};

/**
 * Does `candidate` win over the agency's current pick?
 *
 * The greatest Stripe `created`; on a tie, the one that is not `canceled`;
 * on a further tie, the lower Stripe id, so two runs over the same listing
 * always agree (spec 0017, Value sourcing).
 */
function isNewer(candidate: Resolved, current: Resolved): boolean {
  const candidateCreated = candidate.subscription.created.getTime();
  const currentCreated = current.subscription.created.getTime();

  if (candidateCreated !== currentCreated) {
    return candidateCreated > currentCreated;
  }

  const candidateCanceled = candidate.subscription.status === "canceled";
  const currentCanceled = current.subscription.status === "canceled";

  if (candidateCanceled !== currentCanceled) {
    return !candidateCanceled;
  }

  return candidate.subscription.id < current.subscription.id;
}

/** One line per item level anomaly. Provider ids only, never a payload. */
function logItem(event: string, fields: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      event: `stripe_reconcile.${event}`,
      ...fields,
      at: new Date().toISOString(),
    }),
  );
}

async function run(
  gateway: StripeListGateway,
  { db }: SweepInput,
): Promise<SweepReport> {
  // Into memory first. A throw here (a page failing part way through)
  // propagates out of `run` uncaught, which the runner records as `failed`
  // with no counts produced at all, exactly because nothing below has run
  // yet (spec 0017, AC-7, Critical test scenarios).
  const listed: RetrievedSubscription[] = [];

  for await (const subscription of gateway.listSubscriptions()) {
    listed.push(subscription);
  }

  const listedIds = new Set(listed.map((subscription) => subscription.id));

  // Resolve and group by agency, keeping only the newest per agency.
  const byOrg = new Map<string, Resolved>();
  let unresolved = 0;
  let superseded = 0;

  for (const subscription of listed) {
    const orgId = await resolveOrgId(db, subscription);

    if (orgId === undefined || !(await organizationExists(db, orgId))) {
      unresolved += 1;
      logItem("unresolved", { stripeSubscriptionId: subscription.id });
      continue;
    }

    const candidate: Resolved = { orgId, subscription };
    const current = byOrg.get(orgId);

    if (current === undefined) {
      byOrg.set(orgId, candidate);
    } else {
      superseded += 1;

      if (isNewer(candidate, current)) {
        byOrg.set(orgId, candidate);
      }
    }
  }

  // Apply the survivors, each in its own transaction, one failure never
  // stopping the rest.
  let applied = 0;
  let customerConflict = 0;
  let errors = 0;

  for (const { orgId, subscription } of byOrg.values()) {
    try {
      const outcome = await db.transaction((tx) =>
        applySubscriptionState(tx, orgId, subscription),
      );

      if (outcome === "customer_id_conflict") {
        customerConflict += 1;
        logItem("customer_conflict", {
          orgId,
          stripeSubscriptionId: subscription.id,
        });
      } else {
        applied += 1;
      }
    } catch (thrown) {
      errors += 1;
      logItem("error", {
        orgId,
        stripeSubscriptionId: subscription.id,
        error: thrown instanceof Error ? thrown.message : String(thrown),
      });
    }
  }

  // A local row the complete listing never mentioned. Logged, never changed.
  const localRows = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions);
  const unlisted = localRows.filter(
    (row): row is { stripeSubscriptionId: string } =>
      row.stripeSubscriptionId !== null &&
      !listedIds.has(row.stripeSubscriptionId),
  );

  unlisted.forEach((row) => {
    logItem("unlisted", { stripeSubscriptionId: row.stripeSubscriptionId });
  });

  return {
    outcome: errors > 0 ? "failed" : "ok",
    counts: {
      listed: listed.length,
      applied,
      unresolved,
      customer_conflict: customerConflict,
      superseded,
      unlisted: unlisted.length,
      errors,
    },
  };
}

export function stripeReconcileSweep(gateway: StripeListGateway): Sweep {
  return {
    name: "stripe_reconcile",
    run: (input) => run(gateway, input),
  };
}
