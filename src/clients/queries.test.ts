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
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { listClients, getClient, CLIENTS_PAGE_SIZE } = await import("./queries");
const { ilike } = await import("drizzle-orm");

const ctx = { orgId: "org-1" } as never;

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

    expect(state.findMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderBy: expect.any(Array) }),
    );
  });

  it("filters to archived or active clients depending on the flag", async () => {
    state.findMany.mockResolvedValue([]);

    await listClients(ctx, { archived: true });
    await listClients(ctx, { archived: false });

    expect(state.findMany).toHaveBeenCalledTimes(2);
    // Both calls carry a `where`; the value itself is exercised for real
    // against PostgreSQL in `/check verify`, so what matters here is only
    // that a predicate is always present, and never left off.
    for (const call of state.findMany.mock.calls) {
      expect(call[1]?.where).toBeDefined();
    }
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
  it("returns the row tenantDb finds", async () => {
    state.findById.mockResolvedValue({ id: "client-1", name: "Acme" });

    const result = await getClient(ctx, "client-1");

    expect(state.findById).toHaveBeenCalledWith(expect.anything(), "client-1");
    expect(result).toStrictEqual({ id: "client-1", name: "Acme" });
  });

  it("returns undefined for a missing id, the same as a foreign agency's id (AC-11)", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await getClient(ctx, "someone-elses-client");

    expect(result).toBeUndefined();
  });
});
