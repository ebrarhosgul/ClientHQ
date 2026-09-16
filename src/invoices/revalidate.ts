/**
 * Every invoice write revalidates the three surfaces that show one, so the
 * list, the detail page and the client page's Invoices section never show a
 * stale status or total (spec 0012). Shared by every Server Action in this
 * feature rather than repeated at each call site, as projects do.
 */
import type { RevalidateConfig } from "@/db/tenant";

export const INVOICE_REVALIDATE: RevalidateConfig = {
  paths: [
    "/invoices",
    { path: "/invoices/[id]", type: "page" },
    { path: "/clients/[id]", type: "page" },
  ],
};
