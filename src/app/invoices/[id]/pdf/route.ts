import { handleInvoicePdfRequest } from "@/invoices/pdf/handle-request";

/**
 * The staff download (spec 0013, AC-1). Outside the `(agency)/(gated)` group
 * on purpose, like the deliverable download route: a route handler renders no
 * layout, so the subscription gate has to be applied by hand inside the
 * shared handler instead of inherited from one. The proxy's `/invoices(.*)`
 * rule still requires an organization claim here, which is what keeps a
 * client contact off this URL (they reach `/portal/invoices/[id]/pdf`
 * instead).
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/invoices/[id]/pdf">,
) {
  const { id } = await params;

  return handleInvoicePdfRequest(id);
}
