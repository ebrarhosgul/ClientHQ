/**
 * One structured JSON line per sweep and one per run (spec 0017, AC-3), shaped
 * like `src/auth/webhook-log.ts`: the same one call, one line rule and the
 * same `event` / `at` fields, so feature 20 can forward either without either
 * being rewritten.
 *
 * Counts, durations, uuids, provider ids and error messages only. Never an
 * email address, a person's name, an image URL, a payload or a row (AC-10).
 */
import type { SweepCounts, SweepName, SweepOutcome } from "./sweep";

export type CronRunLogLine = {
  readonly event: "cron.run";
  readonly runId: string;
  readonly outcome: "ok" | "failed";
  readonly durationMs: number;
  readonly at: string;
};

export type CronRunLogDetails = {
  readonly runId: string;
  readonly outcome: "ok" | "failed";
  readonly durationMs: number;
};

export function logCronRun(details: CronRunLogDetails): void {
  const line: CronRunLogLine = {
    event: "cron.run",
    ...details,
    at: new Date().toISOString(),
  };

  console.log(JSON.stringify(line));
}

export type CronSweepLogLine = {
  readonly event: "cron.sweep";
  readonly runId: string;
  readonly name: SweepName;
  readonly outcome: SweepOutcome;
  readonly durationMs: number;
  readonly counts?: SweepCounts;
  readonly reason?: string;
  readonly error?: string;
  readonly at: string;
};

export type CronSweepLogDetails = {
  readonly runId: string;
  readonly name: SweepName;
  readonly outcome: SweepOutcome;
  readonly durationMs: number;
  readonly counts?: SweepCounts;
  readonly reason?: string;
  readonly error?: string;
};

export function logCronSweep(details: CronSweepLogDetails): void {
  const line: CronSweepLogLine = {
    event: "cron.sweep",
    ...details,
    at: new Date().toISOString(),
  };

  console.log(JSON.stringify(line));
}

/**
 * The one line a rejected request leaves (AC-1): no `runId`, since nothing
 * was read or written.
 */
export function logCronUnauthorized(): void {
  console.warn(
    JSON.stringify({
      event: "cron.request",
      outcome: "unauthorized",
      at: new Date().toISOString(),
    }),
  );
}
