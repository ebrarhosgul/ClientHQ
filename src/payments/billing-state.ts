/**
 * Turning one `subscriptions` row into what `/billing` says and offers.
 *
 * Pure, and separate from the page, because two of the three rules here are the
 * kind that look obvious and are quietly wrong in most billing pages:
 *
 * 1. **The action comes from `status`, never from "is there a customer id".**
 *    An agency that cancelled still has a Stripe customer, and offering it only
 *    a portal it cannot resubscribe from is a dead end (AC-6). It gets both: a
 *    Subscribe button, and a portal link for its payment history.
 * 2. **An unrecognised status still renders.** Spec 0002 left the CHECK off the
 *    column so a status Stripe invents tomorrow is recorded rather than
 *    rejected, and a page that crashed on one would undo that. The known
 *    statuses are exhaustive over Stripe's own union, and anything else falls
 *    back to plain wording rather than an error.
 *
 * Interpreting these statuses as *access levels* is `src/access/level.ts`'s
 * job (spec 0008), not this one. Nothing here gates anything; it only says
 * what is true. The status list itself lives in `subscription-status.ts` so
 * both readers share it without either importing the other.
 */
import type { ChipTint } from "@/ui/patterns/status-chip";

import type { SubscriptionRow } from "./queries";
import { isKnownStatus, type SubscriptionStatus } from "./subscription-status";

/**
 * The statuses that mean "there is nothing live to manage", so Checkout is
 * offered again. Spec 0007, AC-6 fixes this list.
 */
const ENDED_STATUSES: readonly SubscriptionStatus[] = [
  "canceled",
  "incomplete_expired",
  "unpaid",
];

export type BillingView = {
  /** A few words for the badge, e.g. "Free trial". */
  readonly label: string;
  /** The design system's own chip tints, so this reads like every other status in the product. */
  readonly tint: ChipTint;
  /** One or two plain sentences saying what is true and what to do. */
  readonly description: string;
  /** The renewal or trial end line, already worded and dated. Absent when there is no date. */
  readonly dateLine?: string;
  /** Offer Checkout: there is nothing live to manage. */
  readonly canSubscribe: boolean;
  /** Offer the Billing Portal: a Stripe customer exists to manage. */
  readonly canOpenPortal: boolean;
};

/**
 * The date, in UTC and said so.
 *
 * The product has no per user timezone, so rendering this in one would mean
 * inventing it. Naming UTC is the honest version: a trial that ends "12
 * September 2026 (UTC)" is unambiguous, where a bare date is not.
 */
export function formatBillingDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

  return `${formatted} (UTC)`;
}

/**
 * The same, with the time of day, for a moment that matters to the hour.
 *
 * The grace window closes at `past_due_since` plus 7 days, not at midnight, so
 * a banner saying only the date would be wrong for most of that day (spec
 * 0008, AC-5). Twenty four hour clock, because it is unambiguous in UTC.
 */
export function formatBillingDateTime(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  return `${formatted} (UTC)`;
}

/** What the date on the row means, which depends on the status. */
function dateLineFor(status: string, row: SubscriptionRow): string | undefined {
  if (row.currentPeriodEnd === null) {
    return undefined;
  }

  const on = formatBillingDate(row.currentPeriodEnd);

  if (row.cancelAtPeriodEnd) {
    return `Your access ends on ${on}.`;
  }

  // While a subscription is trialing, the item's period end *is* the trial end,
  // which is why spec 0007 adds no `trial_end` column.
  return status === "trialing"
    ? `Your free trial ends on ${on}.`
    : `Your subscription renews on ${on}.`;
}

type Wording = {
  readonly label: string;
  readonly tint: ChipTint;
  readonly description: string;
};

/**
 * A sentence for every status Stripe documents. Exhaustive by construction: a
 * status added to `SUBSCRIPTION_STATUSES` fails the typecheck until it has
 * wording, which is the AGENTS.md rule about status enums, kept without giving
 * up the column's tolerance for an unknown one.
 */
const WORDING: Readonly<Record<SubscriptionStatus, Wording>> = {
  trialing: {
    label: "Free trial",
    tint: "info",
    description:
      "You have full access. Nothing is charged until the trial ends, and you can cancel before then without paying.",
  },
  active: {
    label: "Active",
    tint: "success",
    description:
      "Your subscription is paid up. You can change your card, see your invoices or cancel at any time.",
  },
  past_due: {
    label: "Payment failed",
    tint: "warning",
    description:
      "The last payment did not go through. Stripe will try again, and updating your card now is the quickest way to sort it out.",
  },
  canceled: {
    label: "Cancelled",
    tint: "neutral",
    description:
      "This subscription has ended. Your data is still here, and you can subscribe again whenever you are ready.",
  },
  incomplete: {
    label: "Waiting on payment",
    tint: "warning",
    description:
      "The first payment has not finished yet. It usually needs one more step from your bank.",
  },
  incomplete_expired: {
    label: "Never started",
    tint: "neutral",
    description:
      "The first payment was never completed, so this subscription did not start. You can try again.",
  },
  unpaid: {
    label: "Unpaid",
    tint: "danger",
    description:
      "Stripe has stopped retrying the last payment. Subscribe again to pick things back up.",
  },
  paused: {
    label: "Paused",
    tint: "neutral",
    description:
      "This subscription is paused, so nothing is being charged and nothing renews.",
  },
};

/** What to show when there has never been a subscription at all (AC-1). */
const NEVER_SUBSCRIBED: BillingView = {
  label: "No subscription",
  tint: "neutral",
  description:
    "Your agency is not subscribed yet. Subscribing starts a 14 day free trial, and nothing is charged until it ends.",
  canSubscribe: true,
  canOpenPortal: false,
};

/**
 * Read one row into everything the page needs.
 *
 * @param row the agency's subscription, or `undefined` when there is none
 */
export function billingView(row: SubscriptionRow | undefined): BillingView {
  if (row === undefined) {
    return NEVER_SUBSCRIBED;
  }

  const status = row.status;

  // An unrecognised status is treated as still live and offered no Checkout:
  // offering one to an agency that may already be paying is the worse mistake.
  const { wording, canSubscribe }: { wording: Wording; canSubscribe: boolean } =
    isKnownStatus(status)
      ? {
          wording: WORDING[status],
          canSubscribe: ENDED_STATUSES.includes(status),
        }
      : {
          wording: {
            label: "Subscription",
            tint: "neutral",
            description: `Stripe reports this subscription as “${status}”. Open the billing portal to see the detail.`,
          },
          canSubscribe: false,
        };

  return {
    ...wording,
    dateLine: dateLineFor(status, row),
    canSubscribe,
    // The column is not nullable, so a row always names a Stripe customer.
    canOpenPortal: true,
  };
}
