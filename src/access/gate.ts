/**
 * The read side of the access gate: what this agency may do, once per request
 * (spec 0008, AC-8, AC-9).
 *
 * Wrapped in React's `cache()` so the gated layout and any page under it share
 * one read; there is no cache across requests, which is what keeps the level
 * honest about the clock. The row is read through the tenant scoping layer
 * with the organization taken from the resolved context, and the role comes
 * from the same context, so nothing here trusts a URL or a form.
 *
 * It reads and only reads, and it never calls Stripe. A database failure
 * propagates so no page renders on a level nobody knows (AC-12).
 */
import { cache } from "react";

import { agencyContext } from "@/auth/context";
import { subscriptions } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";
import { logGateInvariant } from "@/db/tenant/log";

import {
  accessVerdict,
  type AccessLevel,
  type SubscriptionAccessRow,
} from "./level";

export type AgencyAccess = {
  readonly level: AccessLevel;
  /** Present only on `grace`: when the window closes. */
  readonly graceEndsAt?: Date;
  /** From the Clerk session claim, never `memberships.role`. */
  readonly role: StaffContext["role"];
};

function accessFromRow(
  ctx: StaffContext,
  row: SubscriptionAccessRow | undefined,
): AgencyAccess {
  const verdict = accessVerdict(row, new Date());

  if (verdict.invariantBreak !== undefined) {
    logGateInvariant({ orgId: ctx.orgId, reason: verdict.invariantBreak });
  }

  return {
    level: verdict.level,
    ...(verdict.graceEndsAt === undefined
      ? {}
      : { graceEndsAt: verdict.graceEndsAt }),
    role: ctx.role,
  };
}

export const agencyAccess = cache(async (): Promise<AgencyAccess> => {
  const ctx = await agencyContext();
  const row = await tenantDb(ctx).findFirst(subscriptions);

  return accessFromRow(
    ctx,
    row === undefined
      ? undefined
      : { status: row.status, pastDueSince: row.pastDueSince },
  );
});

/**
 * Same verdict as `agencyAccess()`, from a row the caller already has. For a
 * page that also needs the full subscription row for its own purposes (e.g.
 * `/billing`, spec 0007) so it doesn't cause a second `select` for the same
 * row `agencyAccess()` would otherwise fetch on its own.
 */
export function agencyAccessFromRow(
  ctx: StaffContext,
  row: SubscriptionAccessRow | undefined,
): AgencyAccess {
  return accessFromRow(ctx, row);
}
