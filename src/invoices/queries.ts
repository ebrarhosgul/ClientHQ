/**
 * The reads behind `/invoices`, `/invoices/[id]`, the client page's Invoices
 * section and the notification's recipient list (spec 0012).
 *
 * Every read goes through `tenantDb(ctx)`, scoped to the acting agency by
 * construction (AC-14); there is no path here to another agency's rows.
 */
import { and, asc, desc, eq, isNotNull, ne, type SQL } from "drizzle-orm";

import { clientId as clientIdSchema } from "@/clients/schema";
import {
  INVOICE_STATUSES,
  clientContacts,
  invoiceEvents,
  invoiceLineItems,
  invoices,
  type InvoiceStatus,
} from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

import type { InvoiceRow, LineItemRow } from "./draft";
import { invoiceId as invoiceIdSchema } from "./schema";
import { isPastDue } from "./status";

export const INVOICES_PAGE_SIZE = 25;

export type { InvoiceRow, LineItemRow };

export type InvoiceListRow = InvoiceRow & {
  readonly clientName: string;
  readonly pastDue: boolean;
};

export type InvoiceListParams = {
  /** The raw `page` URL search param, parsed and clamped here. */
  readonly pageParam?: string;
  /** The raw `status` URL search param: one status, or unset for every status but void. */
  readonly statusParam?: string;
  /** The raw `client` URL search param, validated as a uuid here. */
  readonly clientParam?: string;
  /** `?void=true`: include voided invoices in the default view. */
  readonly includeVoid: boolean;
  /** The calendar day "past due" is measured against; see `todayUtc()`. */
  readonly todayUtc: string;
};

