import type { Database } from "@/db/tenant";

/**
 * The seven sweeps `/api/cron/daily` runs, in the fixed order spec 0017
 * (AC-3) requires, plus `analytics_erasure` where spec 0019 (AC-20) places
 * it: after the Clerk reconcile that scrubs, before the prune. Every run
 * walks this whole list even when an early build only wires a prefix of it
 * (`src/cron/daily.ts`).
 */
export const SWEEP_ORDER = [
  "overdue_invoices",
  "abandoned_uploads",
  "expired_invites",
  "stripe_reconcile",
  "clerk_reconcile",
  "analytics_erasure",
  "retention_prune",
] as const;

export type SweepName = (typeof SWEEP_ORDER)[number];

/** A sweep's own outcome, recorded in the run's report, never in its own row. */
export type SweepOutcome = "ok" | "skipped" | "failed";

/**
 * The counts vocabulary is fixed per sweep in each sweep's own module; a
 * sweep writes every key it owns on every run, zero when nothing happened, so
 * a reader never has to guess whether a missing key means zero.
 */
export type SweepCounts = Record<string, number | boolean>;

export type SweepInput = {
  readonly db: Database;
  /** One value per run, computed once by the runner from `now` (AC-3, AC-4). */
  readonly todayUtc: string;
  readonly now: Date;
};

export type SweepReport = {
  readonly outcome: SweepOutcome;
  /** Absent on a `skipped` report, which carries `reason` instead. */
  readonly counts?: SweepCounts;
  /** Why a `skipped` sweep skipped. */
  readonly reason?: string;
  /**
   * The thrown error's message, or the first per object error message when
   * only counts failed (report vocabulary, spec 0017).
   */
  readonly error?: string;
};

export type Sweep = {
  readonly name: SweepName;
  readonly run: (input: SweepInput) => Promise<SweepReport>;
};
