/**
 * `analytics_erasure`, the sixth nightly sweep (spec 0019, AC-20).
 *
 * The scrub paths queue `deletePerson` for after their response, and that
 * callback can fail in exactly one way worth a second look: the function
 * froze before it ran, or PostHog was down when it did. This is the retry,
 * not a second erasure path: it re issues `deletePerson` for every user
 * scrubbed in the last seven days. Deletion is idempotent at the provider,
 * so a repeat for someone already gone is harmless.
 *
 * No new table. Skipped, with a reason, when the private key pair is unset.
 */
import { gte } from "drizzle-orm";

import { analytics, type Analytics } from "@/analytics";
import { users } from "@/db/schema";
import { isErasureConfigured } from "@/observability";

import type { Sweep, SweepInput, SweepReport } from "./sweep";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type ErasureOptions = {
  readonly client?: Analytics;
  readonly configured?: () => boolean;
};

async function run(
  { db, now }: SweepInput,
  options: ErasureOptions,
): Promise<SweepReport> {
  const configured = options.configured ?? isErasureConfigured;

  if (!configured()) {
    return { outcome: "skipped", reason: "analytics_unconfigured" };
  }

  const client = options.client ?? analytics();
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);

  const scrubbed = await db
    .select({ clerkUserId: users.clerkUserId })
    .from(users)
    .where(gte(users.deletedAt, cutoff));

  let personsDeleted = 0;
  let personsFailed = 0;

  for (const row of scrubbed) {
    // `deletePerson` never throws; it says whether the provider confirmed.
    if (await client.deletePerson(row.clerkUserId)) {
      personsDeleted += 1;
    } else {
      personsFailed += 1;
    }
  }

  return {
    outcome: "ok",
    counts: {
      persons_deleted: personsDeleted,
      persons_failed: personsFailed,
    },
  };
}

export function analyticsErasureSweep(options: ErasureOptions = {}): Sweep {
  return {
    name: "analytics_erasure",
    run: (input) => run(input, options),
  };
}
