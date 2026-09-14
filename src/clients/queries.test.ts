/**
 * @vitest-environment node
 *
 * covers: spec 0006 AC-4, AC-5, AC-11, Value sourcing
 *
 * `tenantDb` itself is proven in `src/db/tenant/accessor.test.ts`; this file
 * is about `listClients`'s own logic on top of it (pagination, page
 * clamping) and that a name search is applied, trimmed, as a case
 * insensitive `ilike`.
 */
import { and, asc, isNotNull, isNull, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clients } from "@/db/schema";

const state = vi.hoisted(() => ({
  findMany: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("@/db/tenant", () => ({
  tenantDb: () => ({ findMany: state.findMany, findById: state.findById }),
}));

vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();

  return { ...actual, ilike: vi.fn(actual.ilike) };
});

const { listClients, getClient, listClientOptions, CLIENTS_PAGE_SIZE } =
  await import("./queries");
const { ilike } = await import("drizzle-orm");

const ctx = { orgId: "org-1" } as never;

const dialect = new PgDialect();

/** The rendered statement, which is what PostgreSQL would receive. */
function render(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error("expected a where clause, got none");
  }

  const query = dialect.sqlToQuery(sql);

  return { sql: query.sql, params: query.params };
}

function whereFromCall(index = 0): SQL | undefined {
  return state.findMany.mock.calls[index]?.[1]?.where as SQL | undefined;
}

function orderByFromCall(index = 0): readonly SQL[] {
  return state.findMany.mock.calls[index]?.[1]?.orderBy as readonly SQL[];
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `client-${index}`,
    name: `Client ${index}`,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listClients", () => {
  it("returns page 1 of 1 for no rows at all", async () => {
    state.findMany.mockResolvedValue([]);

    const result = await listClients(ctx, { archived: false });

    expect(result).toStrictEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("paginates at CLIENTS_PAGE_SIZE, defaulting to page 1 (AC-4)", async () => {
    expect(CLIENTS_PAGE_SIZE).toBe(25);
    state.findMany.mockResolvedValue(rows(30));

    const result = await listClients(ctx, { archived: false });

    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(2);
    expect(result.total).toBe(30);
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0]?.id).toBe("client-0");
  });

  it("returns the remainder on the last page", async () => {
    state.findMany.mockResolvedValue(rows(30));

    const result = await listClients(ctx, { archived: false, pageParam: "2" });

    expect(result.page).toBe(2);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]?.id).toBe("client-25");
  });

  it.each(["0", "-1", "abc", "999"])(
    "clamps an out of range page param (%s) to page 1, never a crash (Value sourcing)",
    async (pageParam) => {
      state.findMany.mockResolvedValue(rows(30));

      const result = await listClients(ctx, { archived: false, pageParam });

      expect(result.page).toBe(1);
    },
  );

  it("orders by name then id, and reads by org through tenantDb (AC-10)", async () => {
    state.findMany.mockResolvedValue([]);

    await listClients(ctx, { archived: false });

    expect(orderByFromCall().map((clause) => render(clause))).toStrictEqual([
      render(asc(clients.name)),
      render(asc(clients.id)),
    ]);
  });

  it("filters to archived or active clients depending on the flag", async () => {
    state.findMany.mockResolvedValue([]);

    await listClients(ctx, { archived: true });
    await listClients(ctx, { archived: false });

    expect(state.findMany).toHaveBeenCalledTimes(2);
    expect(render(whereFromCall(0))).toStrictEqual(
      render(and(isNotNull(clients.archivedAt))),
    );
    expect(render(whereFromCall(1))).toStrictEqual(
      render(and(isNull(clients.archivedAt))),
    );
  });

  it("applies a trimmed, case insensitive name search when given one (AC-5)", async () => {
    state.findMany.mockResolvedValue([]);

    await listClients(ctx, { archived: false, search: "  ada  " });

    expect(ilike).toHaveBeenCalledWith(expect.anything(), "%ada%");
  });

  it("does not search at all for a whitespace only query", async () => {
    state.findMany.mockResolvedValue([]);

    await listClients(ctx, { archived: false, search: "   " });

    expect(ilike).not.toHaveBeenCalled();
  });

  it("resets to page 1 when a search narrows the result set below the requested page", async () => {
    // 30 unfiltered rows would put page 2 in range; the search narrows it to 3.
    state.findMany.mockResolvedValue(rows(3));

    const result = await listClients(ctx, {
      archived: false,
      search: "ada",
      pageParam: "2",
    });

    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(3);
  });
});

describe("getClient", () => {
  const CLIENT_ID = "11111111-1111-7111-8111-111111111111";
  const MISSING_ID = "99999999-9999-7999-8999-999999999999";

  it("returns the row tenantDb finds", async () => {
    state.findById.mockResolvedValue({ id: CLIENT_ID, name: "Acme" });

    const result = await getClient(ctx, CLIENT_ID);

    expect(state.findById).toHaveBeenCalledWith(expect.anything(), CLIENT_ID);
    expect(result).toStrictEqual({ id: CLIENT_ID, name: "Acme" });
  });

  it("returns undefined for a missing id, the same as a foreign agency's id (AC-11)", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await getClient(ctx, MISSING_ID);

    expect(result).toBeUndefined();
  });

  it("returns undefined for an id that is not a uuid, without ever reaching the database (AC-11)", async () => {
    const result = await getClient(ctx, "not-a-uuid");

    expect(state.findById).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("listClientOptions", () => {
  it("returns id and name for every row tenantDb finds", async () => {
    state.findMany.mockResolvedValue([
      { id: "client-1", name: "Acme", companyEmail: "a@example.com" },
      { id: "client-2", name: "Harbour Books" },
    ]);

    const result = await listClientOptions(ctx);

    expect(result).toStrictEqual([
      { id: "client-1", name: "Acme" },
      { id: "client-2", name: "Harbour Books" },
    ]);
  });

  it("only ever asks for active clients, never archived ones (AC-3)", async () => {
    state.findMany.mockResolvedValue([]);

    await listClientOptions(ctx);

    expect(render(whereFromCall())).toStrictEqual(
      render(isNull(clients.archivedAt)),
    );
  });

  it("orders by name then id", async () => {
    state.findMany.mockResolvedValue([]);

    await listClientOptions(ctx);

    expect(orderByFromCall().map((clause) => render(clause))).toStrictEqual([
      render(asc(clients.name)),
      render(asc(clients.id)),
    ]);
  });
});
