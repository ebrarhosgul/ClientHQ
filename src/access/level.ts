/**
 * What an agency may do, worked out from its subscription row and the clock
 * (spec 0008, AC-1, AC-2, AC-3).
 *
 * Pure on purpose. The level is never stored, never cached across requests,
 * and never read from Stripe: it is the value of `accessVerdict(row, now)` at
 * the instant of the read, which is what lets a grace window expire with no
 * job and no write. `now` is a parameter rather than `new Date()` so the tests
 * can stand at the boundary and watch it tip.
 *
 * This file imports nothing from `src/db/tenant`, and that is load bearing:
 * `src/db/tenant/action.ts` imports it, and a cycle there would be the first
 * thing to break.
 */
import {
  isKnownStatus,
  type SubscriptionStatus,
} from "@/payments/subscription-status";

export const ACCESS_LEVELS = [
  /** No row, or a Checkout that never finished. Sent to `/billing`. */
  "unsubscribed",
  /** Paying, or in the trial. Everything works. */
  "full",
  /** A payment failed less than 7 days ago. Reads work, writes are refused. */
  "grace",
  /** Lapsed, ended, or in a state this build does not know. Sent to `/billing`. */
  "locked",
] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * A product rule, not deployment configuration, which is why it is a constant
 * and not an environment variable.
 */
export const GRACE_WINDOW_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The two columns the gate reads. Anything else on the row is not its business. */
export type SubscriptionAccessRow = {
  readonly status: string;
  readonly pastDueSince: Date | null;
};

/**
 * The one state the webhook should never produce: `past_due` with no start
 * date. It is treated as `locked` rather than as a grace window with no end,
 * and reported so somebody looks at the webhook.
 */
export type InvariantBreak = "past_due_without_since";

export type AccessVerdict = {
  readonly level: AccessLevel;
  /** Present only on `grace`: when the window closes. */
  readonly graceEndsAt?: Date;
  readonly invariantBreak?: InvariantBreak;
};

/** When a window that opened at `pastDueSince` closes. */
export function graceEndsAt(pastDueSince: Date): Date {
  return new Date(
    pastDueSince.getTime() + GRACE_WINDOW_DAYS * MILLISECONDS_PER_DAY,
  );
}

function pastDueVerdict(pastDueSince: Date | null, now: Date): AccessVerdict {
  if (pastDueSince === null) {
    return { level: "locked", invariantBreak: "past_due_without_since" };
  }

  const endsAt = graceEndsAt(pastDueSince);

  // Strictly before: at exactly the boundary the window has closed (AC-2).
  return now.getTime() < endsAt.getTime()
    ? { level: "grace", graceEndsAt: endsAt }
    : { level: "locked" };
}

/**
 * The full table for a status this build knows. Exhaustive: a status added to
 * `SUBSCRIPTION_STATUSES` fails the typecheck here until it has a level.
 */
function knownVerdict(
  status: SubscriptionStatus,
  pastDueSince: Date | null,
  now: Date,
): AccessVerdict {
  switch (status) {
    case "incomplete":
      return { level: "unsubscribed" };
    case "trialing":
    case "active":
      return { level: "full" };
    case "past_due":
      return pastDueVerdict(pastDueSince, now);
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return { level: "locked" };
    default: {
      const unreachable: never = status;

      return unreachable;
    }
  }
}

/**
 * The level, and the two facts that sometimes travel with it.
 *
 * Never throws and never logs; the callers decide what to do with an invariant
 * break. `cancel_at_period_end` is deliberately not an input: an agency that
 * has cancelled keeps full access until Stripe ends the subscription and the
 * webhook records that (AC-1).
 */
export function accessVerdict(
  row: SubscriptionAccessRow | undefined,
  now: Date,
): AccessVerdict {
  if (row === undefined) {
    return { level: "unsubscribed" };
  }

  // A status this build has never heard of locks. Stripe may add one tomorrow
  // and the webhook will record it faithfully (spec 0002); failing towards
  // "sort it out on /billing" is the safe direction.
  return isKnownStatus(row.status)
    ? knownVerdict(row.status, row.pastDueSince, now)
    : { level: "locked" };
}

/** The level alone, for a caller with no use for the rest of the verdict. */
export function accessLevel(
  row: SubscriptionAccessRow | undefined,
  now: Date,
): AccessLevel {
  return accessVerdict(row, now).level;
}
