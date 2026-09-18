/**
 * One structured JSON line per refusal, and per store failure (spec 0018,
 * AC-7, AC-8). Shaped like `src/auth/webhook-log.ts`: one call, one line, the
 * same `event` / `at` fields.
 *
 * Never a name, an email address or any input field: the subject is already
 * an id.
 */
import type { RateLimitVerdict } from "./window";

export type RateLimitRefusedLine = {
  readonly event: "rate_limit.refused";
  readonly subject: string;
  readonly action: string;
  readonly count: number;
  readonly limit: number;
  readonly windowStart: string;
  readonly at: string;
};

export type RateLimitSkippedLine = {
  readonly event: "rate_limit.skipped";
  readonly subject: string;
  readonly action: string;
  readonly errorName: string;
  readonly at: string;
};

function emit(line: RateLimitRefusedLine | RateLimitSkippedLine): void {
  console.warn(JSON.stringify(line));
}

/** Record a refusal. Called by the door itself, never by a caller. */
export function logRefused(
  verdict: Extract<RateLimitVerdict, { readonly allowed: false }>,
): void {
  emit({
    event: "rate_limit.refused",
    subject: verdict.subject,
    action: verdict.action,
    count: verdict.count,
    limit: verdict.limit,
    windowStart: verdict.windowStart.toISOString(),
    at: new Date().toISOString(),
  });
}

export type SkippedDetails = {
  readonly subject: string;
  readonly action: string;
  readonly errorName: string;
};

/** Record that the store threw, so the attempt was let through (AC-7). */
export function logSkipped(details: SkippedDetails): void {
  emit({
    event: "rate_limit.skipped",
    ...details,
    at: new Date().toISOString(),
  });
}
