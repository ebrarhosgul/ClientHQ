"use server";

/**
 * Archiving and restoring a client (spec 0006, AC-8, AC-9).
 *
 * Both are idempotent: archiving an already archived client, or restoring an
 * already active one, succeeds with no error and no write, rather than
 * treating "already in that state" as a failure.
 */
import { z } from "zod";

import { clients } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { clientId } from "./schema";

const clientIdInput = z.object({ id: clientId });

export type ArchivedClient = {
  readonly archivedAt: Date;
};

export type RestoredClient = {
  readonly archivedAt: null;
};

const REVALIDATE = {
  paths: ["/clients", { path: "/clients/[id]", type: "page" as const }],
};

export const archiveClient = withTenantAction({
  name: "archiveClient",
  input: clientIdInput,
  revalidate: REVALIDATE,
  handler: async ({ input, db }): Promise<ArchivedClient> => {
    const existing = await db.findById(clients, input.id);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (existing.archivedAt !== null) {
      return { archivedAt: existing.archivedAt };
    }

    const row = await db.update(clients, input.id, { archivedAt: new Date() });

    if (row === undefined || row.archivedAt === null) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { archivedAt: row.archivedAt };
  },
});

export const restoreClient = withTenantAction({
  name: "restoreClient",
  input: clientIdInput,
  revalidate: REVALIDATE,
  handler: async ({ input, db }): Promise<RestoredClient> => {
    const existing = await db.findById(clients, input.id);

    if (existing === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (existing.archivedAt === null) {
      return { archivedAt: null };
    }

    const row = await db.update(clients, input.id, { archivedAt: null });

    if (row === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    return { archivedAt: null };
  },
});
