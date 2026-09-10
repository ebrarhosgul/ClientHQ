"use client";

/**
 * The two buttons on `/billing`, and the only client code this feature has.
 *
 * Each is its own `<form>` posting to its own Server Action, rather than a
 * click handler, for three reasons that all matter here:
 *
 * - A Server Action reached from a form may `redirect()` to an external URL,
 *   which is the whole point: both actions end at a page Stripe hosts.
 * - `SubmitButton` reads the enclosing form's pending state, so the button
 *   announces that it is working through `aria-busy` and a label change rather
 *   than through a spinner alone.
 * - It works before the JavaScript loads, which for the one control that leads
 *   to a payment page is worth having.
 *
 * A failure comes back as the project's ordinary `Result` and renders in the
 * same alert every other form in the product uses. A success never comes back
 * at all: the browser is already on its way to Stripe.
 */
import { CreditCard, ExternalLink } from "lucide-react";
import { useActionState } from "react";

import type { ActionError } from "@/db/tenant";
import { openBillingPortal } from "@/payments/open-billing-portal";
import { startCheckout } from "@/payments/start-checkout";
import { errorMessage } from "@/ui/patterns/error-messages";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { SubmitButton } from "@/ui/primitives/submit-button";

type BillingActionState = { readonly error?: ActionError };

const IDLE: BillingActionState = {};

export type BillingActionsProps = {
  /** Offer Checkout: there is no live subscription to manage. */
  readonly canSubscribe: boolean;
  /** Offer the Billing Portal: a Stripe customer exists. */
  readonly canOpenPortal: boolean;
};

/**
 * Both actions can be offered at once, and for a cancelled agency they are:
 * Subscribe to come back, and the portal for the invoices from last time.
 */
export function BillingActions({
  canSubscribe,
  canOpenPortal,
}: BillingActionsProps) {
  const [checkout, runCheckout] = useActionState<BillingActionState>(
    async () => {
      const result = await startCheckout({});

      // Only reached on failure: success redirects and never returns.
      return result.ok ? IDLE : { error: result.error };
    },
    IDLE,
  );

  const [portal, runPortal] = useActionState<BillingActionState>(async () => {
    const result = await openBillingPortal({});

    return result.ok ? IDLE : { error: result.error };
  }, IDLE);

  const error = checkout.error ?? portal.error;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(error)}</p>
          </AlertDescription>
        </Alert>
      ) : undefined}

      <div className="flex flex-wrap items-center gap-2">
        {canSubscribe ? (
          <form action={runCheckout}>
            <SubmitButton pendingLabel="Opening Stripe…">
              <CreditCard />
              Subscribe
            </SubmitButton>
          </form>
        ) : undefined}

        {canOpenPortal ? (
          <form action={runPortal}>
            <SubmitButton
              variant={canSubscribe ? "outline" : "default"}
              pendingLabel="Opening Stripe…"
            >
              <ExternalLink />
              Manage billing
            </SubmitButton>
          </form>
        ) : undefined}
      </div>

      <p className="text-sm text-muted-foreground">
        Payment happens on a page Stripe hosts. Your card details never reach
        this app.
      </p>
    </div>
  );
}
