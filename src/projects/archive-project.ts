"use server";

/**
 * Archiving and restoring a project (spec 0010, AC-11, AC-12).
 *
 * The first `requireRole: "admin"` actions in the codebase: `withTenantAction`
 * refuses a member with `forbidden` before either handler runs. Both are
 * idempotent, exactly like `src/clients/archive-client.ts`: archiving an
 * already archived project, or restoring an already active one, succeeds
 * with no error and no write. Archiving never touches `status`.
 */
import { z } from "zod";

import { projects } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { PROJECT_REVALIDATE } from "./revalidate";
import { projectId } from "./schema";

const projectIdInput = z.object({ id: projectId });

export type ArchivedProject = {
  readonly archivedAt: Date;
};

export type RestoredProject = {
  readonly archivedAt: null;
};

export const archiveProject = withTenantAction({
  name: "archiveProject",
  input: projectIdInput,
  requireRole: "admin",
  revalidate: PROJECT_REVALIDATE,
  handler: async ({ input, db }): Promise<ArchivedProject> => {
    const existing = await db.findById(projects, input.id);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (existing.archivedAt !== null) {
      return { archivedAt: existing.archivedAt };
    }

    const row = await db.update(projects, input.id, {
      archivedAt: new Date(),
    });

    if (row === undefined || row.archivedAt === null) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { archivedAt: row.archivedAt };
  },
});

export const restoreProject = withTenantAction({
  name: "restoreProject",
  input: projectIdInput,
  requireRole: "admin",
  revalidate: PROJECT_REVALIDATE,
  handler: async ({ input, db }): Promise<RestoredProject> => {
    const existing = await db.findById(projects, input.id);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (existing.archivedAt === null) {
      return { archivedAt: null };
    }

    const row = await db.update(projects, input.id, { archivedAt: null });

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { archivedAt: null };
  },
});
