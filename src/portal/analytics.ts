/**
 * The three portal events (spec 0019, AC-12), each on the client and never
 * on the person: `distinct_id` is `client:<client_id>`, the properties are
 * the agency, the client and the thing looked at, and PostHog is told not
 * to build a profile. Nothing here can throw or slow a render: the client
 * never throws, and a page view is queued for after the response.
 */
import { afterResponse, analytics, type EventProperties } from "@/analytics";
import type { ContactContext } from "@/db/tenant";

export type PortalPath = EventProperties<"portal.viewed">["path"];

function forClient(ctx: ContactContext) {
  return {
    distinctId: { kind: "client", clientId: ctx.clientId },
    orgId: ctx.orgId,
  } as const;
}

/** A portal page rendered for this contact's client. Called per render. */
export function trackPortalView(ctx: ContactContext, path: PortalPath): void {
  afterResponse(() => {
    analytics().track("portal.viewed", {
      ...forClient(ctx),
      properties: { client_id: ctx.clientId, path },
    });
  });
}

/** An invoice opened in the portal, beside the page view. */
export function trackPortalInvoiceView(
  ctx: ContactContext,
  invoiceId: string,
): void {
  afterResponse(() => {
    analytics().track("portal.invoice_viewed", {
      ...forClient(ctx),
      properties: { client_id: ctx.clientId, invoice_id: invoiceId },
    });
  });
}

/** A deliverable downloaded through the portal branch of the download route. */
export function trackPortalFileDownload(
  ctx: ContactContext,
  deliverableId: string,
): void {
  analytics().track("portal.file_downloaded", {
    ...forClient(ctx),
    properties: { client_id: ctx.clientId, deliverable_id: deliverableId },
  });
}
