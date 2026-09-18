import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { id } from "./helpers";

/**
 * One row per run of `/api/cron/daily` (spec 0017). Not tenant scoped, on the
 * shape of `processed_webhook_events`: the sweeps cross every agency by
 * design.
 *
 * The insert at the start of a run is the keep alive: it is what stops the
 * Supabase free tier project from pausing for inactivity, so no separate
 * heartbeat query exists. `finished_at` stays null when the run dies mid
 * flight (a platform timeout), which is what makes that failure visible from
 * SQL: a row with `started_at` set and nothing else.
 */
export const cronRuns = pgTable(
  "cron_runs",
  {
    id: id(),
    /** The database clock at insert, not the application clock. */
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Null until the run ends; stays null forever if the platform kills it. */
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    /** `ok` or `failed`; null while the run is still in progress. */
    outcome: text("outcome", { enum: ["ok", "failed"] }),
    /** The `sweeps` report array, written once at finish. */
    report: jsonb("report"),
  },
  (t) => [
    index("cron_runs_started_at_idx").on(t.startedAt),
    check("cron_runs_outcome_check", sql`${t.outcome} in ('ok', 'failed')`),
  ],
);
