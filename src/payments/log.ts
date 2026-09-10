/**
 * One structured JSON line per webhook outcome that is not "handled" (spec
 * 0007, AC-21).
 *
 * Shaped like `src/db/tenant/log.ts` on purpose: same one call, one line rule,
 * same `event` / `at` fields, and the same refusal to carry row contents or
 * payloads. Feature 20 can forward either of them to Sentry without either
 * being rewritten.
 *
 * Three paths log:
 *
 * - **500**, a transient failure Stripe should retry. `error` says what broke.
 * - **200 with nothing applied**, an event that can never succeed. Stripe
 *   disables an endpoint that keeps failing, so a poison event has to be
 *   answered rather than retried forever, and the log is the only trace it
 *   leaves.
 * - **400**, a signature that did not verify. There is no trusted event id on
 *   that path, so the line names what it can and nothing it cannot vouch for.
 *
 * `console` and nothing else, exactly as the tenant layer decided: Vercel
 * collects stdout, and error tracking is feature 20's call.
 */

export type StripeWebhookOutcome =
  /** Verified, resolved, applied. Not logged; this exists for completeness. */
  | "handled"
  /** Verified, already in the ledger. Nothing applied, nothing wrong. */
  | "duplicate"
  /** Verified, but unresolvable or refused. Answered 200 so Stripe stops. */
  | "refused"
  /** Verified, and not one of the six events this endpoint acts on. */
  | "ignored"
  /** Verified, and applying it failed in a way a retry might survive. */
  | "failed"
  /** Not verified. Nothing was read, nothing was written. */
  | "unverified";

export type StripeWebhookLogLine = {
  readonly event: "stripe.webhook";
  readonly outcome: StripeWebhookOutcome;
  /** Absent on the unverified path, where no event id can be trusted. */
  readonly eventId?: string;
  readonly eventType?: string;
  /** Why it was refused, or what failed. Never a payload or a row. */
  readonly reason: string;
  readonly at: string;
};

export type StripeWebhookLogDetails = {
  readonly outcome: StripeWebhookOutcome;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly reason: string;
};

/**
 * Record a webhook outcome.
 *
 * `JSON.stringify` drops the undefined identifiers, so the unverified line
 * carries no fields it cannot stand behind.
 */
export function logStripeWebhook(details: StripeWebhookLogDetails): void {
  const line: StripeWebhookLogLine = {
    event: "stripe.webhook",
    ...details,
    at: new Date().toISOString(),
  };

  console.warn(JSON.stringify(line));
}
