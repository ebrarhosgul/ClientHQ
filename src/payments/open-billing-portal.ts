"use server";

/**
 * Opening Stripe's Billing Portal (spec 0007, AC-6, AC-7, AC-13).
 *
 * Everything after subscribing happens here rather than in this app: changing a
 * card, reading invoices, cancelling. None of it is code you own, and the
 * cancellation comes back as a webhook like any other change, so the mirror
 * stays correct without this action knowing anything about what was done there.
 *
 * The portal is offered whenever a Stripe customer exists, including to an
 * agency that has already cancelled: its payment history is still in there, and
 * the invoices it might need are the whole reason not to hide it.
 */
import { redirect } from "next/navigation";

import { subscriptions } from "@/db/schema";
import { tenantActionError, withTenantAction, type Result } from "@/db/tenant";
import { env } from "@/lib/env";

import { noBillingInput } from "./schema";
import { stripeClient } from "./stripe";
import { throughStripe } from "./unavailable";

/**
 * Create the portal session. Split from the exported action for the same reason
 * as `startCheckout`: `redirect()` throws, so it is called outside the `try`.
 */
const createPortalSession = withTenantAction({
  name: "openBillingPortal",
  input: noBillingInput,
  requireRole: "admin",
  // One of the two actions the access gate exempts (spec 0008, AC-6): this is
  // how a lapsed agency pays, so it has to work at every level. The admin
  // guard above still applies.
  subscription: "any",
  handler: async ({ db }): Promise<{ readonly url: string }> => {
    const existing = await db.findFirst(subscriptions);

    if (existing === undefined) {
      // Nothing to manage. Reachable only by calling the action directly, since
      // the page hides the link until a customer exists.
      throw tenantActionError({
        code: "not_found",
        message:
          "There is no billing account to open yet. Subscribe first, and the portal appears here.",
      });
    }

    const session = await throughStripe("billingPortal.sessions.create", () =>
      stripeClient().billingPortal.sessions.create({
        customer: existing.stripeCustomerId,
        return_url: `${env().NEXT_PUBLIC_APP_URL}/billing`,
      }),
    );

    return { url: session.url };
  },
});

/** Send an admin to Stripe's Billing Portal, or say why not. */
export async function openBillingPortal(
  input: unknown,
): Promise<Result<never>> {
  const opened = await createPortalSession(input);

  if (!opened.ok) {
    return opened;
  }

  redirect(opened.data.url);
}
