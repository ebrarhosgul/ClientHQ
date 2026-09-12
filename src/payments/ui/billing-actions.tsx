"use client";

/**
 * The buttons that lead to Stripe, and the only client code this feature has.
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
 *
 * `OpenBillingPortalButton` is the portal half on its own, for the grace
 * banner (spec 0008, AC-5): same action, same pending state, its own alert.
 */
import { CreditCard, ExternalLink } from "lucide-react";
import { useActionState, type ReactNode } from "react";

import type { ActionError, Result } from "@/db/tenant";
import { openBillingPortal } from "@/payments/open-billing-portal";
import { startCheckout } from "@/payments/start-checkout";
import { errorMessage } from "@/ui/patterns/error-messages";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import {
  SubmitButton,
  type SubmitButtonProps,
} from "@/ui/primitives/submit-button";

type BillingActionState = { readonly error?: ActionError };

const IDLE: BillingActionState = {};

/**
 * Run one of the two Stripe bound actions from a form.
 *
 * Only a failure ever becomes state: a success redirects and never returns.
 */
function useBillingAction(
  action: (input: unknown) => Promise<Result<never>>,
): readonly [BillingActionState, () => void] {
  const [state, run] = useActionState<BillingActionState>(async () => {
    const result = await action({});

    return result.ok ? IDLE : { error: result.error };
  }, IDLE);

  return [state, run];
}

function BillingActionAlert({ error }: { readonly error: ActionError }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>That did not work</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
      </AlertDescription>
    </Alert>
  );
}

export type OpenBillingPortalButtonProps = {
  readonly variant?: SubmitButtonProps["variant"];
  readonly children?: ReactNode;
};

/**
 * One button to the Billing Portal, with its own alert underneath on failure.
 * The label is the caller's, because "Manage billing" on `/billing` and
 * "Update your card" in the grace banner are the same action said for
 * different reasons.
 */
export function OpenBillingPortalButton({
  variant = "default",
  children = (
    <>
      <ExternalLink />
      Manage billing
    </>
  ),
}: OpenBillingPortalButtonProps) {
  const [portal, runPortal] = useBillingAction(openBillingPortal);

  return (
    <div className="flex flex-col gap-2">
      <form action={runPortal}>
        <SubmitButton variant={variant} pendingLabel="Opening Stripe…">
          {children}
        </SubmitButton>
      </form>
      {portal.error ? <BillingActionAlert error={portal.error} /> : undefined}
    </div>
  );
}

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
  const [checkout, runCheckout] = useBillingAction(startCheckout);
  const [portal, runPortal] = useBillingAction(openBillingPortal);

  const error = checkout.error ?? portal.error;

  return (
    <div className="flex flex-col gap-4">
      {error ? <BillingActionAlert error={error} /> : undefined}

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
