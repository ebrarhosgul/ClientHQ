/**
 * The real Stripe calls behind the webhook handler's `StripeGateway`.
 *
 * The handler owns the ordering and the transaction; this owns the network. Two
 * calls, kept apart from the logic so the ordering, replay and rollback
 * behaviour can be tested with a fake and no Stripe account.
 */
import { env } from "@/lib/env";

import type { StripeGateway, VerifiedEvent } from "./webhook";
import { stripeClient } from "./stripe";

/**
 * Verify and re read against the live Stripe account.
 *
 * `constructEventAsync` rather than `constructEvent`: the synchronous version
 * needs Node's crypto module, and the async one uses the web crypto that is
 * available in every runtime this could be deployed to. The difference matters
 * only when the route's runtime changes, which is exactly when nobody would
 * remember this.
 */
export function liveStripeGateway(): StripeGateway {
  const stripe = stripeClient();

  return {
    constructEvent: async (
      body: string,
      signature: string,
    ): Promise<VerifiedEvent> => {
      const event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        env().STRIPE_WEBHOOK_SECRET,
      );

      return { id: event.id, type: event.type, object: event.data.object };
    },

    retrieveSubscription: (id: string): Promise<unknown> =>
      stripe.subscriptions.retrieve(id),
  };
}
