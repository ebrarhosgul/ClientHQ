import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { agencyAccess } from "@/access/gate";
import { deliverables } from "@/db/schema";
import { isTenantResolutionError, tenantContext, tenantDb } from "@/db/tenant";
import { deliverableId } from "@/deliverables/schema";
import {
  downloadErrorResponse,
  notFoundResponse,
} from "@/deliverables/download-error-page";
import { isClerkConfigured } from "@/lib/env";
import { objectStorage } from "@/storage";

/** The signed GET is valid for 2 minutes. */
const GET_EXPIRES_SECONDS = 120;

/**
 * Downloads, for staff and for client contacts alike (spec 0011, AC-12,
 * AC-13, AC-14, AC-18).
 *
 * Outside every route group on purpose (the proxy requires a session but not
 * an organization), which is what lets a client contact reach it at all.
 * Order: storage configured, context, the subscription gate (staff only,
 * exactly as the gated layout applies it, since a route handler sits outside
 * that layout and would otherwise bypass spec 0008), the row, its status and
 * visibility rules, `head`, then the redirect.
 *
 * A route handler has no layout or error boundary above it, unlike a Server
 * Action's `withTenantAction`, so a signed in person with no active Clerk
 * organization and no accepted `client_contacts` row (`tenantContext()`
 * throwing `no_active_org`, `no_mirror_row` or `no_contact`) is caught here
 * and answered with the same 404 as a nonexistent id, rather than a 500
 * (AC-12, AC-13).
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/deliverables/[id]/download">,
) {
  const storage = objectStorage();

  if (storage === undefined) {
    return downloadErrorResponse({
      status: 503,
      heading: "File storage is not configured",
      body: "Downloads are unavailable in this environment.",
    });
  }

  const { id } = await params;
  const parsedId = deliverableId.safeParse(id);

  // With no Clerk publishable key there is no session to resolve, so no id
  // can ever be this agency's or this contact's own, exactly as every page
  // treats it (spec 0004, AC-22).
  if (!parsedId.success || !isClerkConfigured()) {
    return notFoundResponse();
  }

  let ctx;

  try {
    ctx = await tenantContext();
  } catch (thrown) {
    if (isTenantResolutionError(thrown)) {
      return notFoundResponse();
    }

    throw thrown;
  }

  if (ctx.kind === "staff") {
    const access = await agencyAccess();

    if (access.level === "unsubscribed" || access.level === "locked") {
      redirect("/billing");
    }

    const row = await tenantDb(ctx).findById(deliverables, parsedId.data);

    if (row === undefined || row.status !== "ready") {
      return notFoundResponse();
    }

    return respondWithSignedDownload(storage, row);
  }

  const row = await tenantDb(ctx).findFirst(deliverables, {
    where: eq(deliverables.id, parsedId.data),
    with: { project: { columns: { archivedAt: true } } },
  });

  if (
    row === undefined ||
    row.status !== "ready" ||
    !row.visibleToClient ||
    row.project.archivedAt !== null
  ) {
    return notFoundResponse();
  }

  return respondWithSignedDownload(storage, row);
}

async function respondWithSignedDownload(
  storage: NonNullable<ReturnType<typeof objectStorage>>,
  row: { readonly id: string; readonly r2Key: string; readonly name: string },
): Promise<Response> {
  const head = await storage.head(row.r2Key);

  if (head === undefined) {
    console.error(
      JSON.stringify({
        event: "deliverables.download.missing_object",
        deliverableId: row.id,
        at: new Date().toISOString(),
      }),
    );

    return downloadErrorResponse({
      status: 404,
      heading: "This file is missing",
      body: `"${row.name}" could not be found in storage. It may need to be uploaded again.`,
    });
  }

  const url = await storage.presignGet({
    key: row.r2Key,
    filename: row.name,
    expiresInSeconds: GET_EXPIRES_SECONDS,
  });

  return Response.redirect(url, 302);
}
