/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-2, AC-3
 *
 * The runner against a faked `db` and fake sweeps: the run row's insert and
 * update, per sweep isolation (a throw never stops the next sweep), and the
 * run outcome derived from the sweeps. Real PostgreSQL, the actual row and
 * concurrent runs are proven in `runner.db.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/tenant";

import { runDailySweeps } from "./runner";
import type { Sweep } from "./sweep";

const RUN_ID = "00000000-0000-7000-8000-000000000099";

function fakeDb(): {
  readonly db: Database;
  readonly updates: readonly unknown[];
} {
  const updates: unknown[] = [];

  const insert = vi.fn(() => ({
    values: () => ({
      returning: async () => [{ id: RUN_ID }],
    }),
  }));

  const update = vi.fn(() => ({
    set: (patch: unknown) => ({
      where: async () => {
        updates.push(patch);
      },
    }),
  }));

  return { db: { insert, update } as unknown as Database, updates };
}

function sweep(name: Sweep["name"], run: Sweep["run"]): Sweep {
  return { name, run };
}

describe("runDailySweeps", () => {
  it("inserts the run row, runs every sweep, and reports ok when none failed", async () => {
    const { db, updates } = fakeDb();
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async () => ({
        outcome: "ok",
        counts: { moved: 2 },
      })),
      sweep("abandoned_uploads", async () => ({
        outcome: "skipped",
        reason: "storage not configured",
      })),
    ];

    const result = await runDailySweeps({
      db,
      sweeps,
      now: new Date("2026-01-02T03:00:00Z"),
    });

    expect(result.runId).toBe(RUN_ID);
    expect(result.outcome).toBe("ok");
    expect(result.sweeps.map((s) => s.name)).toEqual([
      "overdue_invoices",
      "abandoned_uploads",
    ]);
    expect(result.sweeps[0]).toMatchObject({
      outcome: "ok",
      counts: { moved: 2 },
    });
    expect(result.sweeps[1]).toMatchObject({
      outcome: "skipped",
      reason: "storage not configured",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ outcome: "ok" });
  });

  it("records a sweep that throws as failed, with its message, and still runs the rest", async () => {
    const { db } = fakeDb();
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async () => {
        throw new Error("boom");
      }),
      sweep("abandoned_uploads", async () => ({
        outcome: "ok",
        counts: { removed: 1 },
      })),
    ];

    const result = await runDailySweeps({ db, sweeps, now: new Date() });

    expect(result.outcome).toBe("failed");
    expect(result.sweeps[0]).toMatchObject({
      outcome: "failed",
      error: "boom",
    });
    expect(result.sweeps[1]).toMatchObject({
      outcome: "ok",
      counts: { removed: 1 },
    });
  });

  it("makes the run outcome failed when any sweep failed, however many are ok", async () => {
    const { db } = fakeDb();
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async () => ({
        outcome: "ok",
        counts: { moved: 0 },
      })),
      sweep("abandoned_uploads", async () => ({
        outcome: "failed",
        counts: { errors: 1 },
        error: "storage delete failed",
      })),
      sweep("expired_invites", async () => ({
        outcome: "ok",
        counts: { cleared: 0 },
      })),
    ];

    const result = await runDailySweeps({ db, sweeps, now: new Date() });

    expect(result.outcome).toBe("failed");
    expect(result.sweeps.map((s) => s.outcome)).toEqual(["ok", "failed", "ok"]);
  });

  it("hands every sweep the same todayUtc, derived from now", async () => {
    const { db } = fakeDb();
    const seen: string[] = [];
    const sweeps: readonly Sweep[] = [
      sweep("overdue_invoices", async ({ todayUtc }) => {
        seen.push(todayUtc);
        return { outcome: "ok", counts: {} };
      }),
      sweep("abandoned_uploads", async ({ todayUtc }) => {
        seen.push(todayUtc);
        return { outcome: "ok", counts: {} };
      }),
    ];

    await runDailySweeps({
      db,
      sweeps,
      now: new Date("2026-03-05T12:34:56Z"),
    });

    expect(seen).toEqual(["2026-03-05", "2026-03-05"]);
  });

  it("reports ok with no sweeps wired at all", async () => {
    const { db } = fakeDb();

    const result = await runDailySweeps({ db, sweeps: [], now: new Date() });

    expect(result.outcome).toBe("ok");
    expect(result.sweeps).toEqual([]);
  });
});
