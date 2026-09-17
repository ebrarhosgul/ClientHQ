/**
 * One structured JSON line per Clerk webhook outcome that is not "handled",
 * plus the organization delete branch, which logs itself (spec 0015, AC-14).
 *
 * Shaped like `src/payments/log.ts` on purpose: same one call, one line rule,
 * the same `event` / `at` fields, and the same six outcomes. Feature 20 can
 * forward either of them to Sentry without either being rewritten.
 *
 * Never a payload, an email address, a name or an image URL: only the
 * identifiers a person debugging a delivery needs (spec 0015, key invariants).
 */

export type ClerkWebhookOutcome =
  /** Verified, resolved, applied. Not logged; this exists for completeness. */
  | "handled"
  /** Verified, already in the ledger. Nothing applied, nothing wrong. */
  | "duplicate"
  /** Verified, but unresolvable or refused. Answered 200 so Clerk stops. */
  | "refused"
  /** Verified, and not one of the eight events this endpoint acts on. */
  | "ignored"
  /** Verified, and applying it failed in a way a retry might survive. */
  | "failed"
  /** Not verified. Nothing was read, nothing was written. */
  | "unverified";

export type ClerkWebhookLogLine = {
  readonly event: "clerk.webhook";
  readonly outcome: ClerkWebhookOutcome;
  /** Absent on the unverified path, where no event id can be trusted. */
  readonly eventId?: string;
  readonly eventType?: string;
  /** The Clerk organization or user id involved, when one is known. */
  readonly clerkOrgId?: string;
  readonly clerkUserId?: string;
  /** Why it was refused or ignored, or what failed. Never a payload or a row. */
  readonly reason: string;
  readonly at: string;
};

export type ClerkWebhookLogDetails = {
  readonly outcome: ClerkWebhookOutcome;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly clerkOrgId?: string;
  readonly clerkUserId?: string;
  readonly reason: string;
};

/**
 * Record a webhook outcome.
 *
 * `JSON.stringify` drops the undefined identifiers, so the unverified line
 * carries no fields it cannot stand behind.
 */
export function logClerkWebhook(details: ClerkWebhookLogDetails): void {
  const line: ClerkWebhookLogLine = {
    event: "clerk.webhook",
    ...details,
    at: new Date().toISOString(),
  };

  console.warn(JSON.stringify(line));
}
