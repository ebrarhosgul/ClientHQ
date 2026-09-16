/**
 * The reads behind the portal's pages (spec 0014).
 *
 * Every function here takes a `ContactContext`, never a `TenantContext`: that
 * makes a staff call a compile error rather than a runtime scoping bug, and it
 * is why the queries live apart from `src/invoices/queries.ts`, which staff
 * pages call. Every list returns `{ rows, page, pageCount, total }`, the same
 * shape the agency lists use, so a shared pagination component works for both.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  deliverables,
  invoices,
  projects,
  type ProjectStatus,
} from "@/db/schema";
import { tenantDb, type ContactContext } from "@/db/tenant";
import { todayUtc } from "@/lib/dates";

import {
  CLIENT_VISIBLE_STATUSES,
  isClientVisible,
  isPastDue,
  type ClientVisibleStatus,
} from "@/invoices/status";
import { isOverdue } from "@/projects/status";

import { portalId } from "./schema";

/** Every list in the portal is paged at 25, the same size the agency lists use. */
export const PORTAL_PAGE_SIZE = 25;

/** The overview's own cap, well under a page (spec 0014, AC-5). */
export const OVERVIEW_CAP = 5;

const UNPAID_STATUSES = [
  "sent",
  "overdue",
] as const satisfies readonly ClientVisibleStatus[];

export type PortalInvoiceRow = {
  readonly id: string;
  readonly number: number;
  readonly status: ClientVisibleStatus;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly totalCents: number;
  readonly currency: string;
  readonly pastDue: boolean;
};

export type PortalListResult<TRow> = {
  readonly rows: readonly TRow[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

/**
 * `0`, negative, non numeric or past the last page all clamp to page 1,
 * mirroring `src/invoices/queries.ts`. The Zod parse (`src/portal/schema.ts`)
 * already turned the raw search param into an in range integer or
 * `undefined`; this is the one further check only the row count can answer.
 */
function clampPage(parsedPage: number | undefined, pageCount: number): number {
  return parsedPage !== undefined && parsedPage <= pageCount ? parsedPage : 1;
}

/** Slice an already sorted, already filtered array into one page of 25. */
function paginate<TRow>(
  sorted: readonly TRow[],
  pageParam: number | undefined,
): PortalListResult<TRow> {
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / PORTAL_PAGE_SIZE));
  const page = clampPage(pageParam, pageCount);
  const start = (page - 1) * PORTAL_PAGE_SIZE;

  return {
    rows: sorted.slice(start, start + PORTAL_PAGE_SIZE),
    page,
    pageCount,
    total,
  };
}

/**
 * `sent` and `overdue` sort before `paid`; within a group, issue date newest
 * first, then number descending (AC-9). A pure, in memory comparator: "unpaid
 * first" is not a column, the same reason the agency list sorts in memory too.
 */
export function compareInvoicesForPortal(
  a: PortalInvoiceRow,
  b: PortalInvoiceRow,
): number {
  const aPaid = a.status === "paid" ? 1 : 0;
  const bPaid = b.status === "paid" ? 1 : 0;

  if (aPaid !== bPaid) {
    return aPaid - bPaid;
  }

  const aIssued = a.issueDate ?? "";
  const bIssued = b.issueDate ?? "";

  if (aIssued !== bIssued) {
    return aIssued < bIssued ? 1 : -1;
  }

  return b.number - a.number;
}

/**
 * The client's invoices (AC-9): `unpaidOnly` is what lets the overview's
 * Invoices block and the full `/portal/invoices` list share one query, one
 * filter and one order, so they cannot disagree about which invoices exist.
 * A `void` invoice, a draft, and every other client's invoice never appear:
 * the contact accessor scopes to this client, and the status filter is the
 * one place "client visible" is decided, imported rather than restated.
 */
