/**
 * Who is asking, worked out once per request, for the whole portal (spec
 * 0014, AC-1, AC-2).
 *
 * `portalContext()` is what every page under `/portal` except `/portal/accept`
 * calls: it resolves the tenant context, sends a staff session and a
 * contactless session away, then applies the access gate. Wrapped in React
 * `cache()`, so the layout's own call (for the top bar) and each page's call
 * (for its own query) share one resolution, the same trick `agencyContext()`
 * uses for the agency side.
 *
 * Only `no_contact` is caught here. `no_mirror_row` and a database failure are
 * not: the person is signed in but a genuinely unexpected state, and letting
 * them propagate is what lets `src/app/portal/(contact)/error.tsx` show a way
 * forward instead of guessing at one.
 */
import { redirect } from "next/navigation";
import { cache } from "react";

import type { AccessVerdict } from "@/access/level";
import { clients } from "@/db/schema";
import {
  agencyProfile,
  isTenantResolutionError,
  tenantContext,
  tenantDb,
  type ContactContext,
} from "@/db/tenant";

import {
  isPortalReadable,
  portalAccess,
  PORTAL_UNAVAILABLE_PATH,
} from "./gate";

export type PortalContext = {
  readonly ctx: ContactContext;
  readonly access: AccessVerdict;
  readonly clientName: string;
  readonly agencyName: string;
};

/** Resolve the contact context, sending away anyone who is not a readable contact. */
async function resolveContact(): Promise<ContactContext> {
  let ctx;

  try {
    ctx = await tenantContext();
  } catch (thrown) {
    if (isTenantResolutionError(thrown) && thrown.kind === "no_contact") {
      redirect("/onboarding");
    }

    throw thrown;
  }

  if (ctx.kind === "staff") {
    redirect("/dashboard");
  }

  return ctx;
}

/** The names shown once the contact and the gate have both resolved. */
async function resolveNames(
  ctx: ContactContext,
): Promise<{ readonly clientName: string; readonly agencyName: string }> {
  const [client, agency] = await Promise.all([
    tenantDb(ctx).findFirst(clients),
    agencyProfile(ctx),
  ]);

  return { clientName: client?.name ?? "", agencyName: agency?.name ?? "" };
}

/**
 * Every readable page's context: who is asking, what they may read, and the
 * two names the chrome shows. Redirects away every case but a readable
 * contact (AC-1, AC-2).
 */
export const portalContext = cache(async (): Promise<PortalContext> => {
  const ctx = await resolveContact();
  const access = await portalAccess(ctx);

  if (!isPortalReadable(access.level)) {
    redirect(PORTAL_UNAVAILABLE_PATH);
  }

  const { clientName, agencyName } = await resolveNames(ctx);

  return { ctx, access, clientName, agencyName };
});

/**
 * The same resolution, without the gate's own redirect, for
 * `/portal/unavailable` itself: it has to render *for* an unreadable level, and
 * calling `portalContext()` there would send it straight back to itself.
 */
export const portalContextForUnavailable = cache(
  async (): Promise<PortalContext> => {
    const ctx = await resolveContact();
    const [access, names] = await Promise.all([
      portalAccess(ctx),
      resolveNames(ctx),
    ]);

    return { ctx, access, ...names };
  },
);