export type InvoiceListResult = {
  readonly rows: readonly InvoiceListRow[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

const NO_RESULTS: InvoiceListResult = {
  rows: [],
  page: 1,
  pageCount: 1,
  total: 0,
};

/**
 * `0`, negative, non numeric or past the last page all clamp to page 1
 * (mirrors `src/projects/queries.ts`), never a 404 or a crash.
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

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

/**
 * One named status filters to it (`void` included, since naming it is asking
 * for it). Otherwise every status except `void`, unless the void toggle is on
 * (AC-10).
 */
function statusPredicate(
  statusParam: string | undefined,
  includeVoid: boolean,
): SQL | undefined {
  if (statusParam !== undefined && isInvoiceStatus(statusParam)) {
    return eq(invoices.status, statusParam);
  }

  return includeVoid ? undefined : ne(invoices.status, "void");
}

/**
 * The list order (AC-10, Value sourcing): drafts first, then issue date
 * descending, then created date descending, then id ascending as the final
 * tiebreak. An in memory comparator because "drafts first" is not a column.
 */
export function compareForList(
  a: Pick<InvoiceRow, "status" | "issueDate" | "createdAt" | "id">,
  b: Pick<InvoiceRow, "status" | "issueDate" | "createdAt" | "id">,
): number {
  const aDraft = a.status === "draft" ? 0 : 1;
  const bDraft = b.status === "draft" ? 0 : 1;

  if (aDraft !== bDraft) {
    return aDraft - bDraft;
  }

  const aIssued = a.issueDate ?? "";
  const bIssued = b.issueDate ?? "";

  if (aIssued !== bIssued) {
    return aIssued < bIssued ? 1 : -1;
  }

  const byCreated = b.createdAt.getTime() - a.createdAt.getTime();

  if (byCreated !== 0) {
    return byCreated;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A page of one agency's invoices (AC-10).
 *
 * A blank `client` param is no filter at all, as on the projects list. A
 * non blank one that is not a syntactically valid uuid never reaches the
 * database: it resolves to an empty page directly, the same outcome a well
 * formed but foreign or nonexistent client id gets once the query runs.
 */
export async function listInvoices(
  ctx: StaffContext,
  {
    pageParam,
    statusParam,
    clientParam,
    includeVoid,
    todayUtc,
  }: InvoiceListParams,
): Promise<InvoiceListResult> {
  let clientFilter: string | undefined;
  const trimmedClientParam = clientParam?.trim();

  if (trimmedClientParam) {
    const parsed = clientIdSchema.safeParse(trimmedClientParam);

    if (!parsed.success) {
      return NO_RESULTS;
    }

    clientFilter = parsed.data;
  }

  const where: SQL | undefined = and(
    statusPredicate(statusParam, includeVoid),
    clientFilter ? eq(invoices.clientId, clientFilter) : undefined,
  );

  const matches = await tenantDb(ctx).findMany(invoices, {
    where,
    with: { client: { columns: { name: true } } },
  });

  const sorted = [...matches].sort(compareForList);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE));
  const page = clampPage(pageParam, pageCount);
  const start = (page - 1) * INVOICES_PAGE_SIZE;

  const rows: InvoiceListRow[] = sorted
    .slice(start, start + INVOICES_PAGE_SIZE)
    .map(({ client, ...row }) => ({
      ...row,
      clientName: client.name,
      pastDue: isPastDue(row.status, row.dueDate, todayUtc),
    }));

  return { rows, page, pageCount, total };
}

export type InvoiceEventRow = typeof invoiceEvents.$inferSelect & {
  /** `users.name`, falling back to `users.email`; "System" when there is no actor. */
  readonly actorName: string;
};

export type InvoiceDetail = InvoiceRow & {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly archivedAt: Date | null;
  };
  readonly lines: readonly LineItemRow[];
  /** Newest first. */
  readonly events: readonly InvoiceEventRow[];
};

/**
 * `undefined` for a missing id, another agency's id, and one that isn't even a
 * uuid alike (AC-14), exactly as `getProject` does for projects.
 */
export async function getInvoice(
  ctx: StaffContext,
  id: string,
): Promise<InvoiceDetail | undefined> {
  const parsed = invoiceIdSchema.safeParse(id);

  if (!parsed.success) {
    return undefined;
  }

  const row = await tenantDb(ctx).findFirst(invoices, {
    where: eq(invoices.id, parsed.data),
    with: {
      client: { columns: { id: true, name: true, archivedAt: true } },
      lineItems: {
        orderBy: [asc(invoiceLineItems.position), asc(invoiceLineItems.id)],
      },
      events: {
        orderBy: [desc(invoiceEvents.createdAt), desc(invoiceEvents.id)],
        with: { actor: { columns: { name: true, email: true } } },
      },
    },
  });

  if (row === undefined) {
    return undefined;
  }

  const { client, lineItems, events, ...rest } = row;

  return {
    ...rest,
    client,
    lines: lineItems,
    events: events.map(({ actor, ...event }) => ({
      ...event,
      actorName: actor === null ? "System" : (actor.name ?? actor.email),
    })),
  };
}

/** The most recent notification attempt, by the same order the cooldown reads. */
export function latestNotification(
  events: readonly InvoiceEventRow[],
): InvoiceEventRow | undefined {
  return events.find(
    (event) =>
      event.kind === "notified" || event.kind === "notification_failed",
  );
}

export type ClientInvoiceRow = InvoiceRow & { readonly pastDue: boolean };

/**
 * A client's invoices, every status except `void`, in the list's order, for
 * the client page's Invoices section (AC-13). No paging: one client's own
 * list is expected to stay small.
 *
 * An id that isn't a uuid gets an empty list without reaching the database.
 */
export async function listInvoicesForClient(
  ctx: StaffContext,
  clientId: string,
  todayUtc: string,
): Promise<readonly ClientInvoiceRow[]> {
  const parsed = clientIdSchema.safeParse(clientId);

  if (!parsed.success) {
    return [];
  }

  const rows = await tenantDb(ctx).findMany(invoices, {
    where: and(eq(invoices.clientId, parsed.data), ne(invoices.status, "void")),
  });

  return [...rows].sort(compareForList).map((row) => ({
    ...row,
    pastDue: isPastDue(row.status, row.dueDate, todayUtc),
  }));
}

export type NotifiableContact = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/**
 * The client's contacts with an email, the recipients of the issue email
 * (AC-6). Every `client_contacts` row has an email by schema; the predicate
 * is kept explicit so the rule reads the way the spec states it.
 */
export async function contactsToNotify(
  ctx: StaffContext,
  clientId: string,
): Promise<readonly NotifiableContact[]> {
  const parsed = clientIdSchema.safeParse(clientId);

  if (!parsed.success) {
    return [];
  }

  const rows = await tenantDb(ctx).findMany(clientContacts, {
    where: and(
      eq(clientContacts.clientId, parsed.data),
      isNotNull(clientContacts.email),
    ),
    orderBy: [asc(clientContacts.name), asc(clientContacts.id)],
  });

  return rows
    .filter((row) => row.email.trim() !== "")
    .map((row) => ({ id: row.id, name: row.name, email: row.email }));
}
