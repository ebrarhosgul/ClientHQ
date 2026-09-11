/**
 * The write side of the access gate (spec 0008, AC-6, AC-8, AC-9, AC-11).
 *
 * `withTenantAction()` calls this after the role guard and before it parses
 * anything, on the pooled executor and outside any transaction: the wrapper
 * opens its transaction later, around the handler only. So a refused write
 * costs one primary key sized read and nothing else, and a locked agency never
 * learns whether its input was valid.
 *
 * It reads and only reads. The `subscriptions` row is written by the Stripe
 * webhook route alone, and nothing here calls Stripe, so a Stripe outage
 * changes nothing about who may write. A database failure propagates rather
 * than turning into a Result: the gate never fails open (AC-12).
 */
import { subscriptions } from "../schema";
import { accessVerdict } from "@/access/level";

import { tenantDb } from "./accessor";
import type { StaffContext } from "./context";
import { tenantActionError } from "./errors";
import { logGateInvariant, logRefusal } from "./log";

/** The one sentence a person sees. Never a Stripe status name. */
export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Your agency's subscription needs attention before changes can be saved. Open Billing to sort it out.";

/**
 * Let the write through, or throw the refusal the wrapper hands back.
 *
 * `operation` is the action's name, for the refusal log. The row is read
 * through the scoped accessor, so the organization is the one on the context
 * and nowhere else (AC-9). The webhook can change the row between this read
 * and the handler either way, so no lock is taken.
 */
export async function requireFullAccess(
  ctx: StaffContext,
  operation: string,
): Promise<void> {
  const row = await tenantDb(ctx).findFirst(subscriptions);

  const verdict = accessVerdict(
    row === undefined
      ? undefined
      : { status: row.status, pastDueSince: row.pastDueSince },
    new Date(),
  );

  if (verdict.invariantBreak !== undefined) {
    logGateInvariant({ orgId: ctx.orgId, reason: verdict.invariantBreak });
  }

  if (verdict.level === "full") {
    return;
  }

  logRefusal({
    operation,
    reason: `subscription_inactive:${verdict.level}`,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });

  throw tenantActionError({
    code: "subscription_inactive",
    message: SUBSCRIPTION_INACTIVE_MESSAGE,
  });
}