export async function listPortalInvoices(
  ctx: ContactContext,
  {
    pageParam,
    unpaidOnly = false,
  }: { readonly pageParam?: number; readonly unpaidOnly?: boolean } = {},
): Promise<PortalListResult<PortalInvoiceRow>> {
  const statuses = unpaidOnly ? UNPAID_STATUSES : CLIENT_VISIBLE_STATUSES;

  const matches = await tenantDb(ctx).findMany(invoices, {
    where: inArray(invoices.status, statuses),
  });

  const today = todayUtc();

  const rows = matches.map((row): PortalInvoiceRow => {
    if (!isClientVisible(row.status)) {
      // Unreachable: `statuses` above is always a subset of the client
      // visible statuses, and the `where` clause already filtered to it.
      throw new Error(`invoice ${row.id} has status ${row.status}`);
    }

    if (row.number === null) {
      // Unreachable: every client visible status was assigned a number on issue.
      throw new Error(`invoice ${row.id} is ${row.status} with no number`);
    }

    const { status, number } = row;

    return {
      id: row.id,
      number,
      status,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      totalCents: row.totalCents,
      currency: row.currency,
      pastDue: isPastDue(status, row.dueDate, today),
    };
  });

  return paginate(rows.sort(compareInvoicesForPortal), pageParam);
}

export type PortalProjectRow = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly dueDate: string | null;
  readonly overdue: boolean;
};

function toPortalProjectRow(
  row: typeof projects.$inferSelect,
  today: string,
): PortalProjectRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    dueDate: row.dueDate,
    overdue: isOverdue(row.dueDate, row.status, row.archivedAt, today),
  };
}

/**
 * Due date ascending, a project with none last, then name (AC-6): the same
 * rule `/projects` applies inline through Drizzle's `orderBy`, restated here
 * as a pure comparator because the portal paginates in memory, the same
 * reason `compareInvoicesForPortal` exists.
 */
export function compareProjectsForPortal(
  a: Pick<PortalProjectRow, "id" | "name" | "dueDate">,
  b: Pick<PortalProjectRow, "id" | "name" | "dueDate">,
): number {
  if (a.dueDate === null && b.dueDate !== null) {
    return 1;
  }

  if (a.dueDate !== null && b.dueDate === null) {
    return -1;
  }

  if (a.dueDate !== b.dueDate) {
    return a.dueDate! < b.dueDate! ? -1 : 1;
  }

  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The client's non archived projects, every status (AC-6). Archived projects
 * never appear: the one predicate every list, the detail page and the
 * overview agree on.
 */
export async function listPortalProjects(
  ctx: ContactContext,
  pageParam?: number,
): Promise<PortalListResult<PortalProjectRow>> {
  const rows = await tenantDb(ctx).findMany(projects, {
    where: isNull(projects.archivedAt),
  });

  const today = todayUtc();
  const mapped = rows.map((row) => toPortalProjectRow(row, today));

  return paginate(mapped.sort(compareProjectsForPortal), pageParam);
}

/**
 * One non archived project of the contact's own client (AC-7). `undefined`
 * for a malformed id, a missing one, another client's, and an archived one:
 * the contact accessor's client predicate handles the first three, the
 * `archivedAt is null` filter the fourth.
 */
export async function getPortalProject(
  ctx: ContactContext,
  id: string,
): Promise<PortalProjectRow | undefined> {
  const parsed = portalId.safeParse(id);

  if (!parsed.success) {
    return undefined;
  }

  const row = await tenantDb(ctx).findFirst(projects, {
    where: and(eq(projects.id, parsed.data), isNull(projects.archivedAt)),
  });

  return row === undefined ? undefined : toPortalProjectRow(row, todayUtc());
}

export type PortalFileRow = {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
  readonly projectId: string;
  readonly projectName: string;
};

type DeliverableWithProject = typeof deliverables.$inferSelect & {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly archivedAt: Date | null;
  };
};

function toPortalFileRow(row: DeliverableWithProject): PortalFileRow {
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    projectId: row.project.id,
    projectName: row.project.name,
  };
}

