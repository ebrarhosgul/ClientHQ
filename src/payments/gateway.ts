/**
 * The real Stripe calls behind the webhook handler's `StripeGateway`, and the
 * nightly reconcile's `StripeListGateway`.
 *
 * The handler and the reconcile own the ordering and the transaction; this
 * owns the network. Kept apart from the logic so the ordering, replay and
 * rollback behaviour can be tested with a fake and no Stripe account.
 */
import { env } from "@/lib/env";

import { retrievedSubscription } from "./events";
import type { StripeListGateway } from "./reconcile";
import { stripeClient } from "./stripe";
import type { StripeGateway, VerifiedEvent } from "./webhook";

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

/**
 * List every subscription in the account, all statuses, the SDK's own
 * `for await` auto pagination following it to the end at 100 per page (spec
 * 0017, AC-7). A page request that fails throws out of the generator, which
 * is what lets the reconcile write nothing rather than half a listing.
 *
 * `src/cron/daily.ts` builds this once at module scope, unlike
 * `liveStripeGateway()` above (built per request, inside the webhook route's
 * handler): `stripeClient()` is deferred into the generator body so
 * constructing this gateway itself never touches `env()`, the same rule
 * `src/db/client.ts` sets for the database handle.
 */
export function liveStripeListGateway(): StripeListGateway {
  return {
    listSubscriptions: async function* listSubscriptions() {
      const page = stripeClient().subscriptions.list({
        status: "all",
        limit: 100,
      });

      for await (const subscription of page) {
        yield retrievedSubscription.parse(subscription);
      }
    },
  };
}
