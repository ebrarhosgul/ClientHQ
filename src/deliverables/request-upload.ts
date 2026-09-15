"use server";

/**
 * Start an upload (spec 0011, AC-1, AC-2, AC-4).
 *
 * The row's id has to exist before the PUT can be signed, and the tenant
 * accessor's `insert()` is the only thing allowed to mint it (spec 0003,
 * AC-3): passing an `id` in is a type error. So the object key is built in
 * two steps: insert with a unique placeholder key, then update it to the
 * real `org/{orgId}/project/{projectId}/{id}` once the real id is known. The
 * placeholder is unique (a fresh id of its own), so two inserts racing each
 * other never collide on `r2_key`'s unique constraint.
 */
import { projects, deliverables } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import { newId } from "@/lib/id";

import { requireConfiguredStorage } from "./require-storage";
import { DELIVERABLE_REVALIDATE } from "./revalidate";
import { requestUploadInput } from "./schema";

/** The signed PUT is valid for 15 minutes. */
const PUT_EXPIRES_SECONDS = 900;

export type RequestedUpload = {
  readonly deliverableId: string;
  readonly uploadUrl: string;
  readonly expiresAt: Date;
};

export const requestUpload = withTenantAction({
  name: "requestUpload",
  input: requestUploadInput,
  revalidate: DELIVERABLE_REVALIDATE,
  handler: async ({ input, ctx, db }): Promise<RequestedUpload> => {
    // Checked before any row is read (AC-2's fixed order, AC-18).
    const storage = requireConfiguredStorage();

    const project = await db.findById(projects, input.projectId);

    if (project === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (project.archivedAt !== null) {
      throw tenantActionError({
        code: "conflict",
        message: "This project is archived, so no files can be added.",
      });
    }

    const inserted = await db.insert(deliverables, {
      projectId: input.projectId,
      name: input.name,
      r2Key: `pending/${newId()}`,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedByUserId: ctx.userId,
      visibleToClient: false,
      status: "pending",
    });

    const r2Key = `org/${ctx.orgId}/project/${input.projectId}/${inserted.id}`;

    await db.update(deliverables, inserted.id, { r2Key });

    const uploadUrl = await storage.presignPut({
      key: r2Key,
      contentType: input.contentType,
      contentLength: input.sizeBytes,
      expiresInSeconds: PUT_EXPIRES_SECONDS,
    });

    return {
      deliverableId: inserted.id,
      uploadUrl,
      expiresAt: new Date(Date.now() + PUT_EXPIRES_SECONDS * 1000),
    };
  },
});
