/**
 * The pure arithmetic behind a ceiling: which window an attempt falls in, how
 * long until it resets, and the sentence that says so (spec 0018, AC-4, AC-5).
 *
 * Nothing here touches the database or the clock on its own; `now` is always
 * a parameter, so a test can fix it.
 */
import type { RateLimitPolicy } from "./policies";

/** What the door builds after every consume, and the wrapper hands back. */
export type RateLimitVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly subject: string;
      readonly action: string;
      readonly count: number;
      readonly limit: number;
      readonly windowStart: Date;
      readonly retryAfterSeconds: number;
      readonly message: string;
    };

/**
 * The window's opening instant, aligned to the UTC clock (AC-4): the hourly
 * window resets on the hour, the daily windows at 00:00 UTC.
 */
export function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Whole seconds until this window resets, rounded up. */
export function retryAfterSeconds(
  start: Date,
  windowSeconds: number,
  now: Date,
): number {
  const resetsAt = start.getTime() + windowSeconds * 1000;
  return Math.ceil((resetsAt - now.getTime()) / 1000);
}

/** The fixed noun phrase for each policy, exactly as AC-5 requires. */
const NOUN_PHRASE: Record<RateLimitPolicy["action"], string> = {
  upload: "Your agency has reached its upload allowance of 60 an hour.",
  invoice_email:
    "Your agency has reached its allowance of 50 invoice emails a day.",
  create_agency: "You have reached the allowance of 3 new agencies a day.",
};

/**
 * `in about N minutes` under an hour, `in about N hours` otherwise, each
 * singular at 1. 3599 seconds reads `in about 1 hour`, never `in about 60
 * minutes` (AC-5).
 */
function resetPhrase(retryAfterSecondsValue: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSecondsValue / 60));

  if (minutes < 60) {
    return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.max(1, Math.ceil(retryAfterSecondsValue / 3600));
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** The sentence a refusal returns in `error.message` (AC-5). */
export function refusalMessage(
  policy: RateLimitPolicy,
  retryAfterSecondsValue: number,
): string {
  return `${NOUN_PHRASE[policy.action]} Try again ${resetPhrase(retryAfterSecondsValue)}.`;
}
