"use server";

/**
 * Confirm that a pending upload really landed (spec 0011, AC-6, AC-7).
 *
 * A `ready` row short circuits before the uploader check: any staff member
 * of this agency re-confirming an already finished upload gets the stored
 * values back with no R2 call, which is what makes the browser's retry after
 * a page reload safe. Only a still-`pending` row is restricted to the person
 * who started it.
 */
import { eq } from "drizzle-orm";

import { deliverables } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { isAllowedContentType, MAX_UPLOAD_BYTES } from "./file-rules";
import { requireConfiguredStorage } from "./require-storage";
import { DELIVERABLE_REVALIDATE } from "./revalidate";
import { confirmUploadInput } from "./schema";

export type ConfirmedUpload = {
  readonly status: "ready";
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly projectId: string;
  /** True when this call flipped the row; false for a repeat confirm. */
  readonly confirmed: boolean;
};

function isWithinRules(head: {
  readonly contentType: string;
  readonly contentLength: number;
}): boolean {
  return (
    isAllowedContentType(head.contentType) &&
    head.contentLength >= 1 &&
    head.contentLength <= MAX_UPLOAD_BYTES
  );
}

export const confirmUpload = withTenantAction({
  name: "confirmUpload",
  input: confirmUploadInput,
  revalidate: DELIVERABLE_REVALIDATE,
  handler: async ({ input, ctx, db }): Promise<ConfirmedUpload> => {
    const storage = requireConfiguredStorage();

    const row = await db.findById(deliverables, input.deliverableId);

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (row.status === "ready") {
      return {
        status: "ready",
        sizeBytes: row.sizeBytes,
        contentType: row.contentType,
        projectId: row.projectId,
        confirmed: false,
      };
    }

    if (row.uploadedByUserId !== ctx.userId) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const head = await storage.head(row.r2Key);

    if (head === undefined) {
      throw tenantActionError({
        code: "conflict",
        message: "The upload has not finished yet. Try again in a moment.",
      });
    }

    if (!isWithinRules(head)) {
      // Idempotent: tolerates a concurrent `abandonUpload` having already
      // removed either the object or the row.
      try {
        await storage.delete(row.r2Key);
      } catch {
        // A transient storage failure here must not rethrow: `withTenantAction`
        // rethrows anything it does not recognise as a tenant action error,
        // and the client calls this action fire-and-forget, so an escaped
        // rejection would strand the uploader in "Finishing up…" with no way
        // out. `conflict` is retried automatically by the browser's confirm
        // ladder, same as "the upload has not finished yet".
        throw tenantActionError({
          code: "conflict",
          message:
            "The upload could not be verified right now. Try again in a moment.",
        });
      }

      await db.delete(deliverables, row.id);

      throw tenantActionError({
        code: "validation",
        message:
          "This file was removed because it did not match what was declared.",
      });
    }

    const updated = await db.update(
      deliverables,
      row.id,
      {
        status: "ready",
        contentType: head.contentType,
        sizeBytes: head.contentLength,
      },
      { where: eq(deliverables.status, "pending") },
    );

    if (updated === undefined) {
      // Raced with an abandon, a delete, or another confirm: gone or already
      // flipped by the time this compare and set ran.
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return {
      status: "ready",
      sizeBytes: updated.sizeBytes,
      contentType: updated.contentType,
      projectId: updated.projectId,
      confirmed: true,
    };
  },
  // Once per real upload (spec 0019, AC-12): a repeat confirm is silent.
  track: {
    event: "deliverable.uploaded",
    when: (_input, result) => result.confirmed,
    properties: (input, result) => ({
      deliverable_id: input.deliverableId,
      project_id: result.projectId,
    }),
  },
});
