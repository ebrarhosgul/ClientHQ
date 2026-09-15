"use server";

/**
 * Remove a deliverable for good (spec 0011, AC-15).
 *
 * Object first, row second: a storage failure leaves the row in place
 * (nothing to point at nothing), and a missing row is treated as already
 * done rather than an error, matching `abandonUpload`'s idempotency.
 */
import { deliverables } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { requireConfiguredStorage } from "./require-storage";
import { DELIVERABLE_REVALIDATE } from "./revalidate";
import { deleteDeliverableInput } from "./schema";

export type DeletedDeliverable = {
  readonly removed: boolean;
};

export const deleteDeliverable = withTenantAction({
  name: "deleteDeliverable",
  input: deleteDeliverableInput,
  revalidate: DELIVERABLE_REVALIDATE,
  handler: async ({ input, db }): Promise<DeletedDeliverable> => {
    const storage = requireConfiguredStorage();

    const row = await db.findById(deliverables, input.deliverableId);

    if (row === undefined) {
      return { removed: false };
    }

    if (row.status !== "ready") {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    try {
      await storage.delete(row.r2Key);
    } catch {
      throw tenantActionError({
        code: "conflict",
        message:
          "The file could not be removed from storage. Nothing was deleted; try again.",
      });
    }

    await db.delete(deliverables, row.id);

    return { removed: true };
  },
});
