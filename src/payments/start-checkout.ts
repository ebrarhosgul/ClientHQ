"use server";

/**
 * Starting a subscription (spec 0007, AC-2, AC-13, AC-14, AC-18).
 *
 * Card details never come near this app. The agency is sent to a payment page
 * Stripe hosts, which is what keeps PCI scope at its lightest tier, and the app
 * learns what happened from the webhook rather than from the browser coming
 * back.
 *
 * Three values do the real work in the session this creates:
 *
 * - `client_reference_id` is the internal `org_id`, and it is the only thing
 *   that binds a Stripe customer to an agency. Without it the webhook would
 *   have a payment and no idea whose it is.
 * - `subscription_data.metadata.org_id` is the same value again, on the
 *   subscription itself. It is the fallback for a `customer.subscription.*`
 *   event that arrives before the session event does (AC-22), which happens
 *   more often than the ordering suggests.
 * - `customer`, when the agency already has one. An agency that cancelled and
 *   comes back reuses its Stripe customer rather than growing a second one and
 *   orphaning its payment history (AC-14).
 *
 * The trial is **not** set here. It lives on the Stripe Price, and Checkout
 * applies it. Spec 0007 chose that knowing the cost: nobody reading this file
 * can tell you it is 14 days.
 */
import { redirect } from "next/navigation";

import { subscriptionStatusProperty } from "@/analytics";
import { subscriptions } from "@/db/schema";
import { tenantActionError, withTenantAction, type Result } from "@/db/tenant";
import { env } from "@/lib/env";

import { checkoutIdempotencyKey } from "./idempotency";
import { noBillingInput } from "./schema";
import { stripeClient } from "./stripe";
import { throughStripe } from "./unavailable";

/**
 * Create the session.
 *
 * Split from the exported action below so `redirect()` can be called outside a
 * `try` block, which is what Next asks for: it works by throwing, and a `catch`
 * around it would swallow the navigation.
 */
const createCheckoutSession = withTenantAction({
  name: "startCheckout",
  input: noBillingInput,
  // The Clerk session's organization role claim, not `memberships.role`, which
  // is a display mirror and can be stale (AC-13).
  requireRole: "admin",
  // One of the two actions the access gate exempts (spec 0008, AC-6): this is
  // how a lapsed agency pays, so it has to work at every level. The admin
  // guard above still applies.
  subscription: "any",
  handler: async ({
    ctx,
    db,
  }): Promise<{
    readonly url: string;
    readonly subscriptionStatus: string | undefined;
  }> => {
    const existing = await db.findFirst(subscriptions);
    const appUrl = env().NEXT_PUBLIC_APP_URL;

    const session = await throughStripe("checkout.sessions.create", () =>
      stripeClient().checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: env().STRIPE_PRICE_ID, quantity: 1 }],
          client_reference_id: ctx.orgId,
          subscription_data: { metadata: { org_id: ctx.orgId } },
          // Both back to `/billing`: the page reads the mirror, so it says the
          // right thing whether the agency finished or changed its mind.
          success_url: `${appUrl}/billing`,
          cancel_url: `${appUrl}/billing`,
          // Omitted when there is no customer yet, so Stripe creates one. Never
          // `payment_method_types`: hardcoding it would lock out every payment
          // method configured in the dashboard.
          ...(existing === undefined
            ? {}
            : { customer: existing.stripeCustomerId }),
        },
        {
          idempotencyKey: checkoutIdempotencyKey(
            ctx.orgId,
            existing?.stripeCustomerId,
            new Date(),
          ),
        },
      ),
    );

    if (session.url === null) {
      // Stripe returns no URL for a session that cannot be paid in a browser.
      throw tenantActionError({
        code: "unavailable",
        message: "Stripe could not open the payment page. Try again shortly.",
      });
    }

    return { url: session.url, subscriptionStatus: existing?.status };
  },
  // The fourth step of the funnel (spec 0019, AC-11, AC-13), stamped with
  // the status the agency had when it started paying.
  track: {
    event: "checkout.started",
    properties: (_input, session) => ({
      subscription_status: subscriptionStatusProperty(
        session.subscriptionStatus,
      ),
    }),
  },
});

/**
 * Send an admin to Stripe's hosted Checkout.
 *
 * Returns the project's ordinary `Result` when it cannot, and does not return
 * at all when it can: `redirect()` throws, and Next turns that into the
 * navigation, external URL included.
 */
export async function startCheckout(input: unknown): Promise<Result<never>> {
  const started = await createCheckoutSession(input);

  if (!started.ok) {
    return started;
  }

  redirect(started.data.url);
}
