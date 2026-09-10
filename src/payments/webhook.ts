/**
 * The only writer of the `subscriptions` table (spec 0007).
 *
 * This module is the six step order the spec calls "the part most easily got
 * subtly wrong", and every step is here for a failure that actually happens:
 *
 * 1. **Verify the signature against the raw body**, before anything is parsed.
 *    A failure is 400 and writes nothing at all, ledger row included.
 * 2. **Resolve which agency the event belongs to.** Only
 *    `checkout.session.completed` carries `client_reference_id`, so it is the
 *    only event that can bind a Stripe customer to an agency; every other event
 *    finds its row by `stripe_customer_id`, or by the `org_id` this app wrote
 *    into the subscription's metadata for the case where a subscription event
 *    outruns the session that created it.
 * 3. **Re read the subscription from Stripe, outside any transaction.** The
 *    payload says something changed; it is never the source of what it changed
 *    to, which is what makes an out of order delivery harmless. Outside,
 *    because the pool is capped at one connection and a Stripe round trip
 *    inside a transaction would serialise the whole application.
 * 4. **Insert the ledger row with conflict-do-nothing.** Nothing inserted means
 *    this event was already handled, so commit and answer 200 without applying
 *    anything. Conflict-do-nothing rather than catching a unique violation:
 *    a raised violation would poison the very transaction the ledger protects.
 * 5. **Lock the agency's row for update, then apply the retrieved state.** The
 *    lock is what stops two concurrent deliveries from each reading, then
 *    committing in the wrong order.
 * 6. **Commit.** Ledger row and state change together or not at all. Committing
 *    the ledger first would mark an event handled while its effect was lost,
 *    and Stripe's retry would then be a silent no operation.
 *
 * ## Why almost nothing answers 500
 *
 * Stripe disables an endpoint that keeps failing, and a disabled endpoint means
 * a mirror that silently freezes. So 500 means only one thing here: "this might
 * work on retry". An event that can never succeed, one naming no organization
 * or naming one that does not exist, is logged and answered 200. The log is
 * what makes that honest rather than a shrug.
 *
 * The one deliberate exception is a payload that does not parse. That is not a
 * poison event, it is this code being wrong about Stripe's shapes, and it is
 * worth the retries and the loud failure. See `events.ts`.
 */
import { eq, sql } from "drizzle-orm";

import { processedWebhookEvents, subscriptions } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";

import {
  checkoutSessionCompleted,
  invoiceEvent,
  orgIdFromMetadata,
  primaryItem,
  retrievedSubscription,
  subscriptionEvent,
  type RetrievedSubscription,
} from "./events";
import { logStripeWebhook, type StripeWebhookOutcome } from "./log";
import { organizationExists } from "./organizations";

/**
 * The six events this endpoint is subscribed to, and the only ones it acts on.
 *
 * Anything else that arrives is answered 200 and ignored rather than treated as
 * a failure: the subscription list lives in the Stripe dashboard, and an extra
 * checkbox there should not turn into retries here.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
] as const;

export type StripeWebhookEvent = (typeof STRIPE_WEBHOOK_EVENTS)[number];

function isHandledEvent(type: string): type is StripeWebhookEvent {
  return (STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

/** A verified Stripe event, reduced to the three things this module reads. */
export type VerifiedEvent = {
  readonly id: string;
  readonly type: string;
  readonly object: unknown;
};

/**
 * The two Stripe calls this handler makes, and nothing more.
 *
 * Narrowed to an interface rather than taking the SDK client so the ordering,
 * replay and rollback behaviour can be tested against a fake without a network,
 * a key, or a Stripe account.
 */
export type StripeGateway = {
  /** Verifies the signature over the raw body. Throws when it does not verify. */
  readonly constructEvent: (
    body: string,
    signature: string,
  ) => Promise<VerifiedEvent>;
  /** Re reads authoritative state. Throws `resourceMissing` when it is gone. */
  readonly retrieveSubscription: (id: string) => Promise<unknown>;
};

export type StripeWebhookRequest = {
  readonly db: Database;
  readonly gateway: StripeGateway;
  /** The raw body, exactly as it arrived. Parsing it first breaks verification. */
  readonly body: string;
  readonly signature: string | undefined;
};

export type StripeWebhookResult = {
  readonly status: 200 | 400 | 500;
  readonly outcome: StripeWebhookOutcome;
  /** Why, in a couple of words. Mirrors what was logged. */
  readonly reason: string;
};

