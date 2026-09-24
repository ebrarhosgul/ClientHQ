/**
 * The reads behind `/dashboard` (spec 0020).
 *
 * Every read goes through `tenantDb(ctx)`, scoped to the acting agency by
 * construction. Each function here is independent, so a failure in one never
 * touches the others; the page awaits all three in parallel, one per
 * `<Suspense>` boundary.
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";

import { clients, deliverables, invoices, projects } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";
import { daysBetweenUtc, sixMonthWindowStart } from "@/lib/dates";
import { isOverdue } from "@/projects/status";
import { CLIENT_VISIBLE_STATUSES, isPastDue } from "@/invoices/status";

export const DASHBOARD_SECTION_ROW_LIMIT = 5;
const RECENT_DELIVERABLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A row of `invoices` plus the client name, as `overdueInvoicesSummary` reads it. */
type InvoiceWithClient = typeof invoices.$inferSelect & {
  readonly client: { readonly name: string };
};

export type OverdueInvoiceRow = {
  readonly id: string;
  readonly number: number;
  readonly clientName: string;
  readonly totalCents: number;
  readonly currency: string;
  readonly dueDate: string;
  readonly daysOverdue: number;
};

export type OverdueTotal = {
  readonly currency: string;
  readonly cents: number;
};

export type OverdueInvoicesSummary = {
  readonly count: number;
  readonly totals: readonly OverdueTotal[];
  readonly rows: readonly OverdueInvoiceRow[];
};

/**
 * An invoice counts as overdue exactly when its status is `overdue`, or its
 * status is `sent` and its due date is before `todayUtc` (AC-3). The one
 * definition the SQL `where` below and this predicate share.
 */
function matchesOverdue(
  row: Pick<InvoiceWithClient, "status" | "dueDate">,
  todayUtc: string,
): boolean {
  return (
    row.status === "overdue" || isPastDue(row.status, row.dueDate, todayUtc)
  );
}

/**
 * Pure: the count, the per currency totals and the top 5 rows, from every
 * matching invoice (AC-3, AC-4, AC-5). Kept apart from the read so a test can
 * hold it against the SQL `where` over the same fixtures.
 */
export function summariseOverdue(
  rows: readonly InvoiceWithClient[],
  todayUtc: string,
): OverdueInvoicesSummary {
  const matches = rows.filter((row) => matchesOverdue(row, todayUtc));

  const totalsByCurrency = new Map<string, number>();
  for (const row of matches) {
    totalsByCurrency.set(
      row.currency,
      (totalsByCurrency.get(row.currency) ?? 0) + row.totalCents,
    );
  }

  const totals = [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, cents }));

  const top = [...matches]
    .sort((a, b) => {
      // `dueDate` is never null for a matching invoice: only `sent` and
      // `overdue` invoices can match, and both are due dated on issue.
      const byDueDate = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      return byDueDate !== 0 ? byDueDate : (a.number ?? 0) - (b.number ?? 0);
    })
    .slice(0, DASHBOARD_SECTION_ROW_LIMIT)
    .map((row) => ({
      id: row.id,
      // Never null: a matching invoice was always numbered on issue.
      number: row.number ?? 0,
      clientName: row.client.name,
      totalCents: row.totalCents,
      currency: row.currency,
      dueDate: row.dueDate ?? "",
      daysOverdue: daysBetweenUtc(row.dueDate ?? todayUtc, todayUtc),
    }));

  return { count: matches.length, totals, rows: top };
}

/**
 * Every invoice this agency holds, read whole (the accessor has no top level
 * `columns` option), then summarised in memory (AC-3, AC-4, AC-5). The
 * overdue set is small by nature, so this stays cheap at realistic volumes
 * (spec 0020, Consequences).
 */
export async function overdueInvoicesSummary(
  ctx: StaffContext,
  todayUtc: string,
): Promise<OverdueInvoicesSummary> {
  const rows = await tenantDb(ctx).findMany(invoices, {
    where: or(
      eq(invoices.status, "overdue"),
      and(eq(invoices.status, "sent"), lt(invoices.dueDate, todayUtc)),
    ),
    with: { client: { columns: { name: true } } },
  });

  return summariseOverdue(rows, todayUtc);
}

export type OpenProjectRow = {
  readonly id: string;
  readonly name: string;
  readonly clientName: string;
  readonly status: (typeof projects.$inferSelect)["status"];
  readonly dueDate: string | null;
  readonly overdue: boolean;
};

export type OpenProjectsSummary = {
  readonly count: number;
  readonly rows: readonly OpenProjectRow[];
};

/**
 * A project counts as open exactly when it is not archived and its status is
 * not `delivered` (AC-6). Count and rows run in parallel; the same order as
 * `/projects` (spec 0010).
 */
export async function openProjectsSummary(
  ctx: StaffContext,
  todayUtc: string,
): Promise<OpenProjectsSummary> {
  const where = and(
    isNull(projects.archivedAt),
    ne(projects.status, "delivered"),
  );

  const [count, rows] = await Promise.all([
    tenantDb(ctx).count(projects, { where }),
    tenantDb(ctx).findMany(projects, {
      where,
      orderBy: [asc(projects.dueDate), asc(projects.name), asc(projects.id)],
      limit: DASHBOARD_SECTION_ROW_LIMIT,
      with: { client: { columns: { name: true } } },
    }),
  ]);

  return {
    count,
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      clientName: row.client.name,
      status: row.status,
      dueDate: row.dueDate,
      overdue: isOverdue(row.dueDate, row.status, row.archivedAt, todayUtc),
    })),
  };
}

export type RecentDeliverableRow = {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly visibleToClient: boolean;
  readonly uploadedByName: string;
  readonly createdAt: Date;
};

