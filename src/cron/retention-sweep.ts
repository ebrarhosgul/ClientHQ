/**
 * `retention_prune`, the sixth and last nightly sweep (spec 0017, AC-9).
 *
 * Lives in `src/cron/` rather than beside either table because it spans two
 * features: the webhook idempotency ledger (spec 0002) and this feature's own
 * `cron_runs` table. Both exist to answer a question for a limited while and
 * then just cost storage, so both share one 90 day cutoff.
 *
 * The current run's own `cron_runs` row is always fresh (it was inserted
 * moments ago by `runDailySweeps`, before this sweep runs), so the cutoff
 * excludes it on its own; nothing here needs to name the run's id.
 */
import { lt } from "drizzle-orm";

import { cronRuns, processedWebhookEvents } from "@/db/schema";

import type { Sweep, SweepInput, SweepReport } from "./sweep";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

async function run({ db, now }: SweepInput): Promise<SweepReport> {
  const cutoff = new Date(now.getTime() - NINETY_DAYS_MS);

  const webhookEventsPruned = await db
    .delete(processedWebhookEvents)
    .where(lt(processedWebhookEvents.processedAt, cutoff))
    .returning({ id: processedWebhookEvents.id });

  const cronRunsPruned = await db
    .delete(cronRuns)
    .where(lt(cronRuns.startedAt, cutoff))
    .returning({ id: cronRuns.id });

  return {
    outcome: "ok",
    counts: {
      webhook_events_pruned: webhookEventsPruned.length,
      cron_runs_pruned: cronRunsPruned.length,
    },
  };
}

export const retentionPruneSweep: Sweep = {
  name: "retention_prune",
  run,
};
