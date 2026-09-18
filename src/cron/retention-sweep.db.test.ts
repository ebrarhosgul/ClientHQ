/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-9
 *
 * The retention prune against real PostgreSQL: a 91 day old row in each
 * table is removed, an 89 day old `cron_runs` row and a fresh
 * `processed_webhook_events` row are left alone, and the current run's own
 * row (inserted moments ago, before this sweep runs) survives because it is
 * nowhere near the cutoff.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { cronRuns, processedWebhookEvents } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import { retentionPruneSweep } from "./retention-sweep";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const NOW = new Date("2026-06-15T12:00:00Z");
const NINETY_ONE_DAYS_AGO = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000);
const EIGHTY_NINE_DAYS_AGO = new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000);

const createdRuns: string[] = [];
const createdEvents: string[] = [];

function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

async function makeCronRun(startedAt: Date): Promise<string> {
  const id = newId();

  await db.insert(cronRuns).values({ id, startedAt });
  createdRuns.push(id);

  return id;
}

async function makeWebhookEvent(processedAt: Date): Promise<string> {
  const id = newId();

  await db.insert(processedWebhookEvents).values({
    id,
    source: "stripe",
    eventId: `evt_${tag()}`,
    eventType: "customer.subscription.updated",
    processedAt,
  });
  createdEvents.push(id);

  return id;
}

async function cronRunExists(id: string): Promise<boolean> {
  const rows = await db.select().from(cronRuns).where(eq(cronRuns.id, id));
  return rows.length > 0;
}

async function webhookEventExists(id: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(processedWebhookEvents)
    .where(eq(processedWebhookEvents.id, id));
  return rows.length > 0;
}

afterEach(async () => {
  if (createdRuns.length > 0) {
    await db.delete(cronRuns).where(inArray(cronRuns.id, createdRuns));
    createdRuns.length = 0;
  }
  if (createdEvents.length > 0) {
    await db
      .delete(processedWebhookEvents)
      .where(inArray(processedWebhookEvents.id, createdEvents));
    createdEvents.length = 0;
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("retention_prune against real PostgreSQL", () => {
  it("prunes rows past 90 days from both tables and keeps the rest", async () => {
    const staleEvent = await makeWebhookEvent(NINETY_ONE_DAYS_AGO);
    const freshEvent = await makeWebhookEvent(NOW);
    const staleRun = await makeCronRun(NINETY_ONE_DAYS_AGO);
    const recentRun = await makeCronRun(EIGHTY_NINE_DAYS_AGO);
    const currentRun = await makeCronRun(NOW);

    const report = await retentionPruneSweep.run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report.outcome).toBe("ok");
    expect(report.counts).toEqual({
      webhook_events_pruned: 1,
      cron_runs_pruned: 1,
    });

    expect(await webhookEventExists(staleEvent)).toBe(false);
    expect(await webhookEventExists(freshEvent)).toBe(true);
    expect(await cronRunExists(staleRun)).toBe(false);
    expect(await cronRunExists(recentRun)).toBe(true);
    expect(await cronRunExists(currentRun)).toBe(true);
  });

  it("reports zero and changes nothing when no row qualifies", async () => {
    const run = await makeCronRun(EIGHTY_NINE_DAYS_AGO);
    const event = await makeWebhookEvent(NOW);

    const report = await retentionPruneSweep.run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report).toEqual({
      outcome: "ok",
      counts: { webhook_events_pruned: 0, cron_runs_pruned: 0 },
    });
    expect(await cronRunExists(run)).toBe(true);
    expect(await webhookEventExists(event)).toBe(true);
  });
});