export type RecentDeliverablesSummary = {
  readonly addedLast7Days: number;
  readonly rows: readonly RecentDeliverableRow[];
};

/**
 * A deliverable counts as recent when it is `ready` and its project is not
 * archived (AC-7). The active project ids are read first; with none, the
 * second query is skipped entirely.
 */
export async function recentDeliverablesSummary(
  ctx: StaffContext,
  now: Date,
): Promise<RecentDeliverablesSummary> {
  const activeProjects = await tenantDb(ctx).findMany(projects, {
    where: isNull(projects.archivedAt),
  });

  const activeProjectIds = activeProjects.map((project) => project.id);

  if (activeProjectIds.length === 0) {
    return { addedLast7Days: 0, rows: [] };
  }

  const readyOnActiveProjects = and(
    eq(deliverables.status, "ready"),
    inArray(deliverables.projectId, activeProjectIds),
  );

  const since = new Date(now.getTime() - RECENT_DELIVERABLE_WINDOW_MS);

  const [addedLast7Days, rows] = await Promise.all([
    tenantDb(ctx).count(deliverables, {
      where: and(readyOnActiveProjects, gt(deliverables.createdAt, since)),
    }),
    tenantDb(ctx).findMany(deliverables, {
      where: readyOnActiveProjects,
      orderBy: [desc(deliverables.createdAt), desc(deliverables.id)],
      limit: DASHBOARD_SECTION_ROW_LIMIT,
      with: {
        project: { with: { client: { columns: { name: true } } } },
        uploadedBy: { columns: { name: true, email: true } },
      },
    }),
  ]);

  return {
    addedLast7Days,
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      projectName: row.project.name,
      clientName: row.project.client.name,
      visibleToClient: row.visibleToClient,
      // `scrubUser()` always sets a name; the only way to see a null one is a
      // real account that never had a display name set (as `listDeliverables` notes).
      uploadedByName: row.uploadedBy.name ?? row.uploadedBy.email,
      createdAt: row.createdAt,
    })),
  };
}

/** Whether the agency has any client row at all, active or archived (AC-9). */
export async function hasAnyClient(ctx: StaffContext): Promise<boolean> {
  const row = await tenantDb(ctx).findFirst(clients);
  return row !== undefined;
}

/**
 * The agency's clients that are not archived (AC-19, the Overview card).
 * Reachable at zero even with clients on record: AC-9 only checks for any
 * client at all, active or archived.
 */
export async function activeClientsCount(ctx: StaffContext): Promise<number> {
  return tenantDb(ctx).count(clients, { where: isNull(clients.archivedAt) });
}

export type InvoicedMonthTotal = {
  readonly currency: string;
  readonly cents: number;
};

export type InvoicedMonth = {
  /** `YYYY-MM`, the UTC calendar month. */
  readonly month: string;
  readonly totalsByCurrency: readonly InvoicedMonthTotal[];
};

export type InvoicedTrend = {
  /** Exactly 6 entries, oldest first, ending with `todayUtc`'s own month. */
  readonly months: readonly InvoicedMonth[];
  /** The sorted union of every currency with a non zero bucket anywhere in the window. */
  readonly currencies: readonly string[];
};

/** A row of `invoices`, as `invoicedTrend` reads it (no relation needed). */
type InvoiceForTrend = Pick<
  typeof invoices.$inferSelect,
  "issueDate" | "currency" | "totalCents"
>;

/**
 * Pure: buckets every matching invoice by the UTC calendar month of its
 * `issueDate` and by `currency`, and returns exactly 6 months (AC-21, AC-22).
 * Kept apart from the read so a test can fix `todayUtc` and the window it
 * implies, without a database.
 */
export function summariseInvoicedByMonth(
  rows: readonly InvoiceForTrend[],
  todayUtc: string,
): InvoicedTrend {
  const windowStart = sixMonthWindowStart(todayUtc);
  const [startYear, startMonth] = windowStart.split("-").map(Number);

  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  const buckets = new Map<string, Map<string, number>>(
    monthKeys.map((key) => [key, new Map<string, number>()]),
  );

  for (const row of rows) {
    if (row.issueDate === null) {
      continue;
    }

    const monthBucket = buckets.get(row.issueDate.slice(0, 7));
    if (monthBucket === undefined) {
      // Outside the window: the caller's own `where` already excludes this,
      // this guard just keeps the function honest as a pure one.
      continue;
    }

    monthBucket.set(
      row.currency,
      (monthBucket.get(row.currency) ?? 0) + row.totalCents,
    );
  }

  const currencies = [
    ...new Set([...buckets.values()].flatMap((bucket) => [...bucket.keys()])),
  ].sort((a, b) => a.localeCompare(b));

  const months = monthKeys.map((month) => ({
    month,
    totalsByCurrency: [...(buckets.get(month) ?? new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, cents]) => ({ currency, cents })),
  }));

  return { months, currencies };
}

/**
 * Every invoice counting toward the last 6 months of invoiced volume
 * (`sent`, `overdue` or `paid`, issued inside the window), summarised in
 * memory by `summariseInvoicedByMonth` (AC-21). The window is small by
 * construction, the same tradeoff `overdueInvoicesSummary` already makes.
 */
export async function invoicedTrend(
  ctx: StaffContext,
  todayUtc: string,
): Promise<InvoicedTrend> {
  const rows = await tenantDb(ctx).findMany(invoices, {
    where: and(
      inArray(invoices.status, CLIENT_VISIBLE_STATUSES),
      gte(invoices.issueDate, sixMonthWindowStart(todayUtc)),
    ),
  });

  return summariseInvoicedByMonth(rows, todayUtc);
}
