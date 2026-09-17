/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-2, AC-3
 *
 * The runner against real PostgreSQL. The insert and update of the
 * `cron_runs` row are real writes; this is what proves the row's `report`
 * ends up holding exactly what the route answers with. Fake sweeps stand in
 * for whichever are actually wired in `src/cron/daily.ts` at this point in
 * the build, on the shape of `src/auth/webhook.db.test.ts`.
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { cronRuns } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { loadEnvFiles } from "@/lib/load-env-files";

import { runDailySweeps } from "./runner";
import type { Sweep } from "./sweep";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const createdRuns: string[] = [];

function sweep(name: Sweep["name"], run: Sweep["run"]): Sweep {
  return { name, run };
}

afterEach(async () => {
  if (createdRuns.length > 0) {
    await db.delete(cronRuns).where(inArray(cronRuns.id, createdRuns));
    createdRuns.length = 0;
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("the cron runner against real PostgreSQL", () => {
  it("inserts the run row, then updates it with ok and the full report (AC-2)", async () => {
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async () => ({
        outcome: "ok",
        counts: { moved: 3 },
      })),
      sweep("abandoned_uploads", async () => ({
        outcome: "skipped",
        reason: "storage not configured",
      })),
    ];

    const result = await runDailySweeps({ db, sweeps, now: new Date() });
    createdRuns.push(result.runId);

    expect(result.outcome).toBe("ok");

    const [row] = await db
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.id, result.runId));

    expect(row).toBeDefined();
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.outcome).toBe("ok");
    expect(row.report).toEqual(result.sweeps);
  });

  it("orders the sweeps exactly as given, and isolates a throw so the rest still run (AC-3)", async () => {
    const order: string[] = [];
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async () => {
        order.push("overdue_invoices");
        throw new Error("connection reset");
      }),
      sweep("abandoned_uploads", async () => {
        order.push("abandoned_uploads");
        return { outcome: "ok", counts: { removed: 0 } };
      }),
      sweep("expired_invites", async () => {
        order.push("expired_invites");
        return { outcome: "ok", counts: { cleared: 0 } };
      }),
    ];

    const result = await runDailySweeps({ db, sweeps, now: new Date() });
    createdRuns.push(result.runId);

    expect(order).toEqual([
      "overdue_invoices",
      "abandoned_uploads",
      "expired_invites",
    ]);
    expect(result.outcome).toBe("failed");
    expect(result.sweeps[0]).toMatchObject({
      outcome: "failed",
      error: "connection reset",
    });
    expect(result.sweeps[1]).toMatchObject({ outcome: "ok" });
    expect(result.sweeps[2]).toMatchObject({ outcome: "ok" });

    const [row] = await db
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.id, result.runId));

    expect(row.outcome).toBe("failed");
  });
});
