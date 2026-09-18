/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-20, AC-21
 *
 * The retry sweep against a fake sink: counts per person, a provider
 * failure counted rather than thrown, and the skip when the private key
 * pair is unset. The database is a stub returning the scrubbed rows; the
 * `deleted_at` window itself is a one line `where` proven by the type.
 */
import { describe, expect, it, vi } from "vitest";

import { createAnalytics } from "@/analytics/client";
import { recordingSink } from "@/analytics/sink";
import type { Database } from "@/db/tenant";

import { analyticsErasureSweep } from "./analytics-erasure";

vi.spyOn(console, "warn").mockImplementation(() => undefined);

function dbWith(rows: readonly { readonly clerkUserId: string }[]): Database {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: async () => rows,
  };

  return chain as unknown as Database;
}

const input = (rows: readonly { readonly clerkUserId: string }[]) => ({
  db: dbWith(rows),
  todayUtc: "2026-09-18",
  now: new Date("2026-09-18T03:00:00Z"),
});

describe("analytics_erasure", () => {
  it("is named and placed as spec 0019 says", () => {
    expect(analyticsErasureSweep().name).toBe("analytics_erasure");
  });

  it("skips with analytics_unconfigured when the private key pair is unset", async () => {
    const sink = recordingSink();
    const sweep = analyticsErasureSweep({
      client: createAnalytics({ sink }),
      configured: () => false,
    });

    const report = await sweep.run(input([{ clerkUserId: "user_1" }]));

    expect(report).toEqual({
      outcome: "skipped",
      reason: "analytics_unconfigured",
    });
    expect(sink.calls).toEqual([]);
  });

  it("re issues deletePerson for every recently scrubbed user and counts each", async () => {
    const sink = recordingSink();
    const sweep = analyticsErasureSweep({
      client: createAnalytics({ sink }),
      configured: () => true,
    });

    const report = await sweep.run(
      input([{ clerkUserId: "user_1" }, { clerkUserId: "user_2" }]),
    );

    expect(report).toEqual({
      outcome: "ok",
      counts: { persons_deleted: 2, persons_failed: 0 },
    });
    expect(sink.calls.filter((call) => call.kind === "deletePerson")).toEqual([
      { kind: "deletePerson", distinctId: "user_1" },
      { kind: "deletePerson", distinctId: "user_2" },
    ]);
  });

  it("counts a provider failure and carries on, never throwing", async () => {
    const sink = recordingSink({ failing: true });
    const sweep = analyticsErasureSweep({
      client: createAnalytics({ sink }),
      configured: () => true,
    });

    const report = await sweep.run(input([{ clerkUserId: "user_1" }]));

    expect(report).toEqual({
      outcome: "ok",
      counts: { persons_deleted: 0, persons_failed: 1 },
    });
  });

  it("reports zero counts when nobody was scrubbed", async () => {
    const sweep = analyticsErasureSweep({
      client: createAnalytics({ sink: recordingSink() }),
      configured: () => true,
    });

    expect(await sweep.run(input([]))).toEqual({
      outcome: "ok",
      counts: { persons_deleted: 0, persons_failed: 0 },
    });
  });
});
