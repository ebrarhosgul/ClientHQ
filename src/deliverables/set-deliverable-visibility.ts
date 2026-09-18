"use server";

/**
 * Whether a client contact may see one deliverable (spec 0011, AC-9, AC-11).
 */
import { deliverables } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { requireConfiguredStorage } from "./require-storage";
import { DELIVERABLE_REVALIDATE } from "./revalidate";
import { setDeliverableVisibilityInput } from "./schema";

export type DeliverableVisibility = {
  readonly visibleToClient: boolean;
};

export const setDeliverableVisibility = withTenantAction({
  name: "setDeliverableVisibility",
  input: setDeliverableVisibilityInput,
  revalidate: DELIVERABLE_REVALIDATE,
  handler: async ({ input, db }): Promise<DeliverableVisibility> => {
    requireConfiguredStorage();

    const row = await db.findById(deliverables, input.deliverableId);

    if (row === undefined || row.status !== "ready") {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    // Idempotent: setting the value it already has still writes and
    // succeeds (AC-11), rather than short circuiting on an unchanged value.
    const updated = await db.update(deliverables, row.id, {
      visibleToClient: input.visibleToClient,
    });

    if (updated === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { visibleToClient: updated.visibleToClient };
  },
  // Only a flip to visible is a share (spec 0019, AC-12); hiding is silent.
  track: {
    event: "deliverable.shared",
    when: (_input, result) => result.visibleToClient,
    properties: (input) => ({ deliverable_id: input.deliverableId }),
  },
});
