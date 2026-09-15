import type { InvoiceEventKind } from "@/db/schema";
import { formatBillingDateTime } from "@/payments/billing-state";

import type { InvoiceEventRow } from "../queries";

const KIND_LABELS: Readonly<Record<InvoiceEventKind, string>> = {
  issued: "Issued",
  paid: "Marked paid",
  voided: "Voided",
  overdue: "Marked overdue",
  notified: "Client notified",
  notification_failed: "Notification failed",
};

export function eventLabel(kind: InvoiceEventKind): string {
  return KIND_LABELS[kind];
}

/**
 * The invoice's history, newest first (spec 0012, AC-11): who did what, when,
 * and the note (a void reason, the addresses a notification reached or
 * missed). "System" is the nightly sweep, which has no actor.
 */
export function InvoiceEventsList({
  events,
}: {
  readonly events: readonly InvoiceEventRow[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has happened to this invoice yet. Issuing it is the first entry.
      </p>
    );
  }

  return (
    <ol className="flex flex-col divide-y divide-border">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm font-medium">
              {eventLabel(event.kind)}
              <span className="font-normal text-muted-foreground">
                {" "}
                by {event.actorName}
              </span>
            </p>
            <time
              dateTime={event.createdAt.toISOString()}
              className="text-xs text-muted-foreground tabular-nums"
            >
              {formatBillingDateTime(event.createdAt)}
            </time>
          </div>
          {event.note ? (
            <p className="text-xs text-muted-foreground break-words">
              {event.note}
            </p>
          ) : undefined}
        </li>
      ))}
    </ol>
  );
}
