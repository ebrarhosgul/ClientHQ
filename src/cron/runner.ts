/**
 * Runs the sweeps `src/cron/daily.ts` wires, in the order it hands them.
 *
 * A run is: insert the row (the keep alive, AC-2), call each sweep in its own
 * `try`/`catch` with a timer, build the report, update the row, return it.
 * Pure apart from those two row writes. A sweep never stops another: nothing
 * here ever rethrows a sweep's error (spec 0017, Key invariants).
 */
import { eq } from "drizzle-orm";

import { cronRuns } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { todayUtc } from "@/lib/dates";
import { newId } from "@/lib/id";
import { reportSignal } from "@/observability";

import { logCronRun, logCronSweep } from "./log";
import type { Sweep, SweepName, SweepOutcome, SweepReport } from "./sweep";

export type RunnerSweepResult = SweepReport & {
  readonly name: SweepName;
  readonly durationMs: number;
};

export type RunDailySweepsResult = {
  readonly runId: string;
  readonly outcome: "ok" | "failed";
  readonly sweeps: readonly RunnerSweepResult[];
};

export type RunDailySweepsInput = {
  readonly db: Database;
  readonly sweeps: readonly Sweep[];
  readonly now: Date;
};

/** What a sweep whose `run` threw counts as. */
function failedReport(thrown: unknown): SweepReport {
  return {
    outcome: "failed",
    counts: { errors: 1 },
    error: thrown instanceof Error ? thrown.message : String(thrown),
  };
}

async function runOneSweep(
  sweep: Sweep,
  input: Parameters<Sweep["run"]>[0],
): Promise<RunnerSweepResult> {
  const startedAt = performance.now();

  const report = await sweep.run(input).catch(failedReport);

  return {
    ...report,
    name: sweep.name,
    durationMs: performance.now() - startedAt,
  };
}

function runOutcome(sweeps: readonly RunnerSweepResult[]): "ok" | "failed" {
  const anyFailed = sweeps.some(
    (sweep): boolean => (sweep.outcome as SweepOutcome) === "failed",
  );

  return anyFailed ? "failed" : "ok";
}

export async function runDailySweeps({
  db,
  sweeps,
  now,
}: RunDailySweepsInput): Promise<RunDailySweepsResult> {
  const [inserted] = await db
    .insert(cronRuns)
    .values({ id: newId() })
    .returning({ id: cronRuns.id });

  const runId = inserted.id;
  const input = { db, todayUtc: todayUtc(now), now };
  const runStartedAt = performance.now();

  const results: RunnerSweepResult[] = [];

  for (const sweep of sweeps) {
    const result = await runOneSweep(sweep, input);

    logCronSweep({
      runId,
      name: result.name,
      outcome: result.outcome,
      durationMs: result.durationMs,
      counts: result.counts,
      reason: result.reason,
      error: result.error,
    });

    // A failed sweep is promoted beside its log line (spec 0019, AC-6), one
    // issue per sweep name. No `org_id`: a sweep spans every agency.
    if (result.outcome === "failed") {
      reportSignal(`cron.sweep_failed: ${result.name}`, {
        level: "error",
        tags: { sweep: result.name },
        extra: { runId, error: result.error, durationMs: result.durationMs },
        fingerprint: ["cron.sweep_failed", result.name],
      });
    }

    results.push(result);
  }

  const outcome = runOutcome(results);
  const durationMs = performance.now() - runStartedAt;

  await db
    .update(cronRuns)
    .set({
      finishedAt: new Date(),
      outcome,
      // The exact shape the response body carries (AC-2): name, outcome,
      // counts, durationMs, and reason/error when the sweep has them.
      report: results,
    })
    .where(eq(cronRuns.id, runId));

  logCronRun({ runId, outcome, durationMs });

  return { runId, outcome, sweeps: results };
}
