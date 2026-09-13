/**
 * The reads behind `/projects`, `/projects/[id]`, and the client page's
 * Projects section (spec 0010).
 *
 * Every read goes through `tenantDb(ctx)`, scoped to the acting agency by
 * construction (AC-15); there is no path here to another agency's rows.
 */
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  type SQL,
} from "drizzle-orm";

import { clientId as clientIdSchema } from "@/clients/schema";
import { PROJECT_STATUSES, projects, type ProjectStatus } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

import { projectId } from "./schema";
import { isOverdue } from "./status";

export const PROJECTS_PAGE_SIZE = 25;

export type ProjectRow = typeof projects.$inferSelect;

export type ProjectListRow = ProjectRow & {
  readonly clientName: string;
  readonly overdue: boolean;
};

export type ProjectListParams = {
  /** The raw `page` URL search param, parsed and clamped here. */
  readonly pageParam?: string;
  /** The raw `status` URL search param: `"open"`, `"all"`, one status, or unset. */
  readonly statusParam?: string;
  /** The raw `client` URL search param, validated as a uuid here. */
  readonly clientParam?: string;
  readonly archived: boolean;
  /** The calendar day "overdue" is measured against; see `todayUtc()`. */
  readonly todayUtc: string;
};

export type ProjectListResult = {
  readonly rows: readonly ProjectListRow[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

const NO_RESULTS: ProjectListResult = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

/**
 * `0`, negative, non numeric or past the last page all clamp to page 1
 * (mirrors `src/clients/queries.ts`), never a 404 or a crash.
 */
function clampPage(pageParam: string | undefined, pageCount: number): number {
  if (pageParam === undefined) {
    return 1;
  }

  const parsed = Number(pageParam);

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= pageCount
    ? parsed
    : 1;
}

function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * `status=open` (the default) means every status but `delivered`; `all` means
 * every status; one of the four names that status only. Missing or
 * unrecognized falls back to `open` for an active list and `all` for an
 * archived one, because an archived list is a record, not a work list
 * (spec 0010, Value sourcing).
 */
function statusPredicate(
  statusParam: string | undefined,
  archived: boolean,
): SQL | undefined {
  if (statusParam !== undefined && isProjectStatus(statusParam)) {
    return eq(projects.status, statusParam);
  }

  if (statusParam === "all") {
    return undefined;
  }

  if (statusParam === "open") {
    return ne(projects.status, "delivered");
  }

  return archived ? undefined : ne(projects.status, "delivered");
}

/**
 * A page of one agency's projects (spec 0010, AC-4, AC-5).
 *
 * A `client` filter that is not a syntactically valid uuid never reaches the
 * database: it resolves to an empty list directly, the same outcome a
 * well-formed but foreign or nonexistent client id gets once the query runs
 * (this agency's projects never reference another agency's client, so the
 * equality filter alone already excludes it).
 */
export async function listProjects(
  ctx: StaffContext,
  {
    pageParam,
    statusParam,
    clientParam,
    archived,
    todayUtc,
  }: ProjectListParams,
): Promise<ProjectListResult> {
  let clientFilter: string | undefined;

  if (clientParam !== undefined) {
    const parsed = clientIdSchema.safeParse(clientParam);

    if (!parsed.success) {
      return NO_RESULTS;
    }

    clientFilter = parsed.data;
  }

  const where: SQL | undefined = and(
    archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
    statusPredicate(statusParam, archived),
    clientFilter ? eq(projects.clientId, clientFilter) : undefined,
  );

  const matches = await tenantDb(ctx).findMany(projects, {
    where,
    orderBy: [asc(projects.dueDate), asc(projects.name), asc(projects.id)],
    with: { client: { columns: { name: true } } },
  });

  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / PROJECTS_PAGE_SIZE));
  const page = clampPage(pageParam, pageCount);
  const start = (page - 1) * PROJECTS_PAGE_SIZE;

  const rows: ProjectListRow[] = matches
    .slice(start, start + PROJECTS_PAGE_SIZE)
    .map(({ client, ...row }) => ({
      ...row,
      clientName: client.name,
      overdue: isOverdue(row.dueDate, row.status, row.archivedAt, todayUtc),
    }));

  return { rows, page, pageCount, total };
}

export type ProjectDetail = ProjectRow & { readonly clientName: string };

/**
 * `undefined` for a missing id, another agency's id, and one that isn't even a
 * uuid alike (AC-15), exactly as `getClient` does for clients.
 */
export async function getProject(
  ctx: StaffContext,
  id: string,
): Promise<ProjectDetail | undefined> {
  const parsed = projectId.safeParse(id);

  if (!parsed.success) {
    return undefined;
  }

  const row = await tenantDb(ctx).findFirst(projects, {
    where: eq(projects.id, parsed.data),
    with: { client: { columns: { name: true } } },
  });

  if (row === undefined) {
    return undefined;
  }

  const { client, ...rest } = row;

  return { ...rest, clientName: client.name };
}

export type ClientProjectRow = ProjectRow & { readonly overdue: boolean };

/**
 * A client's active projects, newest first, for the client page's Projects
 * section (spec 0010, AC-13). No paging: a client's own project list is
 * expected to stay small.
 */
export async function listProjectsForClient(
  ctx: StaffContext,
  clientId: string,
  todayUtc: string,
): Promise<readonly ClientProjectRow[]> {
  const rows = await tenantDb(ctx).findMany(projects, {
    where: and(eq(projects.clientId, clientId), isNull(projects.archivedAt)),
    orderBy: [desc(projects.createdAt), asc(projects.id)],
  });

  return rows.map((row) => ({
    ...row,
    overdue: isOverdue(row.dueDate, row.status, row.archivedAt, todayUtc),
  }));
}

/**
 * How many of a client's projects are active, for the archive client confirm
 * dialog's copy (spec 0010, AC-14). Informational only: read once when the
 * client page loads, never a gate on the archive action itself.
 */
export async function countActiveProjects(
  ctx: StaffContext,
  clientId: string,
): Promise<number> {
  const rows = await tenantDb(ctx).findMany(projects, {
    where: and(eq(projects.clientId, clientId), isNull(projects.archivedAt)),
  });

  return rows.length;
}
