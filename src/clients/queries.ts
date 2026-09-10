/**
 * The reads behind `/clients` and `/clients/[id]` (spec 0006).
 *
 * Both go through `tenantDb(ctx)`, scoped to the acting agency by construction
 * (AC-10). There is no path here to another agency's rows (AC-11).
 */
import { and, asc, ilike, isNotNull, isNull, type SQL } from "drizzle-orm";

import { clients } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

import { clientId } from "./schema";

export const CLIENTS_PAGE_SIZE = 25;

export type ClientRow = typeof clients.$inferSelect;

export type ClientListParams = {
  /** The raw `page` URL search param, parsed and clamped here. */
  readonly pageParam?: string;
  readonly search?: string;
  readonly archived: boolean;
};

export type ClientListResult = {
  readonly rows: readonly ClientRow[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

/**
 * `0`, negative, non numeric or past the last page all clamp to page 1
 * (spec 0006, Value sourcing), never a 404 or a crash.
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

/**
 * A page of one agency's clients, active or archived, optionally narrowed by a
 * case insensitive name search.
 *
 * The name search is a substring `ILIKE`, so it cannot use the name index; at
 * the row counts this feature expects that scan is acceptable (spec 0006, key
 * invariants).
 */
export async function listClients(
  ctx: StaffContext,
  { pageParam, search, archived }: ClientListParams,
): Promise<ClientListResult> {
  const db = tenantDb(ctx);
  const trimmed = search?.trim();

  const where: SQL | undefined = and(
    archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
    trimmed ? ilike(clients.name, `%${trimmed}%`) : undefined,
  );

  const matches = await db.findMany(clients, {
    where,
    orderBy: [asc(clients.name), asc(clients.id)],
  });

  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));
  const page = clampPage(pageParam, pageCount);
  const start = (page - 1) * CLIENTS_PAGE_SIZE;

  return {
    rows: matches.slice(start, start + CLIENTS_PAGE_SIZE),
    page,
    pageCount,
    total,
  };
}

/**
 * `undefined` for a missing id, another agency's id, and one that isn't even
 * a uuid alike (AC-11). `clients.id` is a uuid column, so an unparsed id
 * would otherwise reach the database as a malformed query instead of
 * resolving not found — this is the one place both `[id]` pages read a
 * client, so validating here covers both without a page level check.
 */
export async function getClient(
  ctx: StaffContext,
  id: string,
): Promise<ClientRow | undefined> {
  const parsed = clientId.safeParse(id);

  return parsed.success
    ? tenantDb(ctx).findById(clients, parsed.data)
    : undefined;
}
