"use server";

/**
 * Give up on an upload that failed or was cancelled (spec 0011, AC-7, AC-8).
 *
 * The browser calls this best effort: nothing depends on it arriving,
 * because feature 18's daily sweep removes stale `pending` rows on its own
 * schedule. A missing row is a normal outcome here, not a refusal, since the
 * sweep or a second call may have already cleaned it up.
 */
import { deliverables } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { requireConfiguredStorage } from "./require-storage";
import { DELIVERABLE_REVALIDATE } from "./revalidate";
import { abandonUploadInput } from "./schema";

export type AbandonedUpload = {
  readonly removed: boolean;
};

export const abandonUpload = withTenantAction({
  name: "abandonUpload",
  input: abandonUploadInput,
  revalidate: DELIVERABLE_REVALIDATE,
  handler: async ({ input, ctx, db }): Promise<AbandonedUpload> => {
    const storage = requireConfiguredStorage();

    const row = await db.findById(deliverables, input.deliverableId);

    if (row === undefined) {
      return { removed: false };
    }

    if (row.status !== "pending" || row.uploadedByUserId !== ctx.userId) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    // Object first, then row: a failure here leaves a visible pending row
    // rather than an object nobody can find any more.
    await storage.delete(row.r2Key);
    await db.delete(deliverables, row.id);

    return { removed: true };
  },
});
