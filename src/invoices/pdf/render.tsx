/**
 * The one door out of `src/invoices/pdf/` (spec 0013, AC-8): the ESLint
 * `clienthq/react-pdf-boundary` entry restricts `@react-pdf/*` imports to
 * this directory, and `renderInvoicePdf` is what everything outside it calls.
 *
 * `.tsx` rather than the `render.ts` spec 0013 names: `renderToBuffer` takes
 * `ReactElement<DocumentProps>`, and `React.createElement`'s own return type
 * (parameterised by `InvoicePdf`'s actual props) shares no property name with
 * `DocumentProps`, which TypeScript treats as a likely mistake and refuses.
 * Plain JSX carries no such generic, so it is not just cleaner here, it is
 * the only form that typechecks.
 */
import { renderToBuffer } from "@react-pdf/renderer";

import type { InvoicePresentation } from "@/invoices/presentation";

import { InvoicePdf } from "./invoice-pdf";

/**
 * Draws the PDF and returns its bytes. Throws on a renderer or font failure;
 * `handleInvoicePdfRequest` is the one caller and the one place that catches
 * it (AC-6).
 */
export async function renderInvoicePdf(
  presentation: InvoicePresentation,
): Promise<Uint8Array> {
  return renderToBuffer(<InvoicePdf presentation={presentation} />);
}
