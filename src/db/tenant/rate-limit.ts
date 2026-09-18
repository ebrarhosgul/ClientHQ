/**
 * The ceiling door (spec 0018, AC-2, AC-3, AC-7, AC-8): one atomic upsert per
 * attempt, and the only place that reads or writes `rate_limit_windows`.
 *
 * `consume` never throws. A store failure is caught, logged, and returned as
 * `allowed`, because the counter failing must never be the reason a limited
 * action fails (AC-7). The upsert is the whole mechanism: two concurrent
 * calls for the same `(subject, action, window_start)` cannot both read the
 * same count, because `count = count + 1` runs against the row the other one
 * just wrote, not against a value either caller read.
 */
import { sql } from "drizzle-orm";

import { logRefused, logSkipped } from "@/rate-limit/log";
import type { RateLimitPolicy } from "@/rate-limit/policies";
import {
  refusalMessage,
  retryAfterSeconds,
  windowStart,
  type RateLimitVerdict,
} from "@/rate-limit/window";

import { rateLimitWindows } from "../schema";
import { pooledDb } from "./executor";

/** Who is being limited. Rendered to the text column by this door alone. */
export type RateLimitSubject =
  | { readonly kind: "org"; readonly id: string }
  | { readonly kind: "user"; readonly id: string };

function subjectText(subject: RateLimitSubject): string {
  return `${subject.kind}:${subject.id}`;
}

/**
 * Consume one unit of `policy` for `subject`, whatever happens after: the
 * attempt counts whether it is then allowed, refused, or allowed but fails
 * later in the caller.
 */
/** Distinguishes the upsert's own broken invariant from a driver or network failure in `rate_limit.skipped` (AC-7). */
class UpsertReturnedNoRow extends Error {
  constructor() {
    super("the rate limit upsert returned no row");
    this.name = "UpsertReturnedNoRow";
  }
}

export async function consume(
  subject: RateLimitSubject,
  policy: RateLimitPolicy,
  now: Date,
): Promise<RateLimitVerdict> {
  const subjectKey = subjectText(subject);
  const start = windowStart(now, policy.windowSeconds);

  try {
    const db = await pooledDb();

    const [row] = await db
      .insert(rateLimitWindows)
      .values({
        subject: subjectKey,
        action: policy.action,
        windowStart: start,
        count: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          rateLimitWindows.subject,
          rateLimitWindows.action,
          rateLimitWindows.windowStart,
        ],
        set: {
          count: sql`${rateLimitWindows.count} + 1`,
          updatedAt: now,
        },
      })
      .returning({ count: rateLimitWindows.count });

    if (row === undefined) {
      throw new UpsertReturnedNoRow();
    }

    const { count } = row;

    if (count <= policy.limit) {
      return { allowed: true };
    }

    const retryAfter = retryAfterSeconds(start, policy.windowSeconds, now);

    const verdict: RateLimitVerdict = {
      allowed: false,
      subject: subjectKey,
      action: policy.action,
      count,
      limit: policy.limit,
      windowStart: start,
      retryAfterSeconds: retryAfter,
      message: refusalMessage(policy, retryAfter),
    };

    logRefused(verdict);

    return verdict;
  } catch (error) {
    logSkipped({
      subject: subjectKey,
      action: policy.action,
      errorName: error instanceof Error ? error.name : "unknown",
    });

    return { allowed: true };
  }
}