/**
 * A refusal: something this event can never do, however many times Stripe sends
 * it. Thrown so it unwinds the transaction, then answered 200.
 */
class WebhookRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "WebhookRefusal";
  }
}

/** Did Stripe say the object is simply not there? Not worth retrying. */
function isResourceMissing(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    "code" in thrown &&
    (thrown as { readonly code?: unknown }).code === "resource_missing"
  );
}

/** A PostgreSQL unique violation. Never transient, so never a 500. */
function isUniqueViolation(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    "code" in thrown &&
    (thrown as { readonly code?: unknown }).code === "23505"
  );
}

/**
 * Which subscription does this event concern, and does it already name an
 * agency?
 *
 * Read off the payload, which is allowed: an identifier is a pointer, not
 * state. Everything that ends up in a column is re read in step 3.
 */
function referencesOf(event: VerifiedEvent): {
  readonly subscriptionId: string | undefined;
  readonly orgIdFromSession: string | undefined;
} {
  if (event.type === "checkout.session.completed") {
    const session = checkoutSessionCompleted.parse(event.object);

    return {
      subscriptionId: session.subscription ?? undefined,
      orgIdFromSession: session.client_reference_id ?? undefined,
    };
  }

  if (event.type.startsWith("customer.subscription.")) {
    return {
      subscriptionId: subscriptionEvent.parse(event.object).id,
      orgIdFromSession: undefined,
    };
  }

  // invoice.payment_failed / invoice.payment_succeeded
  const invoice = invoiceEvent.parse(event.object);

  return {
    subscriptionId:
      invoice.parent?.subscription_details?.subscription ?? undefined,
    orgIdFromSession: undefined,
  };
}

/**
 * Whose row is this?
 *
 * The session's `client_reference_id` when there is one, because it is the only
 * value that binds a Stripe customer to an agency. Otherwise the row already
 * holding this customer id. Otherwise the `org_id` this app wrote into
 * `subscription_data.metadata` when it started Checkout, which is what lets a
 * subscription event that outran its session still land (AC-22).
 */
async function resolveOrgId(
  db: Database,
  subscription: RetrievedSubscription,
  orgIdFromSession: string | undefined,
): Promise<string | undefined> {
  if (orgIdFromSession !== undefined) {
    return orgIdFromSession;
  }

  const [existing] = await db
    .select({ orgId: subscriptions.orgId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, subscription.customer))
    .limit(1);

  return existing?.orgId ?? orgIdFromMetadata(subscription);
}

/**
 * Apply the retrieved state to the agency's row, inside the open transaction
 * and behind its lock.
 *
 * `past_due_since` is the only value this feature derives rather than mirrors,
 * and it is derived on the **database** clock. Feature 9 measures a grace
 * window from it, and a window measured from a serverless instance's own clock
 * could drift. The `coalesce` is what keeps a repeated `past_due` event from
 * silently extending that window: first move in sets it, later ones leave it,
 * and anything other than `past_due` clears it.
 */
function applyState(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  orgId: string,
  subscription: RetrievedSubscription,
): Promise<unknown> {
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

  return tx
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
        // `$onUpdate` only fires for `.update()`, and the database clock is the
        // same one `past_due_since` just used.
        updatedAt: sql`now()`,
      },
    });
}

/** Log and answer. Every non `handled` outcome leaves exactly one line. */
function answer(
  result: StripeWebhookResult,
  event: VerifiedEvent | undefined,
): StripeWebhookResult {
  if (result.outcome !== "handled") {
    logStripeWebhook({
      outcome: result.outcome,
      eventId: event?.id,
      eventType: event?.type,
      reason: result.reason,
    });
  }

  return result;
}

/**
 * Handle one inbound Stripe webhook request.
 *
 * Takes its database handle and its Stripe calls as arguments rather than
 * reaching for either: the route owns the unscoped handle (that is what
 * `withSystemAccess` is for) and this owns the ordering.
 */
