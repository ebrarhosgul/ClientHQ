import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * One row per `(subject, action, window)`, consumed by the single atomic
 * upsert in `src/db/tenant/rate-limit.ts` and nowhere else (spec 0018, AC-9).
 *
 * Not tenant scoped and not registered in `src/db/tenant/tables.ts`: it
 * carries no `org_id`, because one of its subjects (`create_agency`) is a
 * person with no agency yet. No check constraint on `subject` or `action` on
 * purpose, so a fourth policy or a new subject kind needs no migration.
 */
export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    /** `org:<organizations.id>` for the agency policies, `user:<clerk user id>` for `create_agency`. */
    subject: text("subject").notNull(),
    /** The policy's `action`: `upload`, `invoice_email`, `create_agency`. */
    action: text("action").notNull(),
    /** The window's opening instant, truncated on the clock (AC-4). */
    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** Attempts consumed in this window. Starts at 1, only ever incremented. */
    count: integer("count").notNull(),
    /** The last consume, set by both branches of the upsert. */
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subject, t.action, t.windowStart] }),
    index("rate_limit_windows_window_start_idx").on(t.windowStart),
  ],
);
