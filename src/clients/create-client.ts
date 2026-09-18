"use server";

/**
 * Creating a client (spec 0006, AC-1 through AC-3).
 *
 * The one write with nothing to look up first: every field lands straight on a
 * new row, `org_id` stamped by `tenantDb` from the caller's own context, never
 * from the form (AC-10).
 */
import { clients } from "@/db/schema";
import { withTenantAction } from "@/db/tenant";

import { createClientInput } from "./schema";

export type CreatedClient = {
  readonly id: string;
};

export const createClient = withTenantAction({
  name: "createClient",
  input: createClientInput,
  revalidate: { paths: ["/clients"] },
  handler: async ({ input, db }): Promise<CreatedClient> => {
    const row = await db.insert(clients, {
      name: input.name,
      companyEmail: input.companyEmail,
      phone: input.phone,
      industry: input.industry,
      notes: input.notes,
      billingAddressLine1: input.billingAddressLine1,
      billingAddressLine2: input.billingAddressLine2,
      billingCity: input.billingCity,
      billingRegion: input.billingRegion,
      billingPostalCode: input.billingPostalCode,
      billingCountry: input.billingCountry,
    });

    return { id: row.id };
  },
  track: {
    event: "client.created",
    properties: (_input, created) => ({ client_id: created.id }),
  },
});
