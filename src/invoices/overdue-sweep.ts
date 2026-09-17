/**
 * `overdue_invoices`, the first of the nightly sweeps (spec 0017, AC-4).
 *
 * A compare and set across every agency: every `sent` invoice whose due date
 * has passed moves to `overdue`, with one `invoice_events` row per invoice,
 * in one transaction. `today` is handed down by the runner rather than read
 * here, so every sweep in a run agrees on the day (`src/lib/dates.ts`).
 */
import { and, eq, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { invoiceEvents, invoices } from "@/db/schema";
import { newId } from "@/lib/id";

import type { Sweep, SweepInput, SweepReport } from "@/cron/sweep";

import { INVOICE_REVALIDATE } from "./revalidate";
import { canTransition } from "./status";

/**
 * The same surfaces every invoice write revalidates, plus the two client
 * portal ones no staff action touches (AC-4).
 */
function revalidateOverdueSurfaces(): void {
  INVOICE_REVALIDATE.paths?.forEach((target) => {
    if (typeof target === "string") {
      revalidatePath(target);
    } else {
      revalidatePath(target.path, target.type);
    }
  });

  revalidatePath("/portal/invoices");
  revalidatePath("/portal/invoices/[id]", "page");
}

async function run({ db, todayUtc }: SweepInput): Promise<SweepReport> {
  // A sanity check against `src/invoices/status.ts` drifting under this sweep,
  // not a runtime possibility today: `TRANSITIONS.sent` always includes
  // `overdue`. Failing closed here, before any write, is cheaper than a
  // status the lifecycle module no longer recognizes reaching the database.
  if (!canTransition("sent", "overdue")) {
    throw new Error(
      "overdue_invoices: sent -> overdue is no longer an allowed transition",
    );
  }

  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(invoices)
      .set({ status: "overdue" })
      .where(and(eq(invoices.status, "sent"), lt(invoices.dueDate, todayUtc)))
      .returning({ id: invoices.id, orgId: invoices.orgId });

    if (rows.length > 0) {
      await tx.insert(invoiceEvents).values(
        rows.map((row) => ({
          id: newId(),
          orgId: row.orgId,
          invoiceId: row.id,
          kind: "overdue" as const,
          fromStatus: "sent" as const,
          toStatus: "overdue" as const,
          actorUserId: null,
        })),
      );
    }

    return rows;
  });

  if (moved.length > 0) {
    revalidateOverdueSurfaces();
  }

  return { outcome: "ok", counts: { moved: moved.length } };
}

export const overdueInvoicesSweep: Sweep = {
  name: "overdue_invoices",
  run,
};
