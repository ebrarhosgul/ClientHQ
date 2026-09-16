"use server";

/**
 * Creating a draft in one step (spec 0012, AC-1).
 *
 * Every invoice starts as a draft with no number, no lines, the agency's
 * default currency, no tax and a due date thirty days out. The chosen client
 * must be one of this agency's active clients at the moment of creation; any
 * other reason it fails to resolve (archived, another agency's, made up)
 * collapses to `not_found`, so a prober cannot tell them apart. The one
 * refusal a person can act on, an archived client they can see, gets its own
 * `validation` message.
 */
import { clients, invoices } from "@/db/schema";
import {
  agencyProfile,
  tenantActionError,
  withTenantAction,
} from "@/db/tenant";
import { addDaysUtc, todayUtc } from "@/lib/dates";

import { INVOICE_REVALIDATE } from "./revalidate";
import { createInvoiceDraftInput } from "./schema";
import { DEFAULT_TERMS_DAYS } from "./status";

export type CreatedInvoiceDraft = {
  readonly id: string;
};

export const createInvoiceDraft = withTenantAction({
  name: "createInvoiceDraft",
  input: createInvoiceDraftInput,
  revalidate: INVOICE_REVALIDATE,
  handler: async ({ input, ctx, db }): Promise<CreatedInvoiceDraft> => {
    const client = await db.findById(clients, input.clientId);

    if (client === undefined) {
      throw tenantActionError({
        code: "not_found",
        message: "Choose an active client.",
      });
    }

    if (client.archivedAt !== null) {
      throw tenantActionError({
        code: "validation",
        message: "This client is archived. Restore them to invoice them.",
        fieldErrors: { clientId: ["Choose an active client."] },
      });
    }

    const agency = await agencyProfile(ctx);

    if (agency === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const row = await db.insert(invoices, {
      clientId: client.id,
      status: "draft",
      currency: agency.defaultCurrency,
      taxRateBp: 0,
      dueDate: addDaysUtc(todayUtc(), DEFAULT_TERMS_DAYS),
    });

    return { id: row.id };
  },
});
