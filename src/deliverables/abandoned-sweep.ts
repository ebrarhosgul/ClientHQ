/**
 * `abandoned_uploads`, the second nightly sweep (spec 0017, AC-5).
 *
 * An upload that never confirmed leaves a `pending` row with no object a
 * client can ever see; a day after it started nobody is coming back for it.
 * Object first, then row, the same order `abandonUpload` and
 * `deleteDeliverable` use (spec 0011): a storage failure leaves the row in
 * place rather than deleting a row that might still point at a live object.
 *
 * Takes the storage port as an argument, bound once at wiring
 * (`src/cron/daily.ts`), so a test can hand it the fake instead of touching
 * R2 (spec 0017, Code layout).
 */
import { and, asc, eq, lt } from "drizzle-orm";

import { deliverables } from "@/db/schema";
import type { ObjectStorage } from "@/storage";

import type { Sweep, SweepInput, SweepReport } from "@/cron/sweep";

/** At most this many rows removed per run. */
const BATCH_LIMIT = 200;

/**
 * One more than the batch, read but never removed: its presence alone
 * answers whether more than `BATCH_LIMIT` rows qualified (`counts.truncated`),
 * with no second query.
 */
const READ_LIMIT = BATCH_LIMIT + 1;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

async function run(
  storage: ObjectStorage | undefined,
  { db, now }: SweepInput,
): Promise<SweepReport> {
  if (storage === undefined) {
    return { outcome: "skipped", reason: "storage not configured" };
  }

  const cutoff = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);

  const candidates = await db
    .select({ id: deliverables.id, r2Key: deliverables.r2Key })
    .from(deliverables)
    .where(
      and(
        eq(deliverables.status, "pending"),
        lt(deliverables.createdAt, cutoff),
      ),
    )
    .orderBy(asc(deliverables.createdAt))
    .limit(READ_LIMIT);

  const truncated = candidates.length > BATCH_LIMIT;
  const batch = truncated ? candidates.slice(0, BATCH_LIMIT) : candidates;

  let removed = 0;
  let failed = 0;

  for (const row of batch) {
    try {
      await storage.delete(row.r2Key);
    } catch {
      failed += 1;
      continue;
    }

    await db.delete(deliverables).where(eq(deliverables.id, row.id));
    removed += 1;
  }

  return {
    outcome: failed > 0 ? "failed" : "ok",
    counts: { removed, failed, truncated },
  };
}

export function abandonedUploadsSweep(
  storage: ObjectStorage | undefined,
): Sweep {
  return {
    name: "abandoned_uploads",
    run: (input) => run(storage, input),
  };
}