export async function handleStripeWebhook(
  request: StripeWebhookRequest,
): Promise<StripeWebhookResult> {
  const { db, gateway, body, signature } = request;

  // 1. Verify first. Nothing below this line runs on an unverified body.
  if (signature === undefined) {
    return answer(
      { status: 400, outcome: "unverified", reason: "missing_signature" },
      undefined,
    );
  }

  let event: VerifiedEvent;

  try {
    event = await gateway.constructEvent(body, signature);
  } catch {
    // Deliberately not logging the thrown message: it is derived from a body
    // nothing has vouched for.
    return answer(
      { status: 400, outcome: "unverified", reason: "bad_signature" },
      undefined,
    );
  }

  if (!isHandledEvent(event.type)) {
    return answer(
      { status: 200, outcome: "ignored", reason: "unsubscribed_event_type" },
      event,
    );
  }

  // 2. What does it point at?
  const { subscriptionId, orgIdFromSession } = referencesOf(event);

  if (subscriptionId === undefined) {
    // A one off invoice, or a Checkout Session that produced no subscription.
    return answer(
      { status: 200, outcome: "refused", reason: "no_subscription_reference" },
      event,
    );
  }

  // 3. Re read authoritative state, outside any transaction.
  let subscription: RetrievedSubscription;

  try {
    subscription = retrievedSubscription.parse(
      await gateway.retrieveSubscription(subscriptionId),
    );
  } catch (thrown) {
    if (isResourceMissing(thrown)) {
      return answer(
        { status: 200, outcome: "refused", reason: "subscription_missing" },
        event,
      );
    }

    // Includes a parse failure, which means Stripe's shapes moved under this
    // code. Loud on purpose: see the note at the top of `events.ts`.
    throw thrown;
  }

  const orgId = await resolveOrgId(db, subscription, orgIdFromSession);

  if (orgId === undefined) {
    return answer(
      { status: 200, outcome: "refused", reason: "no_org_id" },
      event,
    );
  }

  // A soft deleted organization is deliberately still written (AC-16): the row
  // is a mirror of Stripe, and Stripe is still billing whoever this is.
  if (!(await organizationExists(db, orgId))) {
    return answer(
      { status: 200, outcome: "refused", reason: "org_not_found" },
      event,
    );
  }

  try {
    return answer(
      await db.transaction(async (tx) => {
        // 4. Ledger first, and without raising: a unique violation here would
        // poison the transaction it exists to protect (AC-23).
        const claimed = await tx
          .insert(processedWebhookEvents)
          .values({
            id: newId(),
            source: "stripe",
            eventId: event.id,
            eventType: event.type,
          })
          .onConflictDoNothing({
            target: [
              processedWebhookEvents.source,
              processedWebhookEvents.eventId,
            ],
          })
          .returning({ id: processedWebhookEvents.id });

        if (claimed.length === 0) {
          return {
            status: 200,
            outcome: "duplicate",
            reason: "already_processed",
          } as const;
        }

        // 5. Lock, then apply. Two concurrent deliveries queue here rather than
        // both reading the old row and committing in whichever order they land.
        const [existing] = await tx
          .select({ stripeCustomerId: subscriptions.stripeCustomerId })
          .from(subscriptions)
          .where(eq(subscriptions.orgId, orgId))
          .for("update")
          .limit(1);

        // One agency, at most one Stripe customer. A stored id is never quietly
        // replaced by a different one: that would move a paying agency onto
        // someone else's customer and lose the first (AC-27).
        if (
          existing !== undefined &&
          existing.stripeCustomerId !== subscription.customer
        ) {
          throw new WebhookRefusal("customer_id_conflict");
        }

        await applyState(tx, orgId, subscription);

        // 6. Commit.
        return { status: 200, outcome: "handled", reason: "applied" } as const;
      }),
      event,
    );
  } catch (thrown) {
    if (thrown instanceof WebhookRefusal) {
      // Rolled back, ledger row included, so nothing half applied survives.
      return answer(
        { status: 200, outcome: "refused", reason: thrown.reason },
        event,
      );
    }

    if (isUniqueViolation(thrown)) {
      // Another organization already holds this customer or subscription id.
      // Retrying cannot fix that, so it is a refusal rather than a 500.
      return answer(
        { status: 200, outcome: "refused", reason: "unique_violation" },
        event,
      );
    }

    // Everything else might work next time, and Stripe should try again. The
    // whole transaction rolled back, so the redelivery is processed rather than
    // skipped as a duplicate (AC-10).
    return answer(
      {
        status: 500,
        outcome: "failed",
        reason: thrown instanceof Error ? thrown.message : "unknown_error",
      },
      event,
    );
  }
}
