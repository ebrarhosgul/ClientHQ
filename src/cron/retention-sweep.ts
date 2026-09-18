/**
 * `retention_prune`, the sixth and last nightly sweep (spec 0017, AC-9; spec
 * 0018, AC-10).
 *
 * Lives in `src/cron/` rather than beside either table because it spans three
 * features: the webhook idempotency ledger (spec 0002), this feature's own
 * `cron_runs` table, and feature 19's `rate_limit_windows`. The first two
 * exist to answer a question for a limited while and then just cost storage,
 * so they share one 90 day cutoff; the rate limit windows answer their
 * question in an hour or a day at most, so a week is generous and they get
 * their own, shorter cutoff.
 *
 * The current run's own `cron_runs` row is always fresh (it was inserted
 * moments ago by `runDailySweeps`, before this sweep runs), so the cutoff
 * excludes it on its own; nothing here needs to name the run's id.
 */
import { lt } from "drizzle-orm";

import {
  cronRuns,
  processedWebhookEvents,
  rateLimitWindows,
} from "@/db/schema";

import type { Sweep, SweepInput, SweepReport } from "./sweep";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function run({ db, now }: SweepInput): Promise<SweepReport> {
  const cutoff = new Date(now.getTime() - NINETY_DAYS_MS);
  const rateLimitCutoff = new Date(now.getTime() - SEVEN_DAYS_MS);

  const webhookEventsPruned = await db
    .delete(processedWebhookEvents)
    .where(lt(processedWebhookEvents.processedAt, cutoff))
    .returning({ id: processedWebhookEvents.id });

  const cronRunsPruned = await db
    .delete(cronRuns)
    .where(lt(cronRuns.startedAt, cutoff))
    .returning({ id: cronRuns.id });

  // No `.returning()`: up to 24 hourly upload rows plus two daily rows per
  // agency per day, plus a row per person creating an agency, means a week's
  // worth can run to hundreds of thousands of rows at scale. `count` is the
  // driver's own affected row count, so nothing is pulled back over the wire
  // just to be measured.
  const rateLimitWindowsPruned = await db
    .delete(rateLimitWindows)
    .where(lt(rateLimitWindows.windowStart, rateLimitCutoff));

  return {
    outcome: "ok",
    counts: {
      webhook_events_pruned: webhookEventsPruned.length,
      cron_runs_pruned: cronRunsPruned.length,
      rate_limit_windows_pruned: rateLimitWindowsPruned.count,
    },
  };
}

export const retentionPruneSweep: Sweep = {
  name: "retention_prune",
  run,
};