/**
 * `ready`, `visible_to_client`, and the project not archived (AC-8): the one
 * predicate `listPortalFiles` and `listProjectFiles` share, over and above the
 * contact accessor's own "this client's projects" narrowing. The project's
 * own `archived_at` is not a column the accessor's predicate reaches (spec
 * 0003's three shapes stop at "belongs to this client"), so it is filtered
 * here, in memory, over the joined relation.
 */
async function findVisibleDeliverables(
  ctx: ContactContext,
  extra?: ReturnType<typeof eq>,
): Promise<readonly DeliverableWithProject[]> {
  const rows = await tenantDb(ctx).findMany(deliverables, {
    where: and(
      eq(deliverables.status, "ready"),
      eq(deliverables.visibleToClient, true),
      extra,
    ),
    with: {
      project: { columns: { id: true, name: true, archivedAt: true } },
    },
  });

  return rows.filter((row) => row.project.archivedAt === null);
}

/**
 * Every shared file across the client's non archived projects, newest first
 * (AC-8). Grouping by project is a presentation step over this flat, already
 * paged order (`groupFilesByProject`), not a second query shape.
 */
export async function listPortalFiles(
  ctx: ContactContext,
  pageParam?: number,
): Promise<PortalListResult<PortalFileRow>> {
  const rows = await findVisibleDeliverables(ctx);
  const sorted = rows
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toPortalFileRow);

  return paginate(sorted, pageParam);
}

/**
 * The shared files on one project, newest first, unpaged (AC-7): a project's
 * own file list is expected to stay small, the same reasoning
 * `listInvoicesForClient` uses on the agency side.
 */
export async function listProjectFiles(
  ctx: ContactContext,
  projectId: string,
): Promise<readonly PortalFileRow[]> {
  const rows = await findVisibleDeliverables(
    ctx,
    eq(deliverables.projectId, projectId),
  );

  return rows
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toPortalFileRow);
}

export type PortalFileGroup = {
  readonly projectId: string;
  readonly projectName: string;
  readonly files: readonly PortalFileRow[];
};

/**
 * Groups an already ordered page of files under a heading per project, in
 * the order each group's newest file appears (AC-8): a stable "first seen
 * wins the group's position" pass over rows already sorted newest first, so
 * every group's own files stay newest first too.
 */
export type OverviewData = {
  readonly projects: readonly PortalProjectRow[];
  readonly files: readonly PortalFileRow[];
  readonly invoices: readonly PortalInvoiceRow[];
};

/**
 * The three overview blocks (AC-5): each section's own list, page 1, sliced
 * to `OVERVIEW_CAP`. One query per section, run together, so the overview
 * can never disagree with `/portal/projects`, `/portal/files` or
 * `/portal/invoices` about order or which rows are visible; the cap is
 * applied here, once, rather than by every caller.
 */
export async function overviewData(ctx: ContactContext): Promise<OverviewData> {
  const [projects, files, invoices] = await Promise.all([
    listPortalProjects(ctx),
    listPortalFiles(ctx),
    listPortalInvoices(ctx, { unpaidOnly: true }),
  ]);

  return {
    projects: projects.rows.slice(0, OVERVIEW_CAP),
    files: files.rows.slice(0, OVERVIEW_CAP),
    invoices: invoices.rows.slice(0, OVERVIEW_CAP),
  };
}

export function groupFilesByProject(
  rows: readonly PortalFileRow[],
): readonly PortalFileGroup[] {
  const groups: {
    projectId: string;
    projectName: string;
    files: PortalFileRow[];
  }[] = [];
  const indexByProject = new Map<string, number>();

  for (const row of rows) {
    const existing = indexByProject.get(row.projectId);

    if (existing === undefined) {
      indexByProject.set(row.projectId, groups.length);
      groups.push({
        projectId: row.projectId,
        projectName: row.projectName,
        files: [row],
      });
    } else {
      groups[existing]!.files.push(row);
    }
  }

  return groups;
}
