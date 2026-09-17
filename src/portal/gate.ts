/**
 * The portal's own read or unavailable gate (spec 0014, AC-2).
 *
 * Unlike the agency gate (spec 0008), a contact accessor cannot reach
 * `subscriptions` at all: it carries no client path, so it is absent from
 * `ContactTable` by construction (`src/db/tenant/tables.ts`). The one read
 * here goes through `unsafeTenantQuery`, named so the escape hatch stays
 * conspicuous, and touches only the two columns `accessVerdict` needs.
 *
 * `full` and `grace` read with no difference between them: the portal shows
 * no billing state at all, so there is nothing for a grace banner to say.
 * `locked` and `unsubscribed` both mean nothing is being paid for right now,
 * which is why this spec sends both to the same unavailable page (spec 0008
 * only named `locked`).
 *
 * This read is marked `audited`: it runs on every portal page view, download
 * and PDF request, and the escape hatch log exists to make a hand written
 * query *site* conspicuous, not to record every time an accepted one runs.
 * Logging it per request would drown that signal in its own noise and log an
 * identified user on every page they open. The call site itself stays as
 * grep-able as any other `unsafeTenantQuery` use.
 */
import { eq } from "drizzle-orm";

import {
  accessVerdict,
  type AccessLevel,
  type AccessVerdict,
} from "@/access/level";
import { subscriptions } from "@/db/schema";
import { unsafeTenantQuery, type ContactContext } from "@/db/tenant";
import { logGateInvariant } from "@/db/tenant/log";

/** The path every unavailable redirect lands on, held once so it cannot drift. */
export const PORTAL_UNAVAILABLE_PATH = "/portal/unavailable";

/** `full` and `grace` read; `locked` and `unsubscribed` do not. Exhaustive. */
export function isPortalReadable(level: AccessLevel): boolean {
  switch (level) {
    case "full":
    case "grace":
      return true;
    case "locked":
    case "unsubscribed":
      return false;
    default: {
      const unreachable: never = level;

      return unreachable;
    }
  }
}

/**
 * The acting agency's access level, for a contact.
 *
 * A database failure propagates so no page renders on a level nobody knows,
 * the same rule the agency gate follows.
 */
export async function portalAccess(
  ctx: ContactContext,
): Promise<AccessVerdict> {
  const row = await unsafeTenantQuery(
    ctx,
    "portal gate",
    (db) =>
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.orgId, ctx.orgId),
        columns: { status: true, pastDueSince: true },
      }),
    { audited: true },
  );

  const verdict = accessVerdict(row, new Date());

  if (verdict.invariantBreak !== undefined) {
    logGateInvariant({ orgId: ctx.orgId, reason: verdict.invariantBreak });
  }

  return verdict;
}
