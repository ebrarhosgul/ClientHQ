import { FileText } from "lucide-react";
import Link from "next/link";

import { formatBillingDate } from "@/payments/billing-state";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

import { typeLabel } from "../file-rules";
import { formatBytes } from "../format";
import type { DeliverableRow } from "../queries";
import { DeleteDeliverableButton } from "./delete-deliverable-button";
import { DeliverableVisibilitySwitch } from "./deliverable-visibility-switch";
import { UploadDeliverable } from "./upload-deliverable";

export type DeliverablesSectionProps = {
  readonly projectId: string;
  readonly archived: boolean;
  readonly storageConfigured: boolean;
  /** `undefined` when the read failed: the section shows a reload prompt. */
  readonly deliverables: readonly DeliverableRow[] | undefined;
};

/**
 * The project page's Deliverables section (spec 0011, AC-10), replacing the
 * spec 0010 placeholder.
 *
 * The upload control is hidden, in order, for an archived project (AC-1) and
 * for storage not configured (AC-18); the list itself still shows either
 * way, since existing `ready` rows are still worth seeing.
 */
export function DeliverablesSection({
  projectId,
  archived,
  storageConfigured,
  deliverables,
}: DeliverablesSectionProps) {
  if (deliverables === undefined) {
    return (
      <section
        aria-labelledby="deliverables-heading"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id="deliverables-heading"
          className="text-base font-semibold tracking-tight"
        >
          Deliverables
        </h2>
        <ErrorState
          heading="Deliverables could not be loaded"
          description="The rest of this project is fine. Reload to try the deliverables again."
          action={
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}`}>Reload</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="deliverables-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2
        id="deliverables-heading"
        className="text-base font-semibold tracking-tight"
      >
        Deliverables
      </h2>

      {archived ? (
        <p className="text-sm text-muted-foreground">
          This project is archived, so no files can be added.
        </p>
      ) : storageConfigured ? (
        <UploadDeliverable projectId={projectId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          File storage is not configured for this environment.
        </p>
      )}

      {deliverables.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          heading="No deliverables yet"
          description="Files added to this project will show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {deliverables.map((deliverable) => (
            <li
              key={deliverable.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <a
                  href={`/deliverables/${deliverable.id}/download`}
                  className="truncate font-medium underline underline-offset-2"
                >
                  {deliverable.name}
                </a>
                <span className="text-xs text-muted-foreground">
                  {typeLabel(deliverable.contentType)} ·{" "}
                  {formatBytes(deliverable.sizeBytes)} · Uploaded by{" "}
                  {deliverable.uploadedByName} on{" "}
                  {formatBillingDate(deliverable.createdAt)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <DeliverableVisibilitySwitch
                  deliverableId={deliverable.id}
                  name={deliverable.name}
                  visibleToClient={deliverable.visibleToClient}
                />
                <DeleteDeliverableButton
                  deliverableId={deliverable.id}
                  name={deliverable.name}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
