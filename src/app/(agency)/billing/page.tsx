import type { Metadata } from "next";

import { agencyContext } from "@/auth/context";
import { billingView, type BillingView } from "@/payments/billing-state";
import { subscriptionForAgency } from "@/payments/queries";
import { BillingActions } from "@/payments/ui/billing-actions";
import { isClerkConfigured } from "@/lib/env";
import { PageHeader } from "@/ui/patterns/page-header";
import { StatusChip } from "@/ui/patterns/status-chip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";

export const metadata: Metadata = {
  title: "Billing",
};

/**
 * `/billing`: what the agency's subscription is, and the one thing it can do
 * about it (spec 0007).
 *
 * The page makes **no Stripe call at all** (AC-17). Everything on it comes from
 * the one local row the webhook keeps in step, read through the tenant scoping
 * layer like every other read in the product. That is what stops a Stripe
 * outage from taking the billing page down with it, and it is why the webhook
 * bothers to mirror anything.
 *
 * Two things are worth knowing before changing this:
 *
 * - **A member sees the same status and no buttons** (AC-13). The role comes
 *   from the Clerk session claim on the context, never from `memberships.role`,
 *   which is a mirror that can be stale until a webhook lands. Hiding the
 *   buttons is presentation only; both Server Actions refuse a member on their
 *   own, so this is not the thing keeping anyone out.
 * - **Coming back from Checkout can be a moment early.** The browser returns
 *   here as soon as Stripe is done, and the webhook may land a second later, so
 *   an agency can briefly see the pre subscription state. A refresh fixes it,
 *   nothing is wrong, and spec 0007 accepted that rather than polling.
 */
export default async function BillingPage() {
  // With no Clerk publishable key there is no session to scope a read to, so
  // this shows what a brand new agency sees rather than resolving a tenant
  // context that cannot exist (spec 0004, AC-22).
  const ctx = isClerkConfigured() ? await agencyContext() : undefined;

  const view: BillingView = billingView(
    ctx === undefined ? undefined : await subscriptionForAgency(ctx),
  );

  const isAdmin = ctx?.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Your agency's subscription to this product. Nothing your own clients pay you passes through here."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Subscription</h2>
          </CardTitle>
          <CardDescription>{view.description}</CardDescription>
          <CardAction>
            {/* The word carries the meaning; the tint only reinforces it. */}
            <StatusChip tint={view.tint}>{view.label}</StatusChip>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {view.dateLine ? (
            <p className="text-sm text-foreground">{view.dateLine}</p>
          ) : undefined}

          {isAdmin ? (
            <BillingActions
              canSubscribe={view.canSubscribe}
              canOpenPortal={view.canOpenPortal}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only an admin of this agency can change the subscription. Ask one
              of them if something here needs sorting out.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
