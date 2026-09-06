import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./clients";
import { id, orgId, timestamps } from "./helpers";
import { users } from "./identity";

export const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "in_review",
  "delivered",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The unit of work an agency delivers. Archiving is orthogonal to status and
 * sets `archived_at`, so a project keeps its workflow state through archiving.
 * Valid status transitions are owned by feature 11; this constrains the value
 * set only.
 */
export const projects = pgTable(
  "projects",
  {
    id: id(),
    orgId: orgId("cascade"),
    /**
     * RESTRICT: a project is work history, so losing one silently because it
     * happened to carry no files is not acceptable. Clients are archived, never
     * deleted.
     */
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: PROJECT_STATUSES })
      .notNull()
      .default("planning"),
    /** A calendar day, not an instant. */
    dueDate: date("due_date", { mode: "string" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("projects_org_id_client_id_idx").on(t.orgId, t.clientId),
    index("projects_org_id_status_idx").on(t.orgId, t.status),
    index("projects_org_id_archived_at_idx").on(t.orgId, t.archivedAt),
    check(
      "projects_status_check",
      sql`${t.status} in ('planning', 'in_progress', 'in_review', 'delivered')`,
    ),
  ],
);

export const DELIVERABLE_STATUSES = ["pending", "ready"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

/**
 * A file attached to a project, stored in R2. Every foreign key RESTRICTs,
 * because a silent cascade would orphan an R2 object nobody can find and you
 * keep paying for. A `pending` row has no confirmed object behind it and is
 * never listed, downloadable or visible in the portal.
 */
export const deliverables = pgTable(
  "deliverables",
  {
    id: id(),
    orgId: orgId("restrict"),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** The object key, never a public URL. */
    r2Key: text("r2_key").notNull().unique(),
    /** Read back from R2 on confirm, not trusted from the browser. */
    contentType: text("content_type").notNull(),
    /** Same. */
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    visibleToClient: boolean("visible_to_client").notNull().default(false),
    status: text("status", { enum: DELIVERABLE_STATUSES })
      .notNull()
      .default("pending"),
    ...timestamps(),
  },
  (t) => [
    index("deliverables_org_id_project_id_idx").on(t.orgId, t.projectId),
    // For the abandoned upload sweep: pending rows older than a cutoff.
    index("deliverables_org_id_status_created_at_idx").on(
      t.orgId,
      t.status,
      t.createdAt,
    ),
    check(
      "deliverables_status_check",
      sql`${t.status} in ('pending', 'ready')`,
    ),
  ],
);
