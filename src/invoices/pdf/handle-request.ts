/**
 * The one handler both PDF routes call (spec 0013, AC-1, AC-2, AC-6, AC-7).
 *
 * Same order as `src/app/deliverables/[id]/download/route.ts`: the id and
 * Clerk configuration first (no session can ever resolve without a
 * publishable key, spec 0004 AC-22), then the tenant context, the access gate
 * (the subscription gate for staff; `portalAccess` for a contact, spec 0014
 * AC-13, answering `302` to `/portal/unavailable` when locked or
 * unsubscribed), the row and the agency's own name, the render, and only then
 * the response headers. The rules follow the resolved context kind, never the
 * URL that reached this handler.
 */
import { redirect } from "next/navigation";

import { agencyAccess } from "@/access/gate";
import {
  agencyProfile,
  isTenantResolutionError,
  tenantContext,
} from "@/db/tenant";
import {
  downloadErrorResponse,
  notFoundResponse,
} from "@/deliverables/download-error-page";
import { presentInvoice } from "@/invoices/presentation";
import { getInvoiceDocument } from "@/invoices/queries";
import { invoiceId as invoiceIdSchema } from "@/invoices/schema";
import { todayUtc } from "@/lib/dates";
import { isClerkConfigured } from "@/lib/env";
import {
  isPortalReadable,
  portalAccess,
  PORTAL_UNAVAILABLE_PATH,
} from "@/portal/gate";

import { renderInvoicePdf } from "./render";

export async function handleInvoicePdfRequest(
  rawId: string,
): Promise<Response> {
  const parsedId = invoiceIdSchema.safeParse(rawId);

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
  } else {
    const access = await portalAccess(ctx);

    if (!isPortalReadable(access.level)) {
      redirect(PORTAL_UNAVAILABLE_PATH);
    }
  }

  const [document, agency] = await Promise.all([
    getInvoiceDocument(ctx, parsedId.data),
    agencyProfile(ctx),
  ]);

  if (document === undefined || agency === undefined) {
    return notFoundResponse();
  }

  const presentation = presentInvoice({
    invoice: document,
    client: document.client,
    lines: document.lines,
    agencyName: agency.name,
    todayUtc: todayUtc(),
    generatedAt: new Date(),
  });

  let pdf: Uint8Array;

  try {
    pdf = await renderInvoicePdf(presentation);
  } catch (thrown) {
    console.error(
      JSON.stringify({
        event: "invoices.pdf.render_failed",
        invoiceId: parsedId.data,
        message: thrown instanceof Error ? thrown.message : String(thrown),
        at: new Date().toISOString(),
      }),
    );

    return downloadErrorResponse({
      status: 500,
      heading: "The PDF could not be generated",
      body: "Something went wrong while drawing this invoice. Try again in a moment, or open the invoice instead.",
      link:
        ctx.kind === "staff"
          ? {
              href: `/invoices/${parsedId.data}`,
              label: "Back to the invoice",
            }
          : {
              href: `/portal/invoices/${parsedId.data}`,
              label: "Back to the portal",
            },
    });
  }

  // `renderToBuffer` returns a `Buffer` backed by `ArrayBufferLike`, and the
  // DOM `BodyInit` type wants a view backed by a concrete `ArrayBuffer`; a
  // fresh `Uint8Array` copy satisfies that without an unchecked cast.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${presentation.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
