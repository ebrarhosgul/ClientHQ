/**
 * The staff context an agency page reads, with the mirror repaired if it is
 * missing.
 *
 * Spec 0003 is deliberate that resolution never writes: it raises
 * `no_mirror_row` and leaves creating the rows to this feature. This is where
 * that promise is kept (spec 0005, AC-12). Spec 0001 called it a safety net, and
 * it is: a Clerk webhook missed during a deploy, or a person who signed up
 * before feature 17 existed, would otherwise be stranded on an error page with
 * nothing they could do about it.
 *
 * **Every agency page and Server Action reads its context through
 * `agencyContext()`, not `staffContext()`.** The repair has to live inside the
 * cached call rather than beside it: React's `cache()` memoises the promise a
 * function returned, rejection included, so a layout that caught
 * `no_mirror_row` and repaired around it would leave every page in the same
 * request holding the original failure. Wrapping it means the successful
 * outcome is what gets cached, and the normal path still costs exactly one
 * resolution query and no writes.
 */
import { redirect } from "next/navigation";
import { cache } from "react";

import {
  agencyProfile,
  contactContext,
  ensureMirrorRows,
  isTenantResolutionError,
  staffContext,
  toMembershipRole,
  type AgencyProfile,
  type StaffContext,
} from "@/db/tenant";
import { resolveStaffContext } from "@/db/tenant/context";
import { sessionClaims } from "@/db/tenant/session";

import { clerkOrganization, clerkUser } from "./clerk";

/** Was this the one failure a repair can fix? */
function isMissingMirror(error: unknown): boolean {
  return isTenantResolutionError(error) && error.kind === "no_mirror_row";
}

/**
 * Put the three rows back from Clerk, which is authoritative for all of them.
 *
 * Two Clerk calls, not three: the membership role comes from the session's own
 * organization claim through `toMembershipRole()`, which spec 0003 already
 * provides. A 404 on either record means the organization was deleted or this
 * person was removed from it, so there is nothing to repair and `/onboarding`
 * is where they belong. Any other Clerk failure propagates (AC-21).
 */
async function repairMirror(): Promise<void> {
  const claims = await sessionClaims();

  if (claims.clerkUserId === undefined || claims.clerkOrgId === undefined) {
    // Unreachable through the proxy, which requires both on an agency path.
    redirect("/onboarding");
  }

  const [organization, user] = await Promise.all([
    clerkOrganization(claims.clerkOrgId),
    clerkUser(claims.clerkUserId),
  ]);

  if (!organization.ok || !user.ok) {
    redirect("/onboarding");
  }

  await ensureMirrorRows(
    organization.data,
    user.data,
    toMembershipRole(claims.clerkOrgRole),
  );
}

/**
 * Who is asking, for an agency page, resolved once per request.
 *
 * On the normal path this is `staffContext()` and nothing more. On the one
 * failure a repair can fix, it repairs and resolves again, with no redirect the
 * person can see. A second `no_mirror_row` after a successful repair means the
 * organization is soft deleted locally (AC-14), so the row is not coming back
 * on its own and `/onboarding` is the honest destination.
 */
export const agencyContext = cache(async (): Promise<StaffContext> => {
  try {
    return await staffContext();
  } catch (error) {
    if (!isMissingMirror(error)) {
      throw error;
    }

    await repairMirror();

    try {
      // The uncached resolver on purpose: `staffContext()` has already cached
      // its rejection for this request and would hand back the same failure.
      return await resolveStaffContext();
    } catch (retryError) {
      if (isMissingMirror(retryError)) {
        redirect("/onboarding");
      }

      throw retryError;
    }
  }
});

/**
 * The acting agency's own row, read from this database rather than from a Clerk
 * hook (AC-15).
 *
 * Which agency is meant comes from `ctx.orgId`, which came from the Clerk
 * session; the name shown comes from the local `organizations` row. That split
 * is the point of the whole feature: it is what proves the session resolved a
 * real server side tenant context through spec 0003's layer.
 */
export async function currentAgency(): Promise<AgencyProfile | undefined> {
  const ctx = await agencyContext();
  return agencyProfile(ctx);
}

/**
 * Is this signed in person an accepted client contact?
 *
 * Asked only by `/onboarding`, and only after Clerk has said they belong to no
 * agency, because a membership always wins over a contact row (AC-6). Both
 * `no_contact` (they have a mirror row but no accepted contact) and
 * `no_mirror_row` (they have neither) mean the same thing here: not a contact,
 * so show them the create an agency form.
 */
export async function isClientContact(): Promise<boolean> {
  try {
    await contactContext();
    return true;
  } catch (error) {
    if (isTenantResolutionError(error)) {
      return false;
    }

    throw error;
  }
}
