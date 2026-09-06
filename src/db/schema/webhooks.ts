import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { id } from "./helpers";

export const WEBHOOK_SOURCES = ["stripe", "clerk"] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

/**
 * The idempotency ledger. Not tenant scoped. A webhook handler inserts the
 * provider's event id here inside the same transaction as the state change;
 * a unique violation means the event was already handled.
 *
 * No payload column: the events carry personal data and both providers keep
 * the originals in their own dashboards. The daily cron prunes rows older than
 * 90 days on `processed_at`.
 */
export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    id: id(),
    /** The route that received it, never the payload. */
    source: text("source", { enum: WEBHOOK_SOURCES }).notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Serves as `created_at`; this table has no `updated_at`. */
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("processed_webhook_events_source_event_id_unique").on(
      t.source,
      t.eventId,
    ),
    index("processed_webhook_events_processed_at_idx").on(t.processedAt),
    check(
      "processed_webhook_events_source_check",
      sql`${t.source} in ('stripe', 'clerk')`,
    ),
  ],
);
