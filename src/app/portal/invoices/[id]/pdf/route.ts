import { handleInvoicePdfRequest } from "@/invoices/pdf/handle-request";

/**
 * The same PDF, for a signed in client contact (spec 0013, AC-2). One shared
 * handler behind two URLs: the rules follow the resolved context kind, never
 * this path.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/portal/invoices/[id]/pdf">,
) {
  const { id } = await params;

  return handleInvoicePdfRequest(id);
}
