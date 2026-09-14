/**
 * The read behind the Deliverables section (spec 0011, AC-9, AC-10).
 *
 * `pending` rows are never returned here: they are invisible everywhere but
 * to their own uploader's confirm and abandon.
 */
import { and, desc, eq } from "drizzle-orm";

import { deliverables } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

export type DeliverableRow = typeof deliverables.$inferSelect & {
  readonly uploadedByName: string;
};

export async function listDeliverables(
  ctx: StaffContext,
  projectId: string,
): Promise<readonly DeliverableRow[]> {
  const rows = await tenantDb(ctx).findMany(deliverables, {
    where: and(
      eq(deliverables.projectId, projectId),
      eq(deliverables.status, "ready"),
    ),
    orderBy: [desc(deliverables.createdAt), desc(deliverables.id)],
    with: { uploadedBy: { columns: { name: true, email: true } } },
  });

  return rows.map(({ uploadedBy, ...row }) => ({
    ...row,
    // `scrubUser()` always sets a name ("Deleted user"); the only way to see
    // a null one is a real account that never had a display name set.
    uploadedByName: uploadedBy.name ?? uploadedBy.email,
  }));
}
